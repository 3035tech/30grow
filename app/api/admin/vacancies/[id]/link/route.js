import { NextResponse } from 'next/server';
import { verifySessionWithCapabilities } from '../../../../../../lib/identity/user-capabilities';
import { cookies } from 'next/headers';
import { COOKIE_NAME } from '../../../../../../lib/identity/auth';
import { query } from '../../../../../../lib/db';
import crypto from 'node:crypto';
import { apiError, ERR } from '../../../../../../lib/api-error';
import { CAP, isSuperAdminPayload, requireCapability } from '../../../../../../lib/identity/permissions';


async function authorizeVacancyLink(payload, vacancyId) {
  if (!vacancyId) return { errorCode: ERR.INVALID_VACANCY, status: 400 };

  const isAdmin = isSuperAdminPayload(payload);
  const companyId = payload?.companyId ?? null;

  if (!isAdmin && !companyId) return { errorCode: ERR.UNAUTHORIZED, status: 401 };

  if (!isAdmin) {
    const owned = await query(
      `SELECT v.id FROM vacancies v
       JOIN companies c ON c.id = v.company_id
       WHERE v.id = $1 AND v.company_id = $2 AND v.deleted = FALSE AND c.deleted = FALSE
       LIMIT 1`,
      [vacancyId, companyId]
    );
    if (owned.rowCount === 0) return { errorCode: ERR.UNAUTHORIZED, status: 401 };
  } else {
    const exists = await query(
      `SELECT v.id FROM vacancies v
       JOIN companies c ON c.id = v.company_id
       WHERE v.id = $1 AND v.deleted = FALSE AND c.deleted = FALSE
       LIMIT 1`,
      [vacancyId]
    );
    if (exists.rowCount === 0) return { errorCode: ERR.VACANCY_NOT_FOUND, status: 404 };
  }

  return { ok: true };
}

export async function POST(request, props) {
  const params = await props.params;
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  const payload = await verifySessionWithCapabilities(token);
  if (!requireCapability(payload, CAP.VACANCIES_MANAGE)) return apiError(request, ERR.UNAUTHORIZED, 401);

  const vacancyId = params?.id;
  const auth = await authorizeVacancyLink(payload, vacancyId);
  if (!auth.ok) return apiError(request, auth.errorCode, auth.status);

  await query(
    `UPDATE vacancy_links
     SET active = FALSE, rotated_at = NOW()
     WHERE vacancy_id = $1 AND active = TRUE`,
    [vacancyId]
  );

  const newToken = crypto.randomBytes(24).toString('hex');
  await query(
    `INSERT INTO vacancy_links (vacancy_id, token, active, expires_at)
     VALUES ($1, $2, TRUE, NOW() + INTERVAL '7 days')`,
    [vacancyId, newToken]
  );

  return NextResponse.json({ ok: true, token: newToken });
}

export async function PATCH(request, props) {
  const params = await props.params;
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  const payload = await verifySessionWithCapabilities(token);
  if (!requireCapability(payload, CAP.VACANCIES_MANAGE)) return apiError(request, ERR.UNAUTHORIZED, 401);

  const vacancyId = params?.id;
  const auth = await authorizeVacancyLink(payload, vacancyId);
  if (!auth.ok) return apiError(request, auth.errorCode, auth.status);

  let body;
  try {
    body = await request.json();
  } catch {
    return apiError(request, ERR.INVALID_JSON, 400);
  }

  const expiresAtRaw = body?.expiresAt;
  if (expiresAtRaw == null || expiresAtRaw === '') {
    return apiError(request, ERR.EXPIRES_AT_REQUIRED, 400);
  }

  const expiresAt = new Date(expiresAtRaw);
  if (Number.isNaN(expiresAt.getTime())) {
    return apiError(request, ERR.INVALID_DATE, 400);
  }

  const r = await query(
    `UPDATE vacancy_links
     SET expires_at = $1
     WHERE vacancy_id = $2 AND active = TRUE
     RETURNING expires_at AS "expiresAt"`,
    [expiresAt, vacancyId]
  );

  if (r.rowCount === 0) {
    return apiError(request, ERR.NO_ACTIVE_LINK, 400);
  }

  return NextResponse.json({ ok: true, expiresAt: r.rows[0].expiresAt });
}
