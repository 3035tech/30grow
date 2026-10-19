import { zipSync } from 'fflate';
import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../../../lib/admin-api.js';
import { pool } from '../../../../../../lib/db.js';
import { CAP } from '../../../../../../lib/permissions.js';
import { z, zPositiveInt } from '../../../../../../lib/validate.js';
import { apiError, ERR } from '../../../../../../lib/api-error.js';
import { fiscalExport } from '../../../../../../lib/rep/exports.js';
import { withSigningCertificate } from '../../../../../../lib/rep/signing.js';
const schema = z.object({
  companyId: zPositiveInt.optional(),
  establishmentId: zPositiveInt,
  format: z.enum(['afd', 'aej']),
  from: z.string().length(10),
  to: z.string().length(10),
});
export const GET = withAdminApi(
  { anyCap: [CAP.DP_VIEW, CAP.TEAM_VIEW], companyFrom: 'query', query: schema },
  async ({ request, companyId, query: q }) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const data = await fiscalExport(client, { ...q, companyId });
      await client.query('COMMIT');
      if (!data) return apiError(request, ERR.NOT_FOUND, 404);
      const p7s = await withSigningCertificate(({ sign }) => sign(data));
      const filename =
        q.format === 'afd'
          ? `AFD${data.subarray(189, 206).toString('latin1').trim()}${data.subarray(11, 25).toString('latin1').trim()}REP_P.txt`
          : `AEJ-${q.establishmentId}-${q.from}-${q.to}.txt`;
      const archive = zipSync({
        [filename]: new Uint8Array(data),
        [filename + '.p7s']: new Uint8Array(p7s),
      });
      return new NextResponse(archive, {
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${filename}.zip"`,
          'Cache-Control': 'private, no-store',
        },
      });
    } catch (e) {
      await client.query('ROLLBACK');
      const reviewCode = {
        REP_HISTORY_REVIEW_REQUIRED: ERR.REP_FISCAL_HISTORY_REVIEW,
        REP_INCOMPLETE_BANK: ERR.REP_FISCAL_HISTORY_REVIEW,
        REP_DSR_REVIEW_REQUIRED: ERR.REP_FISCAL_RULE_REVIEW,
        REP_NIGHT_RULE_REQUIRED: ERR.REP_FISCAL_RULE_REVIEW,
        REP_LEGACY_RECORD_FORMAT: ERR.REP_LEGACY_RECORD_FORMAT,
      }[e.message];
      if (reviewCode) return apiError(request, reviewCode, 409);
      if (e.message?.startsWith('REP_'))
        return apiError(request, ERR.REP_NOT_READY, 409);
      throw e;
    } finally {
      client.release();
    }
  },
);
