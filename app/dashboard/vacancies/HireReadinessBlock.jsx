'use client';

import { useEffect, useState } from 'react';
import { cn } from '../../../lib/cn';
import { t } from '../../../lib/i18n';
import { S } from '../dashboard-shared';
import { computeHireReadiness } from '../../../lib/recruiting/hire-readiness';

/**
 * Compact advisory checklist before hire — progressive disclosure companion
 * to brief / offer / scorecard on the interview card.
 */
export function HireReadinessBlock({
  vacancyId,
  candidateId,
  locale = 'pt-BR',
  row,
}) {
  const [scorecardComplete, setScorecardComplete] = useState(null);

  useEffect(() => {
    let cancelled = false;
    if (!vacancyId || !candidateId) {
      setScorecardComplete(null);
      return undefined;
    }
    (async () => {
      try {
        const res = await fetch(
          `/api/admin/vacancies/${encodeURIComponent(vacancyId)}/candidates/${encodeURIComponent(candidateId)}/scorecard`
        );
        const data = await res.json().catch(() => ({}));
        if (cancelled || !res.ok) return;
        const items = Array.isArray(data.scorecard?.items) ? data.scorecard.items : [];
        if (items.length === 0) {
          setScorecardComplete(false);
          return;
        }
        setScorecardComplete(items.every((it) => it.rating != null && Number(it.rating) >= 1));
      } catch {
        if (!cancelled) setScorecardComplete(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [vacancyId, candidateId, row?.offerStatus, row?.pipelineStage]);

  const readiness = computeHireReadiness(row, { scorecardComplete });

  return (
    <div className="mb-3 rounded-control border border-ink/12 bg-canvas/50 px-3 py-2.5">
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <span className={cn(S.cardSection, 'mb-0 block')}>{t(locale, 'recruiting.hireReadyTitle')}</span>
        <span
          className={cn(
            'font-mono text-2xs',
            readiness.ready ? 'text-success' : 'text-ink-muted'
          )}
        >
          {t(locale, 'recruiting.hireReadyCount', {
            done: readiness.readyCount,
            total: readiness.total,
          })}
        </span>
      </div>
      <p className={cn(S.faint, 'm-0 mb-2')}>{t(locale, 'recruiting.hireReadyHint')}</p>
      <ul className="m-0 list-none space-y-1 p-0">
        {readiness.checks.map((c) => (
          <li
            key={c.id}
            className={cn(
              'font-mono text-2xs leading-snug',
              c.ok ? 'text-success' : c.required ? 'text-ink-muted' : 'text-ink-faint'
            )}
          >
            {c.ok ? '✓' : '○'}{' '}
            {t(locale, `recruiting.hireReadyCheck_${c.id}`)}
            {!c.required ? (
              <span className="text-ink-faint"> · {t(locale, 'recruiting.hireReadyOptional')}</span>
            ) : null}
          </li>
        ))}
      </ul>
      {readiness.ready ? (
        <p className="m-0 mt-2 font-mono text-2xs text-success">
          {t(locale, 'recruiting.hireReadyOk')}
        </p>
      ) : null}
    </div>
  );
}
