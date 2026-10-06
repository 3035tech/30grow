/**
 * DTOV: B-2601 — "Por que não aparece?" for Banco de talentos and the vacancy pipeline.
 * Membership mirrors lib/talent-bank.js and lib/vacancy-ranking.js; tenant-scoped.
 * The lib reads through the shared pool, so fixtures are committed and removed at the end.
 * Run with dtovEnv() (see test/README.md).
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';
import { ABSENCE_REASON } from '../../lib/people/list-absence-diagnostics-core.js';
import {
  diagnoseTalentBankAbsence,
  diagnoseVacancyPipelineAbsence,
} from '../../lib/people/list-absence-diagnostics.js';
import { pool, poolRead } from '../../lib/db.js';

const db = new pg.Client({ host: '127.0.0.1', port: 55432, database: 'enneagram_dtov', user: 'dtov', password: 'dtov_local_only', ssl: false });
await db.connect();
const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const codes = (r) => r.reasons.map((x) => x.code);
const tag = crypto.randomUUID().slice(0, 8);
const companies = [];

try {
  const company = async (name) => {
    const id = Number((await one('INSERT INTO companies(name,slug) VALUES($1,$2) RETURNING id', [name, `diag-${tag}-${companies.length}`])).id);
    companies.push(id);
    return id;
  };
  const cid = await company('Diag lists');
  const otherCid = await company('Diag other');
  const areaId = Number((await one('SELECT id FROM areas ORDER BY id LIMIT 1')).id);
  const vacancy = async (companyId, title) => Number((await one(
    'INSERT INTO vacancies(company_id,title,slug) VALUES($1,$2,$3) RETURNING id', [companyId, title, `${title}-${tag}-${crypto.randomUUID().slice(0, 6)}`])).id);
  const person = async (companyId, name, status = 'candidate') => Number((await one(
    'INSERT INTO candidates(company_id,full_name,email,employment_status) VALUES($1,$2,$3,$4) RETURNING id',
    [companyId, name, `${name.toLowerCase().replace(/\s+/g, '.')}.${tag}@diag.test`, status])).id);
  const assess = (companyId, candidateId, vacancyId, stage, topType = 3) => db.query(
    `INSERT INTO assessments(candidate_id,company_id,area_id,top_type,scores,vacancy_id,pipeline_stage)
     VALUES($1,$2,$3,$4,'{}'::jsonb,$5,$6)`, [candidateId, companyId, areaId, topType, vacancyId, stage || 'new']);

  const dev = await vacancy(cid, 'Dev');
  const qa = await vacancy(cid, 'QA');
  const foreign = await vacancy(otherCid, 'Foreign');

  const ana = await person(cid, `Ana ${tag}`);
  await assess(cid, ana, dev, 'interview', 3);
  const bruno = await person(cid, `Bruno ${tag}`);
  await db.query('INSERT INTO vacancy_candidates(vacancy_id,candidate_id,company_id) VALUES($1,$2,$3)', [dev, bruno, cid]);
  const carla = await person(cid, `Carla ${tag}`);
  await db.query("INSERT INTO vacancy_candidates(vacancy_id,candidate_id,company_id,pipeline_stage) VALUES($1,$2,$3,'new')", [qa, carla, cid]);
  const diego = await person(cid, `Diego ${tag}`, 'employee');
  await assess(cid, diego, null, null, 5);
  await person(otherCid, `Ana ${tag}`);
  await assess(otherCid, (await one('SELECT id FROM candidates WHERE company_id=$1', [otherCid])).id, foreign, 'new');

  // Banco de talentos
  let r = await diagnoseTalentBankAbsence({ companyId: cid, q: `Ana ${tag}` });
  assert.deepEqual(codes(r), [ABSENCE_REASON.IN_LIST], 'Ana in bank, no filters');
  assert.equal(r.candidates.length, 1, 'other tenant homonym never returned');

  r = await diagnoseTalentBankAbsence({ companyId: cid, q: `Ana ${tag}`, vacancyId: qa });
  assert.deepEqual(codes(r), [ABSENCE_REASON.SOFT_FILTERS], 'vacancy filter hides Ana');
  r = await diagnoseTalentBankAbsence({ companyId: cid, q: `Ana ${tag}`, stage: 'hired' });
  assert.deepEqual(codes(r), [ABSENCE_REASON.SOFT_FILTERS], 'stage filter hides Ana');
  r = await diagnoseTalentBankAbsence({ companyId: cid, q: `Ana ${tag}`, topType: 5 });
  assert.deepEqual(codes(r), [ABSENCE_REASON.SOFT_FILTERS], 'type filter hides Ana');
  r = await diagnoseTalentBankAbsence({ companyId: cid, q: `Ana ${tag}`, vacancyId: dev, stage: 'interview', topType: 3 });
  assert.deepEqual(codes(r), [ABSENCE_REASON.IN_LIST], 'matching filters keep Ana');

  r = await diagnoseTalentBankAbsence({ companyId: cid, q: `Bruno ${tag}` });
  assert.deepEqual(codes(r), [ABSENCE_REASON.IN_LIST], 'vacancy link without stage still counts for the bank');
  r = await diagnoseTalentBankAbsence({ companyId: cid, q: `Diego ${tag}` });
  assert.deepEqual(codes(r), [ABSENCE_REASON.NOT_IN_TALENT_BANK], 'internal-only assessment is not in the bank');
  r = await diagnoseTalentBankAbsence({ companyId: cid, q: `Nobody ${tag}` });
  assert.deepEqual(codes(r), [ABSENCE_REASON.NO_MATCH]);
  r = await diagnoseTalentBankAbsence({ companyId: cid, q: tag });
  assert.ok(codes(r).includes(ABSENCE_REASON.HOMONYMS), 'several matches');

  // Pipeline da vaga
  r = await diagnoseVacancyPipelineAbsence({ companyId: cid, q: `Ana ${tag}`, vacancyId: dev });
  assert.deepEqual(codes(r), [ABSENCE_REASON.IN_LIST]);
  assert.equal(r.reasons[0].meta.stage, 'interview');
  r = await diagnoseVacancyPipelineAbsence({ companyId: cid, q: `Ana ${tag}`, vacancyId: dev, filtersActive: true });
  assert.deepEqual(codes(r), [ABSENCE_REASON.SOFT_FILTERS]);

  r = await diagnoseVacancyPipelineAbsence({ companyId: cid, q: `Bruno ${tag}`, vacancyId: dev });
  assert.deepEqual(codes(r), [ABSENCE_REASON.NOT_IN_VACANCY], 'link without stage nor invite is off the board (ranking rule)');
  await db.query(
    "INSERT INTO candidate_invites(vacancy_id,company_id,candidate_id,candidate_name,candidate_email,token) VALUES($1,$2,$3,'Bruno',$4,$5)",
    [dev, cid, bruno, `bruno.${tag}@diag.test`, `tok-${crypto.randomUUID()}`]);
  r = await diagnoseVacancyPipelineAbsence({ companyId: cid, q: `Bruno ${tag}`, vacancyId: dev });
  assert.deepEqual(codes(r), [ABSENCE_REASON.IN_LIST], 'pending invite puts the link on the board');

  r = await diagnoseVacancyPipelineAbsence({ companyId: cid, q: `Carla ${tag}`, vacancyId: dev });
  assert.deepEqual(codes(r), [ABSENCE_REASON.NOT_IN_VACANCY, ABSENCE_REASON.OTHER_VACANCIES]);
  assert.deepEqual(r.reasons[1].meta.titles, ['QA']);

  r = await diagnoseVacancyPipelineAbsence({ companyId: cid, q: `Ana ${tag}`, vacancyId: foreign });
  assert.deepEqual(codes(r), [ABSENCE_REASON.NOT_IN_VACANCY, ABSENCE_REASON.OTHER_VACANCIES], 'another tenant vacancy never matches');
  assert.deepEqual(r.candidates[0].otherVacancyTitles, ['Dev']);

  console.log('help-diagnose lists DTOV: ok');
} finally {
  for (const id of companies) {
    await db.query('DELETE FROM candidate_invites WHERE company_id=$1', [id]);
    await db.query('DELETE FROM assessments WHERE company_id=$1', [id]);
    await db.query('DELETE FROM vacancy_candidates WHERE company_id=$1', [id]);
    await db.query('DELETE FROM vacancies WHERE company_id=$1', [id]);
    await db.query('DELETE FROM candidates WHERE company_id=$1', [id]);
    await db.query('DELETE FROM companies WHERE id=$1', [id]);
  }
  await db.end();
  await poolRead?.end();
  await pool.end();
}
