import { getEmployeeSessionPayload } from '../../../../../../../lib/employee-session.js';
import { apiError,ERR } from '../../../../../../../lib/api-error.js';
import { z,zPositiveInt } from '../../../../../../../lib/validate.js';
import { COMPANY_MODULE,companyHasModule } from '../../../../../../../lib/company-modules.js';
import { getCompanyEnabledModules } from '../../../../../../../lib/company-module-entitlements.js';
import { companyPostFileResponse } from '../../../../../../../lib/company-post-file-http.js';
export const dynamic='force-dynamic';
export async function GET(request,{params}){
 try{
  const session=await getEmployeeSessionPayload();if(!session)return apiError(request,ERR.UNAUTHORIZED,401);
  if(!companyHasModule(session.companyModules,COMPANY_MODULE.COMPANY_FEED))return apiError(request,ERR.FORBIDDEN,403);
  const parsed=z.object({id:zPositiveInt,attachmentId:zPositiveInt}).safeParse(await params);if(!parsed.success)return apiError(request,ERR.INVALID_ID,400);
  return await companyPostFileResponse(request,`employee:${session.candidateId}`,{companyId:session.companyId,postId:parsed.data.id,attachmentId:parsed.data.attachmentId});
 }catch{return apiError(request,ERR.INTERNAL,500);}
}
