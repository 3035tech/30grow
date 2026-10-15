import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../lib/admin-api.js';
import { CAP, requireCapability } from '../../../../lib/permissions.js';
import { apiErrorFromResult, ERR } from '../../../../lib/api-error.js';
import { z, zPositiveInt } from '../../../../lib/validate.js';
import { auditFromRequest } from '../../../../lib/audit.js';
import { checkRateLimit } from '../../../../lib/rate-limit.js';
import { query as dbQuery } from '../../../../lib/db.js';
import {
  listOrgPositions,
  saveOrgPosition,
  changeOrgPosition,
  manageOrgAssignment,
  releaseOrgPosition,
  linkOrgPositionVacancy,
  getOrgPositionHistory,
} from '../../../../lib/people/org-positions.js';
import { POSITION_STATUSES } from '../../../../lib/org-position-constants.js';
const company = { companyId: zPositiveInt.optional() };
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
  });
const base = { ...company, positionId: zPositiveInt };
const reason = z.string().trim().min(1).max(1000);
const plan = z
  .object({
    ...company,
    id: zPositiveInt.optional(),
    version: z.number().int().positive().optional(),
    code: z.string().trim().min(1).max(60),
    title: z.string().trim().min(1).max(160),
    orgUnitId: zPositiveInt,
    jobRoleId: zPositiveInt,
    fte: z.coerce.number().positive().max(1).multipleOf(0.01),
    effectiveFrom: date,
    effectiveTo: date.nullable().default(null),
  })
  .refine((v) => !v.effectiveTo || v.effectiveTo >= v.effectiveFrom);
const mutation = z.discriminatedUnion('action', [
  z.object({
    ...base,
    action: z.literal('status'),
    version: z.number().int().positive(),
    status: z.enum(POSITION_STATUSES),
  }),
  z.object({
    ...base,
    action: z.literal('assign'),
    candidateId: zPositiveInt,
    startedOn: date,
    reason,
  }),
  z.object({
    ...base,
    action: z.literal('release'),
    assignmentId: zPositiveInt,
    endedOn: date,
    reason,
  }),
  z.object({
    ...base,
    action: z.literal('link'),
    vacancyId: zPositiveInt.nullable(),
    recruitmentId: zPositiveInt.optional(),
  }),
]);
export const GET = withAdminApi(
  {
    cap: CAP.TEAM_VIEW,
    query: z.object({
      ...company,
      page: z.coerce.number().int().min(1).max(100000).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(20),
      q: z.string().trim().max(160).default(''),
      status: z.enum(['', ...POSITION_STATUSES, 'open', 'occupied']).default(''),
      orgUnitId: zPositiveInt.optional(),
      jobRoleId: zPositiveInt.optional(),
      vacancyId: zPositiveInt.optional(),
      candidateId: zPositiveInt.optional(),
      historyId: zPositiveInt.optional(),
      options: z.enum(['1']).optional(),
    }),
  },
  async ({ request, companyId, query }) => {
    const result = query.historyId
      ? await getOrgPositionHistory(companyId, query.historyId)
      : await listOrgPositions(companyId, query);
    if (!result.ok) return apiErrorFromResult(request, result);
    if (query.options) {
      const [units, roles] = await Promise.all([
        dbQuery(
          'SELECT id,name,parent_id AS "parentId" FROM org_units WHERE company_id=$1 AND active ORDER BY name LIMIT 500',
          [companyId],
        ),
        dbQuery(
          'SELECT id,name FROM job_roles WHERE company_id=$1 AND active ORDER BY name LIMIT 500',
          [companyId],
        ),
      ]);
      result.units = units.rows;
      result.roles = roles.rows;
    }
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  },
);
function write(schema, work) {
  return withAdminApi(
    { cap: CAP.TEAM_VIEW, body: schema, companyFrom: 'body', logLabel: 'headcount write' },
    async ({ request, companyId, payload, body }) => {
      if (body.action === 'link' && !requireCapability(payload, CAP.VACANCIES_MANAGE))
        return apiErrorFromResult(request, { errorCode: ERR.FORBIDDEN });
      const limit = await checkRateLimit(`headcount:${companyId}:${payload.userId}`, 60, 60_000);
      if (!limit.ok) return apiErrorFromResult(request, { errorCode: ERR.RATE_LIMIT });
      let result;
      try {
        result = await work({ ...body, companyId, actorId: payload.userId });
      } catch (error) {
        if (Object.values(ERR).includes(error.code))
          return apiErrorFromResult(request, { errorCode: error.code });
        throw error;
      }
      if (!result.ok) return apiErrorFromResult(request, result);
      await auditFromRequest(request, {
        actorUserId: payload.userId,
        companyId,
        action: `organization.position.${body.action || (body.id ? 'update' : 'create')}`,
        targetType: 'org_position',
        targetId: body.positionId || result.id,
        metadata: {
          status: body.status,
          candidateId: body.candidateId,
          orgUnitId: body.orgUnitId,
          jobRoleId: body.jobRoleId,
          vacancyId: body.vacancyId,
          fte: body.fte,
          effectiveDate: body.startedOn || body.endedOn,
        },
      });
      return NextResponse.json(result);
    },
  );
}
export const POST = write(plan, saveOrgPosition);
export const PATCH = write(
  mutation.refine(
    (value) => value.action !== 'link' || value.vacancyId !== null || value.recruitmentId != null,
  ),
  (body) =>
    ({
      status: changeOrgPosition,
      assign: manageOrgAssignment,
      release: releaseOrgPosition,
      link: linkOrgPositionVacancy,
    })[body.action]({ ...body, id: body.positionId }),
);
