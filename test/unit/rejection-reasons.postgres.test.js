import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import * as pipeline from '../../lib/pipeline.js';
import { ERR } from '../../lib/api-error-codes.js';

const enabled = process.env.REJECTION_PG_TEST === '1';
test('PostgreSQL: multiple reasons, legacy backfill, history, constraints and atomic rollback', { skip: !enabled }, async () => {
  // Fixed disposable target; never loads credentials or a destination from .env.
  const db = new pg.Client({ host: '127.0.0.1', port: 55488, user: 'postgres', password: 'local-rejection-test', database: 'rejection_validation' });
  await db.connect();
  await db.query('BEGIN');
  try {
    const suffix = Date.now().toString();
    const companyId = (await db.query("INSERT INTO companies(name,slug) VALUES('Rejection test',$1) RETURNING id", [`rejection-${suffix}`])).rows[0].id;
    const areaId = (await db.query("INSERT INTO areas(key,label) VALUES($1,'Test') RETURNING id", [`rejection-${suffix}`])).rows[0].id;
    const vacancyId = (await db.query("INSERT INTO vacancies(company_id,title,slug) VALUES($1,'Test vacancy',$2) RETURNING id", [companyId, suffix])).rows[0].id;
    const candidates = [];
    for (const name of ['Assessed fixture', 'Pending fixture']) {
      const candidateId = (await db.query('INSERT INTO candidates(company_id,full_name) VALUES($1,$2) RETURNING id', [companyId, name])).rows[0].id;
      const linkId = (await db.query("INSERT INTO vacancy_candidates(company_id,vacancy_id,candidate_id,pipeline_stage,rejection_reason) VALUES($1,$2,$3,'rejected','salary') RETURNING id", [companyId, vacancyId, candidateId])).rows[0].id;
      candidates.push({ candidateId, linkId });
    }
    const assessmentId = (await db.query("INSERT INTO assessments(candidate_id,company_id,area_id,top_type,scores,vacancy_id,pipeline_stage,rejection_reason) VALUES($1,$2,$3,1,'{}',$4,'rejected','salary') RETURNING id", [candidates[0].candidateId, companyId, areaId, vacancyId])).rows[0].id;
    const migration = await readFile(new URL('../../migrations/167_multiple_rejection_reasons.sql', import.meta.url), 'utf8');
    await db.query(migration);
    assert.deepEqual((await db.query('SELECT rejection_reasons FROM assessments WHERE id=$1',[assessmentId])).rows[0].rejection_reasons, ['salary']);
    let failHistory = false;
    const query = async (sql, values) => {
      if (failHistory && sql.includes('INSERT INTO') && sql.includes('pipeline_history')) throw new Error('Injected history failure');
      return db.query(sql, values);
    };
    const deps = {
      ...pipeline, localeFromRequest: () => 'pt-BR', ERR, NextResponse: { json: Response.json }, cookies: async () => ({ get: () => ({ value: 'fixture' }) }), COOKIE_NAME: 'session',
      verifySessionWithCapabilities: async () => ({ companyId, userId: null }), canAccessCandidateRecord: () => true, isSuperAdminPayload: () => false,
      CAP: { VACANCIES_MANAGE: 'manage', VACANCIES_VIEW: 'view' }, requireCapability: () => true, sanitizeInterviewNotesHtml: (v) => v,
      query, queryRead: query, withTransaction: async (fn) => { await db.query('SAVEPOINT move'); try { const result=await fn({query}); await db.query('RELEASE SAVEPOINT move'); return result; } catch(e) { await db.query('ROLLBACK TO SAVEPOINT move'); throw e; } },
      apiError: (_, code, status) => Response.json({code},{status}), apiErrorFromResult: (_, result) => Response.json(result,{status:400}),
      resolveRecruitingPipelineStage: async ({ stageKey }) => ({ canonicalKey: stageKey === 'c_rejected' ? 'rejected' : stageKey }),
      audit: async () => {}, auditFromRequest: async () => {}, pipelineStageToFunnelEvent: () => null, scheduleJobFunnelEvent: () => {},
      persistCandidateHire: async () => {}, runCandidateHireEffects: async () => {}, maybeCloseVacancyIfFilled: async () => {}, notifyHireOnboardingKit: async () => {},
    };
    const route = async (file) => {
      const context = vm.createContext({ console: {error:()=>{}}, Response });
      const mod = new vm.SourceTextModule(await readFile(new URL(`../../${file}`,import.meta.url),'utf8'),{context});
      await mod.link(()=>new vm.SyntheticModule(Object.keys(deps),function(){for(const[k,v]of Object.entries(deps))this.setExport(k,v);},{context}));
      await mod.evaluate(); return mod.namespace;
    };
    for (const [file, params, table, id, historyTable, foreignKey] of [
      ['app/api/admin/assessments/[id]/route.js',{id:assessmentId},'assessments',assessmentId,'assessment_pipeline_history','assessment_id'],
      ['app/api/admin/vacancies/[id]/candidates/[candidateId]/route.js',{id:vacancyId,candidateId:candidates[1].candidateId},'vacancy_candidates',candidates[1].linkId,'vacancy_candidate_pipeline_history','vacancy_candidate_id'],
    ]) {
      const api = await route(file);
      const move = (body) => api.PATCH({json:async()=>body},{params});
      let res = await move({pipelineStage:'c_rejected',rejectionReasons:['salary','skill_gap']});
      assert.equal(res.status,200); assert.deepEqual((await res.json()).rejectionReasons,['salary','skill_gap']);
      await db.query(migration); // Reapplying never collapses a multi-reason record.
      assert.deepEqual((await db.query(`SELECT ${pipeline.rejectionReasonsSql('r')} AS reasons FROM ${table} r WHERE id=$1`,[id])).rows[0].reasons,['salary','skill_gap']);
      assert.deepEqual((await db.query(`SELECT rejection_reasons FROM ${historyTable} WHERE ${foreignKey}=$1 ORDER BY id DESC LIMIT 1`,[id])).rows[0].rejection_reasons,['salary','skill_gap']);
      failHistory=true;
      assert.equal((await move({pipelineStage:'interview'})).status,500);
      assert.equal((await db.query(`SELECT pipeline_stage FROM ${table} WHERE id=$1`,[id])).rows[0].pipeline_stage,'c_rejected');
      failHistory=false;
      assert.equal((await move({pipelineStage:'interview'})).status,200);
      assert.deepEqual((await db.query(`SELECT rejection_reason,rejection_reasons FROM ${table} WHERE id=$1`,[id])).rows[0],{rejection_reason:null,rejection_reasons:[]});
      assert.equal((await move({pipelineStage:'rejected',rejectionReason:'experience'})).status,200);
      assert.deepEqual((await db.query(`SELECT rejection_reasons FROM ${table} WHERE id=$1`,[id])).rows[0].rejection_reasons,['experience']);
    }
    const detailApi = await route('app/api/admin/vacancies/[id]/candidates/[candidateId]/route.js');
    for (const person of candidates) {
      const response = await detailApi.GET({}, {params:{id:vacancyId,candidateId:person.candidateId}});
      assert.equal(response.status,200);
      const data=await response.json();
      assert.equal(String(data.companyId),String(companyId));
      assert.ok(data.history.length > 0);
    }
    // Imported assessments can predate vacancy_candidates links.
    await db.query('DELETE FROM vacancy_candidates WHERE id=$1',[candidates[0].linkId]);
    assert.equal((await detailApi.GET({}, {params:{id:vacancyId,candidateId:candidates[0].candidateId}})).status,200);
    const unlinkedId=(await db.query("INSERT INTO candidates(company_id,full_name) VALUES($1,'Unlinked fixture') RETURNING id",[companyId])).rows[0].id;
    assert.equal((await detailApi.GET({}, {params:{id:vacancyId,candidateId:unlinkedId}})).status,404);
    const otherCompany=(await db.query("INSERT INTO companies(name,slug) VALUES('Other company',$1) RETURNING id",[`other-${suffix}`])).rows[0].id;
    const otherPerson=(await db.query("INSERT INTO candidates(company_id,full_name) VALUES($1,'Other tenant fixture') RETURNING id",[otherCompany])).rows[0].id;
    assert.equal((await detailApi.GET({}, {params:{id:vacancyId,candidateId:otherPerson}})).status,404);
    await db.query('SAVEPOINT invalid');
    await assert.rejects(db.query("UPDATE assessments SET rejection_reasons=ARRAY['invented'] WHERE id=$1",[assessmentId]),{code:'23514'});
    await db.query('ROLLBACK TO SAVEPOINT invalid');
    // Read compatibility with an old server changing or clearing the legacy reason.
    await db.query("UPDATE assessments SET rejection_reason='salary' WHERE id=$1",[assessmentId]);
    assert.deepEqual((await db.query(`SELECT ${pipeline.rejectionReasonsSql('a')} AS reasons FROM assessments a WHERE id=$1`,[assessmentId])).rows[0].reasons,['salary']);
    await db.query('UPDATE assessments SET rejection_reason=NULL WHERE id=$1',[assessmentId]);
    assert.deepEqual((await db.query(`SELECT ${pipeline.rejectionReasonsSql('a')} AS reasons FROM assessments a WHERE id=$1`,[assessmentId])).rows[0].reasons,[]);
    const counts = await db.query(`SELECT r.reason,COUNT(*)::int AS n FROM assessment_pipeline_history h CROSS JOIN LATERAL unnest(${pipeline.rejectionReasonsSql('h','reason')}) r(reason) WHERE h.assessment_id=$1 GROUP BY 1`,[assessmentId]);
    assert.equal(counts.rows.find(r=>r.reason==='skill_gap').n,1);
  } finally { await db.query('ROLLBACK'); await db.end(); }
});
