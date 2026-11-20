import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../../lib/admin-api.js';
import { pool, query as dbQuery } from '../../../../../lib/db.js';
import { CAP } from '../../../../../lib/identity/permissions.js';
import {
  repRegistrySchema,
  saveRepRegistry,
} from '../../../../../lib/rep/registry.js';
import { signingConfigured } from '../../../../../lib/rep/signing.js';
import { readSigningSettings, signingCertificateStatus } from '../../../../../lib/rep/certificate-settings.js';
import { apiError, ERR } from '../../../../../lib/api-error.js';
import { timeClockEnabledSql } from '../../../../../lib/people/time-clock-eligibility.js';
import { isTimeClockScheduleReady, isTimeClockSetupReady } from '../../../../../lib/people/time-clock-setup.js';
const options = { anyCap: [CAP.DP_VIEW, CAP.TEAM_VIEW], requireCompany: true };
export const GET = withAdminApi(
  { ...options, companyFrom: 'query' },
  async ({ companyId }) => {
    const e = await dbQuery(
      'SELECT id,employer_document,employer_name,workplace,registration,responsible_cpf,timezone,complementary_document,last_nsr FROM rep_establishments WHERE company_id=$1 ORDER BY id',
      [companyId],
    );
    const establishmentFieldNames = {
      employerDocument: 'employer_document',
      employerName: 'employer_name',
      complementaryDocument: 'complementary_document',
      workplace: 'workplace',
      registration: 'registration',
      timezone: 'timezone',
      responsibleCpf: 'responsible_cpf',
    };
    const establishments = e.rows.map((item) => {
      const validation = repRegistrySchema.safeParse({
        action: 'establishment',
        employerDocument: item.employer_document,
        employerName: item.employer_name,
        complementaryDocument: item.complementary_document || '',
        workplace: item.workplace,
        registration: item.registration,
        timezone: item.timezone,
        responsibleCpf: item.responsible_cpf,
      });
      const setupIssues = validation.success
        ? []
        : [...new Set(validation.error.issues
            .map((issue) => establishmentFieldNames[issue.path[0]])
            .filter(Boolean))];
      return { ...item, setupValid: validation.success, setupIssues };
    });
    const counts = await dbQuery(
      `SELECT
         count(*) FILTER(WHERE w.id IS NULL OR w.active=FALSE) AS unregistered,
         count(*) FILTER(WHERE w.id IS NOT NULL AND w.active=TRUE
           AND (COALESCE(c.start_date,c.hired_at::date) IS NULL OR jr.name IS NULL)) AS incompleteWorkerProfiles
       FROM candidates c
       LEFT JOIN rep_workers w ON w.company_id=c.company_id AND w.candidate_id=c.id
       LEFT JOIN job_roles jr ON jr.id=c.job_role_id AND jr.company_id=c.company_id
       WHERE c.company_id=$1 AND c.employment_status='employee' AND ${timeClockEnabledSql('c')}`,
      [companyId],
    );
    const candidateIssues = await dbQuery(
      `SELECT c.id AS "candidateId", c.full_name AS "candidateName",
              (w.id IS NULL OR w.active=FALSE) AS "missingRepLink",
              ARRAY_REMOVE(ARRAY[
                CASE WHEN w.id IS NULL OR w.active=FALSE THEN 'repLink'::text END,
                CASE WHEN w.active=TRUE AND COALESCE(c.start_date,c.hired_at::date) IS NULL THEN 'admission'::text END,
                CASE WHEN w.active=TRUE AND jr.name IS NULL THEN 'jobRole'::text END
              ], NULL) AS "missingFields"
       FROM candidates c
       LEFT JOIN rep_workers w ON w.company_id=c.company_id AND w.candidate_id=c.id
       LEFT JOIN job_roles jr ON jr.id=c.job_role_id AND jr.company_id=c.company_id
       WHERE c.company_id=$1 AND c.employment_status='employee' AND ${timeClockEnabledSql('c')}
         AND (w.id IS NULL OR w.active=FALSE OR COALESCE(c.start_date,c.hired_at::date) IS NULL OR jr.name IS NULL)
       ORDER BY c.full_name,c.id
       LIMIT 8`,
      [companyId],
    );
    const schedule = await dbQuery(
      `SELECT to_char(workday_start,'HH24:MI') AS "workdayStart",
              to_char(workday_end,'HH24:MI') AS "workdayEnd",
              break_minutes AS "breakMinutes",
              to_char(break_start,'HH24:MI') AS "breakStart",
              to_char(break_end,'HH24:MI') AS "breakEnd",
              break_preassigned AS "breakPreassigned",timezone
       FROM company_time_schedules WHERE company_id=$1 LIMIT 1`,
      [companyId],
    );
    const workers = await dbQuery(
      `SELECT w.id,w.candidate_id AS "candidateId",w.cpf,w.worker_name AS "workerName",
              w.establishment_id AS "establishmentId",e.employer_name AS "employerName",w.active
       FROM rep_workers w JOIN rep_establishments e ON e.id=w.establishment_id AND e.company_id=w.company_id
       WHERE w.company_id=$1 ORDER BY w.active DESC,w.worker_name,w.id`,
      [companyId],
    );
    let certificateStatus = 'missing';
    try {
      certificateStatus = signingCertificateStatus(await readSigningSettings());
    } catch {
      certificateStatus = 'unavailable';
    }
    const response = {
      establishments,
      workers: workers.rows,
      candidateIssues: candidateIssues.rows,
      signingConfigured: signingConfigured(),
      certificateStatus,
      unregisteredWorkers: Number(counts.rows[0].unregistered),
      incompleteWorkerProfiles: Number(counts.rows[0].incompleteworkerprofiles),
      scheduleConfigured: isTimeClockScheduleReady(schedule.rows[0]),
      complianceCertified: false,
    };
    response.setupReady = isTimeClockSetupReady(response);
    return NextResponse.json(response, { headers: { 'Cache-Control': 'no-store' } });
  },
);
export const POST = withAdminApi(
  { ...options, companyFrom: 'body', body: repRegistrySchema },
  async ({ request, companyId, body: b }) => {
    if (b.action === 'workerStatus') {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const id = await saveRepRegistry(client, companyId, b);
        if (!id) {
          await client.query('ROLLBACK');
          return apiError(request, ERR.INVALID_DATA, 409);
        }
        await client.query('COMMIT');
        return NextResponse.json({ id });
      } catch (e) {
        await client.query('ROLLBACK');
        if (e.message === 'REP_WORKER_OPEN_SHIFT')
          return apiError(request, ERR.REP_WORKER_OPEN_SHIFT, 409);
        if (['23505', '23514', 'P0001'].includes(e.code))
          return apiError(request, ERR.INVALID_DATA, 409);
        throw e;
      } finally {
        client.release();
      }
    }
    try {
      const id = await saveRepRegistry({ query: dbQuery }, companyId, b);
      if (!id) return apiError(request, ERR.INVALID_DATA, 409);
      return NextResponse.json({ id });
    } catch (e) {
      if (['23505', '23514', 'P0001'].includes(e.code))
        return apiError(request, ERR.INVALID_DATA, 409);
      throw e;
    }
  },
);
