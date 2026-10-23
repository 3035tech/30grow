import { withTransaction } from '../db.js';
import { reconcileRefundEvent } from './refunds.js';
import { LAUNCH_PRICE, STRIPE_EVENTS, TERMINAL_STATUSES, addUtcMonths, objectId, planForPrice, priceId, toIso } from './catalog.js';
import { BillingError, getStripe, stripeMode, checkedPrice } from './stripe.js';
import { billingPlan } from './catalog.js';

/** Program the transition in Stripe itself; delayed webhooks cannot extend R$99. */
async function ensureLaunchSchedule(stripe, sub, restoring = false) {
  if (sub.metadata?.launch !== 'true' || !['active', 'trialing'].includes(sub.status)) return objectId(sub.schedule);
  if (!restoring && (sub.cancel_at_period_end || sub.cancel_at)) return objectId(sub.schedule);
  const standard = await checkedPrice(stripe, billingPlan('brl_small_monthly'));
  let schedule;
  if (sub.schedule) schedule = await stripe.subscriptionSchedules.retrieve(objectId(sub.schedule));
  else schedule = await stripe.subscriptionSchedules.create({ from_subscription: sub.id }, { idempotencyKey: `grow:launch-schedule:${sub.id}` });
  if (schedule.metadata?.grow_launch_configured === 'true') return schedule.id;
  if (!['active', 'not_started'].includes(schedule.status)) return null;
  const phaseStart = schedule.current_phase?.start_date || schedule.phases[0]?.start_date;
  const anchor = sub.trial_end || sub.start_date;
  if (!phaseStart || !anchor) throw new BillingError('BILLING_SYNC_FAILED', 503);
  const end = addUtcMonths(anchor, 12);
  if (end <= Math.floor(Date.now() / 1000)) throw new BillingError('BILLING_SYNC_FAILED', 503);
  await stripe.subscriptionSchedules.update(schedule.id, {
    end_behavior: 'release', proration_behavior: 'none',
    metadata: { app: '30grow', company_id: sub.metadata.company_id, grow_launch_configured: 'true' },
    phases: [
      { start_date: phaseStart, end_date: end, items: [{ price: priceId(LAUNCH_PRICE), quantity: 1 }],
        ...(sub.trial_end && sub.trial_end > phaseStart ? { trial_end: sub.trial_end } : {}),
        proration_behavior: 'none' },
      { duration: { interval: 'month', interval_count: 1 }, items: [{ price: standard.id, quantity: 1 }],
        metadata: { launch: 'completed', plan_key: 'brl_small_monthly' }, proration_behavior: 'none' },
    ],
  });
  return schedule.id;
}

/** Caller holds the account lock BEFORE reading Stripe: out-of-order deliveries
 * always reconcile the latest provider state, never replay stale event snapshots. */
export async function syncSubscription(db, stripe, account, subscriptionId) {
  const sub = await stripe.subscriptions.retrieve(subscriptionId);
  if (objectId(sub.customer) !== account.customer_id || sub.livemode !== account.livemode) throw new BillingError('BILLING_SYNC_FAILED', 409);
  if (account.subscription_id && account.subscription_id !== sub.id) {
    // An old subscription's delayed event must never replace a new one.
    if (!TERMINAL_STATUSES.includes(account.status) || TERMINAL_STATUSES.includes(sub.status)) return null;
  }
  if (account.subscription_id !== sub.id && (sub.metadata?.app !== '30grow' || sub.metadata?.checkout_attempt !== account.checkout_attempt || sub.metadata?.company_id !== String(account.company_id))) return null;
  const item = sub.items.data.length === 1 ? sub.items.data[0] : null;
  const plan = item?.quantity === 1 ? planForPrice(objectId(item.price)) : null;
  const price = item?.price;
  const known = plan && price?.currency === plan.currency && price?.unit_amount === plan.amount && price?.recurring?.interval === plan.interval && price?.recurring?.interval_count === 1;
  const schedule = known && plan.key === LAUNCH_PRICE.key ? await ensureLaunchSchedule(stripe, sub) : objectId(sub.schedule);
  if (known && plan.key === LAUNCH_PRICE.key && ['active', 'trialing'].includes(sub.status)) {
    const redeemed = await db.query(`UPDATE billing_launch_redemptions SET redeemed=TRUE,subscription_id=$3
      WHERE company_id=$1 AND livemode=$2 AND (subscription_id IS NULL OR subscription_id=$3) RETURNING slot`, [account.company_id, account.livemode, sub.id]);
    if (!redeemed.rowCount) throw new BillingError('BILLING_LAUNCH_UNAVAILABLE', 409);
  }
  await db.query(`UPDATE company_billing_accounts SET subscription_id=$3,status=$4,plan_key=$5,currency=$6,
    period_end=$7,cancel_at_period_end=$8,schedule_id=$9,updated_at=now() WHERE company_id=$1 AND livemode=$2`,
  [account.company_id, account.livemode, sub.id, sub.status, known ? plan.key : null, ['brl', 'usd'].includes(sub.currency) ? sub.currency : null, toIso(item?.current_period_end), Boolean(sub.cancel_at_period_end || (sub.cancel_at && sub.cancel_at <= item?.current_period_end)), schedule]);
  // A real live purchase opts a legacy company into commercial management.
  if (sub.livemode && ['active', 'trialing'].includes(sub.status) && known) await db.query('UPDATE company_billing_terms SET managed=TRUE WHERE company_id=$1', [account.company_id]);
  return { status: sub.status, planKey: known ? plan.key : null };
}

