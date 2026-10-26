import { loadOperationalSummaries } from '../../../../../lib/people/operational-summary.js';
import { EMPLOYEE_ACCESS_STATE_SQL } from '../../../../../lib/employee/employee-access-state.js';
import { rejectionReasonsSql } from '../../../../../lib/recruiting/pipeline';
import { candidateTagsSelectSql } from '../../../../../lib/recruiting/candidate-tags-core.js';
import { NextResponse } from 'next/server';
import { verifySessionWithCapabilities } from '../../../../../lib/identity/user-capabilities';
import { cookies } from 'next/headers';
import { COOKIE_NAME } from '../../../../../lib/identity/auth';
import { query, queryRead, withTransaction } from '../../../../../lib/db';
import { audit, auditFromRequest } from '../../../../../lib/audit';
import { apiError, ERR, httpStatusForError, localeFromRequest } from '../../../../../lib/api-error';
import { normalizeCandidateProfile } from '../../../../../lib/recruiting/candidate-profile';
import { titleCasePersonName } from '../../../../../lib/person-name';
import { buildCandidateTimeline } from '../../../../../lib/recruiting/hire';
import { buildCandidatePeopleBrief } from '../../../../../lib/people/candidate-people-brief';
import { isRichTextEmpty, sanitizeRichTextHtml } from '../../../../../lib/sanitize-html';
import { CAP, requireAnyCapability, canAccessCandidateRecord, isSuperAdminPayload } from '../../../../../lib/identity/permissions';
import { upsertDpProfile } from '../../../../../lib/people/employee-dp.js';
import { listCandidateOverdueLms } from '../../../../../lib/development/lms.js';
import { normalizeLocale } from '../../../../../lib/i18n.js';
import { finishEmployeeEmailChange, isValidEmployeeEmail, revokeEmployeeAccessForEmailChange } from '../../../../../lib/employee/employee-auth.js';
import { EMPLOYMENT_STATUS, WORK_FORMATS } from '../../../../../lib/domain-status.js';
import { normalizeTimeClockOverride } from '../../../../../lib/people/time-clock-eligibility.js';
import { CANDIDATE_AUDIT_PRESENCE_FIELDS, CANDIDATE_AUDIT_VALUE_FIELDS, diffAuditFields } from '../../../../../lib/audit-changes.js';

