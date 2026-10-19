import { z, zPositiveInt } from '../../../../../lib/validate.js';
import { withBillingApi } from '../../../../../lib/billing/api.js';
import { setSubscriptionCancellation } from '../../../../../lib/billing/sync.js';

export const POST = withBillingApi({ companyFrom: 'body', body: z.object({ companyId: zPositiveInt.optional(), cancel: z.boolean(), confirmed: z.literal(true) }) },
  ({ companyId, body }) => setSubscriptionCancellation(companyId, body.cancel));
