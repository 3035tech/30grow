import { NextResponse } from 'next/server';
import { withAdminApi } from '../admin-api.js';
import { CAP, isSuperAdminPayload } from '../identity/permissions.js';
import { apiError, ERR } from '../api-error.js';
import { BillingError, requireSameOrigin } from './stripe.js';
export function withPlatformBillingApi(options, handler) {
  return withAdminApi({
    cap: CAP.COMPANIES_MANAGE,
    requireCompany: false,
    ...options,
    logLabel: 'platform-billing'
  }, async context => {
    if (!isSuperAdminPayload(context.payload)) return apiError(context.request, ERR.FORBIDDEN, 403);
    try {
      if (context.request.method !== 'GET') requireSameOrigin(context.request);
      return NextResponse.json(await handler(context), {
        headers: {
          'Cache-Control': 'private, no-store'
        }
      });
    } catch (error) {
      if (error instanceof BillingError) return apiError(context.request, error.code, error.status);
      console.error('[platform-billing]', {
        type: error.type || error.code || 'unknown'
      });
      return apiError(context.request, ['StripePermissionError', 'StripeAuthenticationError'].includes(error.type) ? ERR.BILLING_STRIPE_PERMISSION : ERR.BILLING_UNAVAILABLE, 503);
    }
  });
}