export async function GET(request, props) {
  const params = await props.params;
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  const payload = await verifySessionWithCapabilities(token);
  if (!canAccessCandidateRecord(payload)) return apiError(request, ERR.UNAUTHORIZED, 401);
  const isAdmin = isSuperAdminPayload(payload);
  const companyId = payload?.companyId ?? null;
  if (!isAdmin && !companyId) return apiError(request, ERR.UNAUTHORIZED, 401);

  const id = params?.id;
  const c = await queryRead(
    `SELECT c.id, ${candidateTagsSelectSql('c')} AS tags, c.company_id AS "companyId", c.full_name AS "fullName", c.email,
            c.personal_email AS "personalEmail", c.marital_status AS "maritalStatus",
            c.employee_number AS "employeeNumber", c.work_format AS "workFormat",
            c.work_history AS "workHistory", c.hr_notes AS "hrNotes",
            c.phone, c.linkedin_url AS "linkedinUrl", c.city, c.state,
            c.salary_expectation AS "salaryExpectation", c.availability, c.source,
            c.job_role_id AS "jobRoleId", jr.name AS "jobRoleName",
            c.employment_status AS "employmentStatus",
            ${EMPLOYEE_ACCESS_STATE_SQL} AS "employeeAccessState",
            c.hired_at AS "hiredAt", c.start_date AS "startDate",
            c.birth_date AS "birthDate",
            c.hired_vacancy_id AS "hiredVacancyId",
            c.consent_at AS "consentAt", c.created_at AS "createdAt",
            c.created_by_user_id AS "createdByUserId",
            u.display_name AS "createdByName",
            c.cv_url AS "cvUrl", c.cv_updated_at AS "cvUpdatedAt",
            (c.cv_extracted_text IS NOT NULL AND c.cv_extracted_text <> '') AS "hasCvText"
     FROM candidates c
     LEFT JOIN job_roles jr ON jr.id = c.job_role_id AND jr.company_id = c.company_id
     LEFT JOIN users u ON u.id = c.created_by_user_id AND u.deleted = FALSE
     WHERE c.id = $1
     LIMIT 1`,
    [id]
  );
  if (c.rowCount === 0) return apiError(request, ERR.NOT_FOUND, 404);
  if (!isAdmin && String(c.rows[0].companyId) !== String(companyId)) {
    return apiError(request, ERR.UNAUTHORIZED, 401);
  }

  const a = await queryRead(
    `SELECT ass.id,
            ar.key AS "areaKey",
            ar.label AS "areaLabel",
            ass.top_type AS "topType",
            ass.scores,
            ass.created_at AS "createdAt",
            ass.source,
            ass.vacancy_id AS "vacancyId",
            v.title AS "vacancyTitle",
            ass.pipeline_stage AS "pipelineStage",
            ass.rejection_reason AS "rejectionReason", ${rejectionReasonsSql('ass')} AS "rejectionReasons",
            ass.start_date AS "startDate",
            ass.hired_at AS "hiredAt",
            ass.invite_id AS "inviteId",
            ass.fill_duration_ms AS "fillDurationMs",
            ass.copy_event_count AS "copyEventCount"
     FROM assessments ass
     JOIN areas ar ON ar.id = ass.area_id
     LEFT JOIN vacancies v ON v.id = ass.vacancy_id
     WHERE ass.candidate_id = $1
     ORDER BY ass.created_at DESC
     LIMIT 30`,
    [id]
  );

  let historyByAssessment = {};
  if (a.rows.length > 0) {
    const assessmentIds = a.rows.map((r) => r.id);
    try {
      const h = await queryRead(
        `SELECT h.assessment_id AS "assessmentId", from_stage AS "fromStage", to_stage AS "toStage",
                reason, ${rejectionReasonsSql('h', 'reason')} AS reasons, start_date AS "startDate", changed_at AS "changedAt"
         FROM assessment_pipeline_history h
         WHERE assessment_id = ANY($1::bigint[])
         ORDER BY changed_at ASC`,
        [assessmentIds]
      );
      for (const row of h.rows) {
        const key = String(row.assessmentId);
        if (!historyByAssessment[key]) historyByAssessment[key] = [];
        historyByAssessment[key].push(row);
      }
    } catch {}
  }
  const assessmentsWithHistory = a.rows.map((row) => {
    const base = {
      ...row,
      pipelineHistory: historyByAssessment[String(row.id)] || [],
    };
    // Telemetria de integridade: apenas role admin
    if (!isAdmin) {
      delete base.fillDurationMs;
      delete base.copyEventCount;
    }
    return base;
  });

  const { searchParams } = new URL(request.url);
  const loc = normalizeLocale(searchParams.get('locale'));

  const [timeline, people, lmsOverdue] = await Promise.all([
    buildCandidateTimeline(id).catch((e) => {
      console.error('candidate timeline:', { code: e?.code || 'UNKNOWN' });
      return [];
    }),
    buildCandidatePeopleBrief(query, {
      candidateId: id,
      companyId: c.rows[0].companyId,
      isAdmin,
      locale: loc,
      scores: assessmentsWithHistory[0]?.scores || null,
      topType: assessmentsWithHistory[0]?.topType ?? null,
    }).catch((e) => {
      console.error('candidate people brief:', { code: e?.code || 'UNKNOWN' });
      return null;
    }),
    listCandidateOverdueLms(query, {
      companyId: c.rows[0].companyId,
      candidateId: id,
      limit: 5,
    }).catch(() => []),
  ]);

  const operational = await loadOperationalSummaries(queryRead, [{ candidateId: id, companyId: c.rows[0].companyId }]);
  return NextResponse.json({
    candidate: c.rows[0],
    operational: operational[String(id)] || null,
    assessments: assessmentsWithHistory,
    timeline,
    people,
    lmsOverdue,
  });
}

