import { NextResponse } from 'next/server';
import { isTurnstileConfigured, turnstileSiteKey } from '../../../../lib/identity/turnstile.js';

export const dynamic = 'force-dynamic';

/** GET /api/auth/captcha-config — Turnstile só obrigatório quando secret + site key estão ativos. */
export async function GET() {
  const siteKey = turnstileSiteKey();
  const required = isTurnstileConfigured() && Boolean(siteKey);
  return NextResponse.json({
    required,
    siteKey: required ? siteKey : '',
  });
}
