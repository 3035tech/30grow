import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../../../lib/admin-api.js';
import { query as dbQuery } from '../../../../../../lib/db.js';
import { CAP } from '../../../../../../lib/identity/permissions.js';
import { z, zPositiveInt } from '../../../../../../lib/validate.js';

const querySchema = z.object({
  companyId: zPositiveInt.optional(),
  q: z.string().trim().max(80).optional().default(''),
});

export const GET = withAdminApi(
  {
    anyCap: [CAP.DP_VIEW, CAP.TEAM_VIEW],
    query: querySchema,
    companyFrom: 'query',
    logLabel: 'time-clock REP candidates GET',
  },
  async ({ companyId, query }) => {
    const needle = query.q.trim();
    if (needle.length < 2) return NextResponse.json({ ok: true, items: [] });

    const result = await dbQuery(
      `SELECT c.id, c.full_name AS label, c.email,
              COALESCE(profile.cpf, '') AS cpf
       FROM candidates c
       LEFT JOIN candidate_dp_profiles profile
         ON profile.candidate_id=c.id AND profile.company_id=c.company_id
       LEFT JOIN rep_workers worker
         ON worker.company_id=c.company_id AND worker.candidate_id=c.id AND worker.active=TRUE
       WHERE c.company_id=$1 AND c.employment_status='employee'
         AND worker.id IS NULL
         AND (c.full_name ILIKE $2 OR COALESCE(c.email, '') ILIKE $2)
       ORDER BY c.full_name ASC
       LIMIT 20`,
      [companyId, `%${needle}%`],
    );
    return NextResponse.json(
      { ok: true, items: result.rows },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  },
);