export async function PATCH(request, props) {
  const params = await props.params;
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  const payload = await verifySessionWithCapabilities(token);
  if (!canAccessCandidateRecord(payload)) return apiError(request, ERR.UNAUTHORIZED, 401);
  const isAdmin = isSuperAdminPayload(payload);
  const companyId = payload?.companyId ?? null;
  if (!isAdmin && !companyId) return apiError(request, ERR.UNAUTHORIZED, 401);

  const id = params?.id;
  if (!id) return apiError(request, ERR.INVALID_ID, 400);

  if (!isAdmin) {
    const owned = await query(`SELECT id FROM candidates WHERE id = $1 AND company_id = $2 LIMIT 1`, [id, companyId]);
    if (owned.rowCount === 0) return apiError(request, ERR.UNAUTHORIZED, 401);
  }

  const body = await request.json().catch(() => ({}));
  const hasDpProfile = body.dpProfile !== undefined;
  if (hasDpProfile) {
    if (!requireAnyCapability(payload, [CAP.DP_VIEW, CAP.TEAM_VIEW])) return apiError(request, ERR.UNAUTHORIZED, 401);
    if (!body.dpProfile || typeof body.dpProfile !== 'object' || Array.isArray(body.dpProfile)) return apiError(request, ERR.INVALID_DATA, 400);
  }
  const profile = normalizeCandidateProfile(body);
  const hasHrNotes = body.hrNotes !== undefined;
  const hasProfile = Object.values(profile).some((v) => v != null);
  const hasName = body.fullName !== undefined || body.name !== undefined;
  const hasBirthDate = body.birthDate !== undefined || body.birth_date !== undefined;
  const hasExtendedProfile = [
    'personalEmail', 'personal_email', 'maritalStatus', 'marital_status',
    'employeeNumber', 'employee_number', 'workFormat', 'work_format',
    'workHistory', 'work_history', 'email', 'timeClockOverride',
  ].some((key) => body[key] !== undefined);
  const hasTimeClockOverride = body.timeClockOverride !== undefined;
  if (hasTimeClockOverride && !requireAnyCapability(payload, [CAP.DP_VIEW, CAP.TEAM_VIEW])) {
    return apiError(request, ERR.UNAUTHORIZED, 401);
  }

  if (!hasHrNotes && !hasProfile && !hasName && !hasBirthDate && !hasExtendedProfile) {
    return apiError(request, ERR.NO_FIELDS_TO_UPDATE, 400);
  }

  const sets = [];
  const sqlParams = [id];
  let n = 2;

  if (hasName) {
    const name = titleCasePersonName(body.fullName || body.name).slice(0, 200);
    if (!name) return apiError(request, ERR.CANDIDATE_NAME_REQUIRED, 400);
    sets.push(`full_name = $${n++}`);
    sqlParams.push(name);
  }
  if (hasHrNotes) {
    const notes =
      body.hrNotes == null || body.hrNotes === ''
        ? null
        : sanitizeRichTextHtml(body.hrNotes, 20_000);
    sets.push(`hr_notes = $${n++}`);
    sqlParams.push(notes && !isRichTextEmpty(notes) ? notes : null);
  }
  if (body.phone !== undefined || body.telefone !== undefined) {
    const rawPhone = body.phone !== undefined ? body.phone : body.telefone;
    if (rawPhone != null && String(rawPhone).trim() && !/^\+?[\d\s().-]+$/.test(String(rawPhone).trim())) return apiError(request, ERR.INVALID_DATA, 400);
    const digits = String(rawPhone || '').replace(/\D/g, '');
    if (digits && (digits.length < 10 || digits.length > 15)) return apiError(request, ERR.INVALID_DATA, 400);
    sets.push(`phone = $${n++}`);
    sqlParams.push(profile.phone);
  }
  if (body.linkedinUrl !== undefined || body.linkedin !== undefined || body.linkedin_url !== undefined) {
    sets.push(`linkedin_url = $${n++}`);
    sqlParams.push(profile.linkedinUrl);
  }
  if (body.city !== undefined || body.cidade !== undefined) {
    sets.push(`city = $${n++}`);
    sqlParams.push(profile.city);
  }
  if (body.state !== undefined || body.uf !== undefined) {
    sets.push(`state = $${n++}`);
    sqlParams.push(profile.state);
  }
  if (body.salaryExpectation !== undefined || body.salary !== undefined || body.pretensao !== undefined) {
    sets.push(`salary_expectation = $${n++}`);
    sqlParams.push(profile.salaryExpectation);
  }
  if (body.availability !== undefined || body.disponibilidade !== undefined) {
    sets.push(`availability = $${n++}`);
    sqlParams.push(profile.availability);
  }
  if (body.source !== undefined || body.fonte !== undefined) {
    sets.push(`source = $${n++}`);
    sqlParams.push(profile.source);
  }
  if (body.birthDate !== undefined || body.birth_date !== undefined) {
    const raw = body.birthDate !== undefined ? body.birthDate : body.birth_date;
    let birthDate = null;
    if (raw != null && String(raw).trim() !== '') {
      const s = String(raw).trim().slice(0, 10);
      const parsed = new Date(`${s}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== s) {
        return apiError(request, ERR.INVALID_DATE, 400);
      }
      birthDate = s;
    }
    sets.push(`birth_date = $${n++}`);
    sqlParams.push(birthDate);
  }
  if (body.personalEmail !== undefined || body.personal_email !== undefined) {
    const value = body.personalEmail !== undefined ? body.personalEmail : body.personal_email;
    if (value != null && String(value).trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value).trim())) return apiError(request, ERR.INVALID_EMAIL, 400);
    sets.push(`personal_email = $${n++}`);
    sqlParams.push(value == null ? null : String(value).trim().slice(0, 240) || null);
  }
  let nextEmail = null;
  if (body.email !== undefined) {
    nextEmail = String(body.email ?? '').trim().toLowerCase();
    if (!nextEmail || nextEmail.length > 254 || !isValidEmployeeEmail(nextEmail)) return apiError(request, ERR.INVALID_CANDIDATE_EMAIL, 400);
    sets.push(`email = $${n++}`);
    sqlParams.push(nextEmail);
  }
  if (body.maritalStatus !== undefined || body.marital_status !== undefined) {
    const value = body.maritalStatus !== undefined ? body.maritalStatus : body.marital_status;
    sets.push(`marital_status = $${n++}`);
    sqlParams.push(value == null ? null : String(value).trim().slice(0, 40) || null);
  }
  if (body.employeeNumber !== undefined || body.employee_number !== undefined) {
    const value = body.employeeNumber !== undefined ? body.employeeNumber : body.employee_number;
    sets.push(`employee_number = $${n++}`);
    sqlParams.push(value == null ? null : String(value).trim().slice(0, 80) || null);
  }
  if (body.workFormat !== undefined || body.work_format !== undefined) {
    const value = body.workFormat !== undefined ? body.workFormat : body.work_format;
    const allowed = new Set(WORK_FORMATS);
    const normalized = value == null ? null : String(value).trim().toLowerCase();
    if (normalized && !allowed.has(normalized)) return apiError(request, ERR.INVALID_DATA, 400);
    sets.push(`work_format = $${n++}`);
    sqlParams.push(normalized || null);
  }
  let nextTimeClockOverride = null;
  if (hasTimeClockOverride) {
    nextTimeClockOverride = normalizeTimeClockOverride(body.timeClockOverride);
    if (nextTimeClockOverride === undefined) return apiError(request, ERR.INVALID_DATA, 400);
    sets.push(`time_clock_override = $${n++}`);
    sqlParams.push(nextTimeClockOverride);
  }
  if (body.workHistory !== undefined || body.work_history !== undefined) {
    const value = body.workHistory !== undefined ? body.workHistory : body.work_history;
    sets.push(`work_history = $${n++}`);
    sqlParams.push(value == null ? null : String(value).trim().slice(0, 4000) || null);
  }

  if (sets.length === 0) return apiError(request, ERR.NO_FIELDS_TO_UPDATE, 400);

  const up = await withTransaction(async (db) => {
    const previous = await db.query(
      `SELECT company_id AS "companyId", full_name AS "fullName", email,
              personal_email AS "personalEmail", marital_status AS "maritalStatus",
              employee_number AS "employeeNumber", work_format AS "workFormat",
              time_clock_override AS "timeClockOverride",
              work_history AS "workHistory", hr_notes AS "hrNotes",
              phone, linkedin_url AS "linkedinUrl", city, state,
              salary_expectation AS "salaryExpectation", availability, source,
              birth_date AS "birthDate", start_date AS "startDate",
              employment_status AS "employmentStatus"
       FROM candidates WHERE id = $1 FOR UPDATE`,
      [id]
    );
    if (!previous.rowCount) return { rowCount: 0, rows: [] };
    if (!isAdmin && String(previous.rows[0].companyId) !== String(companyId)) return { errorCode: ERR.UNAUTHORIZED, status: 401 };
    const employeeRecord = [EMPLOYMENT_STATUS.EMPLOYEE, EMPLOYMENT_STATUS.ALUMNI].includes(previous.rows[0].employmentStatus);
    if (nextEmail && employeeRecord && nextEmail !== String(previous.rows[0].email || '').toLowerCase()
      && !isAdmin && !requireAnyCapability(payload, [CAP.DP_VIEW, CAP.TEAM_VIEW])) {
      return { errorCode: ERR.EMPLOYEE_EMAIL_CHANGE_FORBIDDEN, status: httpStatusForError(ERR.EMPLOYEE_EMAIL_CHANGE_FORBIDDEN) };
    }
    const oldFormat = previous.rows[0].workFormat || null;
    const changesFormat = body.workFormat !== undefined || body.work_format !== undefined;
    const nextFormat = changesFormat ? String(body.workFormat ?? body.work_format ?? '').trim().toLowerCase() || null : oldFormat;
    const changed = oldFormat !== nextFormat;
    const effectiveDate = body.workFormatEffectiveDate;
    if (changed && (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate || '') || Number.isNaN(Date.parse(effectiveDate)) || new Date(effectiveDate).toISOString().slice(0, 10) !== effectiveDate)) {
      return { errorCode: ERR.INVALID_DATA };
    }
    const result = await db.query(
    `UPDATE candidates SET ${sets.join(', ')}
     WHERE id = $1
     RETURNING id, full_name AS "fullName", email,
               personal_email AS "personalEmail", marital_status AS "maritalStatus",
               employee_number AS "employeeNumber", work_format AS "workFormat",
               time_clock_override AS "timeClockOverride",
               work_history AS "workHistory", hr_notes AS "hrNotes",
               phone, linkedin_url AS "linkedinUrl", city, state,
               salary_expectation AS "salaryExpectation", availability, source,
               birth_date AS "birthDate", start_date AS "startDate"`,
    sqlParams
    );
    if (changed) await db.query(
      `INSERT INTO employee_work_format_history (company_id, candidate_id, previous_format, new_format, effective_date, actor_user_id)
       VALUES ($1, $2, $3, $4, $5::date, $6)`,
      [previous.rows[0].companyId, id, oldFormat, nextFormat, effectiveDate, payload.userId || null]
    );
    if (hasDpProfile) {
      const dp = await upsertDpProfile(db, {
        ...body.dpProfile,
        companyId: previous.rows[0].companyId,
        candidateId: id,
        userId: payload.userId,
        allowAlumni: true,
      });
      // Throw (rather than return) so candidate fields and history roll back too.
      if (!dp.ok) throw Object.assign(new Error('Invalid DP profile'), { dpErrorCode: dp.errorCode });
      result.rows[0].dpProfile = dp.profile;
      result.companyId = previous.rows[0].companyId;
      result.dpChanges = dp.changes;
    }
    result.changes = diffAuditFields(previous.rows[0], result.rows[0], {
      valueFields: CANDIDATE_AUDIT_VALUE_FIELDS,
      presenceFields: CANDIDATE_AUDIT_PRESENCE_FIELDS,
    });
    result.auditCompanyId = previous.rows[0].companyId;
    const previousOverride = previous.rows[0].timeClockOverride ?? null;
    if (hasTimeClockOverride && previousOverride !== nextTimeClockOverride) {
      result.timeClockChange = { companyId: previous.rows[0].companyId, from: previousOverride };
    }
    const previousEmail = String(previous.rows[0].email || '').toLowerCase();
    if (nextEmail && nextEmail !== previousEmail) {
      const revoked = await revokeEmployeeAccessForEmailChange(db, { candidateId: id, companyId: previous.rows[0].companyId });
      result.emailChange = { companyId: previous.rows[0].companyId, from: previousEmail, revoked, inviteIfMissing: previous.rows[0].employmentStatus === EMPLOYMENT_STATUS.EMPLOYEE };
    }
    return result;
  }).catch((error) => {
    if (error.dpErrorCode) return { errorCode: error.dpErrorCode, status: 400 };
    if (error?.code === '23505' && String(error?.constraint || '').includes('email')) return { errorCode: ERR.EMAIL_TAKEN, status: 409 };
    console.error('PATCH candidate profile transaction', { code: error?.code || 'UNKNOWN' });
    return { errorCode: ERR.INTERNAL, status: 500 };
  });
  if (up.errorCode) return apiError(request, up.errorCode, up.status || 400);
  if (up.rowCount === 0) return apiError(request, ERR.NOT_FOUND, 404);

  await auditFromRequest(request, {
    actorUserId: payload.userId || null,
    companyId: up.auditCompanyId,
    action: 'candidate.profile_update',
    targetType: 'candidate',
    targetId: String(id),
    metadata: { changes: up.changes },
  });

  let portalAccessReset = null;
  if (up.emailChange) {
    portalAccessReset = await finishEmployeeEmailChange(query, {
      candidateId: id,
      companyId: up.emailChange.companyId,
      revoked: up.emailChange.revoked,
      inviteIfMissing: up.emailChange.inviteIfMissing,
      previousEmail: up.emailChange.from,
      locale: localeFromRequest(request),
    });
    await auditFromRequest(request, {
      actorUserId: payload.userId || null,
      companyId: up.emailChange.companyId,
      action: 'candidate.email_change',
      targetType: 'candidate',
      targetId: String(id),
      metadata: { from: up.emailChange.from, to: nextEmail, portalAccessReset: Boolean(portalAccessReset), inviteSent: Boolean(portalAccessReset?.inviteSent) },
    });
  }

  if (up.timeClockChange) await auditFromRequest(request, {
    actorUserId: payload.userId || null,
    companyId: up.timeClockChange.companyId,
    action: 'candidate.time_clock_override',
    targetType: 'candidate',
    targetId: String(id),
    metadata: { from: up.timeClockChange.from, to: nextTimeClockOverride },
  });

  if (hasDpProfile) await auditFromRequest(request, {
    actorUserId: payload.userId || null,
    companyId: up.companyId,
    action: 'dp.profile.updated',
    targetType: 'candidate',
    targetId: String(id),
    metadata: { changes: up.dpChanges || [] },
  });

  return NextResponse.json(portalAccessReset ? { ...up.rows[0], portalAccessReset } : up.rows[0]);
}

export async function DELETE(request, props) {
  const params = await props.params;
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  const payload = await verifySessionWithCapabilities(token);
  if (!canAccessCandidateRecord(payload)) return apiError(request, ERR.UNAUTHORIZED, 401);
  const isAdmin = isSuperAdminPayload(payload);
  const companyId = payload?.companyId ?? null;
  if (!isAdmin && !companyId) return apiError(request, ERR.UNAUTHORIZED, 401);

  const id = params?.id;
  if (!isAdmin) {
    const owned = await query(`SELECT id FROM candidates WHERE id = $1 AND company_id = $2 LIMIT 1`, [id, companyId]);
    if (owned.rowCount === 0) return apiError(request, ERR.UNAUTHORIZED, 401);
  }
  const cand = await query(`SELECT company_id AS "companyId" FROM candidates WHERE id = $1 LIMIT 1`, [id]);
  if (cand.rowCount === 0) return apiError(request, ERR.NOT_FOUND, 404);

  const del = await withTransaction(async (client) => {
    // These FKs use SET NULL: remove identity-bound invites before deleting
    // the candidate, otherwise their snapshots and reminder tokens survive.
    const scope = [id, cand.rows[0].companyId];
    await client.query(`DELETE FROM candidate_invites WHERE candidate_id = $1 AND company_id = $2`, scope);
    await client.query(`DELETE FROM ae_invites WHERE candidate_id = $1 AND company_id = $2`, scope);
    return client.query(`DELETE FROM candidates WHERE id = $1 AND company_id = $2 RETURNING id`, scope);
  });
  if (del.rowCount === 0) return apiError(request, ERR.NOT_FOUND, 404);

  // Legacy results have no reliable candidate/tenant relationship. A name is
  // not an identity: deleting homonyms could erase another company's data.
  // Handle those records through a separately reviewed retention procedure.

  await audit({
    actorUserId: payload.userId || null,
    action: 'candidate.delete',
    companyId: cand.rows[0].companyId,
    targetType: 'candidate',
    targetId: id,
  });

  return NextResponse.json({ ok: true });
}
