'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { t } from '../../lib/i18n';
import { cn } from '../../lib/cn';
import { S } from '../dashboard/dashboard-shared';
import { AppLoading, ContentEnter } from './AppLoading';
import { ChartPanel, ChartLegend } from './ChartPanel';
import { StackedSegmentBar } from './StackedSegmentBar';
import { CategoryBars } from './CategoryBars';
import {
  CHART_MIN_N,
  vacationPoolTotals,
  vacationPoolByAreaBars,
} from '../../lib/analytics/chart-aggregates';

/**
 * B-3029 — Company vacation pool (used / pending / available) above the DP leave inbox.
 */
export function VacationPoolBlock({ locale = 'pt-BR', companyId, reloadKey = 0 }) {
  const [pool, setPool] = useState(null);
  const [loading, setLoading] = useState(() => Boolean(companyId));
  const [loadError, setLoadError] = useState(false);
  const hasDataRef = useRef(false);

  const load = useCallback(async () => {
    if (!companyId) {
      setPool(null);
      setLoading(false);
      setLoadError(false);
      hasDataRef.current = false;
      return;
    }
    if (!hasDataRef.current) setLoading(true);
    setLoadError(false);
    try {
      const params = new URLSearchParams({
        companyId: String(companyId),
        mode: 'pool',
      });
      const res = await fetch(`/api/admin/dp/leave?${params}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'pool');
      const next = data.pool || null;
      setPool(next);
      hasDataRef.current = Boolean(next && next.headcount > 0);
    } catch {
      setLoadError(true);
      if (!hasDataRef.current) setPool(null);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  const totals = useMemo(() => vacationPoolTotals(pool || {}), [pool]);

  const stackSegments = useMemo(
    () => [
      {
        id: 'used',
        value: Math.max(0, totals.usedDays),
        toneClass: 'bg-info',
        label: t(locale, 'panel.dp.vacationPoolUsed'),
      },
      {
        id: 'pending',
        value: Math.max(0, totals.pendingDays),
        toneClass: 'bg-warning',
        label: t(locale, 'panel.dp.vacationPoolPending'),
      },
      {
        id: 'available',
        value: Math.max(0, totals.availableDays),
        toneClass: 'bg-success',
        label: t(locale, 'panel.dp.vacationPoolAvailable'),
      },
    ],
    [totals, locale]
  );

  const roleBars = useMemo(() => {
    if (!pool?.byJobRole?.length) return [];
    const rows = pool.byJobRole.map((r) => ({
      ...r,
      label: r.label || t(locale, 'panel.dp.vacationPoolNoRole'),
    }));
    return vacationPoolByAreaBars(rows, { limit: 8 }).map((r) => ({
      id: r.id,
      label: r.label,
      value: r.value,
      toneClass: 'rounded-full bg-info',
    }));
  }, [pool, locale]);

  if (!companyId) return null;

  if (loading && !pool) {
    return (
      <div className={cn(S.card, 'mb-0')}>
        <AppLoading locale={locale} variant="inline" />
      </div>
    );
  }

  if (loadError && !pool) {
    return (
      <p className={cn(S.faint, 'mb-0 text-2xs')}>{t(locale, 'panel.dp.vacationPoolLoadError')}</p>
    );
  }

  if (!pool || pool.headcount === 0) {
    return null;
  }

  const stackTotal =
    Math.max(0, totals.usedDays) +
    Math.max(0, totals.pendingDays) +
    Math.max(0, totals.availableDays);
  const showChart = pool.headcount >= CHART_MIN_N && stackTotal > 0;

  if (!showChart) return null;

  return (
    <ContentEnter animKey={`vac-pool|${companyId}|${pool.headcount}|${stackTotal}`}>
      <ChartPanel
        title={t(locale, 'panel.dp.vacationPoolTitle')}
        hint={t(locale, 'panel.dp.vacationPoolHint', {
          n: pool.headcount,
          year: pool.periodHint?.periodStart?.slice(0, 4) || '',
        })}
      >
        <StackedSegmentBar
          segments={stackSegments}
          height={10}
          className="mb-2"
          aria-label={t(locale, 'panel.dp.vacationPoolTitle')}
        />
        <ChartLegend items={stackSegments} total={stackTotal} className="mb-3" />
        {roleBars.length > 0 ? (
          <div>
            <div className={cn(S.label, 'mb-2')}>{t(locale, 'panel.dp.vacationPoolByRole')}</div>
            <CategoryBars items={roleBars} height={8} />
          </div>
        ) : null}
        {pool.truncated ? (
          <p className={cn(S.faint, 'mb-0 mt-2')}>
            {t(locale, 'panel.dp.vacationPoolTruncated', {
              scanned: pool.scanned,
              cap: pool.scanCap,
            })}
          </p>
        ) : null}
      </ChartPanel>
    </ContentEnter>
  );
}
