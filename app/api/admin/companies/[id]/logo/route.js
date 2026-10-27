import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifySessionWithCapabilities } from '../../../../../../lib/identity/user-capabilities';
import { COOKIE_NAME } from '../../../../../../lib/identity/auth';
import { query } from '../../../../../../lib/db';
import { audit } from '../../../../../../lib/audit';
import { apiError, ERR } from '../../../../../../lib/api-error';
import { CAP, requireCapability } from '../../../../../../lib/identity/permissions';
import {
  isCompanyLogoStorageConfigured,
  removeCompanyLogoObject,
  uploadCompanyLogoObject,
} from '../../../../../../lib/company/company-logo';

async function requireCompany(companyId) {
  const current = await query(
    `SELECT id, logo_url AS "logoUrl", logo_key AS "logoKey"
     FROM companies WHERE id = $1 AND deleted = FALSE LIMIT 1`,
    [companyId]
  );
  if (current.rowCount === 0) return null;
  return current.rows[0];
}

/** Status do storage (UI desabilita upload se não configurado). */
export async function GET(request, props) {
  const params = await props.params;
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  const payload = await verifySessionWithCapabilities(token);
  if (!requireCapability(payload, CAP.COMPANIES_MANAGE)) return apiError(request, ERR.UNAUTHORIZED, 401);

  const companyId = params?.id ? parseInt(String(params.id), 10) : NaN;
  if (!Number.isFinite(companyId)) return apiError(request, ERR.INVALID_COMPANY, 400);
  const row = await requireCompany(companyId);
  if (!row) return apiError(request, ERR.NOT_FOUND, 404);

  return NextResponse.json({
    configured: isCompanyLogoStorageConfigured(),
    logoUrl: row.logoUrl || null,
    hasLogo: Boolean(row.logoUrl),
  });
}

/** Upload multipart field `file` → S3 + grava logo_url/logo_key. */
export async function POST(request, props) {
  const params = await props.params;
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  const payload = await verifySessionWithCapabilities(token);
  if (!requireCapability(payload, CAP.COMPANIES_MANAGE)) return apiError(request, ERR.UNAUTHORIZED, 401);

  if (!isCompanyLogoStorageConfigured()) {
    return apiError(request, ERR.STORAGE_NOT_CONFIGURED, 503);
  }

  const companyId = params?.id ? parseInt(String(params.id), 10) : NaN;
  if (!Number.isFinite(companyId)) return apiError(request, ERR.INVALID_COMPANY, 400);
  const row = await requireCompany(companyId);
  if (!row) return apiError(request, ERR.NOT_FOUND, 404);

  let form;
  try {
    form = await request.formData();
  } catch {
    return apiError(request, ERR.INVALID_LOGO_TYPE, 400);
  }
  const file = form.get('file');
  if (!file || typeof file === 'string' || typeof file.arrayBuffer !== 'function') {
    return apiError(request, ERR.INVALID_LOGO_TYPE, 400);
  }

  const mimeType = String(file.type || '').trim();
  const ab = await file.arrayBuffer();
  const buffer = Buffer.from(ab);

  let uploaded;
  try {
    uploaded = await uploadCompanyLogoObject(companyId, { buffer, mimeType });
  } catch (e) {
    const code = e?.code || e?.message;
    if (code === 'STORAGE_NOT_CONFIGURED') return apiError(request, ERR.STORAGE_NOT_CONFIGURED, 503);
    if (code === 'STORAGE_UPLOAD_FAILED') {
      return apiError(request, ERR.STORAGE_UPLOAD_FAILED, 502);
    }
    if (code === 'INVALID_LOGO_TYPE') return apiError(request, ERR.INVALID_LOGO_TYPE, 400);
    if (code === 'INVALID_LOGO_SIZE') return apiError(request, ERR.INVALID_LOGO_SIZE, 400);
    throw e;
  }

  const prevKey = row.logoKey || null;
  const up = await query(
    `UPDATE companies
     SET logo_url = $2, logo_key = $3
     WHERE id = $1 AND deleted = FALSE
     RETURNING id, logo_url AS "logoUrl", logo_key AS "logoKey"`,
    [companyId, uploaded.logoUrl, uploaded.logoKey]
  );

  if (prevKey && prevKey !== uploaded.logoKey) {
    await removeCompanyLogoObject(prevKey);
  }

  await audit({
    actorUserId: payload.userId || null,
    action: 'company.logo_upload',
    targetType: 'company',
    targetId: String(companyId),
  });

  return NextResponse.json({
    ok: true,
    logoUrl: up.rows[0].logoUrl,
    hasLogo: true,
  });
}

/** Remove logo do DB e best-effort do S3. */
export async function DELETE(request, props) {
  const params = await props.params;
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  const payload = await verifySessionWithCapabilities(token);
  if (!requireCapability(payload, CAP.COMPANIES_MANAGE)) return apiError(request, ERR.UNAUTHORIZED, 401);

  const companyId = params?.id ? parseInt(String(params.id), 10) : NaN;
  if (!Number.isFinite(companyId)) return apiError(request, ERR.INVALID_COMPANY, 400);
  const row = await requireCompany(companyId);
  if (!row) return apiError(request, ERR.NOT_FOUND, 404);

  await query(
    `UPDATE companies SET logo_url = NULL, logo_key = NULL WHERE id = $1 AND deleted = FALSE`,
    [companyId]
  );
  if (row.logoKey) await removeCompanyLogoObject(row.logoKey);

  await audit({
    actorUserId: payload.userId || null,
    action: 'company.logo_remove',
    targetType: 'company',
    targetId: String(companyId),
  });

  return NextResponse.json({ ok: true, logoUrl: null, hasLogo: false });
}
