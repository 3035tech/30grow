import { ERR } from '../api-error-codes.js';
import { query, withTransaction } from '../db.js';
import { PUBLIC_TERMS_VERSION } from '../public-legal.js';
import { BILLING_PLANS, LAUNCH_PRICE, billingAccess, objectId, TERMINAL_STATUSES, toIso } from './catalog.js';
import { BillingError, getStripe, stripeMode } from './stripe.js';
import { setSubscriptionCancellation, syncSubscription } from './sync.js';
import { billingOperationState, prepareRefund, executeRefund, refundPreview, applyRefundState } from './refunds.js';
function mode() {
  try {
    return {
      configured: true,
      livemode: stripeMode()
    };
  } catch {
    return {
      configured: false,
      livemode: false
    };
  }
}
const accountSelection = `SELECT c.id,c.name,c.active,c.deleted,c.signup_creator_user_id AS "ownerId",u.email AS "ownerEmail",
  l.license_number AS "licenseNumber",l.expires_at AS "originalLicenseExpiresAt",COALESCE(t.managed,FALSE) AS managed,t.trial_ends_at AS "trialEndsAt",
  COALESCE(a.status,'none') AS status,a.plan_key AS "planKey",a.currency,a.period_end AS "periodEnd",COALESCE(a.cancel_at_period_end,FALSE) AS "cancelAtPeriodEnd",
  a.customer_id AS "customerId",a.subscription_id AS "subscriptionId",a.updated_at AS "syncedAt",
  CASE WHEN COALESCE(t.managed,FALSE)=FALSE AND a.subscription_id IS NULL THEN 'legacy'
    WHEN a.status='trialing' OR (a.subscription_id IS NULL AND t.managed AND t.trial_ends_at>now()) THEN 'trial'
    WHEN a.status='active' AND a.period_end>now() AND a.plan_key IS NOT NULL THEN 'active'
    WHEN a.status IN ('past_due','unpaid','incomplete') THEN 'past_due'
    WHEN a.status IN ('canceled','incomplete_expired') THEN 'canceled' ELSE 'none' END AS category
  FROM companies c LEFT JOIN users u ON u.id=c.signup_creator_user_id
  LEFT JOIN company_licenses l ON l.company_id=c.id LEFT JOIN company_billing_terms t ON t.company_id=c.id
  LEFT JOIN company_billing_accounts a ON a.company_id=c.id AND a.livemode=$1 WHERE (c.deleted=FALSE OR a.customer_id IS NOT NULL OR a.subscription_id IS NOT NULL)`;
