import { z, zPositiveInt } from '../../../../lib/validate.js';
import { withBillingApi } from '../../../../lib/billing/api.js';
import { billingSummary } from '../../../../lib/billing/accounts.js';

export const GET = withBillingApi({ companyFrom: 'query', query: z.object({ companyId: zPositiveInt.optional(), currency: z.enum(['brl', 'usd']).default('brl') }) },
  ({ companyId, query }) => billingSummary(companyId, query.currency));
