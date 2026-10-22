'use client';

import { ScoreExplanation } from '../../../_components/ScoreExplanation';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { t } from '../../../../lib/i18n';
import { cn } from '../../../../lib/cn';
import { S } from '../../dashboard-shared';
import { statusToneClass } from '../../../_components/StatusToneChip';
import { Icon } from '../../../_components/Icon';
import { AppLoading, ContentEnter } from '../../../_components/AppLoading';
import { ChartPanel, ChartLegend } from '../../../_components/ChartPanel';
import { StackedSegmentBar } from '../../../_components/StackedSegmentBar';
import { CHART_MIN_N, turnoverRiskDistribution } from '../../../../lib/chart-aggregates';

const SIGNAL_META = {
  climate: { emoji: '🌡️', labelKey: 'turnoverRadar.signalLabelClimate', hintKey: 'turnoverRadar.signalClimateHint' },
  motivators: { emoji: '💪', labelKey: 'turnoverRadar.signalLabelMotivators', hintKey: 'turnoverRadar.signalMotivatorsHint' },
  pdi: { emoji: '📈', labelKey: 'turnoverRadar.signalLabelPdi', hintKey: 'turnoverRadar.signalPdiHint' },
  checkins: { emoji: '✅', labelKey: 'turnoverRadar.signalLabelCheckins', hintKey: 'turnoverRadar.signalCheckinsHint' },
};

function actionHref(action, candidateId) {
  const cid = encodeURIComponent(String(candidateId));
  switch (action) {
    case 'review_climate':
      return '/dashboard?tab=climate';
    case 'accelerate_pdi':
      return `/dashboard?tab=team&candidate=${cid}&section=journey`;
    case 'schedule_one_on_one':
      return `/dashboard?tab=team&candidate=${cid}&section=oneOnOne`;
    case 'motivators_interview':
      return `/dashboard?tab=team&candidate=${cid}&section=briefing`;
    default:
      return null;
  }
}

/**
 * Card de Turnover Radar na Overview (B-1002)
 * Lista colaboradores em risco médio/alto + distribuição low/med/high (B-3028)
 */
