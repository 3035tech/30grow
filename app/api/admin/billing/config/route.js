import { withBillingApi } from '../../../../../lib/billing/api.js';
import { CAP } from '../../../../../lib/identity/permissions.js';
import { query } from '../../../../../lib/db.js';
import { BILLING_PLANS, LAUNCH_PRICE, priceId } from '../../../../../lib/billing/catalog.js';
import { stripeMode } from '../../../../../lib/billing/stripe.js';

export const GET = withBillingApi({ cap: CAP.COMPANIES_MANAGE, requireCompany: false }, async () => {
  let livemode;
  try { livemode = stripeMode(); } catch { return { configured: false, activeCompanies: 0 }; }
  const counts = await query("SELECT COUNT(*) FILTER(WHERE status IN ('active','trialing'))::int AS n FROM company_billing_accounts WHERE livemode=$1", [livemode]);
  const events = await query('SELECT MAX(processed_at) AS latest FROM billing_webhook_events WHERE livemode=$1', [livemode]);
  return { configured: [...BILLING_PLANS, LAUNCH_PRICE].every(p => priceId(p)) && Boolean(process.env.STRIPE_WEBHOOK_SECRET && process.env.STRIPE_PORTAL_CONFIGURATION_ID), livemode, activeCompanies: counts.rows[0].n, lastWebhookAt: events.rows[0].latest };
});
