import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../../lib/admin-api.js';
import { CAP } from '../../../../../lib/ae/require-admin.js';
import { z, zLocale, zPositiveInt } from '../../../../../lib/validate.js';
import { previewEmployeeCsv, importEmployeeCsv } from '../../../../../lib/employee-csv-import.js';
import { EMPLOYEE_CSV_MAX_BYTES } from '../../../../../lib/employee-csv.js';
import { checkRateLimit } from '../../../../../lib/rate-limit.js';
import { apiError, ERR } from '../../../../../lib/api-error.js';
import { audit } from '../../../../../lib/audit.js';

export const POST = withAdminApi({ cap: CAP.TEAM_VIEW, companyFrom: 'body',
  body: z.object({ companyId: zPositiveInt.optional(), csv: z.string().max(EMPLOYEE_CSV_MAX_BYTES), confirm: z.boolean().default(false), locale: zLocale.optional() }),
}, async ({ request, payload, companyId, body }) => {
  const limit = await checkRateLimit(`employee-csv:${payload.userId}:${companyId}`, 10, 15 * 60 * 1000);
  if (!limit.ok) return apiError(request, ERR.RATE_LIMIT, 429);
  try {
    const result = body.confirm
      ? await importEmployeeCsv({ csv: body.csv, companyId, actorId: payload.userId, locale: body.locale })
      : { ok: true, rows: await previewEmployeeCsv(body.csv, companyId) };
    if (body.confirm) await audit({ actorUserId: payload.userId, companyId, action: 'employee.csv_import', targetType: 'company', targetId: String(companyId), metadata: { created: result.rows.filter(row => row.candidateId).length, failed: result.rows.filter(row => row.errors.length).length } });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (/^CSV_/.test(error.message)) return NextResponse.json({ errorCode: error.message }, { status: 400 });
    throw error;
  }
});
