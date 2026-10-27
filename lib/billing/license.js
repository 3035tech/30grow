import { query } from '../db.js';
import { companyLicenseSummary } from '../company/company-license.js';
import { stripeMode } from './stripe.js';

export async function loadCompanyLicense(companyId) {
  const result = await query(`SELECT license_number AS "licenseNumber",starts_at AS "licenseStartsAt",
    expires_at AS "licenseExpiresAt",expires_at<=now() AS "licenseExpired",
    offer_tier AS "licenseOfferTier",trial_days AS "licenseTrialDays" FROM company_licenses WHERE company_id=$1`, [companyId]);
  return result.rowCount ? licenseWithBilling(result.rows[0], companyId) : null;
}

export async function licenseWithBilling(row, companyId) {
  if (!companyId) return companyLicenseSummary(row);
  let mode;
  try { mode = stripeMode(); } catch { return companyLicenseSummary(row); }
  let result;
  try {
    result = await query(`SELECT t.managed,t.trial_ends_at AS "trialEndsAt",a.subscription_id AS "subscriptionId",
      COALESCE(a.status,'none') AS status,a.plan_key AS "planKey",a.currency,a.period_end AS "periodEnd",
      a.cancel_at_period_end AS "cancelAtPeriodEnd",a.livemode
      FROM company_billing_terms t LEFT JOIN company_billing_accounts a ON a.company_id=t.company_id AND a.livemode=$2
      WHERE t.company_id=$1`, [companyId, mode]);
  } catch (error) {
    // Expand-first deployment: until migration 166, keep the existing profile.
    if (error.code === '42P01' && process.env.STRIPE_BILLING_ENFORCE !== 'true') return companyLicenseSummary(row);
    throw error;
  }
  if (!result.rowCount) return companyLicenseSummary(row);
  const billing = result.rows[0];
  return companyLicenseSummary(row, { ...billing, livemode: mode,
    trialEndsAt: billing.trialEndsAt?.toISOString?.() || billing.trialEndsAt,
    periodEnd: billing.periodEnd?.toISOString?.() || billing.periodEnd });
}
