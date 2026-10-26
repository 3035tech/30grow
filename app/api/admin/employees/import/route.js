import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../../lib/admin-api.js';
import { CAP } from '../../../../../lib/ae/require-admin.js';
import { apiError, ERR, httpStatusForError } from '../../../../../lib/api-error.js';
import { z, zLocale, zPositiveInt } from '../../../../../lib/validate.js';
import { checkRateLimit } from '../../../../../lib/rate-limit.js';
import { audit } from '../../../../../lib/audit.js';
import { previewEmployeeCsv, importEmployeeCsv } from '../../../../../lib/employee/employee-csv-import.js';

const bodySchema = z.object({
  companyId: zPositiveInt.optional(),
  mode: z.enum(['preview', 'import']),
  csv: z.string().min(1).max(65536),
  locale: zLocale.optional(),
});

const json = (data, status = 200) => NextResponse.json(data, {
  status,
  headers: { 'Cache-Control': 'no-store' },
});

export const POST = withAdminApi(
  { cap: CAP.TEAM_VIEW, body: bodySchema, companyFrom: 'body', logLabel: 'employee CSV import' },
  async ({ request, payload, companyId, body }) => {
    const limit = await checkRateLimit(
      `admin-employees-import:${payload.userId || 'anon'}`,
      body.mode === 'import' ? 5 : 30,
      15 * 60 * 1000
    );
    if (!limit.ok) return apiError(request, ERR.RATE_LIMIT, httpStatusForError(ERR.RATE_LIMIT));

    if (body.mode === 'preview') {
      return json(await previewEmployeeCsv({ companyId, csv: body.csv }));
    }

    let result;
    try {
      result = await importEmployeeCsv({
        companyId, csv: body.csv, actorId: payload.userId || null,
        locale: body.locale || 'pt-BR',
      });
    } catch (error) {
      if (error?.code === 'P0001' && error.message === ERR.BILLING_CAPACITY) {
        return json({ ok: false, error: ERR.BILLING_CAPACITY, retryPreview: true }, 409);
      }
      if (['EMAIL_TAKEN', 'EMPLOYEE_ALREADY_EXISTS', 'BILLING_CAPACITY'].includes(error?.code)) {
        return json({ ok: false, error: error.code, retryPreview: true }, 409);
      }
      throw error;
    }
    if (!result.ok) return json(result, result.preview ? 409 : 400);
    await audit({
      actorUserId: payload.userId || null,
      companyId,
      action: 'employee.import_csv',
      targetType: 'company',
      targetId: String(companyId),
      metadata: { count: result.total, candidateIds: result.rows.map(row => row.candidateId) },
    });
    return json(result, 201);
  }
);
