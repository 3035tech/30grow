import {
  authenticateMobileEmployee,
  mobileEmployeeBearerToken,
} from '../../../../../../../lib/mobile-employee-session.js';
import { employeeReceiptResponse } from '../../../../../../../lib/rep/employee-api.js';
import { apiError, ERR } from '../../../../../../../lib/api-error.js';
export const dynamic = 'force-dynamic';
export async function GET(request) {
  try {
    return await employeeReceiptResponse(
      request,
      await authenticateMobileEmployee(mobileEmployeeBearerToken(request)),
    );
  } catch {
    return apiError(request, ERR.INTERNAL, 500);
  }
}
