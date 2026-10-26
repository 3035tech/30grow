import { authenticateMobileEmployee,mobileEmployeeBearerToken } from '../../../../../../../../../lib/mobile-employee-session.js';
import { apiError,ERR,HTTP_STATUS } from '../../../../../../../../../lib/api-error.js';
import { z,zPositiveInt } from '../../../../../../../../../lib/validate.js';
import { COMPANY_MODULE,companyHasModule } from '../../../../../../../../../lib/company/company-modules.js';
import { getCompanyEnabledModules } from '../../../../../../../../../lib/company/company-module-entitlements.js';
import { companyPostFileResponse } from '../../../../../../../../../lib/company/company-post-file-http.js';
export const dynamic='force-dynamic';
export async function GET(request,{params}){
 try{
  const session=await authenticateMobileEmployee(mobileEmployeeBearerToken(request));if(!session)return apiError(request,ERR.UNAUTHORIZED,HTTP_STATUS.UNAUTHORIZED);
  if(!companyHasModule(await getCompanyEnabledModules(null,session.companyId),COMPANY_MODULE.COMPANY_FEED))return apiError(request,ERR.FORBIDDEN,HTTP_STATUS.FORBIDDEN);
  const parsed=z.object({id:zPositiveInt,attachmentId:zPositiveInt}).safeParse(await params);if(!parsed.success)return apiError(request,ERR.INVALID_ID,HTTP_STATUS.BAD_REQUEST);
  return await companyPostFileResponse(request,`mobile-employee:${session.candidateId}`,{companyId:session.companyId,postId:parsed.data.id,attachmentId:parsed.data.attachmentId});
 }catch{return apiError(request,ERR.INTERNAL,HTTP_STATUS.INTERNAL_SERVER_ERROR);}
}
