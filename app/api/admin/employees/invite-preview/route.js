import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../../lib/admin-api.js';
import { CAP } from '../../../../../lib/ae/require-admin.js';
import { z, zLocale, zPositiveInt } from '../../../../../lib/validate.js';
import { query } from '../../../../../lib/db.js';
import { runtimeAppUrl } from '../../../../../lib/app-url.js';
import { buildUserPasswordInviteMail } from '../../../../../lib/user-access-mail.js';
import { apiError, ERR } from '../../../../../lib/api-error.js';

// Preview only: no token, candidate write or mail dispatch.
export const POST = withAdminApi({
  cap: CAP.TEAM_VIEW, companyFrom: 'body',
  body: z.object({ companyId: zPositiveInt.optional(), fullName: z.string().trim().min(1).max(200), email: z.string().trim().email().max(254), locale: zLocale.optional() }),
}, async ({ request, companyId, body }) => {
  const company = await query('SELECT name FROM companies WHERE id=$1 AND deleted=FALSE', [companyId]);
  if (!company.rowCount) return apiError(request, ERR.NOT_FOUND, 404);
  const base = runtimeAppUrl();
  if (!base) return apiError(request, ERR.APP_URL_MISSING, 503);
  const mail = buildUserPasswordInviteMail({ email: body.email, displayName: body.fullName, locale: body.locale,
    setupUrl: `${base}/employee/set-password`, employee: { companyLabel: company.rows[0].name, portalUrl: `${base}/employee/login` } });
  return NextResponse.json({ subject: mail.subject, text: mail.text }, { headers: { 'Cache-Control': 'no-store' } });
});
