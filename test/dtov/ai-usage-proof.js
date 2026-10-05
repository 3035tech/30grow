/**
 * Prova DTOV do controle de custo de IA (B-2701 / B-2702): teto por empresa no admin,
 * bloqueio 429 AI_MONTHLY_LIMIT, fallback do assistente de Ajuda e linhas em ai_usage_events.
 *
 * Uso (servidor DTOV no ar): BASE_URL=http://127.0.0.1:3010 node test/dtov/ai-usage-proof.js
 * Cada execução gasta 4 rascunhos de vaga do RH: mais de ~4 execuções em 15 min batem no
 * rate limit por usuário (20/15 min) e falham com RATE_LIMIT. Rodar após `dtov:reset`.
 */

import process from 'node:process';
import pg from 'pg';
import { dtovEnv } from './harness.js';

const BASE = (process.env.BASE_URL || 'http://127.0.0.1:3010').replace(/\/$/, '');
const ADMIN = {
  email: process.env.DTOV_ADMIN_EMAIL || 'admin@3035tech.com',
  password: process.env.DTOV_ADMIN_PASSWORD || 'TroqueEstaSenha123!',
};
const HR = {
  email: 'hr@todos-os-dados.demo',
  password: process.env.DEMO_TODOS_PASSWORD || 'DemoTodosDados!2026',
};

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) process.stdout.write(`  ✓ ${name}\n`);
  else {
    failures += 1;
    process.stderr.write(`  ✗ ${name}${detail ? ` · ${detail}` : ''}\n`);
  }
}

async function req(path, { method = 'GET', cookie = '', body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    redirect: 'manual',
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data, setCookie: res.headers.getSetCookie?.() || [] };
}

async function login(creds) {
  const r = await req('/api/auth/login', { method: 'POST', body: creds });
  if (r.status !== 200) throw new Error(`login ${creds.email} → ${r.status}`);
  return r.setCookie.map((c) => String(c).split(';')[0]).join('; ');
}

async function findCompany(cookie) {
  const r = await req('/api/admin/companies?q=todos&pageSize=20', { cookie });
  return { row: (r.data.items || []).find((c) => /todos/i.test(c.name)), data: r.data };
}

const draft = (cookie) =>
  req('/api/admin/vacancies/assist-ai', {
    method: 'POST',
    cookie,
    body: { action: 'vacancyDescription', title: 'Analista de dados', locale: 'pt-BR' },
  });

async function main() {
  const admin = await login(ADMIN);
  const hr = await login(HR);

  const before = await findCompany(admin);
  check('listagem traz teto padrão e consumo do mês', Number.isFinite(before.data.aiDefaultMonthlyCallLimit) && before.row && Number.isFinite(before.row.aiUsedThisMonth), JSON.stringify(before.row || {}));
  const companyId = before.row.id;
  const used0 = before.row.aiUsedThisMonth;

  const bad = await req(`/api/admin/companies/${companyId}`, { method: 'PATCH', cookie: admin, body: { aiMonthlyCallLimit: -1 } });
  check('teto inválido → 400', bad.status === 400, String(bad.status));

  const set = await req(`/api/admin/companies/${companyId}`, { method: 'PATCH', cookie: admin, body: { aiMonthlyCallLimit: used0 + 2 } });
  check('admin define teto', set.status === 200 && set.data.aiMonthlyCallLimit === used0 + 2, JSON.stringify(set.data));
  check('PATCH só do teto preserva o nome', set.data.name === before.row.name);

  const a = await draft(hr);
  const b = await draft(hr);
  check('chamadas dentro do teto passam', a.status === 200 && b.status === 200, `${a.status} ${b.status}`);
  const c = await draft(hr);
  check('acima do teto → 429 AI_MONTHLY_LIMIT', c.status === 429 && c.data.errorCode === 'AI_MONTHLY_LIMIT', `${c.status} ${JSON.stringify(c.data)}`);
  check('mensagem localizada', typeof c.data.error === 'string' && c.data.error.includes('Limite de uso de IA'), c.data.error);

  const help = await req('/api/admin/help-chat', {
    method: 'POST',
    cookie: hr,
    body: { question: 'Quais critérios o radar de turnover usa para risco alto?', locale: 'pt-BR' },
  });
  check('Ajuda no teto responde pelo Guia (sem erro)', help.status === 200 && help.data.source === 'retrieve', `${help.status} ${help.data.source}`);

  const after = await findCompany(admin);
  check('consumo do mês contou 2 chamadas', after.row.aiUsedThisMonth === used0 + 2, String(after.row.aiUsedThisMonth));

  const env = dtovEnv();
  const client = new pg.Client({
    host: env.POSTGRES_HOST,
    port: Number(env.POSTGRES_PORT),
    user: env.POSTGRES_USER,
    password: env.POSTGRES_PASSWORD,
    database: env.POSTGRES_DB,
  });
  await client.connect();
  try {
    const rows = await client.query(
      `SELECT feature, user_id IS NOT NULL AS has_user, prompt_tokens, completion_tokens
         FROM ai_usage_events WHERE company_id = $1 ORDER BY id DESC LIMIT 2`,
      [companyId]
    );
    check('eventos gravados com feature, usuário e tokens', rows.rows.length === 2 && rows.rows.every((r) => r.feature === 'vacancy_description' && r.has_user && r.prompt_tokens > 0 && r.completion_tokens > 0), JSON.stringify(rows.rows));
    let rejected = false;
    try {
      await client.query(`INSERT INTO ai_usage_events (company_id, feature) VALUES ($1, 'inventada')`, [companyId]);
    } catch (e) {
      rejected = e.code === '23514';
    }
    check('CHECK de domínio recusa feature desconhecida', rejected);
  } finally {
    await client.end();
  }

  const report = await req(`/api/admin/ai-usage?companyId=${companyId}&feature=vacancy_description`, { cookie: admin });
  const reportRow = (report.data.items || []).find((r) => r.companyId === Number(companyId));
  check(
    'relatório de consumo traz a empresa com chamadas, teto e custo',
    report.status === 200 && reportRow && reportRow.calls >= 2 && reportRow.limit === used0 + 2 && reportRow.reached === true && report.data.totals.calls >= 2,
    `${report.status} ${JSON.stringify(reportRow || report.data)}`
  );
  check(
    'relatório por funcionalidade',
    (report.data.features || []).some((f) => f.feature === 'vacancy_description' && f.calls >= 2)
  );
  const badMonth = await req('/api/admin/ai-usage?month=2026-13', { cookie: admin });
  check('mês inválido → 400', badMonth.status === 400, String(badMonth.status));
  const hrReport = await req('/api/admin/ai-usage', { cookie: hr });
  check('RH não acessa o relatório (403)', hrReport.status === 403, String(hrReport.status));

  const reset = await req(`/api/admin/companies/${companyId}`, { method: 'PATCH', cookie: admin, body: { aiMonthlyCallLimit: null } });
  check('teto em branco volta ao padrão', reset.status === 200 && reset.data.aiMonthlyCallLimit === null, JSON.stringify(reset.data));
  const d = await draft(hr);
  check('com o padrão, IA volta a responder', d.status === 200, String(d.status));

  if (failures) {
    process.stderr.write(`\nai-usage-proof: ${failures} falha(s)\n`);
    process.exit(1);
  }
  process.stdout.write('\nai-usage-proof: ok\n');
}

main().catch((e) => {
  process.stderr.write(`${e?.stack || e}\n`);
  process.exit(1);
});
