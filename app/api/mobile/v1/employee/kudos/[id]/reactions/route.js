import { authenticateMobileEmployee, mobileEmployeeBearerToken } from '../../../../../../../../lib/mobile-employee-session.js';
import { getCompanyEnabledModules } from '../../../../../../../../lib/company-module-entitlements.js';
import { apiError, ERR, HTTP_STATUS } from '../../../../../../../../lib/api-error.js';
import { kudoReactionResponse } from '../../../../../../../../lib/kudo-reaction-http.js';

export const dynamic = 'force-dynamic';
async function handle(request, { params }) {
  try {
    const session = await authenticateMobileEmployee(mobileEmployeeBearerToken(request));
    const modules = session ? await getCompanyEnabledModules(null, session.companyId) : null;
    return await kudoReactionResponse(request, params, session, modules, { mobile: true });
  } catch (error) {
    return apiError(request, error.code === '42P01' ? ERR.SCHEMA_NOT_INITIALIZED : ERR.INTERNAL, HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}
export { handle as GET, handle as PUT, handle as DELETE };
