'use client';
import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { cn } from '../../../../lib/cn';
import { S } from '../../dashboard-shared';
import { InsightListItem } from '../../../_components/InsightListItem';
import { AppLoading, ContentEnter } from '../../../_components/AppLoading';
import { CategoryBars } from '../../../_components/CategoryBars';
import { ChartPanel } from '../../../_components/ChartPanel';
import { CHART_MIN_N, topCategoryCounts } from '../../../../lib/analytics/chart-aggregates';
import { t as i18nT, messageNode } from '../../../../lib/i18n';


export default function ExitInsightsCard({ locale = 'pt-BR', companyId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  function t(key, values = {}) {
    const path = `adminModules.exitInsights.${key}`;
    const out = i18nT(locale, path, values);
    return out === path ? key : out;
  }

  function reasonLabel(id) {
    return messageNode(locale, 'adminModules.exitReasons')[id] || id;
  }

  useEffect(() => {
    loadInsights();
  }, [companyId]);

  async function loadInsights() {
    if (!companyId) return;
    setLoading(true);
    try {
      const qs = companyId ? `?companyId=${encodeURIComponent(companyId)}` : '';
      const res = await fetch(`/api/admin/exit-analysis/insights${qs}`);
      const json = await res.json();
      if (json.ok) {
        setData(json);
      }
    } catch (err) {
      console.error('Failed to load exit insights:', err);
    } finally {
      setLoading(false);
    }
  }

  const reasonBars = useMemo(() => {
    if (!data?.reasonAgg?.length) return [];
    return topCategoryCounts(data.reasonAgg, { key: 'exitReason', limit: 5 }).map((r) => ({
      id: r.id,
      label: reasonLabel(r.id),
      value: r.value,
      toneClass: 'rounded-full bg-warning',
    }));
  }, [data, locale]);

  if (loading) {
    return (
      <div className={S.card}>
        <AppLoading locale={locale} variant="inline" />
      </div>
    );
  }

  if (!data || data.total === 0) {
    return (
      <div className={S.card}>
        <div className="mb-4">
          <h3 className={S.cardTitle}>{t('title')}</h3>
          <p className={cn(S.cardSubtitle, 'mt-0.5')}>{t('subtitle')}</p>
        </div>
        <p className={S.cardMuted}>{t('noExits')}</p>
      </div>
    );
  }

  const recruitmentInsights = data.insights.filter((i) => i.category === 'recruitment');
  const managementInsights = data.insights.filter((i) => i.category === 'management');
  const showReasons = data.total >= CHART_MIN_N && reasonBars.length > 0;

  return (
    <ContentEnter animKey={`exit-insights|${companyId}|${data.total}`}>
    <div className={S.card}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className={S.cardTitle}>{t('title')}</h3>
          <p className={cn(S.cardSubtitle, 'mt-0.5')}>{t('subtitle')}</p>
        </div>
        <span className="rounded bg-canvas-alt px-2 py-1 font-mono text-2xs font-medium tabular-nums text-ink-muted">
          {data.total} {t('totalExits')}
        </span>
      </div>

      {showReasons ? (
        <ChartPanel
          className="mb-4"
          title={t('reasonsTitle')}
          hint={t('reasonsHint')}
        >
          <CategoryBars items={reasonBars} height={8} total={data.total} />
        </ChartPanel>
      ) : null}

      {recruitmentInsights.length === 0 && managementInsights.length === 0 ? (
        showReasons ? (
          <p className={cn(S.cardMuted, 'mb-0 text-xs')}>{t('noPatternYet')}</p>
        ) : (
          <p className={cn(S.cardMuted, 'mb-0 text-xs')}>{t('lowVolume')}</p>
        )
      ) : (
      <div className="space-y-4">
        {recruitmentInsights.length > 0 && (
          <div>
            <h4 className={S.cardSection}>{t('recruitment')}</h4>
            <div className="space-y-2">
              {recruitmentInsights.map((insight, idx) => (
                <InsightListItem
                  key={idx}
                  title={insight.description}
                  body={insight.suggestion}
                  tone={insight.severity === 'high' ? 'danger' : 'warning'}
                  toneLabel={insight.severity === 'high' ? t('high') : t('medium')}
                >
                  <p className={cn(S.cardFaint, 'mt-1')}>
                    {insight.percentage}% {t('ofExits')} ({insight.count})
                  </p>
                </InsightListItem>
              ))}
            </div>
          </div>
        )}

        {managementInsights.length > 0 && (
          <div>
            <h4 className={S.cardSection}>{t('management')}</h4>
            <div className="space-y-2">
              {managementInsights.map((insight, idx) => (
                <InsightListItem
                  key={idx}
                  title={insight.description}
                  body={insight.suggestion}
                  tone={insight.severity === 'high' ? 'danger' : 'warning'}
                  toneLabel={insight.severity === 'high' ? t('high') : t('medium')}
                >
                  <p className={cn(S.cardFaint, 'mt-1')}>
                    {insight.percentage}% {t('ofExits')} ({insight.count})
                  </p>
                </InsightListItem>
              ))}
            </div>
          </div>
        )}
      </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-ink/5 pt-4">
        <Link href="/dashboard?tab=exit-analysis" className={S.cardLink}>
          {t('viewAll')}
        </Link>
        <Link href="/dashboard?tab=company-benefits" className={S.cardLink}>
          {t('linkBenefits')}
        </Link>
        <Link href="/dashboard?tab=team" className={S.cardLink}>
          {t('linkTeam')}
        </Link>
      </div>
    </div>
    </ContentEnter>
  );
}
