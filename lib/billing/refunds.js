import { ERR } from '../api-error-codes.js';
import { withTransaction } from '../db.js';
import { PUBLIC_TERMS_VERSION } from '../marketing/public-legal.js';
import { objectId, planForPrice, toIso } from './catalog.js';
import { BillingError, getStripe, stripeMode } from './stripe.js';
const reservedStatuses = new Set(['pending', 'requires_action', 'succeeded']);
export async function billingOperationState(db, operation, status, {
  source = 'api',
  stripeStatus = null,
  refundId = null,
  errorCode = null
} = {}) {
  const result = await db.query(`UPDATE billing_admin_operations SET status=$2,stripe_refund_id=COALESCE($3,stripe_refund_id),error_code=$4,updated_at=now()
    WHERE id=$1 RETURNING *`, [operation.id, status, refundId, errorCode]);
  await db.query(`INSERT INTO billing_admin_operation_events(operation_id,status,source,stripe_status,error_code) VALUES($1,$2,$3,$4,$5)`, [operation.id, status, source, stripeStatus, errorCode]);
  return result.rows[0];
}
export async function applyRefundState(db, operation, refund, source = 'reconcile') {
  if (objectId(refund.charge) !== operation.charge_id || refund.currency !== operation.currency || refund.amount !== operation.amount) throw new BillingError(ERR.BILLING_SYNC_FAILED, 409);
  const status = refund.status === 'succeeded' ? 'succeeded' : ['failed', 'canceled'].includes(refund.status) ? 'failed' : 'pending';
  if (operation.status === status && operation.stripe_refund_id === refund.id) return operation;
  return billingOperationState(db, operation, status, {
    source,
    stripeStatus: refund.status,
    refundId: refund.id
  });
}
export async function refundPreview(db, stripe, account, invoiceId, requestedAt = new Date().toISOString(), ignoreOperationId = null) {
  const invoice = await stripe.invoices.retrieve(invoiceId);
  if (objectId(invoice.customer) !== account.customer_id || invoice.livemode !== account.livemode) throw new BillingError(ERR.NOT_FOUND, 404);
  if (invoice.status !== 'paid' || invoice.amount_paid <= 0 || !['brl', 'usd'].includes(invoice.currency)) throw new BillingError(ERR.BILLING_REFUND_UNAVAILABLE, 409);
  const payments = await stripe.invoicePayments.list({
    invoice: invoice.id,
    status: 'paid',
    limit: 100
  });
  if (payments.has_more || payments.data.length !== 1) throw new BillingError(ERR.BILLING_REFUND_MULTIPLE_PAYMENTS, 409);
  const payment = payments.data[0];
  let chargeId = objectId(payment.payment.charge);
  if (payment.payment.type === 'payment_intent') {
    const intent = await stripe.paymentIntents.retrieve(objectId(payment.payment.payment_intent));
    if (objectId(intent.customer) !== account.customer_id || intent.livemode !== account.livemode) throw new BillingError(ERR.BILLING_SYNC_FAILED, 409);
    chargeId = objectId(intent.latest_charge);
  }
  if (!chargeId) throw new BillingError(ERR.BILLING_REFUND_UNAVAILABLE, 409);
  const charge = await stripe.charges.retrieve(chargeId);
  if (objectId(charge.customer) !== account.customer_id || charge.livemode !== account.livemode || !charge.paid || !charge.captured || charge.currency !== invoice.currency) throw new BillingError(ERR.BILLING_SYNC_FAILED, 409);
  if (charge.amount !== payment.amount_paid || payment.amount_paid !== invoice.amount_paid) throw new BillingError(ERR.BILLING_REFUND_MULTIPLE_PAYMENTS, 409);
  const refunds = [];
  for await (const refund of stripe.refunds.list({
    charge: charge.id,
    limit: 100
  })) refunds.push(refund);
  const seen = new Set(refunds.map(r => r.metadata?.grow_operation_id).filter(Boolean));
  const local = await db.query(`SELECT id,amount FROM billing_admin_operations WHERE company_id=$1 AND livemode=$2 AND charge_id=$3
    AND status IN ('prepared','processing','pending','needs_review') AND ($4::uuid IS NULL OR id<>$4::uuid)`, [account.company_id, account.livemode, charge.id, ignoreOperationId]);
  const reserved = local.rows.filter(o => !seen.has(o.id)).reduce((sum, o) => sum + o.amount, 0);
  const available = Math.max(0, charge.amount - refunds.filter(r => reservedStatuses.has(r.status)).reduce((sum, r) => sum + r.amount, 0) - reserved);
  const line = invoice.lines?.data?.length === 1 && !invoice.lines?.has_more ? invoice.lines.data[0] : null;
  const plan = line ? planForPrice(objectId(line.pricing?.price_details?.price) || objectId(line.price)) : null;
  const subscriptionId = objectId(invoice.parent?.subscription_details?.subscription) || objectId(invoice.subscription);
  const annualUsed = await db.query(`SELECT EXISTS(SELECT 1 FROM billing_admin_operations WHERE company_id=$1 AND livemode=$2 AND invoice_id=$3
    AND refund_basis='annual' AND status<>'failed' AND ($4::uuid IS NULL OR id<>$4::uuid)) AS used`, [account.company_id, account.livemode, invoice.id, ignoreOperationId]);
  const at = Date.parse(requestedAt),
    start = line?.period?.start * 1000,
    end = line?.period?.end * 1000;
  const annualEligible = plan?.interval === 'year' && subscriptionId === account.subscription_id && ['subscription_create', 'subscription_cycle'].includes(invoice.billing_reason) && !line?.parent?.subscription_item_details?.proration && !annualUsed.rows[0].used && Number.isFinite(at) && at >= invoice.created * 1000 && at <= Date.now() + 5000 && end > start && at < end;
  const proportional = annualEligible ? Math.min(available, Math.floor(invoice.amount_paid * Math.min(1, (end - at) / (end - start)))) : null;
  return {
    invoiceId: invoice.id,
    invoiceNumber: invoice.number,
    currency: invoice.currency,
    paid: invoice.amount_paid,
    chargeId: charge.id,
    available,
    annualEligible: Boolean(annualEligible),
    proportional,
    periodStart: toIso(line?.period?.start),
    periodEnd: toIso(line?.period?.end),
    requestedAt,
    refunds: refunds.map(r => ({
      id: r.id,
      amount: r.amount,
      status: r.status,
      createdAt: toIso(r.created),
      operationId: r.metadata?.grow_operation_id || null
    }))
  };
}
export async function reconcileRefundEvent(db, stripe, event) {
  const refund = await stripe.refunds.retrieve(event.data.object.id);
  if (refund.metadata?.app !== '30grow' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(refund.metadata?.grow_operation_id || '')) return {
    ignored: true
  };
  const result = await db.query('SELECT * FROM billing_admin_operations WHERE id=$1 AND livemode=$2 FOR UPDATE', [refund.metadata.grow_operation_id, event.livemode]);
  if (!result.rowCount) return {
    ignored: true
  };
  await applyRefundState(db, result.rows[0], refund, 'webhook');
  return {
    received: true
  };
}
export async function prepareRefund({
  companyId,
  actorUserId,
  requestId,
  invoiceId,
  basis,
  amount,
  reason,
  note = '',
  requestedAt
}) {
  const stripe = getStripe(),
    livemode = stripeMode();
  if (requestedAt && (!Number.isFinite(Date.parse(requestedAt)) || Date.parse(requestedAt) > Date.now() + 5000)) throw new BillingError(ERR.BILLING_REFUND_DATE, 400);
  return withTransaction(async db => {
    const account = (await db.query('SELECT * FROM company_billing_accounts WHERE company_id=$1 AND livemode=$2 FOR UPDATE', [companyId, livemode])).rows[0];
    if (!account?.customer_id || !account.subscription_id) throw new BillingError(ERR.BILLING_PLAN_INVALID);
    const existing = (await db.query('SELECT * FROM billing_admin_operations WHERE id=$1', [requestId])).rows[0];
    if (existing) {
      if (existing.company_id !== companyId || existing.livemode !== livemode || existing.kind !== 'refund' || existing.invoice_id !== invoiceId || existing.refund_basis !== basis || existing.actor_user_id !== actorUserId || existing.reason !== reason || existing.note !== note || requestedAt && new Date(existing.requested_at).getTime() !== Date.parse(requestedAt) || existing.amount !== amount) throw new BillingError(ERR.BILLING_OPERATION_CONFLICT, 409);
      return existing;
    }
    const preview = await refundPreview(db, stripe, account, invoiceId, requestedAt);
    const value = basis === 'full' ? preview.available : basis === 'annual' ? preview.proportional : amount;
    if (!Number.isSafeInteger(value) || value <= 0 || value > preview.available || value !== amount) throw new BillingError(ERR.BILLING_REFUND_AMOUNT, 409);
    if (basis === 'annual' && (!preview.annualEligible || reason !== 'annual_early_termination')) throw new BillingError(ERR.BILLING_REFUND_UNAVAILABLE, 409);
    const operation = (await db.query(`INSERT INTO billing_admin_operations(id,company_id,livemode,actor_user_id,kind,reason,note,refund_basis,invoice_id,charge_id,subscription_id,amount,currency,requested_at,policy_version)
      VALUES($1,$2,$3,$4,'refund',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`, [requestId, companyId, livemode, actorUserId, reason, note, basis, invoiceId, preview.chargeId, account.subscription_id, value, preview.currency, preview.requestedAt, PUBLIC_TERMS_VERSION])).rows[0];
    await db.query("INSERT INTO billing_admin_operation_events(operation_id,status,source) VALUES($1,'prepared','api')", [requestId]);
    return operation;
  });
}
export async function executeRefund(operationId) {
  const stripe = getStripe(),
    livemode = stripeMode();
  let deferredError;
  const result = await withTransaction(async db => {
    // Account first, then operation: same lock order as preparation and other actions.
    const lookup = (await db.query('SELECT company_id FROM billing_admin_operations WHERE id=$1 AND livemode=$2', [operationId, livemode])).rows[0];
    if (!lookup) throw new BillingError(ERR.NOT_FOUND, 404);
    const account = (await db.query('SELECT * FROM company_billing_accounts WHERE company_id=$1 AND livemode=$2 FOR UPDATE', [lookup.company_id, livemode])).rows[0];
    let operation = (await db.query('SELECT * FROM billing_admin_operations WHERE id=$1 FOR UPDATE', [operationId])).rows[0];
    if (['succeeded', 'failed'].includes(operation.status)) return operation;
    for await (const refund of stripe.refunds.list({
      charge: operation.charge_id,
      limit: 100
    })) {
      if (refund.metadata?.grow_operation_id === operation.id) return applyRefundState(db, operation, refund);
    }
    if (Date.now() - new Date(operation.created_at).getTime() > 23 * 3600000) {
      return billingOperationState(db, operation, 'needs_review', {
        errorCode: ERR.BILLING_OPERATION_REVIEW
      });
    }
    const preview = await refundPreview(db, stripe, account, operation.invoice_id, operation.requested_at.toISOString(), operation.id);
    if (operation.amount > preview.available) {
      return billingOperationState(db, operation, 'failed', {
        errorCode: ERR.BILLING_REFUND_AMOUNT
      });
    }
    operation = await billingOperationState(db, operation, 'processing');
    try {
      const refund = await stripe.refunds.create({
        charge: operation.charge_id,
        amount: operation.amount,
        reason: 'requested_by_customer',
        metadata: {
          app: '30grow',
          company_id: String(operation.company_id),
          grow_operation_id: operation.id
        }
      }, {
        idempotencyKey: `grow:admin-refund:${operation.id}`
      });
      return await applyRefundState(db, operation, refund, 'api');
    } catch (error) {
      const definitive = ['StripePermissionError', 'StripeInvalidRequestError', 'StripeAuthenticationError'].includes(error.type);
      operation = await billingOperationState(db, operation, definitive ? 'failed' : 'processing', {
        errorCode: definitive ? 'BILLING_REFUND_REJECTED' : 'BILLING_OPERATION_PENDING'
      });
      deferredError = new BillingError(definitive ? 'BILLING_REFUND_REJECTED' : 'BILLING_OPERATION_PENDING', 503);
      return operation;
    }
  });
  if (deferredError) throw deferredError;
  return result;
}
