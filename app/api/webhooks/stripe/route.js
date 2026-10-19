import { NextResponse } from 'next/server';
import { getStripe, BillingError } from '../../../../lib/billing/stripe.js';
import { processBillingEvent } from '../../../../lib/billing/sync.js';

export const runtime = 'nodejs';
export async function POST(request) {
  if (!process.env.STRIPE_WEBHOOK_SECRET || !process.env.STRIPE_SECRET_KEY) return NextResponse.json({ error: 'not_configured' }, { status: 503 });
  if (Number(request.headers.get('content-length')) > 1048576) return NextResponse.json({ error: 'payload_too_large' }, { status: 413 });
  // Raw body is mandatory: parsing JSON before verification changes the signature.
  const raw = await request.text();
  if (Buffer.byteLength(raw) > 1048576) return NextResponse.json({ error: 'payload_too_large' }, { status: 413 });
  let event;
  try { event = getStripe().webhooks.constructEvent(raw, request.headers.get('stripe-signature') || '', process.env.STRIPE_WEBHOOK_SECRET); }
  catch { return NextResponse.json({ error: 'invalid_signature' }, { status: 400 }); }
  try { return NextResponse.json(await processBillingEvent(event)); }
  catch (error) {
    console.error('[stripe-webhook] processing failed', { eventId: event.id, type: error?.code || error?.type || 'unknown' });
    return NextResponse.json({ error: 'processing_failed' }, { status: error instanceof BillingError && error.status === 400 ? 400 : 503 });
  }
}
