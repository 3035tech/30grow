import { NextResponse } from 'next/server';
import { verifySessionWithCapabilities } from '../../../../lib/user-capabilities';
import { cookies } from 'next/headers';
import { COOKIE_NAME } from '../../../../lib/auth';
import { query, queryRead } from '../../../../lib/db';
import crypto from 'node:crypto';
import { PAGE_SIZE_OPTIONS, sqlCompaniesOrderBy } from '../../../../lib/assessment-filters';
import { apiError, ERR } from '../../../../lib/api-error';
import { CAP, requireCapability } from '../../../../lib/permissions';
import { EMPLOYMENT_STATUS } from '../../../../lib/domain-status';
import { parseCompanyProfileFromBody } from '../../../../lib/company-profile';
import { isCompanyLogoStorageConfigured } from '../../../../lib/company-logo';
import { aiDefaultCompanyMonthlyLimit } from '../../../../lib/ai-usage';
import {
  checkCompanySlugAvailable,
  generateUniqueCompanySlug,
} from '../../../../lib/slugify';

async function ensureActiveLink(companyId) {
  const existing = await queryRead(
    `SELECT token FROM company_links WHERE company_id = $1 AND active = TRUE AND expires_at > NOW() LIMIT 1`,
    [companyId]
  );
  if (existing.rowCount > 0) return existing.rows[0].token;
  const token = crypto.randomBytes(24).toString('hex');
  await query(
    `INSERT INTO company_links (company_id, token, active, expires_at)
     VALUES ($1, $2, TRUE, NOW() + INTERVAL '7 days')`,
    [companyId, token]
  );
  return token;
}

const COMPANY_SORT_KEYS = new Set(['id', 'name', 'slug', 'active', 'createdAt']);

export async function GET(request) {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  const payload = await verifySessionWithCapabilities(token);
  if (!requireCapability(payload, CAP.COMPANIES_MANAGE)) return apiError(request, ERR.UNAUTHORIZED, 401);

  const url = new URL(request.url);
  if (url.searchParams.get('forSelect') === '1') {
    const r = await queryRead(
      `SELECT id, name
       FROM companies
       WHERE deleted = FALSE
       ORDER BY LOWER(name) ASC
       LIMIT 500`
    );
    return NextResponse.json(r.rows);
  }

  const checkSlugRaw = url.searchParams.get('checkSlug');
  if (checkSlugRaw != null) {
    const excludeId = Number(url.searchParams.get('excludeId'));
    const result = await checkCompanySlugAvailable(checkSlugRaw, {
      excludeId: Number.isFinite(excludeId) ? excludeId : null,
    });
    return NextResponse.json({
      ok: true,
      available: result.available,
      invalid: result.invalid,
      slug: result.slug,
    });
  }

  const pageRaw = parseInt(url.searchParams.get('page') || '1', 10);
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? pageRaw : 1;
  const sizeRaw = parseInt(url.searchParams.get('pageSize') || '20', 10);
  const pageSize = PAGE_SIZE_OPTIONS.includes(sizeRaw) ? sizeRaw : 20;
  const sortRaw = url.searchParams.get('sort') || 'createdAt';
  const sort = COMPANY_SORT_KEYS.has(sortRaw) ? sortRaw : 'createdAt';
  const dir = url.searchParams.get('sortDir') === 'asc' ? 'asc' : 'desc';
  const orderSql = sqlCompaniesOrderBy(sort, dir);
  const qRaw = String(url.searchParams.get('q') || '').trim().slice(0, 80);
  const q = qRaw.length >= 1 ? qRaw : '';
  const activeRaw = String(url.searchParams.get('active') || '').trim().toLowerCase();

  const whereParts = ['c.deleted = FALSE'];
  const params = [];
  if (q) {
    params.push(`%${q}%`);
    const i = params.length;
    whereParts.push(`(c.name ILIKE $${i} OR COALESCE(c.slug, '') ILIKE $${i})`);
  }
  if (activeRaw === '1' || activeRaw === 'true' || activeRaw === 'active') {
    whereParts.push('c.active = TRUE');
  } else if (activeRaw === '0' || activeRaw === 'false' || activeRaw === 'inactive') {
    whereParts.push('c.active = FALSE');
  }
  const whereSql = whereParts.join(' AND ');

  const cnt = await queryRead(
    `SELECT COUNT(*)::int AS n FROM companies c WHERE ${whereSql}`,
    params
  );
  const total = cnt.rows[0]?.n ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const effectivePage = Math.min(page, totalPages);
  const offset = (effectivePage - 1) * pageSize;

  const listParams = [...params, pageSize, offset];
  const lim = params.length + 1;
  const off = params.length + 2;
  const r = await queryRead(
    `WITH page AS MATERIALIZED (
       SELECT
         c.id,
         c.name,
         c.slug,
         c.active,
         c.website,
         c.about_html AS "aboutHtml",
         c.public_profile_enabled AS "publicProfileEnabled",
         c.anniversary_date AS "anniversaryDate",
         c.logo_url AS "logoUrl",
         c.ai_monthly_call_limit AS "aiMonthlyCallLimit",
         c.created_at AS "createdAt",
         lk.token AS "activeToken",
         lk.expires_at AS "activeTokenExpiresAt",
         ROW_NUMBER() OVER (${orderSql}) AS rn
       FROM companies c
       LEFT JOIN company_links lk ON lk.company_id = c.id AND lk.active = TRUE
       WHERE ${whereSql}
      ${orderSql}
       LIMIT $${lim} OFFSET $${off}
     )
     SELECT p.*, emp.n AS "activeEmployees", ai.n AS "aiUsedThisMonth"
     FROM page p
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS n
       FROM candidates ce
       WHERE ce.company_id = p.id AND ce.employment_status = '${EMPLOYMENT_STATUS.EMPLOYEE}'
     ) emp ON TRUE
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS n
       FROM ai_usage_events e
       WHERE e.company_id = p.id AND e.created_at >= date_trunc('month', NOW())
     ) ai ON TRUE
     ORDER BY p.rn`,
    listParams
  );

  return NextResponse.json({
    items: r.rows.map(({ rn: _rn, ...row }) => row),
    total,
    page: effectivePage,
    pageSize,
    totalPages,
    logoStorageConfigured: isCompanyLogoStorageConfigured(),
    aiDefaultMonthlyCallLimit: aiDefaultCompanyMonthlyLimit(),
  });
}

