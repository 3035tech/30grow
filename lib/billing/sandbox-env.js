/** A sandbox key must never inherit live price IDs or portal/webhook settings. */
export function stripeSandboxEnvironment(secret, current = {}) {
  if (!/^(sk|rk)_test_[A-Za-z0-9]+$/.test(secret?.STRIPE_SECRET_KEY || '')) throw new Error('A Stripe sandbox key is required. Live keys are refused.');
  const next = Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith('STRIPE_')));
  for (const [key, value] of Object.entries(secret)) if (key.startsWith('STRIPE_') && typeof value === 'string') next[key] = value;
  next.STRIPE_BILLING_ENFORCE = 'true';
  return next;
}
