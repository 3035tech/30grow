import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../../../../lib/admin-api.js';
import { CAP } from '../../../../../../../lib/ae/require-admin.js';
import { z,zPositiveInt } from '../../../../../../../lib/validate.js';
import { apiError,apiErrorFromResult,ERR } from '../../../../../../../lib/api-error.js';
import { readBoundedFormData,singleFormFile } from '../../../../../../../lib/bounded-multipart.js';
import { POST_FILE_MAX_BYTES } from '../../../../../../../lib/company/company-post-file-rules.js';
import { uploadPostAttachment } from '../../../../../../../lib/company/company-post-attachments.js';
import { checkRateLimit } from '../../../../../../../lib/rate-limit.js';
import { auditFromRequest } from '../../../../../../../lib/audit.js';
export const POST=withAdminApi({cap:CAP.COMPANY_FEED_VIEW,companyFrom:'query',query:z.object({companyId:zPositiveInt.optional(),uploadId:z.string().uuid()}),logLabel:'company post attachment upload'},async({request,payload,companyId,params,query})=>{
 const parsed=zPositiveInt.safeParse(params?.id);if(!parsed.success)return apiError(request,ERR.INVALID_ID,400);
 const rate=await checkRateLimit(`post-file-upload:${companyId}:${payload.userId}`,30,3600000);if(!rate.ok)return apiError(request,ERR.RATE_LIMIT,429);
 try{
  const file=singleFormFile(await readBoundedFormData(request,POST_FILE_MAX_BYTES));
  if(!file)return apiError(request,ERR.INVALID_DATA,400);
  if(!file.size||file.size>POST_FILE_MAX_BYTES)return apiError(request,ERR.COMPANY_POST_FILE_SIZE,400);
  const result=await uploadPostAttachment({companyId,postId:parsed.data,userId:payload.userId,uploadId:query.uploadId,file:{buffer:Buffer.from(await file.arrayBuffer()),mimeType:file.type,originalName:file.name}});
  if(!result.ok)return apiErrorFromResult(request,result);
  await auditFromRequest(request,{actorUserId:payload.userId,companyId,action:'company_post.attachment_uploaded',targetType:'company_post',targetId:parsed.data,metadata:{attachmentId:result.attachment.id}});
  return NextResponse.json(result,{status:201,headers:{'Cache-Control':'no-store'}});
 }catch(error){
  const code=error?.code===ERR.INVALID_CV_FILE_SIZE?ERR.COMPANY_POST_FILE_SIZE:error?.code;
  if([ERR.COMPANY_POST_FILE_SIZE,ERR.COMPANY_POST_FILE_TYPE].includes(code))return apiError(request,code,400);
  if(code===ERR.STORAGE_NOT_CONFIGURED)return apiError(request,code,503);
  if(code===ERR.STORAGE_UPLOAD_FAILED)return apiError(request,code,503);
  if(['42P01','42703'].includes(code))return apiError(request,ERR.SCHEMA_NOT_INITIALIZED,503);
  throw error;
 }
});