export async function POST(request) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE_NAME)?.value;
    const payload = await verifySessionWithCapabilities(token);
    if (!requireCapability(payload, CAP.COMPANIES_MANAGE)) return apiError(request, ERR.UNAUTHORIZED, 401);

    const body = await request.json().catch(() => ({}));
    const name = String(body.name || '').trim();
    if (!name) return apiError(request, ERR.NAME_REQUIRED, 400);

    const slugInput = String(body.slug || '').trim();
    let slug;
    if (slugInput) {
      const taken = await checkCompanySlugAvailable(slugInput);
      if (taken.invalid) return apiError(request, ERR.INVALID_SLUG, 400);
      if (!taken.available) return apiError(request, ERR.SLUG_TAKEN, 409);
      slug = taken.slug;
    } else {
      slug = await generateUniqueCompanySlug(name);
    }
    if (!slug) return apiError(request, ERR.NAME_REQUIRED, 400);

    let profile;
    try {
      profile = parseCompanyProfileFromBody(body, { forCreate: true });
    } catch (e) {
      if (e?.code === 'INVALID_WEBSITE') return apiError(request, ERR.INVALID_WEBSITE, 400);
      if (e?.code === 'INVALID_DATE') return apiError(request, ERR.INVALID_DATE, 400);
      throw e;
    }

    let ins;
    try {
      ins = await query(
        `INSERT INTO companies (name, slug, active, website, about_html, public_profile_enabled, anniversary_date)
         VALUES ($1, $2, TRUE, $3, $4, $5, $6)
         RETURNING id, name, slug, active, website, about_html AS "aboutHtml",
                   public_profile_enabled AS "publicProfileEnabled",
                   anniversary_date AS "anniversaryDate",
                   logo_url AS "logoUrl", created_at AS "createdAt"`,
        [
          name,
          slug,
          profile.website,
          profile.aboutHtml,
          profile.publicProfileEnabled === true,
          profile.anniversaryDate ?? null,
        ]
      );
    } catch (err) {
      if (err?.code === '23505') return apiError(request, ERR.SLUG_TAKEN, 409);
      throw err;
    }

    const linkToken = await ensureActiveLink(ins.rows[0].id);
    return NextResponse.json({ ...ins.rows[0], activeToken: linkToken }, { status: 201 });
  } catch (err) {
    console.error('POST /api/admin/companies error:', err);
    return apiError(request, ERR.INTERNAL_ERROR, 500);
  }
}

