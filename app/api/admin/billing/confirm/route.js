import { z, zPositiveInt } from '../../../../../lib/validate.js';
import { withBillingApi } from '../../../../../lib/billing/api.js';
import { confirmCheckout } from '../../../../../lib/billing/sync.js';

export const POST = withBillingApi({ companyFrom: 'body', body: z.object({ companyId: zPositiveInt.optional(), sessionId: z.string().regex(/^cs_[a-zA-Z0-9_]+$/).max(255) }) },
  ({ companyId, body }) => confirmCheckout(companyId, body.sessionId));
