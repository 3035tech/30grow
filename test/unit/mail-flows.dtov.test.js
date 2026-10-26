import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { pool, query } from '../../lib/db.js';
import { __getMailMockLog, __resetMailMockLog } from '../../lib/mail.js';
import { closeRateLimitRedis } from '../../lib/rate-limit.js';
import {
  completePasswordSetup,
  issuePasswordSetupInvite,
  peekPasswordSetupToken,
  requestPasswordResetByEmail,
} from '../../lib/user-password-invite.js';
import {
  issueEmployeePasswordInvite,
  requestEmployeeMagicLink,
  requestEmployeePasswordReset,
} from '../../lib/employee/employee-auth.js';
import { createAndQueueMotivatorsInvite } from '../../lib/ae/create-motivators-invite.js';
import { emailClimateSurveyInvites } from '../../lib/people/climate-surveys.js';
import { CLIMATE_SURVEY_STATUS, EMPLOYMENT_STATUS } from '../../lib/domain-status.js';

const dtov = process.env.DTOV === '1';
const APP = 'https://app.mail-test.example';
const prevEnv = {};

function lastMail() {
  const log = __getMailMockLog();
  assert.ok(log.length > 0, 'expected a captured mail');
  return log[log.length - 1];
}

function assertCleanMail(mail, { to, linkPrefix }) {
  assert.equal(mail.to, to);
  assert.ok(mail.subject && mail.subject.trim().length > 3, 'subject present');
  assert.doesNotMatch(mail.subject, / — /, 'no spaced em dash in subject');
  const body = `${mail.text || ''}\n${mail.html || ''}`;
  assert.doesNotMatch(body, /\bundefined\b|\{\{|\[object Object\]/, 'no template leftovers');
  assert.ok(body.includes(linkPrefix), `body links to ${linkPrefix}`);
  const match = body.match(new RegExp(`${linkPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([A-Za-z0-9_%-]+)`));
  assert.ok(match, 'token in link');
  return decodeURIComponent(match[1]);
}

before(() => {
  for (const k of ['SMTP_MOCK', 'NEXT_PUBLIC_APP_URL']) prevEnv[k] = process.env[k];
  process.env.SMTP_MOCK = '1';
  process.env.NEXT_PUBLIC_APP_URL = APP;
});

beforeEach(() => __resetMailMockLog());

after(async () => {
  for (const [k, v] of Object.entries(prevEnv)) {
    if (v == null) delete process.env[k];
    else process.env[k] = v;
  }
  await pool.end();
  await closeRateLimitRedis();
});

describe('transactional mail flows (DTOV)', { skip: !dtov }, () => {
  it('manager password reset emails a working set-password link', async () => {
    const u = await query(
      `SELECT id, LOWER(email) AS email FROM users
       WHERE deleted = FALSE AND active = TRUE AND company_id IS NOT NULL ORDER BY id LIMIT 1`
    );
    const { id, email } = u.rows[0];

    const res = await requestPasswordResetByEmail(`  ${email.toUpperCase()} `, { appUrl: `${APP}/`, locale: 'pt-BR' });
    assert.deepEqual(res, { ok: true, emailed: true });
    assert.equal(__getMailMockLog().length, 1);
    const token = assertCleanMail(lastMail(), { to: email, linkPrefix: `${APP}/a/set-password?token=` });

    const db = await query(`SELECT password_setup_token FROM users WHERE id = $1`, [id]);
    assert.equal(db.rows[0].password_setup_token, token);
    const peek = await peekPasswordSetupToken(token);
    assert.equal(peek.ok, true);
    assert.equal(Number(peek.userId), Number(id));

    const done = await completePasswordSetup(token, 'NovaSenhaSegura!2026');
    assert.equal(done.ok, true);
    const reused = await completePasswordSetup(token, 'OutraSenha!2026');
    assert.equal(reused.ok, false, 'token is single-use');
  });

  it('reset for an unknown e-mail answers ok without sending anything', async () => {
    const res = await requestPasswordResetByEmail('ninguem-aqui@nao-existe.example', { appUrl: APP });
    assert.deepEqual(res, { ok: true, emailed: false });
    assert.equal(__getMailMockLog().length, 0);
  });

  it('reset mail follows the requested locale', async () => {
    const u = await query(
      `SELECT id FROM users WHERE deleted = FALSE AND active = TRUE AND company_id IS NOT NULL ORDER BY id LIMIT 1`
    );
    await issuePasswordSetupInvite(u.rows[0].id, { appUrl: APP, locale: 'pt-BR', purpose: 'reset' });
    const pt = lastMail().subject;
    await issuePasswordSetupInvite(u.rows[0].id, { appUrl: APP, locale: 'en', purpose: 'reset' });
    const en = lastMail().subject;
    assert.notEqual(pt, en);
  });

  it('manager access invite emails a set-password link', async () => {
    const u = await query(
      `SELECT id, LOWER(email) AS email FROM users
       WHERE deleted = FALSE AND active = TRUE AND company_id IS NOT NULL ORDER BY id DESC LIMIT 1`
    );
    const res = await issuePasswordSetupInvite(u.rows[0].id, { appUrl: APP, purpose: 'invite' });
    assert.equal(res.ok, true);
    assertCleanMail(lastMail(), { to: u.rows[0].email, linkPrefix: `${APP}/a/set-password?token=` });
  });

  it('fails loudly when SMTP is not configured (no silent drop)', async () => {
    const saved = {
      SMTP_MOCK: process.env.SMTP_MOCK,
      DTOV: process.env.DTOV,
      SMTP_HOST: process.env.SMTP_HOST,
      MAIL_FROM: process.env.MAIL_FROM,
    };
    delete process.env.SMTP_MOCK;
    delete process.env.DTOV;
    delete process.env.SMTP_HOST;
    delete process.env.MAIL_FROM;
    try {
      const u = await query(`SELECT LOWER(email) AS email FROM users WHERE deleted = FALSE AND active = TRUE ORDER BY id LIMIT 1`);
      const res = await requestPasswordResetByEmail(u.rows[0].email, { appUrl: APP });
      assert.equal(res.ok, false);
      assert.equal(res.code, 'SMTP_NOT_CONFIGURED');
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v == null) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  it('employee access invite, password reset and magic link all send mail', async () => {
    const c = await query(
      `SELECT id, company_id, LOWER(email) AS email FROM candidates
       WHERE employment_status = $1 AND email IS NOT NULL AND email <> '' ORDER BY id LIMIT 1`,
      [EMPLOYMENT_STATUS.EMPLOYEE]
    );
    const person = c.rows[0];

    const invite = await issueEmployeePasswordInvite(query, {
      candidateId: person.id,
      companyId: person.company_id,
      purpose: 'invite',
    });
    assert.equal(invite.ok, true, JSON.stringify(invite));
    assert.equal(lastMail().to, person.email);
    assert.ok(`${lastMail().text}${lastMail().html}`.includes(APP), 'invite links to app');

    __resetMailMockLog();
    const reset = await requestEmployeePasswordReset(query, { email: person.email, companyId: person.company_id });
    assert.equal(reset.ok, true);
    assert.equal(__getMailMockLog().length, 1, 'invited employee receives reset mail');
    assert.equal(lastMail().to, person.email);

    __resetMailMockLog();
    const magic = await requestEmployeeMagicLink(query, { email: person.email, companyId: person.company_id });
    assert.equal(magic.ok, true);
    assert.equal(magic.sent, true);
    assertCleanMail(lastMail(), { to: person.email, linkPrefix: `${APP}/employee/enter?token=` });
  });

  it('motivators invite emails the assessment link', async () => {
    const co = await query(`SELECT id FROM companies WHERE deleted = FALSE ORDER BY id LIMIT 1`);
    const res = await createAndQueueMotivatorsInvite(query, {
      companyId: co.rows[0].id,
      candidateName: 'Pessoa Teste Email',
      candidateEmail: 'pessoa.teste.email@example.com',
      appBaseUrl: APP,
    });
    assert.equal(res.ok, true, JSON.stringify(res));
    assertCleanMail(lastMail(), {
      to: 'pessoa.teste.email@example.com',
      linkPrefix: `${APP}/assessment/motivators/`,
    });
  });

  it('climate survey invites send one anonymous link per address', async () => {
    const s = await query(
      `SELECT id, company_id FROM climate_surveys WHERE status = $1 ORDER BY id LIMIT 1`,
      [CLIMATE_SURVEY_STATUS.OPEN]
    );
    assert.equal(s.rowCount, 1, 'seed has an open climate survey');
    const res = await emailClimateSurveyInvites(query, {
      companyId: s.rows[0].company_id,
      surveyId: s.rows[0].id,
      emails: ['a.clima@example.com', 'A.Clima@example.com', 'b.clima@example.com'],
      appOrigin: APP,
    });
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(res.sent, 2, 'dedupes addresses');
    const log = __getMailMockLog();
    assert.deepEqual(log.map((m) => m.to).sort(), ['a.clima@example.com', 'b.clima@example.com']);
    for (const m of log) assertCleanMail(m, { to: m.to, linkPrefix: `${APP}/clima/` });
  });
});
