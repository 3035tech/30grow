'use client';

import { t } from '../../lib/i18n';
import { cn } from '../../lib/cn';
import { formatDisplayDate } from '../../lib/format-display-date';
import { S } from '../dashboard/dashboard-shared';
import { InlineCallout } from './InlineCallout';
import { StatMetricTile } from './StatMetricTile';

/**
 * Vacation balance tiles + low/negative callouts (manager DP + /employee).
 */
export function LeaveBalanceSummary({
  locale = 'pt-BR',
  balance,
  showPoolMeta = false,
  showNotes = false,
  showDefaultHint = false,
  showPeriod = false,
  className = '',
}) {
  if (!balance) {
    return (
      <p className={cn(S.faint, 'm-0', className)}>
        {t(locale, 'panel.dp.balanceUnavailable')}
      </p>
    );
  }

  const available = Number(balance.availableDays);
  const low = Number.isFinite(available) && available >= 0 && available <= 5;
  const negative = Number.isFinite(available) && available < 0;

  return (
    <div className={cn(className)}>
      {negative ? (
        <InlineCallout tone="danger" className="mb-3">
          {t(locale, 'panel.dp.balanceNegativeWarning')}
        </InlineCallout>
      ) : low ? (
        <InlineCallout tone="warning" className="mb-3">
          {t(locale, 'panel.dp.balanceLowWarning', { n: balance.availableDays })}
        </InlineCallout>
      ) : null}
      <div className="grid gap-2 sm:grid-cols-3">
        <StatMetricTile
          value={balance.availableDays}
          label={t(locale, 'panel.dp.balanceAvailable')}
        />
        <StatMetricTile
          value={balance.usedDays}
          label={t(locale, 'panel.dp.balanceUsed')}
        />
        <StatMetricTile
          value={balance.pendingDays}
          label={t(locale, 'panel.dp.balancePending')}
        />
      </div>
      {balance.legalAccrual && Array.isArray(balance.periods) ? (
        <div className="mt-3 space-y-2">
          {balance.periods.map(period => (
            <div key={period.periodStart} className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-ink/10 bg-surface px-3 py-2 text-xs">
              <span>{formatDisplayDate(period.periodStart, locale)} – {formatDisplayDate(period.periodEnd, locale)}</span>
              <span className="font-medium">
                {period.acquired
                  ? t(locale, 'panel.dp.balanceAcquiredPeriod', { n: period.availableDays })
                  : t(locale, 'panel.dp.balanceFormingPeriod', { n: period.formingDays })}
              </span>
            </div>
          ))}
          <p className={cn(S.faint, 'mb-0')}>{t(locale, 'panel.dp.balanceLegalNote')}</p>
        </div>
      ) : null}
      {showPeriod && !balance.legalAccrual && balance.periodStart && balance.periodEnd ? (
        <p className={cn(S.faint, 'mb-0 mt-2')}>
          {t(locale, 'panel.dp.balancePeriodMeta', {
            start: formatDisplayDate(balance.periodStart, locale),
            end: formatDisplayDate(balance.periodEnd, locale),
          })}
        </p>
      ) : null}
      {showPoolMeta ? (
        <p className={cn(S.faint, 'mb-0 mt-2')}>
          {t(locale, 'panel.dp.balancePoolMeta', {
            entitlement: balance.entitlementDays,
            adjustment: balance.adjustmentDays,
          })}
        </p>
      ) : null}
      {showNotes && balance.notes ? (
        <p className={cn(S.muted, 'mb-0 mt-1 text-xs')}>{balance.notes}</p>
      ) : null}
      {showDefaultHint && balance.defaultEntitlement ? (
        <p className={cn(S.faint, 'mb-0 mt-2')}>{t(locale, 'panel.dp.balanceDefaultHint')}</p>
      ) : null}
    </div>
  );
}
