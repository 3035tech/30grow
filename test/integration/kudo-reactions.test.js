/** Synthetic records in the local DTOV database only. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dtovEnv, assertDtovTarget } from '../dtov/harness.js';
assert.equal(process.env.KUDO_REACTIONS_TEST, '1');
const env = dtovEnv(); assertDtovTarget(env); Object.assign(process.env, env);
const { pool } = await import('../../lib/db.js');
const { createCompanyKudo, listCompanyKudos } = await import('../../lib/company-kudos.js');
const { setKudoReaction, listKudoReactors } = await import('../../lib/company-kudo-reactions.js');
const { ERR } = await import('../../lib/api-error-codes.js');
const companies = [];
const one = async (sql, params) => (await pool.query(sql, params)).rows[0];
try {
  for (const tag of ['A', 'B']) companies.push((await one('INSERT INTO companies(name,slug) VALUES($1,$2) RETURNING id', ['Synthetic reactions '+tag,'reactions-'+randomUUID()])).id);
  const [companyId, foreignCompanyId] = companies;
  const people = [];
  for (const [index,cid] of [companyId,companyId,foreignCompanyId].entries()) people.push((await one("INSERT INTO candidates(company_id,full_name,email,employment_status) VALUES($1,$2,$3,'employee') RETURNING id", [cid,'Synthetic colleague '+index,randomUUID()+'@example.test'])).id);
  const [authorId,recipientId,foreignId] = people;
  const original = await createCompanyKudo(null,{companyId,fromCandidateId:authorId,toCandidateId:recipientId,message:'Existing recognition stays intact'});
  assert.equal(original.ok,true);
  const kudoId = original.kudo.id;
  const scope = {companyId,kudoId,candidateId:authorId};
  await test('migration reapplies without changing existing recognition', async()=>{
    const sql = await readFile(new URL('../../migrations/171_company_kudo_reactions.sql',import.meta.url),'utf8');
    await pool.query(sql);await pool.query(sql);
    assert.equal((await one('SELECT message FROM company_kudos WHERE id=$1',[kudoId])).message,original.kudo.message);
  });
  await test('author and recipient react; concurrent requests leave one reaction per employee',async()=>{
    await Promise.all(['👍','❤️','👏','🎉','🙌'].map(emoji=>setKudoReaction({...scope,emoji})));
    assert.equal((await one('SELECT count(*)::int AS n FROM company_kudo_reactions WHERE kudo_id=$1',[kudoId])).n,1);
    assert.equal((await setKudoReaction({...scope,emoji:'❤️'})).ok,true);
    assert.equal((await setKudoReaction({...scope,candidateId:recipientId,emoji:'❤️'})).ok,true);
    const feed=await listCompanyKudos(null,{companyId,viewerCandidateId:authorId});
    const row=feed.kudos.find(k=>k.id===kudoId);assert.deepEqual(row.reactions,[{emoji:'❤️',count:2,mine:true}]);
    const list=await listKudoReactors(scope);assert.equal(list.people.length,2);assert.equal(list.hasMore,false);assert.ok(list.people.every(p=>!('email' in p)&&!('candidateId' in p)));
  });
  await test('PUT and DELETE retries are idempotent; changing reaction replaces the old emoji',async()=>{
    for(let i=0;i<2;i++)await setKudoReaction({...scope,emoji:'👏'});
    let result=await setKudoReaction({...scope,emoji:'👏'});assert.equal(result.reactions.find(r=>r.emoji==='👏').count,1);assert.equal(result.reactions.find(r=>r.emoji==='❤️').count,1);
    for(let i=0;i<2;i++)assert.equal((await setKudoReaction({...scope,emoji:null})).ok,true);
    result=await setKudoReaction({...scope,emoji:null});assert.ok(result.reactions.every(r=>!r.mine));
  });
  await test('expanded migration preserves existing reactions, reapplies, and accepts the full fixed catalog', async()=>{
    const { KUDO_REACTION_EMOJIS, KUDO_QUICK_REACTION_EMOJIS } = await import('../../lib/kudo-reaction-options.js');
    await setKudoReaction({...scope,emoji:'👏'});
    const before=await one('SELECT emoji,updated_at FROM company_kudo_reactions WHERE company_id=$1 AND kudo_id=$2 AND candidate_id=$3',[companyId,kudoId,authorId]);
    const sql=await readFile(new URL('../../migrations/173_expanded_kudo_reactions.sql',import.meta.url),'utf8');
    await pool.query(sql);await pool.query(sql);
    assert.deepEqual(await one('SELECT emoji,updated_at FROM company_kudo_reactions WHERE company_id=$1 AND kudo_id=$2 AND candidate_id=$3',[companyId,kudoId,authorId]),before);
    for(const emoji of KUDO_REACTION_EMOJIS)assert.equal((await setKudoReaction({...scope,emoji})).ok,true);
    assert.equal((await one('SELECT count(*)::int AS n FROM company_kudo_reactions WHERE kudo_id=$1 AND candidate_id=$2',[kudoId,authorId])).n,1);
    await setKudoReaction({...scope,emoji:'🚀'});
    const legacy=await listKudoReactors({...scope,allowedEmojis:KUDO_QUICK_REACTION_EMOJIS});
    assert.ok(legacy.people.every(person=>KUDO_QUICK_REACTION_EMOJIS.includes(person.emoji)));
    assert.ok((await listKudoReactors(scope)).people.some(person=>person.emoji==='🚀'));
  });
  await test('foreign company, foreign employee, invalid emoji and direct cross-tenant inserts are rejected',async()=>{
    assert.equal((await setKudoReaction({...scope,companyId:foreignCompanyId,candidateId:foreignId,emoji:'👍'})).errorCode,ERR.NOT_FOUND);
    assert.equal((await listKudoReactors({...scope,companyId:foreignCompanyId})).errorCode,ERR.NOT_FOUND);
    assert.equal((await setKudoReaction({...scope,candidateId:foreignId,emoji:'👍'})).errorCode,ERR.FORBIDDEN);
    assert.equal((await setKudoReaction({...scope,emoji:'<script>'})).errorCode,ERR.INVALID_DATA);
    await assert.rejects(pool.query("INSERT INTO company_kudo_reactions(company_id,kudo_id,candidate_id,emoji) VALUES($1,$2,$3,'👍')",[companyId,kudoId,foreignId]),{code:'23503'});
    await assert.rejects(pool.query("INSERT INTO company_kudo_reactions(company_id,kudo_id,candidate_id,emoji) VALUES($1,$2,$3,'bad')",[companyId,kudoId,authorId]),{code:'23514'});
  });
  await test('former employees cannot react and moderated kudos no longer expose reactions',async()=>{
    await pool.query("UPDATE candidates SET employment_status='candidate' WHERE id=$1",[authorId]);
    assert.equal((await setKudoReaction({...scope,emoji:'👍'})).errorCode,ERR.FORBIDDEN);
    await pool.query('UPDATE company_kudos SET deleted=true WHERE id=$1',[kudoId]);
    assert.equal((await setKudoReaction({...scope,candidateId:recipientId,emoji:'👍'})).errorCode,ERR.NOT_FOUND);
    assert.equal((await listKudoReactors(scope)).errorCode,ERR.NOT_FOUND);
    assert.equal((await listCompanyKudos(null,{companyId})).kudos.length,0);
  });
} finally {
  try {
    for(const id of companies){
      await pool.query('DELETE FROM time_clock_person_history WHERE company_id=$1',[id]);
      await pool.query('DELETE FROM companies WHERE id=$1',[id]);
    }
  } finally { await pool.end(); }
}
