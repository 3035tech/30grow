/** Idempotent catalog setup. Run with --apply only after loading STRIPE_SECRET_KEY.
 * Sandbox is the default; live setup requires the explicit --live argument.
 * Never prints secret keys or signing secrets. --write-env stores Stripe IDs and
 * a newly-created webhook secret locally; no database or deployment is changed.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { BILLING_PLANS, LAUNCH_PRICE, STRIPE_EVENTS, STRIPE_API_VERSION, priceId } from '../lib/billing/catalog.js';
import { getStripe, stripeMode } from '../lib/billing/stripe.js';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const writeEnv = args.includes('--write-env');
const hookArg = args.find(a => a.startsWith('--webhook-url='));
const endpointUrl = hookArg?.slice('--webhook-url='.length);
if (args.includes('--help')) {
  console.log('node --env-file=.env scripts/configure-stripe.mjs [--apply] [--write-env] [--live] [--webhook-url=https://HOST/api/webhooks/stripe]');
  process.exit(0);
}
const plans = [...BILLING_PLANS, LAUNCH_PRICE];
if (!apply) {
  console.log(JSON.stringify({ action: 'preview_only', plans: plans.map(p => ({ key: p.key, amount: p.amount, currency: p.currency, interval: p.interval })), webhookEvents: STRIPE_EVENTS, apiVersion: STRIPE_API_VERSION }, null, 2));
  process.exit(0);
}
const live = stripeMode();
if (live && !args.includes('--live')) throw new Error('Live setup requires --live. No changes made.');
if (endpointUrl) {
  const url = new URL(endpointUrl);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/api/webhooks/stripe') throw new Error('Provide the exact HTTPS /api/webhooks/stripe endpoint.');
  if (!writeEnv) throw new Error('--write-env is required to safely save the new webhook signing secret.');
}
const stripe = getStripe();
const catalog = [];
for await (const p of stripe.products.list({ limit: 100, active: true })) if (p.metadata?.app === '30grow' || p.name === '30Grow Completo') catalog.push(p);
if (catalog.length > 1) throw new Error('Multiple Grow products exist. Review catalog before proceeding.');
let product = catalog[0];
if (!product) product = await stripe.products.create({ name: '30Grow Completo', description: 'Recrutamento, desenvolvimento e gestão de pessoas. Todos os módulos incluídos; preço por faixa de colaboradores ativos.', metadata: { app: '30grow' } }, { idempotencyKey: 'grow:product:v1' });
else if (product.metadata?.app !== '30grow') product = await stripe.products.update(product.id, { metadata: { ...product.metadata, app: '30grow' } });
const env = {};
const existing = [];
for await (const price of stripe.prices.list({ product: product.id, active: true, limit: 100 })) existing.push(price);
for (const plan of plans) {
  const lookupKey = `grow_${plan.key}_v1`;
  const matches = existing.filter(p => p.currency === plan.currency && p.unit_amount === plan.amount && p.recurring?.interval === plan.interval && p.recurring?.interval_count === 1 && p.billing_scheme === 'per_unit');
  let price = existing.find(p => p.id === priceId(plan)) || existing.find(p => p.lookup_key === lookupKey);
  if (!price && matches.length === 1) price = matches[0];
  if (price && (!matches.some(p => p.id === price.id))) throw new Error(`Unexpected configured price for ${plan.key}.`);
  if (!price) price = await stripe.prices.create({ product: product.id, currency: plan.currency, unit_amount: plan.amount, recurring: { interval: plan.interval }, lookup_key: lookupKey, nickname: plan.key, metadata: { app: '30grow', plan_key: plan.key } }, { idempotencyKey: `grow:price:${lookupKey}` });
  else if (!price.lookup_key) price = await stripe.prices.update(price.id, { lookup_key: lookupKey, nickname: plan.key, metadata: { ...price.metadata, app: '30grow', plan_key: plan.key } });
  env[plan.env] = price.id;
}
const configurations = await stripe.billingPortal.configurations.list({ limit: 100 });
let portal = configurations.data.find(c => c.active && c.metadata?.app === '30grow' && c.metadata?.purpose === 'manage');
const portalSettings = { business_profile: { headline: '30Grow — assinatura e pagamentos' }, features: {
  customer_update: { enabled: true, allowed_updates: ['address', 'tax_id'] },
  invoice_history: { enabled: true }, payment_method_update: { enabled: true },
  subscription_cancel: { enabled: true, mode: 'at_period_end', cancellation_reason: { enabled: false, options: ['too_expensive', 'missing_features', 'unused', 'other'] } },
  // Plan changes use a server-validated, target-only portal configuration.
  subscription_update: { enabled: false },
}, metadata: { app: '30grow', purpose: 'manage' } };
portal = portal ? await stripe.billingPortal.configurations.update(portal.id, portalSettings) : await stripe.billingPortal.configurations.create(portalSettings, { idempotencyKey: 'grow:portal:manage:v1' });
env.STRIPE_PORTAL_CONFIGURATION_ID = portal.id;
if (endpointUrl) {
  const hooks = await stripe.webhookEndpoints.list({ limit: 100 });
  const current = hooks.data.find(h => h.url === endpointUrl);
  if (current) {
    if (current.api_version !== STRIPE_API_VERSION) throw new Error('Existing webhook uses another API version. Review endpoint before updating it.');
    await stripe.webhookEndpoints.update(current.id, { enabled_events: STRIPE_EVENTS, disabled: false });
  } else {
    const hook = await stripe.webhookEndpoints.create({ url: endpointUrl, enabled_events: STRIPE_EVENTS, api_version: STRIPE_API_VERSION, metadata: { app: '30grow' } }, { idempotencyKey: `grow:webhook:${endpointUrl}` });
    env.STRIPE_WEBHOOK_SECRET = hook.secret;
  }
}
if (writeEnv) {
  let file = await readFile('.env', 'utf8').catch(() => '');
  for (const [key, value] of Object.entries(env)) {
    const line = `${key}=${value}`;
    const expression = new RegExp(`^${key}=.*$`, 'm');
    file = expression.test(file) ? file.replace(expression, line) : `${file.replace(/\n?$/, '\n')}${line}\n`;
  }
  await writeFile('.env', file, { mode: 0o600 });
}
console.log(JSON.stringify({ environment: live ? 'live' : 'sandbox', product: product.id, prices: Object.fromEntries(Object.entries(env).filter(([k]) => k.startsWith('STRIPE_PRICE_'))), portal: portal.id, webhook: endpointUrl || 'not configured; pass --webhook-url', signingSecretSaved: Boolean(env.STRIPE_WEBHOOK_SECRET && writeEnv), envUpdated: writeEnv }, null, 2));
