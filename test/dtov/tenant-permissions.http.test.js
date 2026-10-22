/** Real HTTP + PostgreSQL proof. Local DTOV only; never accepts a remote base URL. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, writeFile, readdir, readFile } from 'node:fs/promises';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import { dtovEnv, assertDtovTarget } from './harness.js';
assert.equal(process.env.TENANT_AUDIT, '1', 'Explicit TENANT_AUDIT=1 required');
const base = 'http://127.0.0.1:3012';
const env = dtovEnv({
  JWT_SECRET: 'tenant-audit-local-only-secret-32-characters',
  COOKIE_SECURE: 'false',
  PORT: '3012',
  HOSTNAME: '127.0.0.1',
  NEXT_PUBLIC_APP_URL: base,
  APP_URL: base,
  NODE_ENV: 'production',
  SMTP_MOCK: '1',
  OPENAI_MOCK: '1',
  REP_DEVELOPER_DOCUMENT: '11222333000181',
  REP_DEVELOPER_NAME: 'Synthetic developer',
  REP_DEVELOPER_EMAIL: 'developer@example.test',
  TURNSTILE_SECRET_KEY: '',
  STRIPE_BILLING_ENFORCE: 'false',
  REDIS_KEY_PREFIX: `tenant-audit-${Date.now()}`,
  SENTRY_DSN: '',
  NEXT_PUBLIC_SENTRY_DSN: '',
  S3_BUCKET: '',
  AWS_BUCKET_NAME: '',
  OPENAI_API_KEY: '',
  STRIPE_SECRET_KEY: ''
});
assertDtovTarget(env);
const db = new pg.Client({
  host: env.POSTGRES_HOST,
  port: Number(env.POSTGRES_PORT),
  database: env.POSTGRES_DB,
  user: env.POSTGRES_USER,
  password: env.POSTGRES_PASSWORD,
  ssl: false
});
const results = [];
let server;
const stamp = Date.now();
const password = 'TenantAudit!2026Local';
await mkdir('test-results/tenant-audit', {
  recursive: true
});
const serverLog = createWriteStream('test-results/tenant-audit/server.log');
const one = async (sql, values = []) => (await db.query(sql, values)).rows[0];
async function request(path, cookie = '', method = 'GET', body) {
  const response = await fetch(base + path, {
    method,
    redirect: 'manual',
    headers: {
      cookie,
      ...(body === undefined ? {} : {
        'content-type': 'application/json'
      })
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000)
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {}
  return {
    status: response.status,
    text,
    data,
    headers: response.headers
  };
}
async function check(name, work) {
  try {
    await work();
    results.push({
      name,
      pass: true
    });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({
      name,
      pass: false,
      error: error.message
    });
    console.log(`FAIL ${name}: ${error.message}`);
  }
}
async function login(email, employee = false) {
  const r = await request(employee ? '/api/auth/employee/login' : '/api/auth/login', '', 'POST', {
    email,
    password
  });
  assert.equal(r.status, 200, `login ${email}: ${r.status}`);
  const cookie = r.headers.getSetCookie().map(x => x.split(';')[0]).join('; ');
  assert.ok(cookie.includes(employee ? 'team30_employee_session' : 'team30_session'));
  return cookie;
}
function denied(r) {
  assert.ok([401, 403, 404].includes(r.status), `expected denied, got ${r.status}`);
}
function noLeak(r, foreign) {
  for (const marker of [foreign.marker, foreign.email]) assert.ok(!r.text.includes(marker), `foreign marker leaked: ${marker}`);
}
try {
  await db.connect();
  const hash = await bcrypt.hash(password, 4);
  const area = await one('SELECT id FROM areas ORDER BY id LIMIT 1');
  assert.ok(area, 'DTOV seed required');
  async function tenant(tag) {
    const marker = `TENANT_${tag}_PRIVATE_${stamp}`,
      email = `person-${tag}-${stamp}@example.test`;
    const c = await one('INSERT INTO companies(name,slug) VALUES($1,$2) RETURNING id', [marker, `audit-${tag.toLowerCase()}-${stamp}`]);
    const role = await one('INSERT INTO job_roles(company_id,name) VALUES($1,$2) RETURNING id', [c.id, marker]);
    const vacancy = await one("INSERT INTO vacancies(company_id,title,slug,status) VALUES($1,$2,$3,'open') RETURNING id", [c.id, marker, `audit-vac-${tag}-${stamp}`]);
    const person = await one("INSERT INTO candidates(company_id,full_name,email,personal_email,employment_status,password_hash,job_role_id) VALUES($1,$2,$3,$6,'employee',$4,$5) RETURNING id", [c.id, marker, email, hash, role.id, `shared-personal-${stamp}@example.test`]);
    const assessment = await one("INSERT INTO assessments(candidate_id,company_id,area_id,top_type,scores,vacancy_id) VALUES($1,$2,$3,1,'{}',$4) RETURNING id", [person.id, c.id, area.id, vacancy.id]);
    await db.query("INSERT INTO vacancy_candidates(vacancy_id,candidate_id,company_id) VALUES($1,$2,$3)", [vacancy.id, person.id, c.id]);
    const benefit = await one('INSERT INTO company_benefits(company_id,name) VALUES($1,$2) RETURNING id', [c.id, marker]);
    const leave = await one("INSERT INTO employee_leave_requests(company_id,candidate_id,leave_type,starts_on,ends_on) VALUES($1,$2,'sick','2026-10-01','2026-10-01') RETURNING id", [c.id, person.id]);
    const establishment = await one("INSERT INTO rep_establishments(company_id,employer_document,employer_name,workplace,registration,responsible_cpf) VALUES($1,$3,$2,'Synthetic workplace','00000000000000001','12345678909') RETURNING id", [c.id, marker, '9' + String(c.id).padStart(13, '0')]);
    return {
      id: c.id,
      roleId: role.id,
      vacancyId: vacancy.id,
      personId: person.id,
      assessmentId: assessment.id,
      benefitId: benefit.id,
      leaveId: leave.id,
      establishmentId: establishment.id,
      marker,
      email
    };
  }
  const A = await tenant('A'),
    B = await tenant('B');
  async function user(label, role, company, options = {}) {
    const email = `${label}-${stamp}@example.test`,
      row = await one('INSERT INTO users(email,password_hash,role,company_id) VALUES($1,$2,$3,$4) RETURNING id', [email, hash, role, company?.id ?? null]);
    if (options.owner) await db.query('UPDATE companies SET signup_creator_user_id=$1 WHERE id=$2', [row.id, company.id]);
    if (options.limited) await db.query("INSERT INTO user_capability_overrides(user_id,capability,granted) VALUES($1,'profile.self',true)", [row.id]);
    return {
      ...row,
      label,
      role,
      email,
      company
    };
  }
  await check('same personal email: distinct company records and private history', async () => {
    const rows = (await db.query('SELECT id,company_id,personal_email FROM candidates WHERE id=ANY($1::bigint[])', [[A.personId, B.personId]])).rows;
    assert.equal(rows.length, 2);
    assert.equal(rows[0].personal_email, rows[1].personal_email);
    assert.notEqual(rows[0].id, rows[1].id);
    assert.notEqual(rows[0].company_id, rows[1].company_id);
  });
  const identities = [];
  for (const [label, role, company, options] of [['hrA', 'hr', A, {}], ['directionA', 'direction', A, {}], ['ownerA', 'direction', A, {
    owner: true
  }], ['adminA', 'admin', A, {}], ['hrB', 'hr', B, {}], ['limitedA', 'hr', A, {
    limited: true
  }], ['super', 'admin', null, {}]]) identities.push(await user(label, role, company, options));
  server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', '3012', '-H', '127.0.0.1'], {
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  server.stdout.pipe(serverLog);
  server.stderr.pipe(serverLog);
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await request('/login')).status === 200) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise(r => setTimeout(r, 300));
  }
  assert.ok(ready, 'local Next server ready');
  for (const identity of identities) {
    identity.cookie = await login(identity.email);
    await check(`${identity.label}: real login`, async () => assert.ok(identity.cookie));
  }
  const byLabel = Object.fromEntries(identities.map(x => [x.label, x]));
  for (const identity of identities.filter(x => x.company && !x.label.startsWith('limited'))) {
    const own = identity.company,
      foreign = own === A ? B : A,
      cookie = identity.cookie;
    const ownPaths = [`/api/admin/candidates/${own.personId}`, `/api/admin/candidates/${own.personId}/dossier`, `/api/admin/candidates/${own.personId}/dp`, `/api/admin/candidates/${own.personId}/compensation`, `/api/admin/job-roles/${own.roleId}`, `/api/admin/vacancies/${own.vacancyId}`, `/api/admin/company-benefits/${own.benefitId}`];
    for (const path of ownPaths) await check(`${identity.label}: own ${path}`, async () => {
      const r = await request(path, cookie);
      assert.equal(r.status, 200);
      noLeak(r, foreign);
      if (path === `/api/admin/candidates/${own.personId}`) {
        assert.equal(r.data.operational.companyName, own.marker);
        assert.equal(String(r.data.operational.companyId), String(own.id));
      }
    });
    const foreignPaths = [`/api/admin/candidates/${foreign.personId}`, `/api/admin/candidates/${foreign.personId}/dossier`, `/api/admin/candidates/${foreign.personId}/dp`, `/api/admin/candidates/${foreign.personId}/compensation`, `/api/admin/job-roles/${foreign.roleId}`, `/api/admin/vacancies/${foreign.vacancyId}`, `/api/admin/company-benefits/${foreign.benefitId}`, `/api/admin/dp/leave/${foreign.leaveId}/file?companyId=${foreign.id}`];
    for (const path of foreignPaths) await check(`${identity.label}: foreign ${path}`, async () => {
      const r = await request(path, cookie);
      denied(r);
      noLeak(r, foreign);
    });
    for (const suffix of [`/api/admin/vacancies?companyId=${foreign.id}`, `/api/admin/job-roles?companyId=${foreign.id}`, `/api/admin/company-benefits?companyId=${foreign.id}`, `/api/admin/dp/leave?companyId=${foreign.id}`, `/api/admin/assessment-rows?company=${foreign.id}&rosterScope=all`, `/api/admin/assessment-rows?company=all&rosterScope=all`]) await check(`${identity.label}: override ${suffix}`, async () => {
      const r = await request(suffix, cookie);
      assert.equal(r.status, 200);
      noLeak(r, foreign);
      assert.ok(r.text.includes(own.marker), 'own row must remain visible');
    });
    for (const [path, body, table, id, column] of [[`/api/admin/candidates/${foreign.personId}`, {
      fullName: 'ATTACK'
    }, 'candidates', foreign.personId, 'full_name'], [`/api/admin/job-roles/${foreign.roleId}`, {
      name: 'ATTACK'
    }, 'job_roles', foreign.roleId, 'name'], [`/api/admin/vacancies/${foreign.vacancyId}`, {
      title: 'ATTACK'
    }, 'vacancies', foreign.vacancyId, 'title'], [`/api/admin/assessments/${foreign.assessmentId}`, {
      pipelineStage: 'interview'
    }, 'assessments', foreign.assessmentId, 'pipeline_stage']]) await check(`${identity.label}: denied PATCH ${path}`, async () => {
      const before = await one(`SELECT ${column} AS value FROM ${table} WHERE id=$1`, [id]);
      const r = await request(path, cookie, 'PATCH', body);
      const after = await one(`SELECT ${column} AS value FROM ${table} WHERE id=$1`, [id]);
      await db.query(`UPDATE ${table} SET ${column}=$1 WHERE id=$2`, [before.value, id]);
      denied(r);
      assert.deepEqual(after, before);
    });
    await check(`${identity.label}: body company override cannot create in other tenant`, async () => {
      const name = `Created by ${identity.label} ${stamp}`,
        r = await request('/api/admin/job-roles', cookie, 'POST', {
          companyId: foreign.id,
          name
        });
      assert.equal(r.status, 201);
      const saved = await one('SELECT company_id FROM job_roles WHERE id=$1', [r.data.id]);
      assert.equal(String(saved.company_id), String(own.id));
    });
    for (const company of ['all', foreign.id]) await check(`${identity.label}: assessment CSV company=${company}`, async () => {
      const r = await request(`/api/admin/export?company=${company}&rosterScope=all`, cookie);
      assert.equal(r.status, 200);
      assert.match(r.headers.get('content-type'), /csv/);
      noLeak(r, foreign);
      assert.ok(r.text.includes(own.marker));
    });
    await check(`${identity.label}: DP CSV override`, async () => {
      const r = await request(`/api/admin/dp/leave/export?companyId=${foreign.id}`, cookie);
      assert.equal(r.status, 200);
      noLeak(r, foreign);
      assert.ok(r.text.includes(own.marker));
    });
    for (const format of ['json', 'csv']) await check(`${identity.label}: analytics ${format} override`, async () => {
      const r = await request(`/api/admin/analytics/export?companyId=${foreign.id}&format=${format}`, cookie);
      assert.equal(r.status, 200);
      noLeak(r, foreign);
      if (format === 'json') {
        const expected = await request(`/api/admin/analytics/export?companyId=${own.id}&format=json`, cookie);
        assert.equal(expected.status, 200);
        assert.deepEqual(r.data.metrics, expected.data.metrics);
      }
    });
    await check(`${identity.label}: fiscal export foreign establishment`, async () => denied(await request(`/api/admin/time-clock/rep/export?companyId=${foreign.id}&establishmentId=${foreign.establishmentId}&format=afd&from=2026-10-01&to=2026-10-22`, cookie)));
  }
  for (const label of ['ownerA', 'adminA']) {
    const identity = byLabel[label];
    for (const method of ['PATCH', 'DELETE']) await check(`${label}: foreign user ${method} denied`, async () => {
      const before = await one('SELECT role,company_id,active FROM users WHERE id=$1', [byLabel.hrB.id]);
      const r = await request(`/api/admin/users/${byLabel.hrB.id}`, identity.cookie, method, method === 'PATCH' ? {
        role: 'admin'
      } : undefined);
      denied(r);
      assert.deepEqual(await one('SELECT role,company_id,active FROM users WHERE id=$1', [byLabel.hrB.id]), before);
    });
    await check(`${label}: cannot promote own HR to platform admin`, async () => {
      const r = await request(`/api/admin/users/${byLabel.hrA.id}`, identity.cookie, 'PATCH', {
        role: 'admin'
      });
      assert.ok([400, 401, 403, 404].includes(r.status));
      assert.equal((await one('SELECT role FROM users WHERE id=$1', [byLabel.hrA.id])).role, 'hr');
    });
    for (const path of ['/api/admin/companies', '/api/admin/ae/config/questions', '/api/results']) await check(`${label}: global catalog denied ${path}`, async () => denied(await request(path, identity.cookie)));
  }
  for (const label of ['hrA', 'adminA']) await check(`${label}: SSR dashboard ignores foreign company`, async () => {
    const r = await request(`/dashboard?company=${B.id}&tab=team&rosterScope=all`, byLabel[label].cookie);
    assert.equal(r.status, 200);
    noLeak(r, B);
    assert.ok(r.text.includes(A.marker));
  });
  for (const label of ['hrA', 'adminA']) await check(`${label}: overview SSR retains own company context`, async () => {
    const r = await request(`/dashboard?company=${B.id}&tab=overview`, byLabel[label].cookie);
    assert.equal(r.status, 200);
    noLeak(r, B);
    assert.ok(r.text.includes(A.marker));
    assert.ok(r.text.includes('Contexto da empresa'));
  });
  const protectedPaths = [`/api/admin/candidates/${A.personId}`, `/api/admin/vacancies/${A.vacancyId}`, `/api/admin/export?company=all`, `/api/admin/dp/leave/export?companyId=${A.id}`, `/api/admin/analytics/export?companyId=${A.id}`, `/api/admin/time-clock/rep/export?companyId=${A.id}&establishmentId=${A.establishmentId}&format=afd&from=2026-10-01&to=2026-10-22`, '/api/admin/users', '/api/admin/companies'];
  const employeeCookie = await login(A.email, true);
  await check('employee: own authenticated portal works', async () => assert.equal((await request('/api/employee/home', employeeCookie)).status, 200));
  for (const [label, cookie] of [['anonymous', ''], ['employee', employeeCookie], ['limited', byLabel.limitedA.cookie]]) for (const path of protectedPaths) await check(`${label}: deny ${path}`, async () => denied(await request(path, cookie)));
  for (const identity of identities.filter(x => ['hrA', 'directionA', 'limitedA'].includes(x.label))) for (const path of ['/api/admin/users', '/api/admin/companies', '/api/admin/product-feedback']) await check(`${identity.label}: platform/owner-only ${path}`, async () => denied(await request(path, identity.cookie)));
  await check('owner: own users list ignores foreign company', async () => {
    const r = await request(`/api/admin/users?companyId=${B.id}`, byLabel.ownerA.cookie);
    assert.equal(r.status, 200);
    assert.ok(!r.text.includes(byLabel.hrB.email));
    assert.ok(r.text.includes(byLabel.hrA.email));
  });
  for (const tenant of [A, B]) for (const path of [`/api/admin/candidates/${tenant.personId}`, `/api/admin/vacancies/${tenant.vacancyId}`, `/api/admin/job-roles/${tenant.roleId}`, `/api/admin/export?company=${tenant.id}&rosterScope=all`]) await check(`super: permitted ${path}`, async () => {
    const r = await request(path, byLabel.super.cookie);
    assert.equal(r.status, 200);
    assert.ok(r.text.includes(tenant.marker));
  });
  await check('super: explicit all-company CSV', async () => {
    const r = await request('/api/admin/export?company=all&rosterScope=all', byLabel.super.cookie);
    assert.equal(r.status, 200);
    assert.ok(r.text.includes(A.marker) && r.text.includes(B.marker));
  });
  await check('employee: manager cookie cannot authenticate employee API', async () => denied(await request('/api/employee/home', byLabel.hrA.cookie)));
  await check('logout: old manager cookie revoked', async () => {
    assert.equal((await request('/api/auth/logout', byLabel.hrA.cookie, 'POST')).status, 200);
    denied(await request(`/api/admin/vacancies/${A.vacancyId}`, byLabel.hrA.cookie));
  });
  const renewed = await login(byLabel.hrA.email);
  await check('relogin: home scope preserved', async () => {
    denied(await request(`/api/admin/vacancies/${B.vacancyId}`, renewed));
    assert.equal((await request(`/api/admin/vacancies/${A.vacancyId}`, renewed)).status, 200);
  });
  await check('live capability revocation: old session cannot export', async () => {
    await db.query("INSERT INTO user_capability_overrides(user_id,capability,granted) VALUES($1,'profile.self',true)", [byLabel.directionA.id]);
    denied(await request('/api/admin/export', byLabel.directionA.cookie));
  });
  await check('live deactivation: old manager session denied', async () => {
    await db.query('UPDATE users SET active=false WHERE id=$1', [byLabel.hrB.id]);
    denied(await request(`/api/admin/vacancies/${B.vacancyId}`, byLabel.hrB.cookie));
  });
  await check('employee foreign leave is hidden', async () => denied(await request(`/api/employee/dp/leave/${B.leaveId}/file`, employeeCookie)));
  await check('employee termination invalidates old session', async () => {
    await db.query("UPDATE candidates SET employment_status='alumni' WHERE id=$1", [A.personId]);
    denied(await request('/api/employee/home', employeeCookie));
  });
  await check('company modules: live restriction blocks disabled modules, keeps core and employee self-service', async () => {
    await db.query("UPDATE candidates SET employment_status='employee' WHERE id=$1", [A.personId]);
    const freshEmployee = await login(A.email, true);
    await db.query("UPDATE companies SET enabled_modules=ARRAY['core']::text[] WHERE id=$1", [A.id]);
    try {
      denied(await request('/api/admin/job-roles', renewed));
      assert.equal((await request('/api/admin/export?rosterScope=all', renewed)).status, 200);
      assert.equal((await request('/api/employee/home', freshEmployee)).status, 200);
      assert.equal((await request(`/api/admin/export?company=${A.id}&rosterScope=all`, byLabel.super.cookie)).status, 200);
    } finally {
      await db.query('UPDATE companies SET enabled_modules=NULL WHERE id=$1', [A.id]);
    }
  });
  await check('live company reassignment: stale claim cannot retain former tenant', async () => {
    await db.query('UPDATE users SET company_id=$1 WHERE id=$2', [B.id, byLabel.adminA.id]);
    try {
      denied(await request(`/api/admin/vacancies/${A.vacancyId}`, byLabel.adminA.cookie));
      assert.equal((await request(`/api/admin/vacancies/${B.vacancyId}`, byLabel.adminA.cookie)).status, 200);
    } finally {
      await db.query('UPDATE users SET company_id=$1 WHERE id=$2', [A.id, byLabel.adminA.id]);
    }
  });
  await check('deleted company: tenant admin session and new login are denied', async () => {
    await db.query('UPDATE companies SET deleted=true WHERE id=$1', [A.id]);
    try {
      denied(await request(`/api/admin/vacancies/${A.vacancyId}`, byLabel.adminA.cookie));
      assert.equal((await request('/api/auth/login', '', 'POST', {
        email: byLabel.adminA.email,
        password
      })).status, 401);
    } finally {
      await db.query('UPDATE companies SET deleted=false WHERE id=$1', [A.id]);
    }
  });
  // Anonymous access audit of every declared administrative method (real routes, not regex-only proof).
  async function walk(dir) {
    const out = [];
    for (const entry of await readdir(dir, {
      withFileTypes: true
    })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) out.push(...(await walk(path)));else if (entry.name === 'route.js') out.push(path);
    }
    return out;
  }
  for (const file of await walk('app/api/admin')) {
    const source = await readFile(file, 'utf8');
    const methods = [...source.matchAll(/export\s+(?:(?:async\s+)?function|const)\s+(GET|POST|PATCH|PUT|DELETE)\b/g)].map(m => m[1]);
    const path = '/' + file.slice(4, -'/route.js'.length).replace(/\[\.\.\.[^\]]+\]/g, '1').replace(/\[[^\]]+\]/g, '1');
    for (const method of methods) await check(`anonymous inventory ${method} ${path}`, async () => {
      const r = await request(path, '', method, ['POST', 'PATCH', 'PUT'].includes(method) ? {} : undefined);
      assert.ok([401, 403].includes(r.status), `expected authentication denial before resource access, got ${r.status}`);
    });
  }
} catch (error) {
  results.push({
    name: 'suite setup/runtime',
    pass: false,
    error: error.message
  });
  console.error(error);
} finally {
  server?.kill('SIGTERM');
  serverLog.end();
  await db.end().catch(() => {});
  const passed = results.filter(r => r.pass).length,
    failed = results.length - passed;
  await writeFile('test-results/tenant-audit/results.json', JSON.stringify({
    commit: process.env.TENANT_AUDIT_COMMIT || null,
    at: new Date().toISOString(),
    passed,
    failed,
    results
  }, null, 2));
  console.log(`SUMMARY ${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
}
