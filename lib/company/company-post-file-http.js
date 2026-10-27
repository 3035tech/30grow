import { privateAttachmentResponse } from '../private-attachment-response.js';
import { checkRateLimit } from '../identity/rate-limit.js';
import { apiError, apiErrorFromResult, ERR } from '../api-error.js';
import { downloadPostAttachment } from './company-post-attachments.js';

export async function companyPostFileResponse(request,actor,ids){
  const rate=await checkRateLimit(`post-file-download:${actor}`,180,60000);
  if(!rate.ok)return apiError(request,ERR.RATE_LIMIT,429);
  const result=await downloadPostAttachment(ids);
  if(!result.ok)return apiErrorFromResult(request,result);
  const response=privateAttachmentResponse(result);
  if(new URL(request.url).searchParams.get('preview')==='1'&&['image/jpeg','image/png','image/webp'].includes(result.contentType)){
    response.headers.set('Content-Disposition','inline');
    response.headers.set('Content-Security-Policy',"default-src 'none'; sandbox");
  }
  return response;
}
