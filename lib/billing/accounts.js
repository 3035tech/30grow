import { randomUUID } from 'node:crypto';
import { PUBLIC_TERMS_VERSION, CANCELLATION_POLICY_PATH } from '../marketing/public-legal.js';
import { query, withTransaction } from '../db.js';
import { BILLING_PLANS, LAUNCH_PRICE, TERMINAL_STATUSES, billingPlan, fitsPlan, objectId, priceId, toIso, billingAccess } from './catalog.js';
import { BillingError, billingBaseUrl, checkedPrice, getStripe, stripeMode } from './stripe.js';
import { loadCompanyLicense } from './license.js';
import { syncSubscription } from './sync.js';

export async function employeeCount(db, companyId) {
  return Number((await db.query("SELECT COUNT(*)::int AS n FROM candidates WHERE company_id=$1 AND employment_status='employee'", [companyId])).rows[0].n);
}
export async function lockAccount(db, companyId, livemode) {
  const company = (await db.query('SELECT id,name,deleted,active FROM companies WHERE id=$1 FOR UPDATE', [companyId])).rows[0];
  if (!company || company.deleted || !company.active) throw new BillingError('COMPANY_NOT_FOUND', 404);
  await db.query('INSERT INTO company_billing_terms(company_id,managed,trial_ends_at) VALUES($1,FALSE,now()) ON CONFLICT DO NOTHING', [companyId]);
  await db.query(`INSERT INTO company_licenses(company_id,starts_at,expires_at,offer_tier,trial_days)
    VALUES($1,now(),now()+interval '30 days','trial',30) ON CONFLICT(company_id) DO NOTHING`, [companyId]);
  await db.query('INSERT INTO company_billing_accounts(company_id,livemode) VALUES($1,$2) ON CONFLICT DO NOTHING', [companyId, livemode]);
  const account = (await db.query('SELECT * FROM company_billing_accounts WHERE company_id=$1 AND livemode=$2 FOR UPDATE', [companyId, livemode])).rows[0];
  const terms = (await db.query('SELECT * FROM company_billing_terms WHERE company_id=$1', [companyId])).rows[0];
  return { account, terms, company };
}

async function reserveLaunch(db, stripe, companyId, livemode) {
  await db.query('SELECT pg_advisory_xact_lock(3035,$1)', [livemode ? 167 : 166]);
  // Never reclaim a paid slot merely because a webhook was delayed. Confirm
  // expiration with Stripe, including sessions whose API response was lost.
  const expired = await db.query(`SELECT r.company_id,a.customer_id,a.checkout_session_id,a.checkout_attempt
    FROM billing_launch_redemptions r JOIN company_billing_accounts a USING(company_id,livemode)
    WHERE r.livemode=$1 AND NOT r.redeemed AND r.expires_at<=now()`, [livemode]);
  for (const old of expired.rows) {
    const sessions = old.checkout_session_id
      ? [await stripe.checkout.sessions.retrieve(old.checkout_session_id)]
      : (await stripe.checkout.sessions.list({ customer: old.customer_id, limit: 100 })).data.filter(s => s.metadata?.checkout_attempt === old.checkout_attempt);
    const completed = sessions.find(s => s.status === 'complete' && objectId(s.subscription));
    if (completed) await db.query('UPDATE billing_launch_redemptions SET redeemed=TRUE,subscription_id=$3 WHERE company_id=$1 AND livemode=$2', [old.company_id, livemode, objectId(completed.subscription)]);
    else if (!sessions.some(s => s.status === 'open')) await db.query('DELETE FROM billing_launch_redemptions WHERE company_id=$1 AND livemode=$2 AND NOT redeemed', [old.company_id, livemode]);
  }
  const existing = (await db.query('SELECT * FROM billing_launch_redemptions WHERE company_id=$1 AND livemode=$2', [companyId, livemode])).rows[0];
  if (existing?.redeemed) throw new BillingError('BILLING_LAUNCH_UNAVAILABLE', 409);
  if (existing) return;
  const result = await db.query(`INSERT INTO billing_launch_redemptions(company_id,livemode,slot,expires_at)
    SELECT $1,$2,n,now()+interval '24 hours' FROM generate_series(1,20) n
    WHERE NOT EXISTS(SELECT 1 FROM billing_launch_redemptions WHERE livemode=$2 AND slot=n)
    ORDER BY n LIMIT 1 RETURNING slot`, [companyId, livemode]);
  if (!result.rowCount) throw new BillingError('BILLING_LAUNCH_UNAVAILABLE', 409);
}

