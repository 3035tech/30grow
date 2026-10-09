import { NextResponse } from 'next/server';
import { isTurnstileConfigured, turnstileSiteKey } from '../../../../../../lib/turnstile.js';
import { runtimeAppUrl } from '../../../../../../lib/app-url.js';
export const dynamic = 'force-dynamic';
export async function GET() {
  return NextResponse.json({ required: isTurnstileConfigured(), siteKey: turnstileSiteKey(), origin: new URL(runtimeAppUrl()).origin }, { headers: { 'Cache-Control': 'no-store' } });
}
