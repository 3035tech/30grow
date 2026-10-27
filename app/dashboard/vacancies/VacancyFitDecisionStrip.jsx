'use client';

import { useEffect, useState } from 'react';
import { cn } from '../../../lib/cn';
import { t } from '../../../lib/i18n';
import { getTypeData } from '../../../lib/i18n-data';
import { computeAreaScore010 } from '../../../lib/assessment/area-fit';
import { fitTypeAlignment } from '../../../lib/recruiting/vacancy-report-shared';
import { S } from '../dashboard-shared';

/** Module cache: vacancyId → weights object (or null). */
const weightsCache = new Map();

function scoreTone(score) {
  if (score == null) return 'text-ink-muted';
  if (score >= 7.5) return 'text-success';
  if (score >= 5) return 'text-ink';
  return 'text-warning';
}

/**
 * Compact Fit strip for vacancy candidate expand: score, aligned/gap types, hedged probe.
 * Prefers `scores` from parent (candidate expand fetch); loads rubric weights once per vacancy.
 */
export function VacancyFitDecisionStrip({
  vacancyId,
  locale = 'pt-BR',
  /** Assessment scores for this vacancy when already loaded by parent. */
  scores = null,
}) {
  const [weights, setWeights] = useState(() =>
    vacancyId && weightsCache.has(String(vacancyId))
      ? weightsCache.get(String(vacancyId))
      : undefined
  );
  const [loading, setLoading] = useState(weights === undefined);

  useEffect(() => {
    let cancelled = false;
    if (!vacancyId) {
      setWeights(null);
      setLoading(false);
      return undefined;
    }

    const vid = String(vacancyId);
    if (weightsCache.has(vid)) {
      setWeights(weightsCache.get(vid));
      setLoading(false);
      return undefined;
    }

    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/admin/vacancies/${encodeURIComponent(vacancyId)}`);
        const data = await res.json().catch(() => ({}));
        let w = null;
        if (res.ok) {
          w = data.vacancyFitWeights || data.desiredTypeWeights || null;
          if (w && typeof w === 'object' && Object.keys(w).length === 0) w = null;
        }
        weightsCache.set(vid, w);
        if (!cancelled) setWeights(w);
      } catch {
        if (!cancelled) setWeights(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [vacancyId]);

  if (loading) {
    return (
      <div className="mb-3 rounded-control border border-ink/12 bg-canvas/50 px-3 py-2">
        <p className={cn(S.faint, 'm-0')}>{t(locale, 'recruiting.fitDecisionLoading')}</p>
      </div>
    );
  }

  if (!weights || !scores) {
    return (
      <div className="mb-3 rounded-control border border-ink/12 bg-canvas/40 px-3 py-2">
        <span className={cn(S.cardSection, 'mb-0 block')}>{t(locale, 'recruiting.fitDecisionTitle')}</span>
        <p className={cn(S.faint, 'm-0 mt-1')}>{t(locale, 'recruiting.fitDecisionEmpty')}</p>
      </div>
    );
  }

  const { score010, breakdown } = computeAreaScore010(scores, weights, { withBreakdown: true });
  const align = fitTypeAlignment(scores, weights);
  const aligned = align.alignedTypes || [];
  const gaps = align.gapTypes || [];
  const typeData = getTypeData(locale);
  const topGap = gaps[0];
  const challenge = topGap != null ? String(typeData[topGap]?.challenge || '').trim() : '';
  const probe = challenge
    ? t(locale, 'recruiting.fitDecisionProbe', { challenge })
    : null;
  const topContrib = Array.isArray(breakdown?.types) ? breakdown.types.slice(0, 3) : [];

  return (
    <div className="mb-3 rounded-control border border-ink/12 bg-canvas/50 px-3 py-2.5">
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <span className={cn(S.cardSection, 'mb-0 block')}>{t(locale, 'recruiting.fitDecisionTitle')}</span>
        {score010 != null ? (
          <span className={cn('font-mono text-xs font-semibold', scoreTone(score010))}>
            {t(locale, 'recruiting.fitDecisionScore', { score: score010 })}
          </span>
        ) : (
          <span className="font-mono text-2xs text-ink-muted">
            {t(locale, 'recruiting.fitDecisionNoScore')}
          </span>
        )}
      </div>
      <p className={cn(S.faint, 'm-0 mb-2')}>{t(locale, 'recruiting.fitDecisionHint')}</p>
      {topContrib.length > 0 ? (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {topContrib.map((c) => (
            <span
              key={c.type}
              className="rounded-control border border-ink/10 bg-surface/70 px-2 py-0.5 font-mono text-2xs text-ink-muted"
              title={t(locale, 'recruiting.fitDecisionContribTitle', {
                type: `T${c.type}`,
                weight: c.weight,
              })}
            >
              {t(locale, 'recruiting.fitDecisionContribChip', {
                type: `T${c.type}`,
                contribution: c.contribution,
              })}
            </span>
          ))}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-2xs">
        {aligned.length > 0 ? (
          <span className="text-success">
            {t(locale, 'recruiting.fitDecisionAligned', {
              types: aligned.map((x) => `T${x}`).join(', '),
            })}
          </span>
        ) : null}
        {gaps.length > 0 ? (
          <span className="text-warning">
            {t(locale, 'recruiting.fitDecisionGaps', {
              types: gaps.map((x) => `T${x}`).join(', '),
            })}
          </span>
        ) : null}
      </div>
      {probe ? (
        <p className="m-0 mt-2 text-xs leading-snug text-ink-muted">{probe}</p>
      ) : null}
    </div>
  );
}
