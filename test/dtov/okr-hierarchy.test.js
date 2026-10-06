// Local DTOV only; all fixture records and migration replay are rolled back.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import crypto from 'node:crypto';
import pg from 'pg';
import { saveAreaObjective, saveAreaKeyResult, recordKeyResultCheckin, listKeyResultCheckins, listOkrHierarchy, listAssignedKeyResults, deleteAreaOkrEntity } from '../../lib/okr-hierarchy.js';
import { createOkrArea, deleteOkrArea, deleteOkrCycle, updateOkrArea, updateOkrCycle } from '../../lib/okr-cycles.js';
import { createOkrKeyResult, updateOkrKeyResultProgress, deleteOkrObjective } from '../../lib/okr.js';
import { ERR } from '../../lib/api-error-codes.js';

const db=new pg.Client({host:'127.0.0.1',port:55432,database:'enneagram_dtov',user:'dtov',password:'dtov_local_only',ssl:false});
await db.connect();
try {
  await db.query('BEGIN');
  const before=(await db.query('SELECT (SELECT count(*) FROM okr_activities) AS activities,(SELECT count(*) FROM okr_objectives) AS objectives')).rows[0];
  await db.query(await readFile(new URL('../../migrations/133_okr_area_objectives.sql',import.meta.url),'utf8'));
  await db.query(await readFile(new URL('../../migrations/136_okr_key_result_notes.sql',import.meta.url),'utf8'));
  assert.deepEqual((await db.query('SELECT (SELECT count(*) FROM okr_activities) AS activities,(SELECT count(*) FROM okr_objectives) AS objectives')).rows[0],before);
  const companyId=Number((await db.query("INSERT INTO companies(name,slug) VALUES('OKR test',$1) RETURNING id",[`okr-${crypto.randomUUID()}`])).rows[0].id);
  const otherCompanyId=Number((await db.query("INSERT INTO companies(name,slug) VALUES('Other OKR test',$1) RETURNING id",[`okr-${crypto.randomUUID()}`])).rows[0].id);
  const candidateId=Number((await db.query("INSERT INTO candidates(company_id,full_name,employment_status) VALUES($1,'Owner','employee') RETURNING id",[companyId])).rows[0].id);
  const unassignedId=Number((await db.query("INSERT INTO candidates(company_id,full_name,employment_status) VALUES($1,'Unassigned','employee') RETURNING id",[companyId])).rows[0].id);
  const foreignId=Number((await db.query("INSERT INTO candidates(company_id,full_name,employment_status) VALUES($1,'Foreign','employee') RETURNING id",[otherCompanyId])).rows[0].id);
  const userId=Number((await db.query('SELECT id FROM users ORDER BY id LIMIT 1')).rows[0].id);
  const cycleId=Number((await db.query("INSERT INTO okr_cycles(company_id,title,starts_on,ends_on) VALUES($1,'Cycle','2026-01-01','2026-12-31') RETURNING id",[companyId])).rows[0].id);
  const area=(await createOkrArea(db,{companyId,cycleId,title:'Sales'})).area;
  assert.ok(area);
  const renamed=await updateOkrArea(db,{companyId,areaId:area.id,title:'  Commercial  '});
  assert.equal(renamed.ok,true);
  assert.equal(renamed.area.title,'Commercial');
  assert.equal((await updateOkrArea(db,{companyId:otherCompanyId,areaId:area.id,title:'Intrusion'})).errorCode,ERR.NOT_FOUND);
  assert.equal((await updateOkrArea(db,{companyId,areaId:area.id,title:'   '})).errorCode,ERR.INVALID_DATA);
  const objectiveResult=await saveAreaObjective(db,{companyId,areaId:area.id,title:'Grow sales',ownerCandidateId:candidateId,periodEnd:'2026-12-01',userId});
  assert.equal(objectiveResult.ok,true);
  const objectiveId=objectiveResult.objective.id;
  const base={companyId,objectiveId,title:'Reduce sales cycle',unit:'days',startValue:10,targetValue:5,weight:2,deadline:'2026-11-01',assigneeIds:[candidateId],userId};
  const created=await saveAreaKeyResult(db,{...base,notes:'  Source: CRM  '});
  assert.equal(created.ok,true);
  const keyResultId=created.keyResult.id;
  assert.equal(created.keyResult.notes,'Source: CRM');
  assert.equal((await saveAreaKeyResult(db,{...base,keyResultId,notes:'x'.repeat(2001)})).errorCode,ERR.INVALID_DATA);
  assert.equal((await saveAreaKeyResult(db,{...base,keyResultId,notes:`<p>${'y'.repeat(2001)}</p>`})).errorCode,ERR.INVALID_DATA);
  const rich=await saveAreaObjective(db,{companyId,objectiveId,title:'Grow sales',description:'<p onclick="x()">Why <strong>now</strong></p><script>alert(1)</script>',ownerCandidateId:candidateId,periodEnd:'2026-12-01',userId});
  assert.equal(rich.objective.description,'<p>Why <strong>now</strong></p>');
  assert.equal((await saveAreaObjective(db,{companyId,objectiveId,title:'Grow sales',description:'<p><br></p>',ownerCandidateId:candidateId,periodEnd:'2026-12-01',userId})).objective.description,'');
  assert.equal(created.keyResult.progressPct,0);
  assert.equal((await saveAreaKeyResult(db,{...base,assigneeIds:[foreignId]})).ok,false);
  assert.equal((await saveAreaKeyResult(db,{...base,targetValue:10})).ok,false);
  assert.equal((await saveAreaKeyResult(db,{...base,deadline:'2026-12-20'})).ok,false);
  assert.equal((await saveAreaObjective(db,{companyId:otherCompanyId,areaId:area.id,title:'Intrusion',periodEnd:'2026-12-01',userId})).ok,false);
  assert.equal((await recordKeyResultCheckin(db,{companyId,keyResultId,candidateId:unassignedId,currentValue:7.5})).errorCode,ERR.FORBIDDEN);
  assert.equal((await recordKeyResultCheckin(db,{companyId:otherCompanyId,keyResultId,candidateId:foreignId,currentValue:7.5})).ok,false);
  const checked=await recordKeyResultCheckin(db,{companyId,keyResultId,candidateId,currentValue:7.5,note:'Faster'});
  assert.equal(checked.keyResult.progressPct,50);
  const hierarchy=await listOkrHierarchy(db,{companyId});
  assert.equal(hierarchy.cycle.areas[0].title,'Commercial');
  assert.equal(hierarchy.cycle.areas[0].objectives[0].keyResults[0].currentValue,7.5);
  assert.equal(hierarchy.cycle.progressPct,50);
  assert.equal((await listAssignedKeyResults(db,{companyId,candidateId}))[0].objectiveTitle,'Grow sales');
  assert.equal((await listAssignedKeyResults(db,{companyId,candidateId:unassignedId})).length,0);
  assert.equal((await saveAreaObjective(db,{companyId,objectiveId,title:'Grow sales',periodEnd:'2026-10-01',userId})).ok,false);
  assert.equal((await updateOkrCycle(db,{companyId,cycleId,endsOn:'2026-10-01'})).ok,false);
  const edited=await saveAreaKeyResult(db,{...base,keyResultId,targetValue:0});
  assert.equal(edited.keyResult.notes,'Source: CRM');
  assert.equal(edited.keyResult.currentValue,7.5);
  assert.equal(edited.keyResult.progressPct,25);
  const history=(await listKeyResultCheckins(db,{companyId,keyResultId})).items;
  assert.equal(history.length,3);
  assert.equal(history[0].eventKind,'configuration');
  assert.equal(history[1].targetValue,5);
  assert.equal(history[1].progressPct,50);
  assert.equal(history[1].actorName,'Owner');
  // The legacy API must not bypass new-model rules or overwrite measured KRs.
  assert.equal((await createOkrKeyResult(db,{companyId,objectiveId,title:'Bypass'})).ok,false);
  assert.equal((await updateOkrKeyResultProgress(db,{companyId,keyResultId,currentValue:999})).ok,false);
  assert.equal((await deleteOkrObjective(db,{companyId,objectiveId})).ok,false);
  await db.query('SAVEPOINT foreign_fk');
  await assert.rejects(db.query('INSERT INTO okr_key_result_assignees(company_id,key_result_id,candidate_id) VALUES($1,$2,$3)',[companyId,keyResultId,foreignId]),e=>e.code==='23503');
  await db.query('ROLLBACK TO SAVEPOINT foreign_fk');
  assert.equal((await saveAreaKeyResult(db,{...base,keyResultId,targetValue:0,notes:''})).keyResult.notes,'');
  assert.equal((await updateOkrCycle(db,{companyId,cycleId,status:'closed'})).ok,true);
  for(const result of [
    await recordKeyResultCheckin(db,{companyId,keyResultId,candidateId,currentValue:1}),
    await saveAreaKeyResult(db,{...base,keyResultId}),
    await deleteAreaOkrEntity(db,{companyId,id:objectiveId,kind:'objective'}),
    await createOkrArea(db,{companyId,cycleId,title:'No'}),
    await updateOkrArea(db,{companyId,areaId:area.id,title:'No'}),
    await deleteOkrArea(db,{companyId,areaId:area.id}),
    await deleteOkrCycle(db,{companyId,cycleId}),
  ]) assert.equal(result.ok,false);
  assert.equal((await listKeyResultCheckins(db,{companyId,keyResultId})).items.length,4);
  await updateOkrCycle(db,{companyId,cycleId,status:'active'});
  assert.equal((await deleteAreaOkrEntity(db,{companyId,id:objectiveId,kind:'objective'})).ok,true);
  assert.equal((await db.query('SELECT 1 FROM okr_key_result_checkins WHERE key_result_id=$1',[keyResultId])).rowCount,0);
  console.log('PASS migration replay/preservation, hierarchy CRUD, area rename, key result notes, rich text sanitization, metrics, snapshots, tenant FKs, assignee authorization, legacy guards, closed cycles and cascade deletion');
} finally { await db.query('ROLLBACK'); await db.end(); }