function decorate(row) {
  const plan = [...BILLING_PLANS, LAUNCH_PRICE].find(p => p.key === row.planKey);
  return {
    ...row,
    amount: plan?.amount ?? null,
    interval: plan?.interval ?? null,
    commercialAccess: billingAccess({
      managed: row.managed,
      trialEndsAt: row.trialEndsAt,
      status: row.status,
      periodEnd: row.periodEnd,
      knownPlan: Boolean(plan)
    })
  };
}
export async function listBillingCompanies({
  q = '',
  status = 'all',
  page = 1,
  pageSize = 25
}) {
  const runtime = mode();
  const filters = "WHERE ($2='' OR name ILIKE '%'||$2||'%' OR COALESCE(\"ownerEmail\",'') ILIKE '%'||$2||'%') AND ($3='all' OR category=$3)";
  const [rows, counts] = await Promise.all([query(`WITH records AS (${accountSelection}) SELECT *,count(*) OVER()::int AS "totalCount" FROM records ${filters} ORDER BY name,id LIMIT $4 OFFSET $5`, [runtime.livemode, q, status, pageSize, (page - 1) * pageSize]), query(`WITH records AS (${accountSelection}) SELECT count(*)::int AS total,count(*) FILTER(WHERE category='active')::int AS paying,
      count(*) FILTER(WHERE category='trial')::int AS trial,count(*) FILTER(WHERE category='past_due')::int AS overdue,
      count(*) FILTER(WHERE "cancelAtPeriodEnd")::int AS canceling,count(*) FILTER(WHERE category='legacy')::int AS legacy FROM records`, [runtime.livemode])]);
  // Empty pages still report the total without mutating or creating Stripe identities.
  const total = rows.rowCount ? rows.rows[0].totalCount : Number((await query(`WITH records AS (${accountSelection}) SELECT count(*)::int AS n FROM records ${filters}`, [runtime.livemode, q, status])).rows[0].n);
  return {
    ...runtime,
    items: rows.rows.map(({
      totalCount,
      ...row
    }) => decorate(row)),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    summary: counts.rows[0]
  };
}
export async function billingCompanyDetails(companyId, {
  refresh = false
} = {}) {
  const runtime = mode();
  let company = (await query(accountSelection + ' AND c.id=$2', [runtime.livemode, companyId])).rows[0];
  if (!company) throw new BillingError(ERR.NOT_FOUND, 404);
  const stripe = runtime.configured ? getStripe() : null;
  if (refresh && stripe && company.subscriptionId) {
    await withTransaction(async db => {
      const account = (await db.query('SELECT * FROM company_billing_accounts WHERE company_id=$1 AND livemode=$2 FOR UPDATE', [companyId, runtime.livemode])).rows[0];
      await syncSubscription(db, stripe, account, account.subscription_id);
    });
    company = (await query(accountSelection + ' AND c.id=$2', [runtime.livemode, companyId])).rows[0];
  }
  const operations = (await query(`SELECT o.*,u.email AS "actorEmail" FROM billing_admin_operations o LEFT JOIN users u ON u.id=o.actor_user_id
    WHERE o.company_id=$1 AND o.livemode=$2 ORDER BY o.created_at DESC LIMIT 50`, [companyId, runtime.livemode])).rows;
  if (refresh && stripe) {
    for (const op of operations.filter(o => o.kind === 'refund' && !['succeeded', 'failed'].includes(o.status))) {
      for await (const refund of stripe.refunds.list({
        charge: op.charge_id,
        limit: 100
      })) {
        if (refund.metadata?.grow_operation_id === op.id) {
          await withTransaction(async db => {
            const current = (await db.query('SELECT * FROM billing_admin_operations WHERE id=$1 FOR UPDATE', [op.id])).rows[0];
            await applyRefundState(db, current, refund);
          });
          break;
        }
      }
    }
  }
  if (refresh && stripe) {
    for (const operation of operations.filter(op => op.kind !== 'refund' && op.status === 'processing')) await reconcileSubscriptionOperation(operation);
  }
  const history = (await query(`SELECT e.*,o.kind,o.amount,o.currency,o.reason,o.note,o.stripe_refund_id,u.email AS "actorEmail" FROM billing_admin_operation_events e JOIN billing_admin_operations o ON o.id=e.operation_id
    LEFT JOIN users u ON u.id=o.actor_user_id WHERE o.company_id=$1 AND o.livemode=$2 ORDER BY e.id DESC LIMIT 100`, [companyId, runtime.livemode])).rows;
  let invoices = [],
    invoicesUnavailable = false;
  if (stripe && company.customerId) {
    try {
      const result = await stripe.invoices.list({
        customer: company.customerId,
        limit: 24
      });
      invoices = result.data.map(i => ({
        id: i.id,
        number: i.number,
        status: i.status,
        currency: i.currency,
        amount: i.total,
        amountPaid: i.amount_paid,
        createdAt: toIso(i.created),
        url: i.hosted_invoice_url,
        pdf: i.invoice_pdf
      }));
    } catch {
      invoicesUnavailable = true;
    }
  }
  return {
    ...runtime,
    company: decorate(company),
    invoices,
    invoicesUnavailable,
    operations: (await query('SELECT * FROM billing_admin_operations WHERE company_id=$1 AND livemode=$2 ORDER BY created_at DESC LIMIT 50', [companyId, runtime.livemode])).rows,
    history
  };
}
export async function adminRefundPreview(companyId, invoiceId, requestedAt) {
  const stripe = getStripe(),
    livemode = stripeMode();
  const account = (await query('SELECT * FROM company_billing_accounts WHERE company_id=$1 AND livemode=$2', [companyId, livemode])).rows[0];
  if (!account?.customer_id) throw new BillingError(ERR.NOT_FOUND, 404);
  return refundPreview({
    query
  }, stripe, account, invoiceId, requestedAt);
}
async function terminateSubscription(companyId, expectedSubscriptionId) {
  const stripe = getStripe(),
    livemode = stripeMode();
  return withTransaction(async db => {
    const account = (await db.query('SELECT * FROM company_billing_accounts WHERE company_id=$1 AND livemode=$2 FOR UPDATE', [companyId, livemode])).rows[0];
    if (account?.subscription_id !== expectedSubscriptionId) throw new BillingError(ERR.BILLING_OPERATION_CONFLICT, 409);
    const sub = await stripe.subscriptions.retrieve(expectedSubscriptionId);
    if (objectId(sub.customer) !== account.customer_id || sub.livemode !== livemode) throw new BillingError(ERR.BILLING_SYNC_FAILED, 409);
    if (!TERMINAL_STATUSES.includes(sub.status)) {
      if (sub.schedule) await stripe.subscriptionSchedules.cancel(objectId(sub.schedule), {
        invoice_now: false,
        prorate: false
      });else await stripe.subscriptions.cancel(sub.id, {
        invoice_now: false,
        prorate: false
      });
    }
    await syncSubscription(db, stripe, account, sub.id);
  });
}
async function reconcileSubscriptionOperation(operation) {
  const stripe = getStripe();
  return withTransaction(async db => {
    const account = (await db.query('SELECT * FROM company_billing_accounts WHERE company_id=$1 AND livemode=$2 FOR UPDATE', [operation.company_id,operation.livemode])).rows[0];
    const current = (await db.query('SELECT * FROM billing_admin_operations WHERE id=$1 FOR UPDATE',[operation.id])).rows[0];
    if (current.status !== 'processing') return current;
    if (account?.subscription_id !== current.subscription_id) return billingOperationState(db,current,'needs_review',{errorCode:ERR.BILLING_OPERATION_CONFLICT});
    const subscription = await stripe.subscriptions.retrieve(current.subscription_id);
    if (objectId(subscription.customer) !== account.customer_id || subscription.livemode !== account.livemode) throw new BillingError(ERR.BILLING_SYNC_FAILED,409);
    const canceled = TERMINAL_STATUSES.includes(subscription.status);
    const scheduled = Boolean(subscription.cancel_at_period_end || subscription.cancel_at);
    const observed = current.kind === 'terminate' ? canceled : !canceled && (current.kind === 'cancel_renewal' ? scheduled : !scheduled);
    if (observed) {
      await syncSubscription(db,stripe,account,subscription.id);
      return billingOperationState(db,current,'succeeded',{source:'reconcile'});
    }
    // Never reapply an uncertain old command over a later owner/operator decision.
    if (Date.now()-new Date(current.updated_at).getTime()<60000) return current;
    return billingOperationState(db,current,'needs_review',{source:'reconcile',errorCode:ERR.BILLING_OPERATION_REVIEW});
  });
}
export async function performBillingOperation(input) {
  if (input.kind === 'refund') return executeRefund((await prepareRefund(input)).id);
  const livemode = stripeMode();
  let operation = await withTransaction(async db => {
    const account = (await db.query('SELECT * FROM company_billing_accounts WHERE company_id=$1 AND livemode=$2 FOR UPDATE', [input.companyId, livemode])).rows[0];
    if (!account?.subscription_id) throw new BillingError(ERR.BILLING_PLAN_INVALID);
    const existing = (await db.query('SELECT * FROM billing_admin_operations WHERE id=$1', [input.requestId])).rows[0];
    if (existing) {
      if (existing.company_id !== input.companyId || existing.livemode !== livemode || existing.kind !== input.kind || existing.actor_user_id !== input.actorUserId || existing.reason !== input.reason || existing.note !== input.note) throw new BillingError(ERR.BILLING_OPERATION_CONFLICT, 409);
      return existing;
    }
    const op = (await db.query(`INSERT INTO billing_admin_operations(id,company_id,livemode,actor_user_id,kind,reason,note,subscription_id,requested_at,policy_version)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,now(),$9) RETURNING *`, [input.requestId, input.companyId, livemode, input.actorUserId, input.kind, input.reason, input.note, account.subscription_id, PUBLIC_TERMS_VERSION])).rows[0];
    await db.query("INSERT INTO billing_admin_operation_events(operation_id,status,source) VALUES($1,'prepared','api')", [op.id]);
    return op;
  });
  if (['succeeded', 'failed', 'needs_review'].includes(operation.status)) return operation;
  const claim = await withTransaction(async db => {
    const current = (await db.query('SELECT * FROM billing_admin_operations WHERE id=$1 FOR UPDATE',[operation.id])).rows[0];
    if (current.status !== 'prepared') return {claimed:false,operation:current};
    return {claimed:true,operation:await billingOperationState(db,current,'processing')};
  });
  operation = claim.operation;
  if (!claim.claimed) return reconcileSubscriptionOperation(operation);
  try {
    if (input.kind === 'terminate') await terminateSubscription(input.companyId, operation.subscription_id);else await setSubscriptionCancellation(input.companyId, input.kind === 'cancel_renewal', operation.subscription_id);
    return withTransaction(db => billingOperationState(db, operation, 'succeeded'));
  } catch (error) {
    await withTransaction(db => billingOperationState(db, operation, error instanceof BillingError && error.status < 500 ? 'failed' : 'processing', {
      errorCode: error instanceof BillingError ? error.code : 'BILLING_OPERATION_PENDING'
    }));
    throw error instanceof BillingError ? error : new BillingError(ERR.BILLING_OPERATION_PENDING, 503);
  }
}
