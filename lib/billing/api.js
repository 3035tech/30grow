import { NextResponse } from 'next/server';
import { withAdminApi } from '../admin-api.js';
import { CAP } from '../permissions.js';
import { apiError } from '../api-error.js';
import { canManageBilling } from './catalog.js';
import { BillingError, requireSameOrigin } from './stripe.js';

export function withBillingApi(options, handler) {
  return withAdminApi({ cap: CAP.PROFILE_SELF, requireCompany: true, ...options, logLabel: 'billing-api' }, async context => {
    try {
      if (!canManageBilling(context.payload)) return apiError(context.request, 'FORBIDDEN', 403);
      if (context.request.method !== 'GET') requireSameOrigin(context.request);
      return NextResponse.json(await handler(context), { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      if (error instanceof BillingError) return apiError(context.request, error.code, error.status);
      console.error('[billing-api] request failed', { type: error?.type || error?.code || 'unknown' });
      return apiError(context.request, 'BILLING_UNAVAILABLE', 503);
    }
  });
}
