/**
 * DTOV: B-2804.10 — climate and pulse invites in batch. Fixed query count for any size,
 * nothing inserted when the survey/pulse cannot take invites, bounded parallel e-mail
 * with one unique anonymous link per address. Run with DTOV=1 (SMTP mock).
 */
import assert from 'node:assert/strict';
import { query } from '../../lib/db.js';
import { __getMailMockLog, __resetMailMockLog } from '../../lib/mail.js';
import {
  createClimateSurveyInvite,
  createClimateSurveyInviteBatch,
  emailClimateSurveyInvites,
} from '../../lib/people/climate-surveys.js';
import { createTeamPulseInvite, createTeamPulseInviteBatch } from '../../lib/people/team-pulses.js';
import { ERR } from '../../lib/api-error-codes.js';
import { CLIMATE_SURVEY_STATUS, TEAM_PULSE_STATUS } from '../../lib/domain-status.js';

function countingDb() {
  const db = { count: 0, query: (sql, params) => { db.count += 1; return query(sql, params); } };
  return db;
}

async function main() {
  assert.equal(process.env.DTOV, '1', 'run with DTOV=1 (SMTP mock)');
  const climateIds = [];
  const pulseIds = [];
  const restore = [];

  try {
    const s = await query(
      `SELECT s.id, s.company_id AS "companyId" FROM climate_surveys s
       WHERE s.status = $1 AND s.deleted = FALSE
         AND EXISTS (SELECT 1 FROM climate_survey_questions q WHERE q.survey_id = s.id AND q.active)
       ORDER BY s.id LIMIT 1`,
      [CLIMATE_SURVEY_STATUS.OPEN]
    );
    assert.ok(s.rowCount, 'seed has an open climate survey with questions');
    const { id: surveyId, companyId } = s.rows[0];

    const one = countingDb();
    const single = await createClimateSurveyInviteBatch(one, { companyId, surveyId, count: 1 });
    const many = countingDb();
    const batch = await createClimateSurveyInviteBatch(many, { companyId, surveyId, count: 50, ttlDays: 400 });
    assert.ok(single.ok && batch.ok, JSON.stringify([single.errorCode, batch.errorCode]));
    climateIds.push(...single.invites.map((i) => i.id), ...batch.invites.map((i) => i.id));
    assert.equal(many.count, one.count, `climate queries: ${one.count} (1) vs ${many.count} (50)`);
    assert.equal(batch.invites.length, 50, 'cap 50');
    assert.equal(new Set(batch.invites.map((i) => i.token)).size, 50, 'unique tokens');
    assert.ok(batch.invites.every((i) => String(i.surveyId) === String(surveyId) && String(i.companyId) === String(companyId) && !i.usedAt));
    const days = (new Date(batch.invites[0].expiresAt) - Date.now()) / 86400000;
    assert.ok(days > 89 && days <= 90, `ttl clamped to 90 days (${days.toFixed(2)})`);
    const over = await createClimateSurveyInviteBatch({ query }, { companyId, surveyId, count: 999 });
    climateIds.push(...over.invites.map((i) => i.id));
    assert.equal(over.invites.length, 50, 'count above cap is capped');

    const legacy = await createClimateSurveyInvite({ query }, { companyId, surveyId });
    assert.ok(legacy.ok && legacy.invite.token && legacy.survey?.id, 'single invite keeps its shape');
    climateIds.push(legacy.invite.id);

    const before = await query(`SELECT count(*)::int AS n FROM climate_survey_invites WHERE survey_id = $1`, [surveyId]);
    restore.push(() => query(`UPDATE climate_surveys SET status = $2 WHERE id = $1`, [surveyId, CLIMATE_SURVEY_STATUS.OPEN]));
    await query(`UPDATE climate_surveys SET status = $2 WHERE id = $1`, [surveyId, CLIMATE_SURVEY_STATUS.CLOSED]);
    const closed = await createClimateSurveyInviteBatch({ query }, { companyId, surveyId, count: 10 });
    assert.equal(closed.errorCode, ERR.SURVEY_CLOSED);
    const otherCompany = await createClimateSurveyInviteBatch({ query }, { companyId: Number(companyId) + 100000, surveyId, count: 3 });
    assert.equal(otherCompany.errorCode, ERR.NOT_FOUND, 'tenant scoped');
    const after = await query(`SELECT count(*)::int AS n FROM climate_survey_invites WHERE survey_id = $1`, [surveyId]);
    assert.equal(after.rows[0].n, before.rows[0].n, 'nothing inserted when closed');
    await restore.pop()();

    __resetMailMockLog();
    const emails = Array.from({ length: 12 }, (_, i) => `lote${i}@example.com`);
    const mailed = await emailClimateSurveyInvites(query, { companyId, surveyId, emails: [...emails, 'LOTE0@example.com'], appOrigin: 'http://app.test' });
    assert.ok(mailed.ok, JSON.stringify(mailed));
    climateIds.push(...mailed.invites.map((i) => i.id));
    assert.deepEqual([mailed.sent, mailed.skipped], [12, 0]);
    const log = __getMailMockLog();
    assert.deepEqual(log.map((m) => m.to).sort(), [...emails].sort(), 'one mail per address');
    const links = log.map((m) => m.text.match(/http:\/\/app\.test\/clima\/([a-f0-9]+)/)?.[1]);
    assert.equal(new Set(links).size, 12, 'unique link per address');
    assert.ok(links.every((tk) => mailed.invites.some((i) => i.token === tk)), 'links are the created invites');

    const p = await query(
      `SELECT id, company_id AS "companyId", status FROM team_pulses WHERE company_id = $1 AND deleted = FALSE ORDER BY id LIMIT 1`,
      [companyId]
    );
    if (p.rowCount) {
      const { id: pulseId, status } = p.rows[0];
      restore.push(() => query(`UPDATE team_pulses SET status = $2 WHERE id = $1`, [pulseId, status]));
      await query(`UPDATE team_pulses SET status = $2 WHERE id = $1`, [pulseId, TEAM_PULSE_STATUS.OPEN]);
      const p1 = countingDb();
      const pOne = await createTeamPulseInviteBatch(p1, { companyId, pulseId, count: 1 });
      const p40 = countingDb();
      const pMany = await createTeamPulseInviteBatch(p40, { companyId, pulseId, count: 99 });
      assert.ok(pOne.ok && pMany.ok);
      pulseIds.push(...pOne.invites.map((i) => i.id), ...pMany.invites.map((i) => i.id));
      assert.equal(p40.count, p1.count, `pulse queries: ${p1.count} (1) vs ${p40.count} (40)`);
      assert.equal(pMany.invites.length, 40, 'pulse cap 40');
      assert.equal(new Set(pMany.invites.map((i) => i.token)).size, 40);
      const pLegacy = await createTeamPulseInvite({ query }, { companyId, pulseId });
      assert.ok(pLegacy.ok && pLegacy.invite.token && pLegacy.invite.expiresAt);
      pulseIds.push(pLegacy.invite.id);

      await query(`UPDATE team_pulses SET status = $2 WHERE id = $1`, [pulseId, TEAM_PULSE_STATUS.DRAFT]);
      const pBefore = await query(`SELECT count(*)::int AS n FROM team_pulse_invites WHERE pulse_id = $1`, [pulseId]);
      const notOpen = await createTeamPulseInviteBatch({ query }, { companyId, pulseId, count: 5 });
      assert.equal(notOpen.errorCode, ERR.PULSE_NOT_OPEN);
      const pAfter = await query(`SELECT count(*)::int AS n FROM team_pulse_invites WHERE pulse_id = $1`, [pulseId]);
      assert.equal(pAfter.rows[0].n, pBefore.rows[0].n, 'nothing inserted when not open');
    } else {
      console.log('survey-invites-batch: no team pulse in demo company, pulse path skipped');
    }
  } finally {
    while (restore.length) await restore.pop()();
    if (climateIds.length) await query(`DELETE FROM climate_survey_invites WHERE id = ANY($1::bigint[])`, [climateIds]);
    if (pulseIds.length) await query(`DELETE FROM team_pulse_invites WHERE id = ANY($1::bigint[])`, [pulseIds]);
  }

  console.log('survey-invites-batch.dtov.test.js OK');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
