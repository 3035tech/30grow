import { z, zPositiveInt } from '../../../../../lib/validate.js';
import { withBillingApi } from '../../../../../lib/billing/api.js';
import { openBillingPortal } from '../../../../../lib/billing/accounts.js';
import { BILLING_PLANS } from '../../../../../lib/billing/catalog.js';

export const POST = withBillingApi({ companyFrom: 'body', body: z.object({ companyId: zPositiveInt.optional(), planKey: z.enum(BILLING_PLANS.map(p => p.key)).optional() }) },
  ({ companyId, body }) => openBillingPortal(companyId, body.planKey || null));