export function checkoutParams(account, userId) {
  const base = billingBaseUrl();
  const plan = account.checkout_launch ? LAUNCH_PRICE : billingPlan(account.checkout_plan_key);
  const acceptanceMessage = plan.currency === 'brl'
    ? `Li e aceito os [Termos de Uso](${base}/terms), incluindo as regras de [cancelamento e reembolso](${base}${CANCELLATION_POLICY_PATH}).`
    : `I agree to the [Terms of Use](${base}/terms), including the [cancellation and refund policy](${base}${CANCELLATION_POLICY_PATH}).`;
  const metadata = { app: '30grow', company_id: String(account.company_id), checkout_attempt: account.checkout_attempt, plan_key: account.checkout_plan_key, launch: account.checkout_launch ? 'true' : 'false', terms_version: PUBLIC_TERMS_VERSION, terms_url: `${base}/terms`, cancellation_policy_url: `${base}${CANCELLATION_POLICY_PATH}`, initiated_by_user_id: String(userId) };
  return {
    customer: account.customer_id, client_reference_id: String(account.company_id),
    mode: 'subscription', line_items: [{ price: priceId(plan), quantity: 1 }],
    allowed_payment_method_types: ['card'], billing_address_collection: 'required',
    consent_collection: { terms_of_service: 'required' },
    success_url: `${base}/dashboard/billing/return?companyId=${account.company_id}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/dashboard?tab=profile&section=billing&checkout=canceled`,
    metadata,
    subscription_data: { metadata, ...(account.checkout_trial_end ? { trial_end: Math.floor(new Date(account.checkout_trial_end).getTime() / 1000) } : {}) },
    expires_at: Math.floor(new Date(account.checkout_created_at).getTime() / 1000) + 86400,
    custom_text: {
      terms_of_service_acceptance: { message: acceptanceMessage },
      ...(account.checkout_launch ? { submit: { message: 'R$ 99/mês por 12 meses após o período gratuito. Depois, R$ 149/mês. Até 20 colaboradores ativos.' } } : {}),
    },
  };
}

/** Durable intent survives Stripe timeouts / DB rollback. Repeated clicks reuse it. */
export async function startCheckout({ companyId, planKey, launch = false, userId }) {
  if (!process.env.STRIPE_WEBHOOK_SECRET || !process.env.STRIPE_PORTAL_CONFIGURATION_ID) throw new BillingError('BILLING_NOT_CONFIGURED', 503);
  const plan = billingPlan(planKey);
  if (!plan || (launch && plan.key !== 'brl_small_monthly')) throw new BillingError('BILLING_PLAN_INVALID');
  const stripe = getStripe();
  const livemode = stripeMode();
  if (livemode && process.env.STRIPE_BILLING_ENFORCE !== 'true') throw new BillingError('BILLING_NOT_CONFIGURED', 503);
  await checkedPrice(stripe, plan);
  if (launch) await checkedPrice(stripe, LAUNCH_PRICE);
  billingBaseUrl();
  const prepared = await withTransaction(async db => {
    const { account, terms, company } = await lockAccount(db, companyId, livemode);
    if (!fitsPlan(plan, await employeeCount(db, companyId))) throw new BillingError('BILLING_CAPACITY', 409);
    if (account.customer_id) {
      const subscriptions = await stripe.subscriptions.list({ customer: account.customer_id, status: 'all', limit: 100 });
      if (subscriptions.data.some(sub => !TERMINAL_STATUSES.includes(sub.status))) throw new BillingError('BILLING_SUBSCRIPTION_EXISTS', 409);
    }
    if (account.checkout_session_id) {
      const session = await stripe.checkout.sessions.retrieve(account.checkout_session_id);
      if (session.status === 'complete') throw new BillingError('BILLING_CHECKOUT_PENDING', 409);
      if (session.status === 'open') {
        if (account.checkout_plan_key === planKey && account.checkout_launch === launch) return { url: session.url };
        await stripe.checkout.sessions.expire(session.id);
      }
      await db.query('UPDATE company_billing_accounts SET checkout_attempt=NULL,checkout_session_id=NULL WHERE company_id=$1 AND livemode=$2', [companyId, livemode]);
      account.checkout_attempt = null;
    }
    if (!account.customer_id) {
      const owner = (await db.query('SELECT email FROM users WHERE id=$1', [userId])).rows[0];
      const customer = await stripe.customers.create({ name: company.name, email: owner?.email, metadata: { app: '30grow', company_id: String(companyId) } }, { idempotencyKey: `grow:customer:${livemode}:${companyId}` });
      account.customer_id = customer.id;
      await db.query('UPDATE company_billing_accounts SET customer_id=$3 WHERE company_id=$1 AND livemode=$2', [companyId, livemode, customer.id]);
    }
    const pendingAge = Date.now() - new Date(account.checkout_created_at || 0).getTime();
    if (account.checkout_attempt && pendingAge < 86400000) {
      if (account.checkout_plan_key !== planKey || account.checkout_launch !== launch) throw new BillingError('BILLING_CHECKOUT_PENDING', 409);
      return { intent: account.checkout_attempt };
    }
    if (launch) await reserveLaunch(db, stripe, companyId, livemode);
    else await db.query('DELETE FROM billing_launch_redemptions WHERE company_id=$1 AND livemode=$2 AND NOT redeemed', [companyId, livemode]);
    const intent = randomUUID();
    const trial = new Date(terms.trial_ends_at).getTime();
    // Stripe Checkout requires at least 48h. Preserve any remaining promise,
    // granting up to 48h extra when a customer subscribes just before expiry.
    const trialEnd = trial > Date.now() ? new Date(Math.max(trial, Date.now() + 172860000)).toISOString() : null;
    await db.query(`UPDATE company_billing_accounts SET checkout_attempt=$3,checkout_plan_key=$4,checkout_launch=$5,
      checkout_trial_end=$6,checkout_created_at=now(),checkout_session_id=NULL,checkout_expires_at=NULL,updated_at=now()
      WHERE company_id=$1 AND livemode=$2`, [companyId, livemode, intent, planKey, launch, trialEnd]);
    return { intent };
  });
  if (prepared.url) return prepared;
  return withTransaction(async db => {
    const { account } = await lockAccount(db, companyId, livemode);
    if (account.checkout_attempt !== prepared.intent) throw new BillingError('BILLING_CHECKOUT_PENDING', 409);
    if (account.checkout_session_id) return { url: (await stripe.checkout.sessions.retrieve(account.checkout_session_id)).url };
    const session = await stripe.checkout.sessions.create(checkoutParams(account, userId), { idempotencyKey: `grow:checkout:${prepared.intent}` });
    await db.query('UPDATE company_billing_accounts SET checkout_session_id=$3,checkout_expires_at=$4,updated_at=now() WHERE company_id=$1 AND livemode=$2', [companyId, livemode, session.id, toIso(session.expires_at)]);
    return { url: session.url };
  });
}

