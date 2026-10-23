import { isCompanyOwnerPayload, isSuperAdminPayload } from '../permissions.js';
import { PUBLIC_BRL_TIERS, PUBLIC_BRL_LAUNCH } from '../pricing-currency.js';

export const BILLING_PLANS = Object.freeze([
  ...PUBLIC_BRL_TIERS.map(tier => Object.freeze({
    key: `brl_${tier.id}_monthly`, currency: 'brl', interval: 'month',
    amount: tier.monthlyTotal * 100, maxEmployees: tier.max,
    env: `STRIPE_PRICE_BRL_${tier.id.toUpperCase()}_MONTHLY`,
  })),
  Object.freeze({ key: 'brl_small_annual', currency: 'brl', interval: 'year', amount: PUBLIC_BRL_TIERS[0].annualTotal * 100, maxEmployees: 20, env: 'STRIPE_PRICE_BRL_SMALL_ANNUAL' }),
  Object.freeze({ key: 'usd_company_monthly', currency: 'usd', interval: 'month', amount: 3900, maxEmployees: null, env: 'STRIPE_PRICE_USD_COMPANY_MONTHLY' }),
]);
export const LAUNCH_PRICE = Object.freeze({ key: 'brl_launch_monthly', currency: 'brl', interval: 'month', amount: PUBLIC_BRL_LAUNCH.monthlyTotal * 100, maxEmployees: 20, env: 'STRIPE_PRICE_BRL_LAUNCH_MONTHLY' });
export const STRIPE_API_VERSION = '2026-09-30.endive';
export const STRIPE_EVENTS = Object.freeze([
  'checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.expired',
  'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted',
  'invoice.paid', 'invoice.payment_failed', 'invoice.payment_action_required',
  'subscription_schedule.updated', 'subscription_schedule.completed', 'subscription_schedule.released', 'subscription_schedule.canceled',
]);
export const BILLING_STATUS = Object.freeze(['none', 'incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused']);
export const TERMINAL_STATUSES = Object.freeze(['none', 'canceled', 'incomplete_expired']);

export function billingPlan(key) { return BILLING_PLANS.find(plan => plan.key === key) || null; }
export function priceId(plan, env = process.env) { return String(env[plan.env] || '').trim(); }
export function planForPrice(id, env = process.env) {
  if (!id) return null;
  return [...BILLING_PLANS, LAUNCH_PRICE].find(plan => priceId(plan, env) === id) || null;
}
export function fitsPlan(plan, employeeCount) {
  return Boolean(plan) && (plan.maxEmployees == null || employeeCount <= plan.maxEmployees);
}
export function canManageBilling(payload) {
  return isSuperAdminPayload(payload) || (['admin', 'direction', 'hr'].includes(payload?.role) && isCompanyOwnerPayload(payload));
}
export function toIso(seconds) { return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : null; }
export function objectId(value) { return typeof value === 'string' ? value : value?.id || null; }

/** Calendar months, clamped for Jan 31 / leap years; never overflows into another month. */
export function addUtcMonths(seconds, months) {
  const date = new Date(seconds * 1000);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, last));
  return Math.floor(date.getTime() / 1000);
}

export function billingAccess({ managed, trialEndsAt, status, periodEnd, knownPlan = true }, now = Date.now()) {
  if (!managed) return true;
  if (knownPlan && ['active', 'trialing'].includes(status) && Date.parse(periodEnd || '') > now) return true;
  // Once a subscription exists, cancellation/failure must not reopen a free trial.
  return (!status || status === 'none') && Date.parse(trialEndsAt || '') > now;
}
