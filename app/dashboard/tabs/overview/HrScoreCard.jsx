'use client';

import { ScoreExplanation } from '../../../_components/ScoreExplanation';

import { useMemo, useState, useEffect } from 'react';
import Link from 'next/link';
import { t } from '../../../../lib/i18n';
import { cn } from '../../../../lib/cn';
import { S } from '../../dashboard-shared';
import { Icon } from '../../../_components/Icon';
import { AppLoading, ContentEnter } from '../../../_components/AppLoading';
import { useAppFeedback } from '../../../_components/AppFeedback';
import { CategoryBars } from '../../../_components/CategoryBars';
import { ChartPanel } from '../../../_components/ChartPanel';
import { hrScoreAreaBars } from '../../../../lib/chart-aggregates';

/**
 * Card de HR Score na Overview
 * Mostra média da empresa + rollup por área + top/bottom performers
 * B-3025 — barras ordenadas por área.
 */
export default function HrScoreCard({ locale, companyId, isAdmin }) {
  const { confirm, toast } = useAppFeedback();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!companyId) return;

    const fetchScores = async () => {
      try {
        setLoading(true);
        setError(false);
        const params = new URLSearchParams({ companyId: String(companyId) });
        const res = await fetch(`/api/admin/hr-score/company?${params}`);
        if (!res.ok) throw new Error('fetch_failed');
        const json = await res.json();
        setData(json);
      } catch (err) {
        console.error('[HrScoreCard] Fetch error:', err);
        setError(true);
      } finally {
        setLoading(false);
      }
    };

    fetchScores();
  }, [companyId]);

  const areaBars = useMemo(() => {
    const rows = hrScoreAreaBars(data?.byArea || [], { limit: 8 });
    return rows.map((r) => ({
      id: r.id,
      label: r.label,
      value: r.value,
      count: r.count,
      toneClass:
        r.value >= 75 ? 'bg-success' : r.value >= 50 ? 'bg-warning' : 'bg-danger',
    }));
  }, [data]);

  const areaTotal = data?.byArea?.length || 0;
  const areaCapNote =
    areaTotal > areaBars.length
      ? t(locale, 'hrScore.byAreaCap', { shown: areaBars.length, total: areaTotal })
      : null;

  if (loading) {
    return (
      <div className={S.card}>
        <AppLoading locale={locale} variant="inline" label={t(locale, 'hrScore.calculating')} />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className={S.card}>
        <div className={S.cardFaint}>{t(locale, 'hrScore.notAvailable')}</div>
      </div>
    );
  }

  const { overall, topPerformers, bottomPerformers } = data;

  const getScoreColor = (score) => {
    if (score >= 75) return 'text-success';
    if (score >= 50) return 'text-warning';
    return 'text-danger';
  };

  const peopleLabel =
    overall.total === 1
      ? t(locale, 'hrScore.peopleOne')
      : t(locale, 'hrScore.peopleMany', { n: overall.total });

  const recalculate = async () => {
    const ok = await confirm({
      message: t(locale, 'hrScore.recalculateConfirm'),
    });
    if (!ok) return;
    try {
      const res = await fetch('/api/admin/hr-score/recalculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId }),
      });
      if (!res.ok) throw new Error('recalc_failed');
      toast(t(locale, 'hrScore.recalculated'), 'ok');
      window.location.reload();
    } catch {
      toast(t(locale, 'hrScore.recalculateFailed'), 'error');
    }
  };

  return (
    <ContentEnter animKey={`hr-score|${companyId}|${overall.total}`}>
    <div className={S.card}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className={cn(S.cardTitle, 'mb-1 flex items-center gap-1.5')}>
            {t(locale, 'hrScore.title')}
            <span
              className="inline-flex cursor-help text-ink-faint"
              title={t(locale, 'hrScore.description')}
              aria-label={t(locale, 'hrScore.description')}
            >
              <Icon name="infoCircle" className="h-3.5 w-3.5" />
            </span>
          </h3>
          <p className={S.cardSubtitle}>{t(locale, 'hrScore.companyOverview')}</p>
        </div>
        {isAdmin && (
          <button
            type="button"
            onClick={() => void recalculate()}
            className={cn(S.btnGhost, 'px-3 py-1.5 text-xs')}
          >
            {t(locale, 'hrScore.recalculate')}
          </button>
        )}
      </div>

      <ScoreExplanation locale={locale} kind="hr" sampleCount={overall.total} />
      {overall.total === 0 ? (
        <div className={cn('py-8 text-center', S.cardMuted)}>{t(locale, 'hrScore.noScores')}</div>
      ) : (
        <>
          <div className="mb-4 flex items-center justify-between rounded-card border border-ink/8 bg-ink/[0.02] p-4">
            <div>
              <div
                className={cn('cursor-help', S.cardMuted)}
                title={t(locale, 'hrScore.avgScoreHint')}
              >
                {t(locale, 'hrScore.avgScore')}
              </div>
              <div className={S.cardFaint}>{peopleLabel}</div>
            </div>
            <div className="text-center">
              <div
                className={cn(
                  'cursor-help',
                  S.cardMetricHero,
                  getScoreColor(overall.avgScore)
                )}
                title={t(locale, 'hrScore.avgScoreHint')}
                aria-label={`${t(locale, 'hrScore.avgScore')}: ${overall.avgScore}. ${t(locale, 'hrScore.avgScoreHint')}`}
              >
                {overall.avgScore}
              </div>
              <div
                className={cn('cursor-help', S.cardMuted)}
                title={t(locale, 'hrScore.scoreRangeHint')}
                aria-label={`${overall.minScore}–${overall.maxScore}. ${t(locale, 'hrScore.scoreRangeHint')}`}
              >
                {overall.minScore}–{overall.maxScore}
              </div>
            </div>
          </div>

          {areaBars.length > 0 ? (
            <ChartPanel
              className="mb-4"
              title={t(locale, 'hrScore.byArea')}
              hint={t(locale, 'hrScore.byAreaHint')}
              actions={
                <Link
                  href="/dashboard?tab=team"
                  className={cn(S.cardLink, 'font-mono text-2xs')}
                >
                  {t(locale, 'hrScore.openTeam')}
                </Link>
              }
            >
              <CategoryBars
                items={areaBars.map((r) => ({
                  ...r,
                  label:
                    r.count > 0
                      ? `${r.label} · ${r.count}`
                      : r.label,
                }))}
                max={100}
                height={8}
              />
              {areaCapNote ? (
                <p className="mb-0 mt-2.5 font-mono text-2xs text-ink-faint">{areaCapNote}</p>
              ) : null}
            </ChartPanel>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            {topPerformers.length > 0 && (
              <div>
                <h4
                  className={cn(S.cardSection, 'cursor-help')}
                  title={t(locale, 'hrScore.topPerformersHint')}
                >
                  {t(locale, 'hrScore.topPerformers')}
                </h4>
                <ul className="space-y-1.5">
                  {topPerformers.slice(0, 3).map((person) => (
                    <li key={person.id} className="flex items-center justify-between gap-2">
                      <Link
                        href={`/dashboard?tab=team&candidate=${person.id}`}
                        className={cn(S.cardRowTitle, 'hover:underline')}
                      >
                        {person.fullName}
                      </Link>
                      <span
                        className={cn(
                          'ml-2 cursor-help',
                          S.cardMetric,
                          getScoreColor(person.score)
                        )}
                        title={t(locale, 'hrScore.personScoreHint')}
                      >
                        {person.score}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {bottomPerformers.length > 0 && (
              <div>
                <h4
                  className={cn(S.cardSection, 'cursor-help')}
                  title={t(locale, 'hrScore.bottomPerformersHint')}
                >
                  {t(locale, 'hrScore.bottomPerformers')}
                </h4>
                <ul className="space-y-1.5">
                  {bottomPerformers.slice(0, 3).map((person) => (
                    <li key={person.id} className="flex items-center justify-between gap-2">
                      <Link
                        href={`/dashboard?tab=team&candidate=${person.id}`}
                        className={cn(S.cardRowTitle, 'hover:underline')}
                      >
                        {person.fullName}
                      </Link>
                      <div className="ml-2 flex items-center gap-1">
                        <span
                          className={cn(
                            'cursor-help',
                            S.cardMetric,
                            getScoreColor(person.score)
                          )}
                          title={t(locale, 'hrScore.personScoreHint')}
                        >
                          {person.score}
                        </span>
                        {person.turnoverRisk === 'high' && (
                          <span
                            className="inline-flex text-danger"
                            title={t(locale, 'hrScore.highTurnoverHint')}
                            aria-label={t(locale, 'hrScore.highTurnoverHint')}
                          >
                            <Icon name="alert" className="h-3 w-3" />
                          </span>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <p className={cn(S.cardFaint, 'mt-4')}>{t(locale, 'hrScore.hedgingNote')}</p>
        </>
      )}
    </div>
    </ContentEnter>
  );
}
