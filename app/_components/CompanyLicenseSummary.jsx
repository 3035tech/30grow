'use client';

import { t } from '../../lib/i18n';
import { COMPANY_LICENSE } from '../../lib/company/company-license';
import { cn } from '../../lib/cn';
import { formatDisplayDateTime } from '../../lib/format-display-date';
import { S } from '../dashboard/dashboard-shared';
import { StatusToneChip } from './StatusToneChip';
import { InlineCallout } from './InlineCallout';

function licensePlanLabel(locale, license) {
  if (license?.billing?.source === 'stripe') {
    return t(locale, 'billing.licenseSubscription');
  }
  const keys = {
    [COMPANY_LICENSE.OFFER_TIERS.TRIAL]: 'dashboard.licensePlanTrial',
    [COMPANY_LICENSE.OFFER_TIERS.EARLY_ADOPTER]: 'dashboard.licensePlanEarlyAdopter',
    [COMPANY_LICENSE.OFFER_TIERS.DESIGN_PARTNER]: 'dashboard.licensePlanDesignPartner',
    [COMPANY_LICENSE.OFFER_TIERS.LEGACY]: 'dashboard.licensePlanLegacy',
  };
  return t(locale, keys[license?.offerTier] || keys[COMPANY_LICENSE.OFFER_TIERS.LEGACY]);
}

export function CompanyLicenseSummary({ license, locale, onManage }) {
  const expired = license?.status === COMPANY_LICENSE.EXPIRED;
  const billing = license?.billing;
  return (
    <section aria-labelledby="company-license-title" className="mb-5 border-b border-ink/10 pb-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="company-license-title" className="m-0 font-ui text-base font-semibold text-ink">
          {t(locale, 'dashboard.licenseTitle')}
        </h2>
        {license ? <StatusToneChip tone={expired ? 'warning' : 'success'}>
          {t(locale, billing?.source === 'stripe' ? (!billing.planKey ? 'billing.licenseNeedsReview' : `billing.status_${billing.status}`) : expired ? 'dashboard.licenseExpired' : 'dashboard.licenseActive')}
        </StatusToneChip> : null}
      </div>
      {license ? <>
        <p className="mb-3 mt-1 text-sm text-ink-muted">{licensePlanLabel(locale, license)}</p>
        <dl className="m-0 grid gap-x-6 gap-y-4 rounded-control bg-canvas/60 p-4 sm:grid-cols-3">
          {[
            ['dashboard.licenseNumber', license.number, null],
            ['dashboard.licenseStartsAt', formatDisplayDateTime(license.startsAt, locale), license.startsAt],
            [billing?.source === 'stripe' ? 'billing.validUntil' : 'dashboard.licenseExpiresAt', formatDisplayDateTime(license.expiresAt, locale), license.expiresAt],
          ].map(([label, value, dateTime]) => <div key={label} className="min-w-0">
            <dt className={S.muted}>{t(locale, label)}</dt>
            <dd className={cn('m-0 mt-1.5 break-words text-sm text-ink tabular-nums',
              label === 'dashboard.licenseExpiresAt' ? 'font-semibold' : 'font-medium')}>
              {dateTime ? <time dateTime={dateTime}>{value}</time> : value}
            </dd>
          </div>)}
        </dl>
        <p className="mb-0 mt-3 max-w-prose text-sm leading-relaxed text-ink-muted">{t(locale, 'dashboard.licenseEmployeeFree')}</p>
        {billing?.source === 'stripe' ? <details className="mt-3 text-sm text-ink-muted"><summary className="cursor-pointer py-2 focus-visible:outline-brand-500">{t(locale, 'billing.licenseHistory')}</summary><p className="mb-0 mt-1 leading-6">{t(locale, 'billing.originalLicenseTerm', { date: formatDisplayDateTime(license.originalExpiresAt, locale) })}</p></details> : null}
        {billing?.cancelAtPeriodEnd ? <p className="mb-0 mt-3 text-sm text-ink-muted">{t(locale, 'billing.cancellation')}</p> : null}
        {expired ? <InlineCallout tone="warning" className="mt-3">
          {t(locale, billing?.source === 'stripe' ? (billing.status === 'canceled' ? 'billing.subscriptionInactive' : 'billing.paymentAttention') : billing?.managed ? 'billing.trialExpired' : 'dashboard.licenseExpiredNotice')}
        </InlineCallout> : null}
        {billing && onManage ? <button type="button" onClick={onManage} className={cn(S.btnGhost, 'mt-4')}>{t(locale, 'billing.viewSubscription')}</button> : null}
      </> : <p className="mb-0 mt-2 text-sm text-ink-muted">{t(locale, 'dashboard.licenseNone')}</p>}
    </section>
  );
}
