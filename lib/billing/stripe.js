import Stripe from 'stripe';
import { runtimeAppUrl } from '../app-url.js';
import { STRIPE_API_VERSION, priceId } from './catalog.js';

export class BillingError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}
export function stripeMode(env = process.env) {
  const key = String(env.STRIPE_SECRET_KEY || '').trim();
  if (!/^(sk|rk)_(test|live)_/.test(key)) throw new BillingError('BILLING_NOT_CONFIGURED', 503);
  return /^(sk|rk)_live_/.test(key);
}
export function getStripe() {
  stripeMode();
  return new Stripe(process.env.STRIPE_SECRET_KEY.trim(), { apiVersion: STRIPE_API_VERSION, maxNetworkRetries: 2, timeout: 10000, telemetry: false });
}
export function billingBaseUrl() {
  let url;
  try { url = new URL(runtimeAppUrl()); } catch { throw new BillingError('BILLING_NOT_CONFIGURED', 503); }
  if (url.username || url.password || (url.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && ['127.0.0.1', 'localhost'].includes(url.hostname) && url.protocol === 'http:'))) throw new BillingError('BILLING_NOT_CONFIGURED', 503);
  return url.origin;
}
export function requireSameOrigin(request) {
  const origin = request.headers.get('origin');
  const site = request.headers.get('sec-fetch-site');
  if (!origin || origin !== billingBaseUrl() || (site && !['same-origin', 'none'].includes(site))) throw new BillingError('FORBIDDEN', 403);
}
export async function checkedPrice(stripe, plan) {
  const id = priceId(plan);
  if (!id) throw new BillingError('BILLING_NOT_CONFIGURED', 503);
  const price = await stripe.prices.retrieve(id);
  if (!price.active || price.type !== 'recurring' || price.unit_amount !== plan.amount || price.currency !== plan.currency || price.recurring?.interval !== plan.interval || price.recurring?.interval_count !== 1 || price.billing_scheme !== 'per_unit') throw new BillingError('BILLING_PRICE_INVALID', 503);
  return price;
}
