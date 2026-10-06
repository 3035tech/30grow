/**
 * DTOV: B-2714 (NR-1 leve) + B-2600 (redação IA do diagnóstico).
 * Tenant isolation, CHECKs, generated risk_score, anonymity floor, factor summary,
 * versioning keeps factors, and ai_usage_events accepts feature help_diagnose (migration 151).
 * Fixtures are committed in a new company and removed at the end. Run with dtovEnv().
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';
import { pool, poolRead, query } from '../../lib/db.js';
import {
  climateMinResponses,
  createClimateSurvey,
  versionClimateSurvey,
} from '../../lib/people/climate-surveys.js';
import {
  createPsychosocialRisk,
  getPsychosocialOverview,
  listPsychosocialRisks,
  psychosocialSurveyPrompts,
  softDeletePsychosocialRisk,
  updatePsychosocialRisk,
} from '../../lib/people/psychosocial-risks.js';
import { explainAbsenceDiagnosisAi } from '../../lib/people/list-absence-explain-ai.js';
import { ABSENCE_LIST, ABSENCE_REASON } from '../../lib/people/list-absence-diagnostics-core.js';
import { CLIMATE_SURVEY_STATUS, PSYCHOSOCIAL_FACTOR, PSYCHOSOCIAL_RISK_STATUS } from '../../lib/domain-status.js';
import { ERR } from '../../lib/api-error-codes.js';
import { closeRateLimitRedis } from '../../lib/rate-limit.js';

// Global response cache would skip usage tracking on reruns; prove the tracked path.
process.env.AI_RESPONSE_CACHE = '0';

const db = new pg.Client({ host: '127.0.0.1', port: 55432, database: 'enneagram_dtov', user: 'dtov', password: 'dtov_local_only', ssl: false });
await db.connect();
const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const tag = crypto.randomUUID().slice(0, 8);
const companies = [];

try {
  const company = async (name) => {
    const id = Number((await one('INSERT INTO companies(name,slug) VALUES($1,$2) RETURNING id', [name, `nr1-${tag}-${companies.length}`])).id);
    companies.push(id);
    return id;
  };
  const user = async (companyId, label) => Number((await one(
    `INSERT INTO users(email,password_hash,role,company_id,display_name,active)
     VALUES($1,'x','hr',$2,$3,TRUE) RETURNING id`,
    [`${label}.${tag}@nr1.test`, companyId, `${label} ${tag}`])).id);

  const cid = await company('NR1 A');
  const otherCid = await company('NR1 B');
  const owner = await user(cid, 'owner');
  const foreignOwner = await user(otherCid, 'foreign');

  // Questionário NR-1: 16 Likert com fator + 1 texto
  const created = await createClimateSurvey(query, {
    companyId: cid,
    title: 'NR-1',
    prompts: psychosocialSurveyPrompts('pt-BR'),
    createdByUserId: owner,
  });
  assert.equal(created.ok, true);
  const surveyId = created.survey.id;
  const tagged = created.survey.questions.filter((q) => q.psychosocialFactor);
  assert.equal(tagged.length, 16, 'factors persisted on insert');

  await assert.rejects(
    db.query(`UPDATE climate_survey_questions SET psychosocial_factor = 'burnout' WHERE survey_id = $1`, [surveyId]),
    /psychosocial_factor_chk/,
    'CHECK blocks unknown factor'
  );

  // Inventário: dono de outra empresa é recusado
  const bad = await createPsychosocialRisk(query, {
    companyId: cid,
    input: { factor: PSYCHOSOCIAL_FACTOR.WORKLOAD, hazard: 'Metas acima da capacidade', ownerUserId: foreignOwner },
  });
  assert.deepEqual(bad, { ok: false, errorCode: ERR.INVALID_DATA }, 'owner must belong to the company');

  const foreignSurvey = await createClimateSurvey(query, { companyId: otherCid, title: 'B', seedDefaultQuestions: false });
  const risk = await createPsychosocialRisk(query, {
    companyId: cid,
    input: {
      factor: PSYCHOSOCIAL_FACTOR.WORKLOAD,
      hazard: 'Metas acima da capacidade no fechamento',
      exposedGroup: 'Financeiro',
      probability: 3,
      severity: 2,
      ownerUserId: owner,
      dueDate: '2026-12-01',
      surveyId: foreignSurvey.survey.id,
    },
    createdByUserId: owner,
  });
  assert.equal(risk.ok, true);
  assert.equal(risk.risk.riskScore, 6, 'generated risk_score');
  assert.equal(risk.risk.level, 'high');
  assert.equal(risk.risk.ownerUserId, owner);
  assert.equal(risk.risk.surveyId, null, 'survey of another tenant is dropped');
  assert.equal(risk.risk.dueDate, '2026-12-01');

  assert.equal((await listPsychosocialRisks(query, { companyId: otherCid })).length, 0, 'tenant isolation on list');
  const crossUpdate = await updatePsychosocialRisk(query, { companyId: otherCid, riskId: risk.risk.id, input: { status: PSYCHOSOCIAL_RISK_STATUS.CONTROLLED } });
  assert.deepEqual(crossUpdate, { ok: false, errorCode: ERR.NOT_FOUND }, 'tenant isolation on update');

  const upd = await updatePsychosocialRisk(query, {
    companyId: cid,
    riskId: risk.risk.id,
    input: { status: PSYCHOSOCIAL_RISK_STATUS.IN_PROGRESS, severity: 1 },
  });
  assert.equal(upd.ok, true);
  assert.equal(upd.previousStatus, PSYCHOSOCIAL_RISK_STATUS.IDENTIFIED);
  assert.equal(upd.risk.riskScore, 3);
  assert.equal(upd.risk.hazard, 'Metas acima da capacidade no fechamento', 'partial update keeps fields');

  // Anonimato: abaixo do mínimo, sem fatores
  let overview = await getPsychosocialOverview(query, { companyId: cid });
  assert.equal(overview.summary.survey.id, Number(surveyId));
  assert.equal(overview.summary.suppressed, true);
  assert.deepEqual(overview.summary.factors, []);
  assert.equal(overview.companyName, 'NR1 A');

  // Respostas: carga sempre 2/5, apoio sempre 5/5
  await db.query(`UPDATE climate_surveys SET status = $2 WHERE id = $1`, [surveyId, CLIMATE_SURVEY_STATUS.OPEN]);
  const workloadIds = tagged.filter((q) => q.psychosocialFactor === PSYCHOSOCIAL_FACTOR.WORKLOAD).map((q) => q.id);
  const supportIds = tagged.filter((q) => q.psychosocialFactor === PSYCHOSOCIAL_FACTOR.SUPPORT).map((q) => q.id);
  const answers = Object.fromEntries([...workloadIds.map((id) => [id, 2]), ...supportIds.map((id) => [id, 5])]);
  for (let i = 0; i < climateMinResponses(); i += 1) {
    await db.query(
      `INSERT INTO climate_survey_responses(survey_id, company_id, answers) VALUES($1,$2,$3::jsonb)`,
      [surveyId, cid, JSON.stringify(answers)]
    );
  }
  overview = await getPsychosocialOverview(query, { companyId: cid });
  assert.equal(overview.summary.suppressed, false);
  const byFactor = Object.fromEntries(overview.summary.factors.map((f) => [f.factor, f]));
  assert.equal(byFactor.workload.favorability, 25);
  assert.equal(byFactor.workload.signal, 'critical');
  assert.equal(byFactor.support.favorability, 100);
  assert.equal(overview.summary.factors.length, 2, 'factors without answers are omitted');

  // Nova versão mantém os fatores
  const v2 = await versionClimateSurvey(query, { companyId: cid, surveyId, createdByUserId: owner });
  assert.equal(v2.ok, true);
  assert.equal(v2.survey.questions.filter((q) => q.psychosocialFactor).length, 16, 'versioning copies factors');

  const del = await softDeletePsychosocialRisk(query, { companyId: cid, riskId: risk.risk.id });
  assert.equal(del.ok, true);
  assert.equal((await listPsychosocialRisks(query, { companyId: cid })).length, 0);

  // B-2600: mock da IA (DTOV=1) registra uso com a feature nova
  const explained = await explainAbsenceDiagnosisAi({
    list: ABSENCE_LIST.TEAM,
    reasons: [{ code: ABSENCE_REASON.SOFT_FILTERS }],
    candidateCount: 1,
    locale: 'pt-BR',
    usage: { companyId: cid, userId: owner },
  });
  assert.equal(explained.ok, true);
  const usageRow = await one(
    `SELECT COUNT(*)::int AS n FROM ai_usage_events WHERE company_id = $1 AND feature = 'help_diagnose'`,
    [cid]
  );
  assert.ok(usageRow.n >= 1, 'help_diagnose passes ai_usage_events_feature_chk');

  console.log('psychosocial-risks + help-diagnose explain DTOV: ok');
} finally {
  for (const id of companies) {
    await db.query('DELETE FROM ai_usage_events WHERE company_id=$1', [id]);
    await db.query('DELETE FROM psychosocial_risks WHERE company_id=$1', [id]);
    await db.query('DELETE FROM climate_surveys WHERE company_id=$1', [id]);
    await db.query('DELETE FROM users WHERE company_id=$1', [id]);
    await db.query('DELETE FROM companies WHERE id=$1', [id]);
  }
  await db.end();
  await closeRateLimitRedis();
  await poolRead?.end();
  await pool.end();
}
