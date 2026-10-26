import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../../../../lib/admin-api.js';
import { CAP } from '../../../../../../../lib/ae/require-admin.js';
import { apiErrorFromResult, ERR } from '../../../../../../../lib/api-error.js';
import { z, zPositiveInt } from '../../../../../../../lib/validate.js';
import { enrollLmsCandidates, listLmsEnrollments, getLmsCourseOpsSummary } from '../../../../../../../lib/lms.js';
import { audit } from '../../../../../../../lib/audit.js';
import { notifyCompanyManagers } from '../../../../../../../lib/manager-notifications.js';
import { NOTIF } from '../../../../../../../lib/manager-notification-catalog.js';

const listQuerySchema = z.object({
  companyId: zPositiveInt.optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(80),
});

const enrollBodySchema = z.object({
  companyId: zPositiveInt.optional(),
  candidateIds: z.array(zPositiveInt).max(100).optional(),
  allEmployees: z.boolean().optional(),
  teamGroupId: zPositiveInt.optional().nullable(),
  jobRoleId: zPositiveInt.optional().nullable(),
  cohortId: zPositiveInt.optional().nullable(),
  cohortName: z.string().trim().min(1).max(200).optional().nullable(),
  dueDate: z.string().trim().max(10).optional().nullable(),
  mandatory: z.boolean().optional(),
  notify: z.boolean().optional(),
});

/** GET /api/admin/lms/courses/[id]/enrollments */
export const GET = withAdminApi(
  {
    cap: CAP.LEARNING_VIEW,
    query: listQuerySchema,
    companyFrom: 'query',
    logLabel: 'lms enrollments GET',
  },
  async ({ request, companyId, query, params }) => {
    const courseId = parseInt(String(params?.id || ''), 10);
    if (!Number.isFinite(courseId)) {
      return apiErrorFromResult(request, { ok: false, errorCode: ERR.NOT_FOUND });
    }
    const [result, ops] = await Promise.all([
      listLmsEnrollments(null, {
        companyId,
        courseId,
        limit: query.limit,
      }),
      getLmsCourseOpsSummary(null, { companyId, courseId }),
    ]);
    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.NOT_FOUND });
    }
    return NextResponse.json({
      ok: true,
      enrollments: result.enrollments,
      totalLessons: result.totalLessons,
      completionPct: result.completionPct,
      ops,
    });
  }
);

/** POST batch enroll — ids / allEmployees / teamGroupId + optional turma */
export const POST = withAdminApi(
  {
    cap: CAP.LEARNING_VIEW,
    body: enrollBodySchema,
    companyFrom: 'body',
    logLabel: 'lms enrollments POST',
  },
  async ({ request, payload, companyId, body, params }) => {
    const courseId = parseInt(String(params?.id || ''), 10);
    if (!Number.isFinite(courseId)) {
      return apiErrorFromResult(request, { ok: false, errorCode: ERR.NOT_FOUND });
    }
    const result = await enrollLmsCandidates(null, {
      companyId,
      courseId,
      candidateIds: body.candidateIds || [],
      allEmployees: body.allEmployees === true,
      teamGroupId: body.teamGroupId || null,
      jobRoleId: body.jobRoleId || null,
      cohortId: body.cohortId || null,
      cohortName: body.cohortName || null,
      dueDate: body.dueDate,
      mandatory: body.mandatory === true,
      enrolledByUserId: payload.userId,
    });
    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.CREATE_FAILED });
    }
    await audit({
      actorUserId: payload.userId || null,
      action: 'lms.enroll.batch',
      targetType: 'lms_course',
      targetId: String(courseId),
      metadata: {
        enrolled: result.enrolled,
        skipped: result.skipped,
        cohortId: result.cohortId,
      },
    });
    if (body.notify !== false && result.enrolled > 0) {
      try {
        await notifyCompanyManagers({
          companyId,
          type: NOTIF.LMS_ENROLLED,
          entityType: 'lms_course',
          entityId: courseId,
          dedupeKey: `lms_enrolled:${courseId}:${Date.now()}`,
          payload: {
            courseId,
            courseTitle: result.courseTitle,
            enrolled: result.enrolled,
          },
        });
        const { notifyCandidates, EMPLOYEE_NOTIF } = await import(
          '../../../../../../../lib/employee/employee-notifications.js'
        );
        const enrolledIds = Array.isArray(result.candidateIds) ? result.candidateIds : [];
        if (enrolledIds.length) {
          await notifyCandidates(null, {
            companyId,
            candidateIds: enrolledIds,
            type: EMPLOYEE_NOTIF.LMS_ENROLLED,
            entityType: 'lms_course',
            entityId: courseId,
            dedupeKeyPrefix: `lms_enrolled:${courseId}`,
            payload: {
              courseId,
              courseTitle: result.courseTitle,
              dueDate: result.dueDate || null,
            },
          });
        }
      } catch (notifyErr) {
        console.error('[lms enrollments POST] notify failed', notifyErr);
      }
    }
    return NextResponse.json({
      ok: true,
      enrolled: result.enrolled,
      skipped: result.skipped,
      cohortId: result.cohortId,
    });
  }
);
