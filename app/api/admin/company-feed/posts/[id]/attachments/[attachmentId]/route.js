import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../../../../../lib/admin-api.js';
import { CAP } from '../../../../../../../../lib/ae/require-admin.js';
import { z,zPositiveInt } from '../../../../../../../../lib/validate.js';
import { apiError,apiErrorFromResult,ERR } from '../../../../../../../../lib/api-error.js';
import { removePostAttachment } from '../../../../../../../../lib/company-post-attachments.js';
import { companyPostFileResponse } from '../../../../../../../../lib/company-post-file-http.js';
import { auditFromRequest } from '../../../../../../../../lib/audit.js';
const options={cap:CAP.COMPANY_FEED_VIEW,companyFrom:'query',query:z.object({companyId:zPositiveInt.optional(),preview:z.enum(['1']).optional()}),logLabel:'company post attachment'};
function ids(params,companyId){const parsed=z.object({id:zPositiveInt,attachmentId:zPositiveInt}).safeParse(params);return parsed.success?{companyId,postId:parsed.data.id,attachmentId:parsed.data.attachmentId}:null;}
export const GET=withAdminApi(options,async({request,payload,params,companyId})=>{
 const scoped=ids(params,companyId);if(!scoped)return apiError(request,ERR.INVALID_ID,400);
 return companyPostFileResponse(request,`manager:${payload.userId}`,scoped);
});
export const DELETE=withAdminApi(options,async({request,payload,params,companyId})=>{
 const scoped=ids(params,companyId);if(!scoped)return apiError(request,ERR.INVALID_ID,400);
 const result=await removePostAttachment(scoped);if(!result.ok)return apiErrorFromResult(request,result);
 await auditFromRequest(request,{actorUserId:payload.userId,companyId,action:'company_post.attachment_removed',targetType:'company_post',targetId:scoped.postId,metadata:{attachmentId:scoped.attachmentId}});
 return NextResponse.json({ok:true});
});
