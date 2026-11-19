import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../../lib/admin-api.js';
import { pool, query as dbQuery } from '../../../../../lib/db.js';
import { CAP } from '../../../../../lib/identity/permissions.js';
import {
  repRegistrySchema,
  saveRepRegistry,
} from '../../../../../lib/rep/registry.js';
import { signingConfigured } from '../../../../../lib/rep/signing.js';
import { apiError, ERR } from '../../../../../lib/api-error.js';
const options = { anyCap: [CAP.DP_VIEW, CAP.TEAM_VIEW], requireCompany: true };
export const GET = withAdminApi(
  { ...options, companyFrom: 'query' },
  async ({ companyId }) => {
    const e = await dbQuery(
      'SELECT id,employer_document,employer_name,workplace,registration,timezone,last_nsr FROM rep_establishments WHERE company_id=$1 ORDER BY id',
      [companyId],
    );
    const counts = await dbQuery(
      `SELECT count(*) FILTER(WHERE w.id IS NULL OR w.active=FALSE) AS unregistered FROM candidates c LEFT JOIN rep_workers w ON w.company_id=c.company_id AND w.candidate_id=c.id WHERE c.company_id=$1 AND c.employment_status='employee'`,
      [companyId],
    );
    const workers = await dbQuery(
      `SELECT w.id,w.candidate_id AS "candidateId",w.cpf,w.worker_name AS "workerName",
              w.establishment_id AS "establishmentId",e.employer_name AS "employerName",w.active
       FROM rep_workers w JOIN rep_establishments e ON e.id=w.establishment_id AND e.company_id=w.company_id
       WHERE w.company_id=$1 ORDER BY w.active DESC,w.worker_name,w.id`,
      [companyId],
    );
    return NextResponse.json(
      {
        establishments: e.rows,
        workers: workers.rows,
        signingConfigured: signingConfigured(),
        unregisteredWorkers: Number(counts.rows[0].unregistered),
        complianceCertified: false,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
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
