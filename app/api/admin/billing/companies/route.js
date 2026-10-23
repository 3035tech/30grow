import { z, zPositiveInt } from '../../../../../lib/validate.js';
import { withPlatformBillingApi } from '../../../../../lib/billing/admin-api.js';
import { BILLING_COMPANY_FILTERS } from '../../../../../lib/billing/catalog.js';
import { listBillingCompanies, billingCompanyDetails } from '../../../../../lib/billing/admin.js';
export const GET = withPlatformBillingApi({
  query: z.object({
    companyId: zPositiveInt.optional(),
    q: z.string().max(200).default(''),
    status: z.enum(BILLING_COMPANY_FILTERS).default('all'),
    page: zPositiveInt.default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    refresh: z.enum(['true', 'false']).default('false')
  })
}, ({
  query
}) => query.companyId ? billingCompanyDetails(query.companyId, {
  refresh: query.refresh === 'true'
}) : listBillingCompanies(query));
