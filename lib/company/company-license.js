/** Profile view of the company license. Authorization uses billingAccess on the
 * server; neither this display summary nor a browser redirect authorizes access. */
import { billingAccess } from '../billing/catalog.js';
export const COMPANY_LICENSE = Object.freeze({
  PLAN: 'early_access',
  OFFER_TIERS: Object.freeze({
    LEGACY: 'legacy',
    TRIAL: 'trial',
    EARLY_ADOPTER: 'early_adopter',
    DESIGN_PARTNER: 'design_partner',
  }),
  ACTIVE: 'active',
  EXPIRED: 'expired',
  NUMBER_PREFIX: '30T-EA-',
  NUMBER_DIGITS: 6,
});

export function companyLicenseSummary(row, billing = null) {
  if (row.licenseNumber == null) return null;
  const original = {
    number: COMPANY_LICENSE.NUMBER_PREFIX + String(row.licenseNumber).padStart(COMPANY_LICENSE.NUMBER_DIGITS, '0'),
    plan: COMPANY_LICENSE.PLAN,
    startsAt: row.licenseStartsAt,
    expiresAt: row.licenseExpiresAt,
    status: row.licenseExpired ? COMPANY_LICENSE.EXPIRED : COMPANY_LICENSE.ACTIVE,
    offerTier: row.licenseOfferTier || COMPANY_LICENSE.OFFER_TIERS.LEGACY,
    trialDays: Number(row.licenseTrialDays) || 365,
  };
  if (!billing) return original;
  const subscribed = Boolean(billing.subscriptionId);
  const expiresAt = subscribed ? billing.periodEnd : billing.trialEndsAt || original.expiresAt;
  const access = billingAccess({ managed: subscribed || billing.managed, trialEndsAt: billing.trialEndsAt,
    status: billing.status, periodEnd: billing.periodEnd, knownPlan: Boolean(billing.planKey) });
  return {
    ...original,
    plan: subscribed ? 'subscription' : original.plan,
    originalExpiresAt: original.expiresAt,
    expiresAt: expiresAt || original.expiresAt,
    status: billing.managed || subscribed ? (access ? COMPANY_LICENSE.ACTIVE : COMPANY_LICENSE.EXPIRED) : original.status,
    billing: { ...billing, source: subscribed ? 'stripe' : billing.managed ? 'trial' : 'legacy', access },
  };
}