/** The Stripe portal cannot cancel a subscription with a scheduled price change.
 * Offer the same end-of-period cancellation in Grow, without deleting history. */
export async function setSubscriptionCancellation(companyId, cancel, expectedSubscriptionId = null) {
  const stripe = getStripe(), livemode = stripeMode();
  return withTransaction(async db => {
    const account = (await db.query('SELECT * FROM company_billing_accounts WHERE company_id=$1 AND livemode=$2 FOR UPDATE', [companyId, livemode])).rows[0];
    if (!account?.subscription_id) throw new BillingError('BILLING_PLAN_INVALID');
    if (expectedSubscriptionId && account.subscription_id !== expectedSubscriptionId) throw new BillingError('BILLING_OPERATION_CONFLICT',409);
    const sub = await stripe.subscriptions.retrieve(account.subscription_id);
    if (objectId(sub.customer) !== account.customer_id || sub.livemode !== livemode || TERMINAL_STATUSES.includes(sub.status)) throw new BillingError('BILLING_PLAN_INVALID');
    if (sub.schedule) {
      const schedule = await stripe.subscriptionSchedules.retrieve(objectId(sub.schedule));
      const item = sub.items.data[0];
      if (cancel && schedule.metadata?.grow_cancel_at_period_end !== 'true') {
        const start = schedule.current_phase?.start_date;
        const end = item?.current_period_end;
        if (!start || !end || end <= Math.floor(Date.now() / 1000)) throw new BillingError('BILLING_SYNC_FAILED', 503);
        await stripe.subscriptionSchedules.update(schedule.id, {
          end_behavior: 'cancel', proration_behavior: 'none',
          metadata: { ...schedule.metadata, grow_cancel_at_period_end: 'true' },
          phases: [{ start_date: start, end_date: end, items: [{ price: objectId(item.price), quantity: 1 }],
            ...(sub.trial_end && sub.trial_end > start && sub.trial_end <= end ? { trial_end: sub.trial_end } : {}), proration_behavior: 'none' }],
        });
      } else if (!cancel && schedule.metadata?.grow_cancel_at_period_end === 'true') {
        if (sub.metadata?.launch === 'true' && addUtcMonths(sub.trial_end || sub.start_date, 12) > Math.floor(Date.now() / 1000)) {
          await stripe.subscriptionSchedules.update(schedule.id, { metadata: { ...schedule.metadata, grow_launch_configured: 'false', grow_cancel_at_period_end: 'false' } });
          await ensureLaunchSchedule(stripe, sub, true);
        } else await stripe.subscriptionSchedules.release(schedule.id, { preserve_cancel_date: false });
      }
    } else await stripe.subscriptions.update(sub.id, { cancel_at_period_end: cancel });
    await syncSubscription(db, stripe, account, sub.id);
    return { ok: true };
  });
}

export async function confirmCheckout(companyId, sessionId) {
  const stripe = getStripe(), livemode = stripeMode();
  return withTransaction(async db => {
    const account = (await db.query('SELECT * FROM company_billing_accounts WHERE company_id=$1 AND livemode=$2 FOR UPDATE', [companyId, livemode])).rows[0];
    if (!account || account.checkout_session_id !== sessionId) throw new BillingError('NOT_FOUND', 404);
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (objectId(session.customer) !== account.customer_id || session.client_reference_id !== String(companyId) || session.livemode !== livemode || session.mode !== 'subscription') throw new BillingError('FORBIDDEN', 403);
    if (session.status !== 'complete' || !objectId(session.subscription)) return { pending: true };
    const result = await syncSubscription(db, stripe, account, objectId(session.subscription));
    return { pending: !result?.planKey || !['active', 'trialing'].includes(result.status), status: result?.status || 'incomplete' };
  });
}

export async function processBillingEvent(event) {
  if (event.livemode !== stripeMode()) throw new BillingError('BILLING_MODE_MISMATCH', 400);
  if (!STRIPE_EVENTS.includes(event.type)) return { ignored: true };
  const stripe = getStripe();
  return withTransaction(async db => {
    const inserted = await db.query(`INSERT INTO billing_webhook_events(event_id,livemode,event_type,stripe_created_at)
      VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING event_id`, [event.id, event.livemode, event.type, toIso(event.created)]);
    if (!inserted.rowCount) return { duplicate: true };
    if (event.type.startsWith('refund.')) return reconcileRefundEvent(db,stripe,event);
    const object = event.data.object;
    const customer = objectId(object.customer);
    if (!customer) return { ignored: true };
    const account = (await db.query('SELECT * FROM company_billing_accounts WHERE customer_id=$1 AND livemode=$2 FOR UPDATE', [customer, event.livemode])).rows[0];
    if (!account) return { ignored: true };
    let subscriptionId = null;
    if (event.type.startsWith('customer.subscription.')) subscriptionId = object.id;
    else if (event.type.startsWith('checkout.session.')) {
      if (object.id !== account.checkout_session_id) return { ignored: true };
      if (event.type === 'checkout.session.expired') {
        await db.query('DELETE FROM billing_launch_redemptions WHERE company_id=$1 AND livemode=$2 AND NOT redeemed', [account.company_id, event.livemode]);
        return { expired: true };
      }
      subscriptionId = objectId(object.subscription);
    } else if (event.type.startsWith('invoice.')) {
      subscriptionId = objectId(object.parent?.subscription_details?.subscription) || objectId(object.subscription);
    } else if (event.type.startsWith('subscription_schedule.')) {
      subscriptionId = objectId(object.subscription) || objectId(object.released_subscription);
    }
    if (subscriptionId) await syncSubscription(db, stripe, account, subscriptionId);
    return { received: true };
  });
}