export async function billingSummary(companyId, currency = 'brl') {
  let livemode;
  try { livemode = stripeMode(); } catch { return { configured: false, plans: [], invoices: [] }; }
  const stripe = getStripe();
  const summary = await withTransaction(async db => {
    let { account, terms } = await lockAccount(db, companyId, livemode);
    if (account.subscription_id) {
      await syncSubscription(db, stripe, account, account.subscription_id);
      account = (await db.query('SELECT * FROM company_billing_accounts WHERE company_id=$1 AND livemode=$2', [companyId, livemode])).rows[0];
    } else if (account.checkout_session_id) {
      const session = await stripe.checkout.sessions.retrieve(account.checkout_session_id);
      if (session.status === 'complete' && objectId(session.customer) === account.customer_id && objectId(session.subscription)) {
        await syncSubscription(db, stripe, account, objectId(session.subscription));
        account = (await db.query('SELECT * FROM company_billing_accounts WHERE company_id=$1 AND livemode=$2', [companyId, livemode])).rows[0];
      }
    }
    const count = await employeeCount(db, companyId);
    const selectedCurrency = account.subscription_id && !TERMINAL_STATUSES.includes(account.status) ? account.currency : currency;
    const launch = (await db.query(`SELECT COUNT(*)::int AS n,BOOL_OR(company_id=$2 AND redeemed) AS used, BOOL_OR(company_id=$2 AND NOT redeemed) AS reserved
      FROM billing_launch_redemptions WHERE livemode=$1 AND (redeemed OR expires_at>now())`, [livemode, companyId])).rows[0];
    return {
      configured: BILLING_PLANS.filter(p => p.currency === selectedCurrency).every(p => Boolean(priceId(p))) && (selectedCurrency !== 'brl' || Boolean(priceId(LAUNCH_PRICE))) && Boolean(process.env.STRIPE_WEBHOOK_SECRET && process.env.STRIPE_PORTAL_CONFIGURATION_ID),
      livemode, employeeCount: count, managed: terms.managed, trialEndsAt: terms.trial_ends_at,
      status: account.status, subscriptionId: account.subscription_id,
      planKey: account.plan_key, currency: account.currency || currency,
      periodEnd: account.period_end, cancelAtPeriodEnd: account.cancel_at_period_end,
      scheduled: Boolean(account.schedule_id),
      access: billingAccess({ managed: terms.managed, trialEndsAt: terms.trial_ends_at, status: account.status, periodEnd: account.period_end, knownPlan: Boolean(account.plan_key) }),
      launchAvailable: !launch.used && (Number(launch.n) < 20 || launch.reserved) && count <= 20 && Boolean(priceId(LAUNCH_PRICE)),
      plans: BILLING_PLANS.filter(p => p.currency === selectedCurrency).map(p => ({ key: p.key, currency: p.currency, amount: p.amount, interval: p.interval, maxEmployees: p.maxEmployees, eligible: fitsPlan(p, count) && Boolean(priceId(p)) })),
      customerId: account.customer_id,
    };
  });
  let invoices = [], invoicesUnavailable = false;
  if (summary.customerId) {
    try {
      const result = await stripe.invoices.list({ customer: summary.customerId, limit: 12 });
      invoices = result.data.map(i => ({ id: i.id, number: i.number, status: i.status, currency: i.currency, amount: i.total, amountPaid: i.amount_paid, createdAt: toIso(i.created), url: i.hosted_invoice_url, pdf: i.invoice_pdf }));
    } catch { invoicesUnavailable = true; }
  }
  const { customerId, ...safe } = summary;
  return { ...safe, license: await loadCompanyLicense(companyId), invoices, invoicesUnavailable, canOpenPortal: Boolean(customerId && process.env.STRIPE_PORTAL_CONFIGURATION_ID) };
}

