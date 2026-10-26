const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{16,128}$/;

export function mobileIdempotencyKey(request) {
  const value = String(request?.headers?.get?.('idempotency-key') || '').trim();
  return IDEMPOTENCY_KEY_PATTERN.test(value) ? value : null;
}
