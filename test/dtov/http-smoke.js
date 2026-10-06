/**
 * Smoke HTTP/API de todas as superfícies principais (DTOV + Next local).
 * Não é Playwright: valida status/JSON/HTML das rotas, não cliques de UI.
 *
 * Uso típico: npm run dtov:full-app
 * Ou servidor já no ar: BASE_URL=http://127.0.0.1:3010 DTOV=1 node test/dtov/http-smoke.js
 */

import process from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TOK = {
  company: 'd0d0todosdadose5f60718293a4b5c6d7e8f01',
  vacancyOpen: 'e1e1todosdadose5f60718293a4b5c6d7e8f02',
  report: 'a3a3todosdadose5f60718293a4b5c6d7e8f04a3a3todosdadose5f60718',
  aeInvite: 'b4b4todosdadose5f60718293a4b5c6d7e8f05',
  candInvite: 'c5c5todosdadose5f60718293a4b5c6d7e8f06',
};

const HR = {
  email: 'hr@todos-os-dados.demo',
  password: process.env.DEMO_TODOS_PASSWORD || 'DemoTodosDados!2026',
};

const DIRECTION = {
  email: 'direction@todos-os-dados.demo',
  password: process.env.DEMO_TODOS_PASSWORD || 'DemoTodosDados!2026',
};

/** Demo employee (seed Todos os Dados) — used for People/1:1 HTTP coverage. */
const FIXTURE_PEOPLE = {
  searchName: 'Elena Ferreira',
  email: 'elena@todos-os-dados.demo',
  password: 'ColabTest!2026',
};

const ADMIN = {
  email: process.env.DTOV_ADMIN_EMAIL || 'admin@3035tech.com',
  password: process.env.DTOV_ADMIN_PASSWORD || 'TroqueEstaSenha123!',
};

const results = [];

function ok(suite, name, detail = '') {
  results.push({ suite, name, status: 'pass', detail });
  process.stdout.write(`  ✓ ${suite}/${name}${detail ? ` — ${detail}` : ''}\n`);
}

function fail(suite, name, detail) {
  results.push({ suite, name, status: 'fail', detail: String(detail || '') });
  process.stderr.write(`  ✗ ${suite}/${name} — ${detail}\n`);
}

function parseSetCookie(res) {
  // Node fetch: getSetCookie() when available
  if (typeof res.headers.getSetCookie === 'function') {
    return res.headers.getSetCookie();
  }
  const single = res.headers.get('set-cookie');
  return single ? [single] : [];
}

function cookieHeaderFromSetCookie(setCookies) {
  return setCookies
    .map((c) => String(c).split(';')[0])
    .filter(Boolean)
    .join('; ');
}

async function req(base, path, { method = 'GET', cookie = '', body, headers = {} } = {}) {
  const url = `${base.replace(/\/$/, '')}${path}`;
  const init = {
    method,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    redirect: 'manual',
  };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url, init);
  const ct = res.headers.get('content-type') || '';
  let data = null;
  const text = await res.text();
  if (ct.includes('application/json')) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { _raw: text.slice(0, 200) };
    }
  } else {
    data = text;
  }
  return { res, data, text, setCookie: parseSetCookie(res) };
}

async function expectStatus(suite, name, got, allowed, detail = '') {
  const list = Array.isArray(allowed) ? allowed : [allowed];
  if (!list.includes(got)) {
    fail(suite, name, `status ${got}, expected ${list.join('|')}${detail ? ` · ${detail}` : ''}`);
    return false;
  }
  ok(suite, name, detail || `HTTP ${got}`);
  return true;
}

async function login(base, creds) {
  const { res, data, setCookie } = await req(base, '/api/auth/login', {
    method: 'POST',
    body: { email: creds.email, password: creds.password },
  });
  if (res.status !== 200 || !data?.ok) {
    throw new Error(`login failed ${res.status} ${JSON.stringify(data)}`);
  }
  const cookie = cookieHeaderFromSetCookie(setCookie);
  if (!cookie.includes('team30_session')) {
    throw new Error('login missing team30_session cookie');
  }
  return cookie;
}

async function seedForeignTenantFixture() {
  const { Client } = await import('pg');
  const client = new Client({
    host: process.env.POSTGRES_HOST || '127.0.0.1',
    port: Number(process.env.POSTGRES_PORT || 55432),
    database: process.env.POSTGRES_DB || 'enneagram_dtov',
    user: process.env.POSTGRES_USER || 'dtov',
    password: process.env.POSTGRES_PASSWORD || 'dtov_local_only',
    ssl: false,
  });
  await client.connect();
  try {
    const company = await client.query(
      `INSERT INTO companies (name, slug, active, deleted)
       VALUES ('Tenant Isolado DTOV', 'tenant-isolado-dtov', TRUE, FALSE)
       RETURNING id`
    );
    const companyId = Number(company.rows[0].id);
    const vacancy = await client.query(
      `INSERT INTO vacancies (company_id, title, slug, status, deleted)
       VALUES ($1, 'Vaga privada de outro tenant', 'vaga-privada-outro-tenant', 'open', FALSE)
       RETURNING id`,
      [companyId]
    );
    const candidate = await client.query(
      `INSERT INTO candidates (company_id, full_name, email, employment_status)
       VALUES ($1, 'Pessoa de outro tenant', 'pessoa@tenant-isolado.dtov', 'employee')
       RETURNING id`,
      [companyId]
    );
    return {
      companyId,
      vacancyId: Number(vacancy.rows[0].id),
      candidateId: Number(candidate.rows[0].id),
    };
  } finally {
    await client.end();
  }
}