export async function openBillingPortal(companyId, planKey = null) {
  const stripe = getStripe(), livemode = stripeMode();
  return withTransaction(async db => {
    const { account } = await lockAccount(db, companyId, livemode);
    if (!account.customer_id || !process.env.STRIPE_PORTAL_CONFIGURATION_ID) throw new BillingError('BILLING_NOT_CONFIGURED', 503);
    const params = { customer: account.customer_id, configuration: process.env.STRIPE_PORTAL_CONFIGURATION_ID, return_url: `${billingBaseUrl()}/dashboard?tab=profile&section=billing` };
    if (planKey) {
      const plan = billingPlan(planKey);
      if (!plan || !fitsPlan(plan, await employeeCount(db, companyId))) throw new BillingError('BILLING_CAPACITY', 409);
      if (!account.subscription_id || account.schedule_id) throw new BillingError('BILLING_PLAN_CHANGE_SUPPORT', 409);
      const sub = await stripe.subscriptions.retrieve(account.subscription_id);
      if (sub.currency !== plan.currency || sub.items.data.length !== 1) throw new BillingError('BILLING_PLAN_INVALID');
      const price = await checkedPrice(stripe, plan);
      // This portal exposes only the target validated against headcount above.
      // General portal sessions intentionally cannot select arbitrary prices.
      const configuration = await stripe.billingPortal.configurations.create({
        business_profile: { headline: '30Grow — alteração de plano' },
        features: {
          invoice_history: { enabled: true }, payment_method_update: { enabled: true },
          subscription_cancel: { enabled: true, mode: 'at_period_end' },
          subscription_update: { enabled: true, default_allowed_updates: ['price'],
            products: [{ product: objectId(price.product), prices: [price.id] }],
            proration_behavior: 'always_invoice', billing_cycle_anchor: 'unchanged' },
        }, metadata: { app: '30grow', purpose: 'validated_plan_change', plan_key: plan.key },
      }, { idempotencyKey: `grow:plan-portal:${price.id}` });
      params.configuration = configuration.id;
      params.flow_data = { type: 'subscription_update_confirm', subscription_update_confirm: { subscription: sub.id, items: [{ id: sub.items.data[0].id, price: price.id, quantity: 1 }] }, after_completion: { type: 'redirect', redirect: { return_url: params.return_url } } };
    }
    return { url: (await stripe.billingPortal.sessions.create(params)).url };
  });
}

/** Isolated rollout gate. Existing companies remain grandfathered. */
export async function companyBillingRestricted(companyId) {
  if (process.env.STRIPE_BILLING_ENFORCE !== 'true' || !companyId) return false;
  const livemode = stripeMode();
  const result = await query(`SELECT t.managed,t.trial_ends_at,a.status,a.period_end,a.plan_key
    FROM company_billing_terms t LEFT JOIN company_billing_accounts a ON a.company_id=t.company_id AND a.livemode=$2
    WHERE t.company_id=$1`, [companyId, livemode]);
  if (!result.rowCount) return false;
  const row = result.rows[0];
  return !billingAccess({ managed: row.managed, trialEndsAt: row.trial_ends_at, status: row.status, periodEnd: row.period_end, knownPlan: Boolean(row.plan_key) });
}
