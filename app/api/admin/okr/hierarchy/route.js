import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../../lib/admin-api.js';
import { CAP } from '../../../../../lib/ae/require-admin.js';
import { apiErrorFromResult, ERR } from '../../../../../lib/api-error.js';
import { audit } from '../../../../../lib/audit.js';
import { z, zPositiveInt } from '../../../../../lib/validate.js';
import { listOkrHierarchy, saveAreaObjective, saveAreaKeyResult, recordKeyResultCheckin, listKeyResultCheckins, deleteAreaOkrEntity } from '../../../../../lib/okr-hierarchy.js';

const scope = { companyId: zPositiveInt.optional() };
const objective = z.object({ ...scope, action:z.literal('objective'), objectiveId:zPositiveInt.optional(), areaId:zPositiveInt.optional(), title:z.string().trim().min(1).max(300), description:z.string().max(8000).optional(), ownerCandidateId:zPositiveInt.nullable().optional(), periodEnd:z.string() });
const keyResult = z.object({ ...scope, action:z.literal('keyResult'), keyResultId:zPositiveInt.optional(), objectiveId:zPositiveInt.optional(), title:z.string().trim().min(1).max(300), unit:z.string().trim().min(1).max(40), startValue:z.number().finite(), targetValue:z.number().finite(), weight:z.number().int().min(0).max(10), deadline:z.string(), notes:z.string().max(8000).optional(), assigneeIds:z.array(zPositiveInt).min(1).max(20) });
const checkin = z.object({ ...scope, action:z.literal('checkin'), keyResultId:zPositiveInt, currentValue:z.number().finite(), note:z.string().max(500).optional() });
const remove = z.object({ ...scope, action:z.literal('delete'), kind:z.enum(['objective','kr']), id:zPositiveInt });
export const GET = withAdminApi({ cap:CAP.PERFORMANCE_VIEW, companyFrom:'query', query:z.object({...scope,keyResultId:zPositiveInt.optional(),cycleId:zPositiveInt.optional()}), logLabel:'okr hierarchy GET' }, async ({request,companyId,query}) => {
  const result = query.keyResultId ? await listKeyResultCheckins(null,{companyId,keyResultId:query.keyResultId}) : await listOkrHierarchy(null,{companyId,cycleId:query.cycleId ?? null});
  return result.ok ? NextResponse.json(result,{headers:{'Cache-Control':'no-store'}}) : apiErrorFromResult(request,result,{fallbackCode:ERR.INVALID_DATA});
});
export const POST = withAdminApi({ cap:CAP.PERFORMANCE_VIEW, companyFrom:'body', body:z.discriminatedUnion('action',[objective,keyResult,checkin,remove]), logLabel:'okr hierarchy POST' }, async ({request,companyId,body,payload}) => {
  const input={...body,companyId,userId:payload.userId};
  const fn={objective:saveAreaObjective,keyResult:saveAreaKeyResult,checkin:recordKeyResultCheckin,delete:deleteAreaOkrEntity}[body.action];
  const result=await fn(null,input);
  if(!result.ok) return apiErrorFromResult(request,result,{fallbackCode:ERR.INVALID_DATA});
  await audit({actorUserId:payload.userId,companyId,action:`okr.hierarchy.${body.action}`,targetType:body.action==='objective'||body.kind==='objective'?'okr_objective':'okr_key_result',targetId:result.objective?.id||result.keyResult?.id||body.id});
  return NextResponse.json(result);
});
