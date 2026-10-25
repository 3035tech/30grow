import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../../../lib/admin-api.js';
import { CAP } from '../../../../../../lib/ae/require-admin.js';
import { apiErrorFromResult, ERR } from '../../../../../../lib/api-error.js';
import { z, zLocale, zPositiveInt } from '../../../../../../lib/validate.js';
import { query } from '../../../../../../lib/db.js';
import { admitCandidateAsEmployee, listCandidateHiringLinks } from '../../../../../../lib/hire.js';
import { normalizeStartDate } from '../../../../../../lib/pipeline.js';
import { ONBOARDING_STAGES } from '../../../../../../lib/onboarding-stage-selection.js';
import { audit } from '../../../../../../lib/audit.js';
import { checkRateLimit } from '../../../../../../lib/rate-limit.js';
import { EMPLOYEE_ACCESS_STATE_SQL } from '../../../../../../lib/employee-access-state.js';

const schema = z.object({
  companyId: zPositiveInt.optional(),
  startDate: z.string().trim().refine(value => Boolean(normalizeStartDate(value))),
  personalEmail: z.string().trim().email().max(254),
  corporateEmail: z.string().trim().email().max(254).optional().nullable(),
  vacancyId: zPositiveInt.optional().nullable(),
  entryMode: z.enum(['new_hire','existing_employee']).default('new_hire'),
  onboardingStages: z.array(z.enum(ONBOARDING_STAGES)).max(4).refine(value => new Set(value).size === value.length).optional(),
  sendAccessInvite: z.boolean().default(true),
  startedWorking: z.literal(true),
  locale: zLocale.optional(),
});

async function ownedPerson(params, scope, companyId) {
  const parsed = zPositiveInt.safeParse(params?.id);
  if (!parsed.success) return null;
  const result = await query(`SELECT c.id,c.company_id AS "companyId",c.full_name AS "fullName",c.email,
    c.personal_email AS "personalEmail",c.start_date::text AS "startDate",c.employment_status AS "employmentStatus",
    ${EMPLOYEE_ACCESS_STATE_SQL} AS "employeeAccessState"
    FROM candidates c JOIN companies co ON co.id=c.company_id AND co.deleted=FALSE
    WHERE c.id=$1 AND ($2::bigint IS NULL OR c.company_id=$2) AND ($3::bigint IS NULL OR c.company_id=$3)`,
  [parsed.data,scope.isAdmin ? null : scope.companyId,companyId || null]);
  return result.rows[0] || null;
}

export const GET = withAdminApi({ cap: CAP.TEAM_VIEW, requireCompany: false, logLabel: 'admission GET' }, async ({ request, params, scope }) => {
  const person = await ownedPerson(params, scope);
  if (!person) return apiErrorFromResult(request, { errorCode: ERR.NOT_FOUND });
  return NextResponse.json({ person, hiringLinks: await listCandidateHiringLinks(query, { companyId: person.companyId, candidateId: person.id }) });
});

export const POST = withAdminApi({ cap: CAP.TEAM_VIEW, body: schema, requireCompany: false, logLabel: 'admission POST' }, async ({ request, params, scope, body, payload }) => {
  const person = await ownedPerson(params, scope, body.companyId);
  if (!person) return apiErrorFromResult(request, { errorCode: ERR.NOT_FOUND });
  const limit = await checkRateLimit(`employee-admission:${payload.userId}`,30,15*60*1000);
  if (!limit.ok) return apiErrorFromResult(request, { errorCode: ERR.RATE_LIMIT });
  const result = await admitCandidateAsEmployee({ ...body, companyId: person.companyId, candidateId: person.id, actorId: payload.userId });
  if (!result.ok) return apiErrorFromResult(request, result);
  if (!result.alreadyEmployee) await audit({ actorUserId: payload.userId, companyId: person.companyId,
    action: 'employee.admitted', targetType: 'candidate', targetId: String(person.id),
    metadata: { startDate: result.startDate, entryMode: body.entryMode, vacancyId: body.vacancyId || null, startedWorkingConfirmed: true,
      onboardingStages: body.onboardingStages, inviteQueued: result.inviteSent, personalEmailPresent: Boolean(result.personalEmail) } });
  return NextResponse.json(result);
});
