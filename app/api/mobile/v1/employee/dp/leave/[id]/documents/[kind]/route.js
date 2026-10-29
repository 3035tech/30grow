import { apiError, ERR, HTTP_STATUS } from '../../../../../../../../../../lib/api-error.js';
import { query } from '../../../../../../../../../../lib/db.js';
import { authenticateMobileEmployee, mobileEmployeeBearerToken } from '../../../../../../../../../../lib/mobile/mobile-employee-session.js';
import { downloadVacationDocument } from '../../../../../../../../../../lib/people/employee-dp.js';
import { dpDownloadResponse } from '../../../../../../../../../../lib/people/dp-download-response.js';

export const dynamic = 'force-dynamic';

export async function GET(request, props) {
  const session = await authenticateMobileEmployee(mobileEmployeeBearerToken(request));
  if (!session) return apiError(request, ERR.UNAUTHORIZED, HTTP_STATUS.UNAUTHORIZED);
  const { id, kind } = await props.params;
  if (!/^[1-9]\d*$/.test(String(id)) || !Number.isSafeInteger(Number(id)) || !['notice', 'receipt'].includes(kind)) {
    return apiError(request, ERR.NOT_FOUND, HTTP_STATUS.NOT_FOUND);
  }
  return dpDownloadResponse(request, `mobile-vacation:${session.companyId}:${session.candidateId}`, () =>
    downloadVacationDocument({ query }, { id: Number(id), companyId: session.companyId, candidateId: session.candidateId, documentType: kind })
  );
}
