import { NextResponse } from 'next/server';
import { verifySessionWithCapabilities } from '../../../../../../lib/identity/user-capabilities';
import { cookies } from 'next/headers';
import { COOKIE_NAME } from '../../../../../../lib/identity/auth';
import { query } from '../../../../../../lib/db';
import crypto from 'node:crypto';
import { apiError, ERR } from '../../../../../../lib/api-error';
import { CAP, requireCapability } from '../../../../../../lib/identity/permissions';

export async function POST(request, props) {
  const params = await props.params;
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  const payload = await verifySessionWithCapabilities(token);
  if (!requireCapability(payload, CAP.COMPANIES_MANAGE)) return apiError(request, ERR.UNAUTHORIZED, 401);

  const companyId = params?.id;
  if (!companyId) return apiError(request, ERR.INVALID_COMPANY, 400);

  const exists = await query(`SELECT id FROM companies WHERE id = $1 AND deleted = FALSE LIMIT 1`, [companyId]);
  if (exists.rowCount === 0) return apiError(request, ERR.COMPANY_NOT_FOUND, 404);

  await query(
    `UPDATE company_links
     SET active = FALSE, rotated_at = NOW()
     WHERE company_id = $1 AND active = TRUE`,
    [companyId]
  );

  const newToken = crypto.randomBytes(24).toString('hex');
  await query(
    `INSERT INTO company_links (company_id, token, active, expires_at)
     VALUES ($1, $2, TRUE, NOW() + INTERVAL '7 days')`,
    [companyId, newToken]
  );
  return NextResponse.json({ ok: true, token: newToken });
}