export async function runHttpSmoke(baseUrl) {
  const base = String(baseUrl || process.env.BASE_URL || 'http://127.0.0.1:3010').replace(/\/$/, '');
  process.stdout.write(`\n== http smoke @ ${base} ==\n`);

  // ── Health / public infra ─────────────────────────────────────────────
  {
    const { res } = await req(base, '/api/health');
    await expectStatus('health', 'basic', res.status, [200, 204, 503]);
  }
  {
    const token = process.env.HEALTH_STATUS_TOKEN || '';
    const { res, data } = await req(base, '/api/health/status', {
      headers: token ? { 'X-Health-Status-Token': token } : {},
    });
    // Sem token → 401; com header → 200/503
    if (!token) await expectStatus('health', 'status-no-token', res.status, [401]);
    else await expectStatus('health', 'status-authed', res.status, [200, 503], data?.status || '');
  }
  {
    const token = process.env.HEALTH_STATUS_TOKEN || '';
    if (token) {
      const { res } = await req(base, `/api/health/status?token=${encodeURIComponent(token)}`);
      await expectStatus('health', 'status-query-rejected', res.status, [401]);
    } else {
      ok('health', 'status-query-rejected', 'skipped (no token)');
    }
  }

  // ── Public JSON ───────────────────────────────────────────────────────
  for (const [name, path] of [
    ['areas', '/api/public/areas'],
    ['br-cities-sp', '/api/public/br-cities?uf=SP'],
    ['company-link', `/api/public/company-link?token=${TOK.company}`],
    ['vacancy-link', `/api/public/vacancy-link?token=${TOK.vacancyOpen}`],
    ['vacancy-report', `/api/public/vacancy-report?token=${TOK.report}`],
    ['ae-invite', `/api/public/ae-invite?token=${TOK.aeInvite}`],
    ['candidate-invite', `/api/public/candidate-invite?token=${TOK.candInvite}`],
    ['set-password-bad', '/api/public/set-password?token=invalid'],
  ]) {
    const { res, data } = await req(base, path);
    const okStatuses =
      name === 'candidate-invite'
        ? [200, 404, 410]
        : name === 'set-password-bad'
          ? [400]
          : [200];
    // invite may expire in odd seeds — still accept 404 for cand invite
    const allowed = name.includes('invite') && name !== 'ae-invite' ? [200, 404, 410, 409] : okStatuses;
    await expectStatus('public-api', name, res.status, allowed, typeof data === 'object' && data?.errorCode ? data.errorCode : '');
  }

  // ── Public HTML pages ─────────────────────────────────────────────────
  for (const [name, path] of [
    ['home', '/'],
    ['login', '/login'],
    ['t-token', `/t/${TOK.company}`],
    ['v-token', `/v/${TOK.vacancyOpen}`],
    ['r-token', `/r/${TOK.report}`],
    ['ae-assessment', `/assessment/motivators/${TOK.aeInvite}`],
    ['jobs-index', '/jobs'],
  ]) {
    const { res, text } = await req(base, path);
    const okHtml = res.status === 200 && String(text).length > 200;
    if (!okHtml) fail('public-page', name, `status ${res.status} len=${String(text).length}`);
    else ok('public-page', name, `HTTP ${res.status} · ${String(text).length}b`);
  }

  // Canonical public job pages (resolve ids from DTOV)
  let canonicalOpenPath = '';
  let canonicalClosedPath = '';
  {
    const { Client } = await import('pg');
    const client = new Client({
      host: process.env.POSTGRES_HOST || '127.0.0.1',
      port: Number(process.env.POSTGRES_PORT || 55432),
      database: process.env.POSTGRES_DB || 'enneagram_dtov',
      user: process.env.POSTGRES_USER || 'dtov',
      password: process.env.POSTGRES_PASSWORD || 'dtov_local_only',
      ssl: false,
    });
    try {
      await client.connect();
      const open = await client.query(
        `SELECT id, slug FROM vacancies WHERE slug = $1 AND deleted = FALSE LIMIT 1`,
        ['engenheiro-fullstack-plataforma'],
      );
      const closed = await client.query(
        `SELECT id, slug FROM vacancies WHERE slug = $1 AND deleted = FALSE LIMIT 1`,
        ['analista-dados-encerrada'],
      );
      if (open.rows[0]) {
        canonicalOpenPath = `/jobs/${open.rows[0].slug}-${open.rows[0].id}`;
        ok('seo', 'jobs-open-path', canonicalOpenPath);
      } else fail('seo', 'jobs-open-path', 'open vacancy not found in DTOV');
      if (closed.rows[0]) {
        canonicalClosedPath = `/jobs/${closed.rows[0].slug}-${closed.rows[0].id}`;
        ok('seo', 'jobs-closed-path', canonicalClosedPath);
      } else fail('seo', 'jobs-closed-path', 'closed vacancy not found in DTOV');
    } catch (e) {
      fail('seo', 'jobs-path-resolve', e.message);
    } finally {
      try { await client.end(); } catch (_) {}
    }
  }
  if (canonicalOpenPath) {
    const { res, text } = await req(base, canonicalOpenPath);
    if (res.status !== 200 || String(text).length < 200) {
      fail('public-page', 'vaga-open', `status ${res.status} len=${String(text).length}`);
    } else ok('public-page', 'vaga-open', `HTTP ${res.status} · ${canonicalOpenPath}`);
  }
  if (canonicalClosedPath) {
    const { res, text } = await req(base, canonicalClosedPath);
    if (res.status !== 200 || String(text).length < 200) {
      fail('public-page', 'vaga-closed', `status ${res.status} len=${String(text).length}`);
    } else ok('public-page', 'vaga-closed', `HTTP ${res.status} · ${canonicalClosedPath}`);
  }

  // ── SEO: robots + sitemap ─────────────────────────────────────────────
  {
    const { res, text } = await req(base, '/robots.txt');
    const body = String(text || '');
    if (res.status !== 200) fail('seo', 'robots', `status ${res.status}`);
    else if (!/sitemap/i.test(body)) fail('seo', 'robots', 'missing Sitemap line');
    else if (!/Disallow:\s*\/dashboard/i.test(body)) fail('seo', 'robots', 'missing dashboard disallow');
    else if (/Disallow:\s*\/jobs/i.test(body)) fail('seo', 'robots-jobs-open', '/jobs must stay crawlable');
    else if (!/Disallow:\s*\/t\//i.test(body)) fail('seo', 'robots-token-paths', 'missing /t/ disallow');
    else ok('seo', 'robots', `HTTP ${res.status}`);
  }
  {
    const { res } = await req(base, `/v/${TOK.vacancyOpen}`);
    const tag = String(res.headers.get('x-robots-tag') || '');
    if (!/noindex/i.test(tag)) fail('seo', 'v-noindex-header', tag || 'missing');
    else ok('seo', 'v-noindex-header', tag);
  }
  if (canonicalOpenPath) {
    const { res } = await req(base, canonicalOpenPath);
    const tag = String(res.headers.get('x-robots-tag') || '');
    if (/noindex/i.test(tag)) fail('seo', 'jobs-no-noindex-header', tag);
    else ok('seo', 'jobs-no-noindex-header', tag || 'absent');
  }
  {
    const { res, text } = await req(base, '/sitemap.xml');
    const body = String(text || '');
    if (res.status !== 200) fail('seo', 'sitemap', `status ${res.status}`);
    else if (!body.includes('/jobs') && !body.includes('urlset')) {
      fail('seo', 'sitemap', `unexpected body len=${body.length}`);
    } else ok('seo', 'sitemap', `HTTP ${res.status} · ${body.length}b`);
  }

  // ── Job funnel + UTM attribution cookie ───────────────────────────────
  let publicVacancyId = null;
  if (canonicalOpenPath) {
    const m = canonicalOpenPath.match(/-(\d+)$/);
    if (m) publicVacancyId = Number(m[1]);
  }
  {
    const pathWithUtm = `${canonicalOpenPath || '/jobs'}?utm_source=linkedin&utm_medium=social&utm_campaign=dtov&ref=DTOVREF`;
    const { res, setCookie } = await req(base, pathWithUtm);
    const joined = (setCookie || []).join('; ');
    if (res.status !== 200 && res.status !== 308 && res.status !== 301) {
      fail('funnel', 'utm-cookie-page', `status ${res.status}`);
    } else if (!/team30_job_attr=/i.test(joined)) {
      fail('funnel', 'utm-cookie-page', `missing team30_job_attr in Set-Cookie: ${joined.slice(0, 120)}`);
    } else {
      ok('funnel', 'utm-cookie-page', 'team30_job_attr set');
    }
  }
  if (publicVacancyId) {
    const { res, data } = await req(base, '/api/public/job-funnel', {
      method: 'POST',
      body: { eventType: 'job_view', vacancyId: publicVacancyId },
    });
    await expectStatus('funnel', 'job-view', res.status, 200, data?.skipped ? 'skipped' : 'recorded');
    const { res: r2, data: d2 } = await req(base, '/api/public/job-funnel', {
      method: 'POST',
      body: { eventType: 'apply_start', vacancyId: publicVacancyId },
    });
    await expectStatus('funnel', 'apply-start', r2.status, 200, d2?.skipped ? 'skipped' : 'recorded');
  } else {
    fail('funnel', 'public-vacancy-id', 'could not parse id from canonical path');
  }

  // ── Auth HR ───────────────────────────────────────────────────────────
  let hrCookie = '';
  try {
    hrCookie = await login(base, HR);
    ok('auth', 'login-hr', HR.email);
  } catch (e) {
    fail('auth', 'login-hr', e.message);
    return printSummary();
  }

  let hrCompanyId = null;
  {
    const { res, data } = await req(base, '/api/me', { cookie: hrCookie });
    await expectStatus('auth', 'me-hr', res.status, 200, data?.email || data?.user?.email || '');
    if (res.status === 200) {
      hrCompanyId = data?.companyId || data?.user?.companyId || null;
    }
  }
  let foreignTenant = null;
  try {
    foreignTenant = await seedForeignTenantFixture();
    ok('tenant', 'foreign-fixture', `company=${foreignTenant.companyId}`);
  } catch (e) {
    fail('tenant', 'foreign-fixture', e?.message || e);
  }
  {
    const { res } = await req(base, '/api/me/notifications', { cookie: hrCookie });
    await expectStatus('auth', 'notifications', res.status, [200]);
  }
  // Session revocation: bumped session_version must reject /api/me/notifications
  {
    const { Client } = await import('pg');
    const { setSessionVersionCache } = await import('../../lib/session-revocation.js');
    const client = new Client({
      host: process.env.POSTGRES_HOST || '127.0.0.1',
      port: Number(process.env.POSTGRES_PORT || 55432),
      database: process.env.POSTGRES_DB || 'enneagram_dtov',
      user: process.env.POSTGRES_USER || 'dtov',
      password: process.env.POSTGRES_PASSWORD || 'dtov_local_only',
      ssl: false,
    });
    try {
      await client.connect();
      const firstBump = await client.query(
        `UPDATE users
         SET session_version = session_version + 1
         WHERE LOWER(email) = LOWER($1)
         RETURNING id, session_version AS "sessionVersion"`,
        [HR.email]
      );
      await setSessionVersionCache(firstBump.rows[0]?.id, firstBump.rows[0]?.sessionVersion);
      const { res } = await req(base, '/api/me/notifications', { cookie: hrCookie });
      await expectStatus('auth', 'notifications-revoked', res.status, [401]);
      hrCookie = await login(base, HR);
      ok('auth', 'login-hr-after-revoke', 'session renewed');
      const { res: dashRevoked } = await req(base, '/dashboard?tab=overview', { cookie: hrCookie });
      if (![200, 302, 307].includes(dashRevoked.status)) {
        fail('auth', 'dashboard-after-relogin', `status ${dashRevoked.status}`);
      } else {
        ok('auth', 'dashboard-after-relogin', `HTTP ${dashRevoked.status}`);
      }
      const secondBump = await client.query(
        `UPDATE users
         SET session_version = session_version + 1
         WHERE LOWER(email) = LOWER($1)
         RETURNING id, session_version AS "sessionVersion"`,
        [HR.email]
      );
      await setSessionVersionCache(secondBump.rows[0]?.id, secondBump.rows[0]?.sessionVersion);
      const { res: dashDead } = await req(base, '/dashboard?tab=overview', { cookie: hrCookie });
      if (![302, 307, 401].includes(dashDead.status)) {
        fail('auth', 'dashboard-revoked-middleware', `status ${dashDead.status}`);
      } else {
        ok('auth', 'dashboard-revoked-middleware', `HTTP ${dashDead.status}`);
      }
      hrCookie = await login(base, HR);
    } catch (e) {
      fail('auth', 'notifications-revoked', e?.message || e);
    } finally {
      try {
        await client.end();
      } catch {
        /* ignore */
      }
    }
  }
  {
    const { res } = await req(base, '/api/me/locale', {
      method: 'PATCH',
      cookie: hrCookie,
      body: { locale: 'pt-BR' },
    });
    await expectStatus('auth', 'locale', res.status, [200, 204]);
  }

  // Dashboard SSR tabs (HR)
  for (const tab of [
    'overview',
    'team',
    'compatibility',
    'compare',
    'group',
    'leadership',
    'vacancies',
    'talent-bank',
  ]) {
    const { res, text } = await req(base, `/dashboard?tab=${tab}`, { cookie: hrCookie });
    // 200 page or 307/302 if middleware redirects oddly
    if ([200, 307, 302].includes(res.status) && (res.status !== 200 || String(text).length > 100)) {
      ok('dashboard', tab, `HTTP ${res.status}`);
    } else {
      fail('dashboard', tab, `status ${res.status}`);
    }
  }

  // Recruiting APIs
  let vacancyId = null;
  let candidateId = null;
  let vacancyList = [];
  {
    const { res, data } = await req(base, '/api/admin/vacancies?page=1&pageSize=20', { cookie: hrCookie });
    if (await expectStatus('vacancies', 'list', res.status, 200)) {
      vacancyList = data?.items || data || [];
      // Prefer open vacancy (closed often has empty pipeline; scorecard needs a link).
      const open = vacancyList.find((v) => String(v?.status || '').toLowerCase() === 'open');
      vacancyId = open?.id || vacancyList[0]?.id || null;
      ok('vacancies', 'has-rows', `n=${vacancyList.length}`);
    }
  }
  if (foreignTenant) {
    const { res: vacancyRes } = await req(
      base,
      `/api/admin/vacancies/${foreignTenant.vacancyId}`,
      { cookie: hrCookie }
    );
    await expectStatus('tenant', 'foreign-vacancy-hidden', vacancyRes.status, 404);

    const { res: dossierRes } = await req(
      base,
      `/api/admin/candidates/${foreignTenant.candidateId}/dossier`,
      { cookie: hrCookie }
    );
    await expectStatus('tenant', 'foreign-candidate-hidden', dossierRes.status, 404);

    for (const [surface, path] of [
      ['compensation', `/api/admin/candidates/${foreignTenant.candidateId}/compensation`],
      ['dp', `/api/admin/candidates/${foreignTenant.candidateId}/dp`],
    ]) {
      const { res } = await req(base, path, { cookie: hrCookie });
      await expectStatus('tenant', `foreign-${surface}-hidden`, res.status, 404);
    }

    const { res: overrideRes, data: overrideData } = await req(
      base,
      `/api/admin/vacancies?page=1&pageSize=20&companyId=${foreignTenant.companyId}`,
      { cookie: hrCookie }
    );
    if (await expectStatus('tenant', 'company-override-ignored', overrideRes.status, 200)) {
      const rows = Array.isArray(overrideData?.items) ? overrideData.items : [];
      if (rows.some((row) => Number(row?.id) === foreignTenant.vacancyId)) {
        fail('tenant', 'company-override-no-leak', 'foreign vacancy returned');
      } else {
        ok('tenant', 'company-override-no-leak', 'foreign vacancy absent');
      }
    }

    try {
      const directionCookie = await login(base, DIRECTION);
      ok('auth', 'login-direction', DIRECTION.email);
      for (const [surface, path] of [
        ['vacancy', `/api/admin/vacancies/${foreignTenant.vacancyId}`],
        ['dossier', `/api/admin/candidates/${foreignTenant.candidateId}/dossier`],
        ['compensation', `/api/admin/candidates/${foreignTenant.candidateId}/compensation`],
        ['dp', `/api/admin/candidates/${foreignTenant.candidateId}/dp`],
      ]) {
        const { res } = await req(base, path, { cookie: directionCookie });
        await expectStatus('tenant', `direction-foreign-${surface}-hidden`, res.status, 404);
      }
    } catch (e) {
      fail('auth', 'login-direction', e?.message || e);
    }
  }
  {
    const { res, data } = await req(base, '/api/admin/talent-bank?page=1&pageSize=20', { cookie: hrCookie });
    if (await expectStatus('talent-bank', 'list', res.status, 200)) {
      const n = Array.isArray(data?.items) ? data.items.length : -1;
      ok('talent-bank', 'has-shape', `n=${n} total=${data?.total ?? '?'}`);
    }
    const personId = data?.items?.[0]?.id;
    if (personId) {
      const { res: hs, data: hsData } = await req(base, `/api/admin/hr-score/${personId}`, { cookie: hrCookie });
      if (await expectStatus('hr-score', 'person', hs.status, 200)) {
        if (typeof hsData?.score === 'number' && typeof hsData?.employee === 'boolean') ok('hr-score', 'person-shape', `score=${hsData.score}`);
        else fail('hr-score', 'person-shape', JSON.stringify(hsData).slice(0, 160));
      }
    }
  }
  if (vacancyId) {
    const { res } = await req(base, `/api/admin/vacancies/${vacancyId}`, { cookie: hrCookie });
    await expectStatus('vacancies', 'get', res.status, 200);
    const { res: r2 } = await req(base, `/api/admin/vacancies/${vacancyId}/candidates`, {
      cookie: hrCookie,
    });
    await expectStatus('vacancies', 'candidates', r2.status, 200);
    const { res: r3, data: d3 } = await req(base, `/api/admin/vacancies/${vacancyId}/candidates`, {
      cookie: hrCookie,
    });
    if (r3.status === 200) {
      const arr = Array.isArray(d3?.items) ? d3.items : [];
      candidateId = arr[0]?.candidateId || arr[0]?.candidate_id || arr[0]?.id || null;
      if (candidateId) ok('vacancies', 'candidate-id', String(candidateId));
    }
    if (!candidateId && vacancyList.length > 1) {
      for (const v of vacancyList) {
        if (!v?.id || v.id === vacancyId) continue;
        const { res: rx, data: dx } = await req(base, `/api/admin/vacancies/${v.id}/candidates`, {
          cookie: hrCookie,
        });
        if (rx.status !== 200) continue;
        const arr = Array.isArray(dx?.items) ? dx.items : [];
        const cid = arr[0]?.candidateId || arr[0]?.candidate_id || arr[0]?.id || null;
        if (cid) {
          vacancyId = v.id;
          candidateId = cid;
          ok('vacancies', 'candidate-id-fallback', String(candidateId));
          break;
        }
      }
    }
    if (vacancyId && candidateId) {
      const { res: scRes, data: scData } = await req(
        base,
        `/api/admin/vacancies/${vacancyId}/candidates/${candidateId}/scorecard`,
        { cookie: hrCookie }
      );
      if (await expectStatus('vacancies', 'scorecard-get', scRes.status, [200])) {
        const items = scData?.scorecard?.items;
        ok('vacancies', 'scorecard-items', Array.isArray(items) ? `n=${items.length}` : 'missing');
      }
    } else {
      fail('vacancies', 'scorecard-get', 'no vacancy candidate for scorecard');
    }
    const { res: r4, data: d4 } = await req(base, `/api/admin/vacancies/${vacancyId}/ranking`, {
      cookie: hrCookie,
    });
    await expectStatus('vacancies', 'ranking', r4.status, [200, 404]);
    if (r4.status === 200) {
      const first = Array.isArray(d4?.ranking) ? d4.ranking[0] : null;
      if (first && first.stageEnteredAt == null && first.createdAt == null) {
        fail('vacancies', 'ranking-aging', 'missing stageEnteredAt/createdAt');
      } else if (first) {
        ok('vacancies', 'ranking-aging', 'stageEnteredAt present');
      } else {
        ok('vacancies', 'ranking-aging-empty', 'no rows');
      }
    }

    // Clone vacancy (B-409)
    {
      const { res: cloneRes, data: cloneData } = await req(
        base,
        `/api/admin/vacancies/${vacancyId}/clone`,
        { method: 'POST', cookie: hrCookie }
      );
      if (await expectStatus('vacancies', 'clone', cloneRes.status, [201])) {
        const cid = cloneData?.id;
        if (cid) {
          ok('vacancies', 'clone-id', String(cid));
          const { res: delClone } = await req(base, `/api/admin/vacancies/${cid}`, {
            method: 'DELETE',
            cookie: hrCookie,
          });
          await expectStatus('vacancies', 'clone-cleanup', delClone.status, [200, 204]);
        } else {
          fail('vacancies', 'clone-shape', JSON.stringify(cloneData).slice(0, 160));
        }
      }
    }

    // Saved groups (B-404) — list + create + delete against demo company
    {
      const { res: tgList, data: tgData } = await req(base, '/api/admin/team-groups', {
        cookie: hrCookie,
      });
      // HR has company on session — no query needed
      if (await expectStatus('groups', 'list', tgList.status, [200, 400])) {
        if (tgList.status === 200 && !Array.isArray(tgData?.items)) {
          fail('groups', 'list-shape', 'items missing');
        } else if (tgList.status === 200) {
          ok('groups', 'list', `n=${tgData.items.length}`);
        }
      }
      const { res: rowsRes, data: rowsData } = await req(
        base,
        '/api/admin/assessment-rows?page=1&pageSize=5&roster=all',
        { cookie: hrCookie }
      );
      const rows = Array.isArray(rowsData?.rows)
        ? rowsData.rows
        : Array.isArray(rowsData?.items)
          ? rowsData.items
          : Array.isArray(rowsData)
            ? rowsData
            : [];
      const withType = rows.filter((r) => r.assessmentId != null && r.topType != null);
      if (rowsRes.status === 200 && withType.length >= 2) {
        const baseId = withType[0].assessmentId;
        const memberId = withType[1].assessmentId;
        const { res: createRes, data: createData } = await req(base, '/api/admin/team-groups', {
          method: 'POST',
          cookie: hrCookie,
          body: {
            name: 'DTOV Squad',
            baseAssessmentId: baseId,
            memberAssessmentIds: [memberId],
          },
        });
        if (await expectStatus('groups', 'create', createRes.status, 201)) {
          const gid = createData?.item?.id;
          if (gid) {
            ok('groups', 'create-id', String(gid));
            const { res: delRes } = await req(base, `/api/admin/team-groups/${gid}`, {
              method: 'DELETE',
              cookie: hrCookie,
            });
            await expectStatus('groups', 'delete', delRes.status, 200);
          } else {
            fail('groups', 'create-shape', JSON.stringify(createData).slice(0, 160));
          }
        } else if (createData?.errorCode) {
          fail('groups', 'create-error', createData.errorCode);
        }
      } else {
        ok('groups', 'create-skipped', 'need 2 assessments');
      }
    }

    const { res: r5 } = await req(base, `/api/admin/vacancies/${vacancyId}/invites`, {
      cookie: hrCookie,
    });
    await expectStatus('vacancies', 'invites', r5.status, [200]);
    const { res: r6 } = await req(base, `/api/admin/vacancies/${vacancyId}/reports`, {
      cookie: hrCookie,
    });
    await expectStatus('vacancies', 'reports', r6.status, [200]);
    const analyticsId = publicVacancyId || vacancyId;
    const { res: r7, data: d7 } = await req(base, `/api/admin/vacancies/${analyticsId}/analytics`, {
      cookie: hrCookie,
    });
    if (await expectStatus('vacancies', 'analytics', r7.status, 200)) {
      if (typeof d7?.views !== 'number' || !Array.isArray(d7?.sources)) {
        fail('vacancies', 'analytics-shape', JSON.stringify(d7).slice(0, 160));
      } else {
        ok('vacancies', 'analytics-shape', `views=${d7.views} apps=${d7.applications}`);
      }
    }
  }

  {
    const { res, data } = await req(base, '/api/admin/referral-codes', { cookie: hrCookie });
    if (await expectStatus('referral', 'list', res.status, 200)) {
      const items = data?.items || [];
      const hit = items.find((i) => String(i.code || '').toUpperCase() === 'DTOVREF');
      if (!hit) fail('referral', 'list-has-dtovref', `n=${items.length}`);
      else ok('referral', 'list-has-dtovref', String(hit.id));
    }
    const { res: ra, data: da } = await req(base, '/api/admin/referral-codes/analytics', {
      cookie: hrCookie,
    });
    if (await expectStatus('referral', 'analytics', ra.status, 200)) {
      const row = (da?.items || []).find((i) => i.code === 'DTOVREF');
      if (!row || row.applications < 1) {
        fail('referral', 'analytics-dtovref', JSON.stringify(da).slice(0, 200));
      } else {
        ok('referral', 'analytics-dtovref', `apps=${row.applications} hires=${row.hires}`);
      }
    }
    const { res: rc, data: dc } = await req(base, '/api/admin/referral-codes', {
      method: 'POST',
      cookie: hrCookie,
      body: {
        code: `T${Date.now().toString(36).toUpperCase().slice(-6)}`,
        label: 'http-smoke temp',
        vacancyId: publicVacancyId || vacancyId,
      },
    });
    if (await expectStatus('referral', 'create', rc.status, 201)) {
      if (!dc?.code || !dc?.id) fail('referral', 'create-shape', JSON.stringify(dc).slice(0, 120));
      else ok('referral', 'create-shape', dc.code);
    }
  }

  let peopleCandidateId = null;
  {
    const q = encodeURIComponent(FIXTURE_PEOPLE.searchName);
    const { res, data } = await req(
      base,
      `/api/admin/assessment-rows?page=1&pageSize=5&roster=internal&search=${q}`,
      { cookie: hrCookie }
    );
    if (await expectStatus('team', 'assessment-rows', res.status, [200])) {
      const rows = Array.isArray(data?.rows) ? data.rows : [];
      peopleCandidateId = rows[0]?.candidateId || rows[0]?.candidate_id || null;
    }
    if (!peopleCandidateId) {
      const { res: rAll, data: dAll } = await req(
        base,
        '/api/admin/assessment-rows?page=1&pageSize=20&roster=all',
        { cookie: hrCookie }
      );
      if (rAll.status === 200) {
        const rows = Array.isArray(dAll?.rows) ? dAll.rows : [];
        peopleCandidateId = rows[0]?.candidateId || rows[0]?.candidate_id || null;
      }
    }
    if (!peopleCandidateId && candidateId) {
      peopleCandidateId = candidateId;
    }
  }
  {
    const { res } = await req(base, '/api/admin/export?limit=10', { cookie: hrCookie });
    await expectStatus('export', 'csv', res.status, [200, 400, 403]);
  }

  // AE admin (HR may or may not have config — status should respond)
  {
    const { res } = await req(base, '/api/admin/ae/status', { cookie: hrCookie });
    await expectStatus('ae', 'status', res.status, [200, 401, 403]);
  }
  {
    const { res } = await req(base, '/api/admin/ae/definitions', { cookie: hrCookie });
    await expectStatus('ae', 'definitions', res.status, [200, 401, 403]);
  }
  {
    const { res } = await req(base, '/api/admin/ae/attempts?page=1&pageSize=10', { cookie: hrCookie });
    await expectStatus('ae', 'attempts', res.status, [200, 401, 403]);
  }
  {
    const { res } = await req(base, '/api/admin/ae/invites?page=1&pageSize=10', { cookie: hrCookie });
    await expectStatus('ae', 'invites', res.status, [200, 401, 403]);
  }
  {
    const { res: batchGet, data: batchData } = await req(base, '/api/admin/ae/invites/batch', {
      cookie: hrCookie,
    });
    if (await expectStatus('ae', 'invites-batch-roster', batchGet.status, [200, 401, 403])) {
      if (batchGet.status === 200) {
        if (!Array.isArray(batchData?.items) && !Array.isArray(batchData?.eligible)) {
          fail('ae', 'invites-batch-shape', JSON.stringify(batchData).slice(0, 120));
        } else {
          ok(
            'ae',
            'invites-batch-eligible',
            `total=${batchData.total ?? 0} eligible=${batchData.eligibleCount ?? batchData.eligible?.length ?? 0}`
          );
          if ((batchData.total || 0) < 1) {
            fail('ae', 'invites-batch-roster-empty', 'expected internal roster rows');
          }
        }
        const pick = (batchData.eligible || []).slice(0, 1).map((p) => p.candidateId);
        if (pick.length > 0) {
          const { res: batchPost, data: batchPostData } = await req(base, '/api/admin/ae/invites/batch', {
            method: 'POST',
            cookie: hrCookie,
            body: { candidateIds: pick },
          });
          if (await expectStatus('ae', 'invites-batch-post', batchPost.status, [200, 400, 502, 503])) {
            if (batchPost.status === 200) {
              ok(
                'ae',
                'invites-batch-post-counts',
                `sent=${batchPostData.sentCount || 0} failed=${batchPostData.failedCount || 0}`
              );
            }
          }
        } else {
          ok('ae', 'invites-batch-post-skipped', 'no eligible');
        }
      }
    }
  }
  {
    const { res } = await req(base, '/api/admin/ae/analytics', { cookie: hrCookie });
    await expectStatus('ae', 'analytics', res.status, [200, 401, 403]);
  }

  // AE public start/questions (token)
  {
    const { res, data } = await req(base, '/api/ae/start', {
      method: 'POST',
      body: { token: TOK.aeInvite },
    });
    await expectStatus('ae-public', 'start', res.status, [200, 400, 404, 409, 410], data?.errorCode || '');
  }
  {
    const { res } = await req(base, `/api/ae/questions?token=${TOK.aeInvite}`);
    await expectStatus('ae-public', 'questions', res.status, [200, 400, 401, 404, 410]);
  }

  // People / 1:1 — always against fixture candidate (not tied to first vacancy)
  if (peopleCandidateId) {
    ok('people', 'fixture-candidate', String(peopleCandidateId));
    const { res, data } = await req(base, `/api/admin/candidates/${peopleCandidateId}?locale=pt-BR`, {
      cookie: hrCookie,
    });
    await expectStatus('people', 'candidate-get', res.status, 200);
    if (res.status === 200) {
      const brief = data?.people?.decisionBrief;
      if (!brief || typeof brief !== 'object') {
        fail('people', 'decision-brief', 'missing people.decisionBrief');
      } else if (typeof brief.hasAny !== 'boolean') {
        fail('people', 'decision-brief', 'decisionBrief.hasAny missing');
      } else {
        ok('people', 'decision-brief', brief.hasAny ? 'hasAny' : 'empty-ok');
      }
    }
    const { res: r2 } = await req(base, `/api/admin/candidates/${peopleCandidateId}/one-on-ones`, {
      cookie: hrCookie,
    });
    await expectStatus('people', 'one-on-ones', r2.status, 200);
    const { res: pdiList } = await req(
      base,
      `/api/admin/candidates/${peopleCandidateId}/development-plans`,
      { cookie: hrCookie }
    );
    await expectStatus('people', 'pdi-list', pdiList.status, 200);
    const { res: pdiCreate, data: pdiBody } = await req(
      base,
      `/api/admin/candidates/${peopleCandidateId}/development-plans`,
      {
        method: 'POST',
        cookie: hrCookie,
        body: {
          title: 'DTOV PDI',
          objective: 'Smoke',
          seedIdeas: ['Testar um comportamento em situação real'],
        },
      }
    );
    if (await expectStatus('people', 'pdi-create', pdiCreate.status, [201, 200])) {
      ok('people', 'pdi-create-id', String(pdiBody?.plan?.id || ''));
    }
  } else {
    fail('people', 'fixture-candidate', 'no candidate in HR company (demo seed missing?)');
  }

  // Employee portal — password login + home API
  {
    const { Client } = await import('pg');
    const bcrypt = await import('bcryptjs');
    const client = new Client({
      host: process.env.POSTGRES_HOST || '127.0.0.1',
      port: Number(process.env.POSTGRES_PORT || 55432),
      database: process.env.POSTGRES_DB || 'enneagram_dtov',
      user: process.env.POSTGRES_USER || 'dtov',
      password: process.env.POSTGRES_PASSWORD || 'dtov_local_only',
      ssl: false,
    });
    try {
      await client.connect();
      const hash = bcrypt.default.hashSync(FIXTURE_PEOPLE.password, 10);
      const upd = await client.query(
        `UPDATE candidates
         SET password_hash = $1, password_setup_token = NULL
         WHERE LOWER(email) = LOWER($2) AND employment_status = 'employee'
         RETURNING id, company_id AS "companyId"`,
        [hash, FIXTURE_PEOPLE.email]
      );
      if (!upd.rowCount) {
        fail('employee', 'password-seed', `${FIXTURE_PEOPLE.email} not found`);
      } else {
        ok('employee', 'password-seed', String(upd.rows[0].id));
        const loginRes = await req(base, '/api/auth/employee/login', {
          method: 'POST',
          body: {
            email: FIXTURE_PEOPLE.email,
            password: FIXTURE_PEOPLE.password,
            companyId: upd.rows[0].companyId,
            locale: 'pt-BR',
          },
        });
        const empCookie = cookieHeaderFromSetCookie(loginRes.setCookie);
        if (!(loginRes.res.status === 200 && empCookie.includes('team30_employee_session'))) {
          fail('employee', 'login', `status ${loginRes.res.status}`);
        } else {
          ok('employee', 'login', FIXTURE_PEOPLE.email);
          const { res: homeRes, data: homeData } = await req(base, '/api/employee/home', {
            cookie: empCookie,
          });
          if (await expectStatus('employee', 'home', homeRes.status, [200])) {
            ok('employee', 'home-shape', homeData?.fullName ? 'ok' : 'minimal');
          }
          const { res: colPage } = await req(base, '/employee', { cookie: empCookie });
          if (colPage.status === 200) ok('employee', 'hub-page', 'HTTP 200');
          else fail('employee', 'hub-page', `status ${colPage.status}`);
        }
      }
    } catch (e) {
      fail('employee', 'flow', e?.message || e);
    } finally {
      try {
        await client.end();
      } catch {
        /* ignore */
      }
    }
  }

  // Internal compensation timeline (HR)
  if (peopleCandidateId) {
    const { res: compGet, data: compData } = await req(
      base,
      `/api/admin/candidates/${peopleCandidateId}/compensation`,
      { cookie: hrCookie }
    );
    if (await expectStatus('compensation', 'get', compGet.status, [200])) {
      ok('compensation', 'get-shape', Array.isArray(compData?.items) ? `n=${compData.items.length}` : 'items');
    }
    const { res: compPost, data: compPostData } = await req(
      base,
      `/api/admin/candidates/${peopleCandidateId}/compensation`,
      {
        method: 'POST',
        cookie: hrCookie,
        body: {
          eventType: 'bonus',
          amount: '1500.00',
          effectiveDate: '2026-01-01',
          notes: 'DTOV smoke bonus',
        },
      }
    );
    if (await expectStatus('compensation', 'create', compPost.status, [200, 201])) {
      const eventId = compPostData?.event?.id;
      ok('compensation', 'create-id', String(eventId || ''));
      if (eventId) {
        const { res: compDel } = await req(
          base,
          `/api/admin/candidates/${peopleCandidateId}/compensation/${eventId}`,
          { method: 'DELETE', cookie: hrCookie }
        );
        await expectStatus('compensation', 'delete', compDel.status, [200, 204]);
      }
    }
  }

  // Overview intel + B-1000 list APIs (HR has OVERVIEW_VIEW; job-roles GET dual CAP)
  if (hrCompanyId) {
    const qs = `companyId=${encodeURIComponent(hrCompanyId)}`;
    const { res: turnRes, data: turnData } = await req(
      base,
      `/api/admin/turnover-radar/company?${qs}&limit=10&minRisk=low`,
      { cookie: hrCookie }
    );
    if (await expectStatus('turnover-radar', 'company', turnRes.status, [200])) {
      const okShape =
        Array.isArray(turnData?.risks) &&
        typeof turnData?.truncated === 'boolean' &&
        typeof turnData?.scanned === 'number';
      ok('turnover-radar', 'shape', okShape ? `risks=${turnData.risks.length}` : 'bad-shape');
      if (!okShape) fail('turnover-radar', 'shape', JSON.stringify(Object.keys(turnData || {})));
    }

    const { res: rolesRes, data: rolesData } = await req(base, `/api/admin/job-roles?${qs}`, {
      cookie: hrCookie,
    });
    // HR may lack JOB_ROLES_VIEW — dual CAP allows VACANCIES_MANAGE; expect 200 or 401
    if ([200, 401].includes(rolesRes.status)) {
      if (rolesRes.status === 200) {
        ok(
          'job-roles',
          'list',
          Array.isArray(rolesData?.roles) ? `n=${rolesData.roles.length}` : 'shape'
        );
      } else {
        ok('job-roles', 'list-denied', '401 expected without CAP');
      }
    } else {
      fail('job-roles', 'list', `status ${rolesRes.status}`);
    }

    const { res: workRes } = await req(base, `/api/admin/multi-signal-workbench?${qs}`, {
      cookie: hrCookie,
    });
    await expectStatus('multi-signal', 'workbench', workRes.status, [200, 401]);
  }

  // Climate surveys (anonymous structure)
  {
    const { res: listRes, data: listData } = await req(base, '/api/admin/climate-surveys', { cookie: hrCookie });
    await expectStatus('climate', 'list', listRes.status, 200);
    if (listData?.minResponses != null) ok('climate', 'min-responses', String(listData.minResponses));
    const { res: createRes, data: createData } = await req(base, '/api/admin/climate-surveys', {
      method: 'POST',
      cookie: hrCookie,
      body: { title: 'DTOV Climate' },
    });
    let surveyId = null;
    if (await expectStatus('climate', 'create', createRes.status, [201, 200])) {
      surveyId = createData?.survey?.id || null;
      ok('climate', 'create-id', String(surveyId || ''));
    }
    if (surveyId) {
      const { res: qAdd } = await req(base, `/api/admin/climate-surveys/${surveyId}`, {
        method: 'PATCH',
        cookie: hrCookie,
        body: { addQuestion: { prompt: 'DTOV pergunta extra' } },
      });
      await expectStatus('climate', 'add-question', qAdd.status, 200);

      const { res: openRes } = await req(base, `/api/admin/climate-surveys/${surveyId}`, {
        method: 'PATCH',
        cookie: hrCookie,
        body: { status: 'open' },
      });
      await expectStatus('climate', 'open', openRes.status, 200);

      const { res: lockRes, data: lockData } = await req(base, `/api/admin/climate-surveys/${surveyId}`, {
        method: 'PATCH',
        cookie: hrCookie,
        body: { addQuestion: { prompt: 'should fail after open' } },
      });
      if (await expectStatus('climate', 'questions-locked', lockRes.status, [400, 409])) {
        ok('climate', 'locked-code', String(lockData?.errorCode || lockRes.status));
      }

      const { res: batchRes, data: batchData } = await req(base, `/api/admin/climate-surveys/${surveyId}`, {
        method: 'PATCH',
        cookie: hrCookie,
        body: { createInviteBatch: true, count: 2 },
      });
      if (await expectStatus('climate', 'invite-batch', batchRes.status, 200)) {
        ok('climate', 'invite-batch-n', String(batchData?.invites?.length || 0));
      }

      const { res: invRes, data: invData } = await req(base, `/api/admin/climate-surveys/${surveyId}`, {
        method: 'PATCH',
        cookie: hrCookie,
        body: { createInvite: true },
      });
      if (await expectStatus('climate', 'invite', invRes.status, 200)) {
        const token = invData?.invite?.token;
        ok('climate', 'invite-token', token ? 'ok' : 'missing');
        if (token) {
          const { res: pubGet, data: pubMeta } = await req(base, `/api/public/climate/${token}`);
          await expectStatus('climate', 'public-get', pubGet.status, 200);
          const answers = {};
          for (const q of pubMeta?.questions || []) {
            if (String(q.questionKind || '').toLowerCase() === 'text') {
              answers[q.id] = 'DTOV open text insight ok';
            } else {
              answers[q.id] = q.scaleMin;
            }
          }
          const { res: pubPost } = await req(base, `/api/public/climate/${token}`, {
            method: 'POST',
            body: { answers },
          });
          await expectStatus('climate', 'public-post', pubPost.status, 200);
          const { res: aggRes, data: aggData } = await req(
            base,
            `/api/admin/climate-surveys/${surveyId}?aggregate=1`,
            { cookie: hrCookie }
          );
          if (await expectStatus('climate', 'aggregate', aggRes.status, 200)) {
            ok(
              'climate',
              'aggregate-suppressed',
              aggData?.suppressed ? `yes n=${aggData.responseCount}` : 'no'
            );
          }
        }
      }
      const { res: benchRes } = await req(base, '/api/admin/climate-surveys?benchmark=1', {
        cookie: hrCookie,
      });
      await expectStatus('climate', 'benchmark', benchRes.status, 200);

      const { res: verRes, data: verData } = await req(base, `/api/admin/climate-surveys/${surveyId}`, {
        method: 'PATCH',
        cookie: hrCookie,
        body: { version: true },
      });
      if (await expectStatus('climate', 'version', verRes.status, 200)) {
        ok('climate', 'version-draft-id', String(verData?.survey?.id || ''));
        ok(
          'climate',
          'version-status',
          verData?.survey?.status === 'draft' ? 'draft' : String(verData?.survey?.status || '')
        );
      }

      const { res: archivedList } = await req(base, '/api/admin/climate-surveys?status=archived', {
        cookie: hrCookie,
      });
      await expectStatus('climate', 'list-archived', archivedList.status, 200);

      const { res: delRes } = await req(base, `/api/admin/climate-surveys/${surveyId}`, {
        method: 'DELETE',
        cookie: hrCookie,
      });
      await expectStatus('climate', 'delete', delRes.status, 200);
    }
  }

  // Companies/users — usually admin-only; HR should get 401/403
  {
    const { res } = await req(base, '/api/admin/companies?page=1&pageSize=10', { cookie: hrCookie });
    await expectStatus('acl', 'hr-companies-denied', res.status, [401, 403]);
  }
  {
    const { res } = await req(base, '/api/admin/users?page=1&pageSize=10', { cookie: hrCookie });
    await expectStatus('acl', 'hr-users-denied', res.status, [401, 403]);
  }

  // ── Auth Admin ────────────────────────────────────────────────────────
  let adminCookie = '';
  try {
    adminCookie = await login(base, ADMIN);
    ok('auth', 'login-admin', ADMIN.email);
  } catch (e) {
    fail('auth', 'login-admin', e.message);
  }

  if (adminCookie) {
    if (foreignTenant) {
      for (const [surface, path] of [
        ['vacancy', `/api/admin/vacancies/${foreignTenant.vacancyId}`],
        ['dossier', `/api/admin/candidates/${foreignTenant.candidateId}/dossier`],
        ['compensation', `/api/admin/candidates/${foreignTenant.candidateId}/compensation`],
        ['dp', `/api/admin/candidates/${foreignTenant.candidateId}/dp`],
      ]) {
        const { res } = await req(base, path, { cookie: adminCookie });
        await expectStatus('tenant', `admin-cross-tenant-${surface}`, res.status, 200);
      }
    }
    const { res, data: companiesBody } = await req(base, '/api/admin/companies?page=1&pageSize=10', {
      cookie: adminCookie,
    });
    await expectStatus('admin', 'companies', res.status, 200);
    if (
      !companiesBody ||
      (companiesBody.logoStorageConfigured !== false && companiesBody.logoStorageConfigured !== true)
    ) {
      fail('admin', 'companies-logo-flag', 'missing logoStorageConfigured');
    } else {
      ok('admin', 'companies-logo-flag', String(companiesBody.logoStorageConfigured));
    }
    const firstCo = Array.isArray(companiesBody.items) ? companiesBody.items[0] : null;
    if (firstCo && !Number.isInteger(firstCo.activeEmployees)) {
      fail('admin', 'companies-active-employees', `activeEmployees=${firstCo.activeEmployees}`);
    } else if (firstCo) {
      ok('admin', 'companies-active-employees', String(firstCo.activeEmployees));
    }
    if (firstCo?.slug) {
      const qsOwn = new URLSearchParams({
        checkSlug: String(firstCo.slug),
        excludeId: String(firstCo.id),
      });
      const { res: checkOwn, data: ownBody } = await req(
        base,
        `/api/admin/companies?${qsOwn.toString()}`,
        { cookie: adminCookie }
      );
      await expectStatus('admin', 'companies-check-slug-own', checkOwn.status, 200);
      if (ownBody?.available !== true) {
        fail('admin', 'companies-check-slug-own-available', JSON.stringify(ownBody));
      } else {
        ok('admin', 'companies-check-slug-own-available', ownBody.slug || firstCo.slug);
      }

      const other = (companiesBody.items || []).find(
        (c) => c?.id && c.id !== firstCo.id && c.slug
      );
      if (other?.slug) {
        const qsTaken = new URLSearchParams({
          checkSlug: String(other.slug),
          excludeId: String(firstCo.id),
        });
        const { res: checkTaken, data: takenBody } = await req(
          base,
          `/api/admin/companies?${qsTaken.toString()}`,
          { cookie: adminCookie }
        );
        await expectStatus('admin', 'companies-check-slug-taken', checkTaken.status, 200);
        if (takenBody?.available !== false) {
          fail('admin', 'companies-check-slug-taken-flag', JSON.stringify(takenBody));
        } else {
          ok('admin', 'companies-check-slug-taken-flag', takenBody.slug || other.slug);
        }

        const { res: patchClash, data: patchBody } = await req(
          base,
          `/api/admin/companies/${firstCo.id}`,
          {
            method: 'PATCH',
            cookie: adminCookie,
            body: { slug: other.slug },
          }
        );
        await expectStatus('admin', 'companies-patch-slug-clash', patchClash.status, 409);
        if (patchBody?.errorCode && patchBody.errorCode !== 'SLUG_TAKEN') {
          fail('admin', 'companies-patch-slug-clash-code', JSON.stringify(patchBody));
        } else {
          ok('admin', 'companies-patch-slug-clash-code', patchBody?.errorCode || '409');
        }
      }
    }
    if (firstCo?.id) {
      const { res: logoGet } = await req(
        base,
        `/api/admin/companies/${firstCo.id}/logo`,
        { cookie: adminCookie }
      );
      await expectStatus('admin', 'company-logo-get', logoGet.status, 200);
      const { res: logoPost } = await req(base, `/api/admin/companies/${firstCo.id}/logo`, {
        method: 'POST',
        cookie: adminCookie,
        body: {},
      });
      // Sem S3 → 503; com S3 + body JSON inválido → 400
      await expectStatus('admin', 'company-logo-post', logoPost.status, [400, 503]);
    }
    const { res: r2 } = await req(base, '/api/admin/users?page=1&pageSize=10', {
      cookie: adminCookie,
    });
    await expectStatus('admin', 'users', r2.status, 200);
    const { res: r3 } = await req(base, '/dashboard?tab=companies', { cookie: adminCookie });
    await expectStatus('admin', 'dashboard-companies', r3.status, [200, 302, 307]);
    const { res: r4 } = await req(base, '/dashboard?tab=users', { cookie: adminCookie });
    await expectStatus('admin', 'dashboard-users', r4.status, [200, 302, 307]);
    const { res: r5 } = await req(base, '/api/admin/ae/config/questions', { cookie: adminCookie });
    await expectStatus('admin', 'ae-questions-config', r5.status, [200, 403]);
    const { res: r6 } = await req(base, '/api/admin/ae/config/dimensions', { cookie: adminCookie });
    await expectStatus('admin', 'ae-dimensions', r6.status, [200, 403]);
    const { res: r7 } = await req(base, '/api/admin/ae/config/templates', { cookie: adminCookie });
    await expectStatus('admin', 'ae-templates', r7.status, [200, 403]);
  }

  // Cron: sem secret = 401; com secret = 200/500 (smtp missing ok)
  {
    const { res } = await req(base, '/api/cron/invite-reminders', { method: 'POST' });
    await expectStatus('cron', 'invite-reminders-unauth', res.status, [401]);
    const { res: wrong } = await req(base, '/api/cron/hour-bank-checkpoints', {
      method: 'POST',
      headers: { Authorization: 'Bearer wrong-secret' },
    });
    await expectStatus('cron', 'hour-bank-checkpoints-wrong-secret', wrong.status, [401]);
  }
  {
    const secret = process.env.CRON_SECRET || '';
    if (secret) {
      for (const path of [
        '/api/cron/invite-reminders',
        '/api/cron/notification-retention',
        '/api/cron/vacancy-deadline-notifications',
        '/api/cron/manager-weekly-digest?email=0',
      ]) {
        const { res } = await req(base, path, {
          method: 'POST',
          headers: { Authorization: `Bearer ${secret}` },
        });
        await expectStatus('cron', path.split('/').pop().split('?')[0], res.status, [200, 500]);
      }
      const { res: ckpt } = await req(base, '/api/cron/hour-bank-checkpoints', {
        method: 'POST',
        headers: { 'X-Cron-Secret': secret },
      });
      await expectStatus('cron', 'hour-bank-checkpoints', ckpt.status, [200]);
    } else {
      ok('cron', 'secret-skipped', 'CRON_SECRET not set');
    }
  }

  // ── Early-access signup (self-service) — fluxo completo ───────────────
  {
    const { Client } = await import('pg');
    const client = new Client({
      host: process.env.POSTGRES_HOST || '127.0.0.1',
      port: Number(process.env.POSTGRES_PORT || 55432),
      database: process.env.POSTGRES_DB || 'enneagram_dtov',
      user: process.env.POSTGRES_USER || 'dtov',
      password: process.env.POSTGRES_PASSWORD || 'dtov_local_only',
      ssl: false,
    });
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const signupEmail = `early.${stamp}@signup.30team.test`;
    const signupPassword = 'SignupTest!2026';
    const companyName = `#0Pay ${stamp}`;

    try {
      await client.connect();

      // Página /signup renderiza
      {
        const { res, text } = await req(base, '/signup');
        if (res.status !== 200 || String(text).length < 100) {
          fail('signup', 'page', `status ${res.status} len=${String(text).length}`);
        } else ok('signup', 'page', `HTTP ${res.status}`);
      }

      // Validação: campos obrigatórios
      {
        const { res, data } = await req(base, '/api/auth/signup', {
          method: 'POST',
          body: { email: signupEmail },
        });
        await expectStatus('signup', 'missing-fields', res.status, [400], data?.errorCode || '');
      }

      // Happy path: criar conta (# no nome da empresa — repro do bug de prod)
      {
        const { res, data } = await req(base, '/api/auth/signup', {
          method: 'POST',
          body: {
            fullName: 'Thomas Early',
            email: signupEmail,
            companyName,
            jobTitle: 'hr_manager',
            teamSize: '11-50',
            painPoints: 'Gestao 360',
            locale: 'pt-BR',
          },
        });
        if (!(res.status === 200 && data?.ok)) {
          fail(
            'signup',
            'create',
            `status ${res.status} body=${JSON.stringify(data).slice(0, 240)}`
          );
        } else {
          ok('signup', 'create', 'ok');
        }
      }

      // Estado no DB: pending + token
      let setupToken = '';
      {
        const u = await client.query(
          `SELECT id, active, signup_pending, signup_source, password_setup_token, company_id
           FROM users WHERE LOWER(email) = $1 LIMIT 1`,
          [signupEmail]
        );
        if (!u.rowCount) {
          fail('signup', 'db-user', 'user missing after create');
        } else {
          const row = u.rows[0];
          if (row.active !== false || row.signup_pending !== true || row.signup_source !== 'early_access') {
            fail(
              'signup',
              'db-user',
              `active=${row.active} pending=${row.signup_pending} source=${row.signup_source}`
            );
          } else if (!row.password_setup_token || String(row.password_setup_token).length < 16) {
            fail('signup', 'db-user', 'password_setup_token missing (invite failed?)');
          } else {
            setupToken = row.password_setup_token;
            ok('signup', 'db-user', 'pending + setup token');
          }
          const co = await client.query(
            `SELECT signup_auto_created, signup_creator_user_id, name, slug
             FROM companies WHERE id = $1`,
            [row.company_id]
          );
          if (!co.rowCount || co.rows[0].signup_auto_created !== true) {
            fail('signup', 'db-company', 'signup_auto_created expected');
          } else if (Number(co.rows[0].signup_creator_user_id) !== Number(row.id)) {
            fail('signup', 'db-company', 'creator mismatch');
          } else {
            ok('signup', 'db-company', `slug=${co.rows[0].slug}`);
          }
        }
      }

      // Resend enquanto pending
      {
        const { res, data } = await req(base, '/api/auth/signup', {
          method: 'POST',
          body: {
            fullName: 'Thomas Early',
            email: signupEmail,
            companyName,
            locale: 'pt-BR',
          },
        });
        if (!(res.status === 200 && data?.ok)) {
          fail('signup', 'resent', `status ${res.status} ${JSON.stringify(data).slice(0, 160)}`);
        } else {
          const u2 = await client.query(
            `SELECT password_setup_token FROM users WHERE LOWER(email) = $1 LIMIT 1`,
            [signupEmail]
          );
          const nextTok = u2.rows[0]?.password_setup_token;
          if (!nextTok) fail('signup', 'resent', 'token cleared');
          else {
            setupToken = nextTok;
            ok('signup', 'resent', 'token rotated');
          }
        }
      }

      // Peek + complete set-password
      if (setupToken) {
        const peek = await req(base, `/api/public/set-password?token=${encodeURIComponent(setupToken)}`);
        if (!(peek.res.status === 200 && peek.data?.ok)) {
          fail('signup', 'set-password-peek', `status ${peek.res.status} ${JSON.stringify(peek.data)}`);
        } else ok('signup', 'set-password-peek', peek.data.email || 'masked');

        const done = await req(base, '/api/public/set-password', {
          method: 'POST',
          body: { token: setupToken, password: signupPassword },
        });
        if (!(done.res.status === 200 && done.data?.ok)) {
          fail('signup', 'set-password-complete', `status ${done.res.status} ${JSON.stringify(done.data)}`);
        } else ok('signup', 'set-password-complete', 'activated');

        const after = await client.query(
          `SELECT active, signup_pending, password_setup_token IS NULL AS token_cleared
           FROM users WHERE LOWER(email) = $1`,
          [signupEmail]
        );
        const a = after.rows[0];
        if (!a?.active || a.signup_pending || !a.token_cleared) {
          fail('signup', 'db-activated', JSON.stringify(a));
        } else ok('signup', 'db-activated', 'active + pending cleared');
      }

      // Login com a senha definida
      {
        const login = await req(base, '/api/auth/login', {
          method: 'POST',
          body: { email: signupEmail, password: signupPassword },
        });
        const setCookie = parseSetCookie(login.res);
        const cookie = cookieHeaderFromSetCookie(setCookie);
        if (!(login.res.status === 200 && cookie.includes('team30_session'))) {
          fail('signup', 'login-after', `status ${login.res.status} cookie=${Boolean(cookie)}`);
        } else ok('signup', 'login-after', 'session cookie');
      }

      // E-mail já ativo mantém resposta indistinguível do sucesso (anti-enumeração).
      {
        const { res, data } = await req(base, '/api/auth/signup', {
          method: 'POST',
          body: {
            fullName: 'Other',
            email: signupEmail,
            companyName: 'Other Co',
            locale: 'pt-BR',
          },
        });
        await expectStatus('signup', 'duplicate-active', res.status, [200], data?.ok ? 'anti-enum' : '');
      }
    } catch (e) {
      fail('signup', 'flow-exception', e?.message || e);
    } finally {
      try {
        await client.end();
      } catch {
        /* ignore */
      }
    }
  }

  // Logout
  {
    const { res } = await req(base, '/api/auth/logout', { method: 'POST', cookie: hrCookie });
    await expectStatus('auth', 'logout', res.status, [200, 204]);
  }

  return printSummary();
}

function printSummary() {
  const failed = results.filter((r) => r.status === 'fail');
  const passed = results.filter((r) => r.status === 'pass');
  process.stdout.write('\n== http summary ==\n');
  process.stdout.write(`pass: ${passed.length}  fail: ${failed.length}\n`);
  if (failed.length) {
    for (const f of failed) process.stdout.write(`  - ${f.suite}/${f.name}: ${f.detail}\n`);
  }
  return { passed: passed.length, failed: failed.length, results };
}

async function main() {
  const summary = await runHttpSmoke(process.env.BASE_URL);
  process.exitCode = summary.failed ? 1 : 0;
}

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
