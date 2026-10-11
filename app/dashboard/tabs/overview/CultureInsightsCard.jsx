'use client';
import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { ListLoadError } from '../../../_components/ListLoadError';
import { cn } from '../../../../lib/cn';
import { S } from '../../dashboard-shared';
import { InsightListItem } from '../../../_components/InsightListItem';
import { StatusToneChip } from '../../../_components/StatusToneChip';
import { AppLoading } from '../../../_components/AppLoading';
import { t as i18nT } from '../../../../lib/i18n';

export default function CultureInsightsCard({ locale = 'pt-BR', companyId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showFull, setShowFull] = useState(false);
  const [error, setError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [fullLoading, setFullLoading] = useState(false);
  const requestVersion = useRef(0);

  function t(key, values = {}) {
    const path = `adminModules.cultureInsights.${key}`;
    const out = i18nT(locale, path, values);
    return out === path ? key : out;
  }

  useEffect(() => {
    const version = ++requestVersion.current;
    const controller = new AbortController();
    setData(null);
    setShowFull(false);
    setError(null);
    setFullLoading(false);
    if (!companyId) {
      setLoading(false);
      return () => { requestVersion.current++; };
    }
    setLoading(true);
    async function loadData() {
      try {
        const params = new URLSearchParams({ companyId: String(companyId), summary: 'true' });
        const res = await fetch(`/api/admin/organizational-culture?${params}`, { signal: controller.signal });
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || String(res.status));
        if (version === requestVersion.current) setData(json.summary);
      } catch (err) {
        if (version === requestVersion.current && !controller.signal.aborted) setError(err.message);
      } finally {
        if (version === requestVersion.current) setLoading(false);
      }
    }
    void loadData();
    return () => {
      controller.abort();
      requestVersion.current++;
    };
  }, [companyId, reloadKey]);

  async function loadFullInsights() {
    if (!companyId || fullLoading) return;
    const version = requestVersion.current;
    setFullLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ companyId: String(companyId) });
      const res = await fetch(`/api/admin/organizational-culture?${params}`);
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || String(res.status));
      if (version === requestVersion.current) {
        setData((current) => ({ ...current, fullCulture: json.culture }));
        setShowFull(true);
      }
    } catch (err) {
      if (version === requestVersion.current) setError(err.message);
    } finally {
      if (version === requestVersion.current) setFullLoading(false);
    }
  }

  function healthTone(health) {
    switch (health) {
      case 'positive':
        return 'success';
      case 'neutral':
        return 'warning';
      case 'concern':
        return 'danger';
      default:
        return 'neutral';
    }
  }

  function getCategoryIcon(category) {
    switch (category) {
      case 'climate':
        return '🌡️';
      case 'type_mix':
        return '🧩';
      case 'pulse':
        return '📊';
      case 'alignment':
        return '🎯';
      default:
        return '💡';
    }
  }

  if (loading) {
    return (
      <div className={S.card}>
        <AppLoading locale={locale} variant="inline" />
      </div>
    );
  }

  if (error) {
    return <div className={S.card}><ListLoadError locale={locale} message={t('loadError')} onRetry={() => setReloadKey((n) => n + 1)} /></div>;
  }

  if (!data || (!data.hasClimateData && !data.hasPulseData && !data.hasTypeMixData)) {
    return (
      <div className={S.card}>
        <div className="mb-4">
          <h3 className={cn(S.cardTitle, 'mb-1')}>{t('title')}</h3>
          <p className={S.cardSubtitle}>{t('subtitle')}</p>
        </div>
        <p className={S.cardBody}>{t('noData')}</p>
        <p className={cn(S.cardMuted, 'mt-1')}>{t('noDataDesc')}</p>
        <div className="mt-3 flex flex-wrap gap-3">
          <Link href="/dashboard?tab=climate" className={S.cardLink}>
            {t('ctaClimate')} →
          </Link>
          <Link href="/dashboard?tab=companies" className={S.cardLink}>
            {t('ctaCompanies')} →
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className={S.card}>
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h3 className={cn(S.cardTitle, 'mb-1')}>{t('title')}</h3>
          <p className={S.cardSubtitle}>{t('subtitle')}</p>
        </div>
      </div>

      {!showFull && (
        <div className="space-y-4">
          <div>
            <p className={S.cardSection}>{t('overallHealth')}</p>
            <StatusToneChip
              tone={healthTone(data.overallHealth)}
              bordered={false}
              className="rounded px-3 py-1 font-ui text-sm font-medium"
            >
              {t(data.overallHealth)}
            </StatusToneChip>
          </div>

          {data.dominantArchetype && (
            <div>
              <p className={S.cardSection}>{t('dominantArchetype')}</p>
              <p className={S.cardBody}>
                {t('dominantArchetypeValue', {
                  type: data.dominantArchetype.type,
                  pct: data.dominantArchetype.percentage,
                })}
              </p>
            </div>
          )}

          <div>
            <p className={S.cardSection}>{t('declaredTitle')}</p>
            {data.declaredSnippet ? (
              <p className={cn(S.cardMuted, 'm-0')}>{data.declaredSnippet}</p>
            ) : (
              <p className={cn(S.cardMuted, 'm-0')}>{t('declaredEmpty')}</p>
            )}
            <div className="mt-2 flex flex-wrap gap-3">
              <Link href="/dashboard?tab=climate" className={S.cardLink}>
                {t('ctaClimate')}
              </Link>
              <Link href="/dashboard?tab=companies" className={S.cardLink}>
                {t('ctaCompanies')}
              </Link>
              <Link href="/dashboard?tab=team" className={S.cardLink}>
                {t('ctaTeam')}
              </Link>
            </div>
          </div>

          <button type="button" onClick={loadFullInsights} disabled={fullLoading} className={S.cardLink}>
            {t('viewFull')} →
          </button>
        </div>
      )}

      {showFull && data.fullCulture && (
        <div className="space-y-4">
          <h4 className={cn(S.cardTitle, 'text-sm')}>{t('insightsTitle')}</h4>
          <div className="space-y-3">
            {data.fullCulture.insights.map((insight, idx) => {
              let actionLink = null;
              if (insight.category === 'climate') {
                actionLink = '/dashboard?tab=climate';
              } else if (insight.category === 'pulse') {
                actionLink = '/dashboard?tab=group';
              } else if (insight.category === 'alignment') {
                actionLink = '/dashboard?tab=companies';
              } else if (insight.category === 'type_mix') {
                actionLink = '/dashboard?tab=team';
              }
              return (
                <InsightListItem
                  key={idx}
                  title={`${getCategoryIcon(insight.category)} ${insight.description}`}
                  body={insight.details}
                >
                  {actionLink ? (
                    <Link href={actionLink} className={cn(S.cardLink, 'mt-1 inline-block')}>
                      {t('viewLink')}
                    </Link>
                  ) : null}
                </InsightListItem>
              );
            })}
          </div>

          <button type="button" onClick={() => setShowFull(false)} className={S.cardLink}>
            ← {t('viewSummary')}
          </button>
        </div>
      )}
    </div>
  );
}