export default function TurnoverRadarCard({ locale, companyId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!companyId) return;

    const fetchRisks = async () => {
      try {
        setLoading(true);
        const res = await fetch(`/api/admin/turnover-radar/company?companyId=${companyId}`);
        if (!res.ok) throw new Error('fetch_failed');
        const json = await res.json();
        setData(json);
      } catch (err) {
        console.error('[TurnoverRadarCard] Error:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchRisks();
  }, [companyId]);

  const dist = useMemo(
    () => turnoverRiskDistribution(data?.distribution),
    [data?.distribution]
  );

  const showDist = dist.scanned >= CHART_MIN_N;

  const distSegments = useMemo(
    () => [
      {
        id: 'high',
        value: dist.high,
        toneClass: 'bg-danger',
        label: t(locale, 'turnoverRadar.riskHigh'),
      },
      {
        id: 'medium',
        value: dist.medium,
        toneClass: 'bg-warning',
        label: t(locale, 'turnoverRadar.riskMedium'),
      },
      {
        id: 'low',
        value: dist.low,
        toneClass: 'bg-success',
        label: t(locale, 'turnoverRadar.riskLow'),
      },
    ],
    [dist, locale]
  );

  const riskTone = (risk) => {
    if (risk === 'high') return 'danger';
    if (risk === 'medium') return 'warning';
    return 'success';
  };

  const riskTextClass = (risk) => {
    const tone = riskTone(risk);
    if (tone === 'danger') return 'text-danger';
    if (tone === 'warning') return 'text-warning';
    return 'text-success';
  };

  const getRiskIcon = (risk) => {
    if (risk === 'high') return 'alert';
    if (risk === 'medium') return 'infoCircle';
    return 'check';
  };

  if (loading) {
    return (
      <div className={S.card}>
        <AppLoading locale={locale} variant="inline" />
      </div>
    );
  }

  const risks = Array.isArray(data?.risks) ? data.risks : [];
  const hasList = risks.length > 0;

  if (!data || (dist.scanned === 0 && !hasList)) {
    return (
      <div className={S.card}>
        <h3 className={cn(S.cardTitle, 'mb-1')}>{t(locale, 'turnoverRadar.title')}</h3>
        <p className={cn(S.cardSubtitle, 'mb-2')}>{t(locale, 'turnoverRadar.subtitle')}</p>
        <p className={cn(S.cardMuted, 'm-0 mb-3')}>{t(locale, 'turnoverRadar.noRisks')}</p>
        <Link href="/dashboard?tab=team" className={cn(S.cardLink, 'inline-flex min-h-touch items-center')}>
          {t(locale, 'turnoverRadar.openTeamCta')}
        </Link>
      </div>
    );
  }

  const atRiskLabel =
    risks.length === 1
      ? t(locale, 'turnoverRadar.peopleAtRiskOne')
      : risks.length > 0
        ? t(locale, 'turnoverRadar.peopleAtRiskMany', { n: risks.length })
        : t(locale, 'turnoverRadar.noAtRiskList');

  return (
    <ContentEnter animKey={`turnover|${companyId}|${dist.scanned}|${risks.length}`}>
    <div className={S.card}>
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h3 className={cn(S.cardTitle, 'mb-1')}>{t(locale, 'turnoverRadar.title')}</h3>
          <p className={S.cardSubtitle}>{t(locale, 'turnoverRadar.subtitle')}</p>
          <p className={cn(S.cardMuted, 'mt-1')}>{atRiskLabel}</p>
          {data.truncated ? (
            <p className={cn(S.cardMuted, 'mt-1 text-xs')}>
              {t(locale, 'turnoverRadar.scanTruncated', {
                scanned: data.scanned || data.scanCap,
                cap: data.scanCap,
              })}
            </p>
          ) : null}
        </div>
      </div>

      {showDist ? (
        <ChartPanel
          className="mb-4"
          title={t(locale, 'turnoverRadar.distTitle')}
          hint={t(locale, 'turnoverRadar.distHint', { n: dist.scanned })}
        >
          <StackedSegmentBar
            segments={distSegments}
            height={10}
            aria-label={t(locale, 'turnoverRadar.distTitle')}
            className="mb-2"
          />
          <ChartLegend items={distSegments} total={dist.scanned} />
        </ChartPanel>
      ) : null}

      {!hasList ? (
        <p className={cn(S.cardMuted, 'mb-0')}>{t(locale, 'turnoverRadar.noAtRiskList')}</p>
      ) : (
      <div className="space-y-3">
        {risks.slice(0, 8).map((person) => {
          const riskLabel =
            person.risk === 'high'
              ? t(locale, 'turnoverRadar.riskHigh')
              : person.risk === 'medium'
                ? t(locale, 'turnoverRadar.riskMedium')
                : t(locale, 'turnoverRadar.riskLow');
          const riskScoreHint = t(locale, 'turnoverRadar.riskScoreHint');

          return (
            <div
              key={person.candidateId}
              className="flex items-start gap-3 rounded-card border border-ink/8 bg-ink/[0.02] p-3"
            >
              <div
                className={cn(
                  'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border',
                  statusToneClass(riskTone(person.risk))
                )}
                title={riskLabel}
                aria-label={riskLabel}
              >
                <Icon name={getRiskIcon(person.risk)} className="h-4 w-4" />
              </div>

              <div className="min-w-0 flex-1">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <Link
                      href={`/dashboard?tab=team&candidate=${person.candidateId}`}
                      className={cn(S.cardRowTitle, 'hover:underline')}
                    >
                      {person.candidateName}
                    </Link>
                    <Link
                      href={`/dashboard?tab=team&candidate=${person.candidateId}&section=journey`}
                      title={t(locale, 'turnoverRadar.viewPdi')}
                      aria-label={t(locale, 'turnoverRadar.viewPdi')}
                      className={cn(S.cardChip, 'border-brand-500/30 text-brand-600 hover:bg-brand-500/[0.12]')}
                    >
                      <Icon name="leadership" className="h-3 w-3" />
                      PDI
                    </Link>
                  </div>
                  <span
                    className={cn(
                      'cursor-help',
                      S.cardMetric,
                      riskTextClass(person.risk)
                    )}
                    title={`${riskLabel}: ${person.riskScore}. ${riskScoreHint}`}
                    aria-label={`${riskLabel}: ${person.riskScore}. ${riskScoreHint}`}
                  >
                    {person.riskScore}
                  </span>
                </div>

                {person.area ? <div className={cn(S.cardMuted, 'mb-2')}>{person.area}</div> : null}

                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(person.signals || {}).map(([key, signal]) => {
                    if (!signal || signal.score < 40) return null;
                    const meta = SIGNAL_META[key];
                    if (!meta) return null;
                    const label = t(locale, meta.labelKey);
                    const hint = t(locale, meta.hintKey);
                    const tip = `${label}: ${signal.score}. ${hint}`;
                    return (
                      <span
                        key={key}
                        className={cn(S.cardChip, 'cursor-help')}
                        title={tip}
                        aria-label={tip}
                      >
                        <span aria-hidden>{meta.emoji}</span> {signal.score}
                      </span>
                    );
                  })}
                </div>

                {Array.isArray(person.actions) && person.actions.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {person.actions.map((action) => {
                      const href = actionHref(action, person.candidateId);
                      if (!href) return null;
                      return (
                        <Link
                          key={action}
                          href={href}
                          className={cn(S.cardChip, 'border-brand-500/25 text-brand-600 hover:bg-brand-500/[0.1]')}
                          title={t(locale, `turnoverRadar.action.${action}`)}
                        >
                          {t(locale, `turnoverRadar.action.${action}`)}
                        </Link>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      )}

      <ScoreExplanation locale={locale} kind="attention" />
      {risks.length > 8 ? (
        <div className="mt-4 text-center">
          <Link
            href="/dashboard?tab=team&roster=internal&filter=turnover_risk"
            className={cn(S.cardLink, 'hover:underline')}
          >
            {t(locale, 'turnoverRadar.viewAll', { n: risks.length })}
          </Link>
        </div>
      ) : null}
    </div>
    </ContentEnter>
  );
}
