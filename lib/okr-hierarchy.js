import { asDb } from './ae/as-db.js';
import { withTransaction } from './db.js';
import { ERR } from './api-error-codes.js';
import { listOkrCycles, activityUrgency } from './okr-cycles.js';
import { keyResultProgress, okrRollup } from './okr-metrics.js';
import { htmlToPlainText, sanitizeRichTextHtml } from './sanitize-html.js';

const fail = code => { const error = new Error(code); error.okrCode = code; throw error; };
const day = value => value instanceof Date ? value.toISOString().slice(0, 10) : value ? String(value).slice(0, 10) : null;
const numeric = new Set(['id','companyId','areaId','objectiveId','ownerCandidateId','candidateId','keyResultId','cycleId','startValue','targetValue','currentValue','weight','progressPct']);
function map(row) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => {
    const name = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    return [name, numeric.has(name) && value != null ? Number(value) : ['deadline','periodStart','periodEnd','startsOn','endsOn'].includes(name) ? day(value) : value];
  }));
}
function kr(row) {
  const item = map(row);
  item.progressPct = keyResultProgress(item.startValue, item.targetValue, item.currentValue);
  item.urgency = activityUrgency(item);
  return item;
}
function amount(value) {
  if (value === '' || value == null || !Number.isFinite(Number(value)) || Math.abs(Number(value)) > 999999999999.99) fail(ERR.INVALID_DATA);
  return Math.round(Number(value) * 100) / 100;
}
function text(value, max, required = true) {
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) fail(ERR.INVALID_DATA);
  return value.trim();
}
export const OKR_RICH_TEXT_MAX = 2000;
export const OKR_RICH_HTML_MAX = 8000;
function richText(value) {
  if (typeof value !== 'string' || value.length > OKR_RICH_HTML_MAX) fail(ERR.INVALID_DATA);
  const html = sanitizeRichTextHtml(value, OKR_RICH_HTML_MAX) || '';
  if (htmlToPlainText(html).length > OKR_RICH_TEXT_MAX) fail(ERR.INVALID_DATA);
  return htmlToPlainText(html) ? html : '';
}
async function transaction(db, work) {
  try { return db ? await work(asDb(db)) : await withTransaction(work); }
  catch (error) { if (error.okrCode) return { ok: false, errorCode: error.okrCode }; throw error; }
}

// Cycle first: serialized against close/delete, then lock the actual KR/objective.
async function scope(db, companyId, kind, id, write = true) {
  if (!Number.isSafeInteger(Number(id)) || Number(id) <= 0) fail(ERR.INVALID_ID);
  const joins = kind === 'area' ? '' : `JOIN okr_objectives o ON o.area_id=a.id AND o.company_id=a.company_id ${kind === 'kr' ? 'JOIN okr_key_results k ON k.objective_id=o.id AND k.company_id=o.company_id' : ''}`;
  const alias = kind === 'area' ? 'a' : kind === 'kr' ? 'k' : 'o';
  const row = (await db.query(`SELECT c.id FROM okr_cycles c JOIN okr_areas a ON a.cycle_id=c.id AND a.company_id=c.company_id ${joins} WHERE ${alias}.id=$2 AND c.company_id=$1`, [companyId,id])).rows[0];
  if (!row) fail(ERR.NOT_FOUND);
  const cycle = (await db.query(`SELECT * FROM okr_cycles WHERE company_id=$1 AND id=$2 ${write ? 'FOR UPDATE' : ''}`, [companyId,row.id])).rows[0];
  if (!cycle) fail(ERR.NOT_FOUND);
  if (write && cycle.status === 'closed') fail(ERR.INVALID_ACTION);
  return cycle;
}
async function person(db, companyId, candidateId) {
  if (candidateId == null) return null;
  if (!Number.isSafeInteger(Number(candidateId)) || Number(candidateId) <= 0) fail(ERR.INVALID_DATA);
  const r = await db.query("SELECT id FROM candidates WHERE company_id=$1 AND id=$2 AND employment_status='employee'", [companyId,candidateId]);
  if (!r.rowCount) fail(ERR.INVALID_DATA);
  return Number(candidateId);
}
function deadline(value, cycle) {
  const parsed = day(value || cycle.ends_on);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(parsed || '') || Number.isNaN(Date.parse(parsed)) || new Date(parsed).toISOString().slice(0,10) !== parsed || parsed < day(cycle.starts_on) || parsed > day(cycle.ends_on)) fail(ERR.INVALID_DATA);
  return parsed;
}

export const OKR_OBJECTIVE_CAP_PER_AREA = 40;
export const OKR_KR_CAP_PER_OBJECTIVE = 8;
export const OKR_KR_ASSIGNEE_CAP = 20;

function groupBy(items, key) {
  const groups = new Map();
  for (const item of items) {
    const list = groups.get(item[key]);
    if (list) list.push(item); else groups.set(item[key], [item]);
  }
  return groups;
}

// Reads use the same caps as the write checks below, so rows written outside them (legacy
// API, imports) can't inflate the payload. KRs and owners are scoped by area, so each read is
// independent of the previous result.
// Returns every cycle as a header (selector) plus the full tree of one cycle: `cycleId`
// when it is in the list, otherwise the latest.
export async function listOkrHierarchy(dbOrQuery, { companyId, cycleId = null }) {
  const db = asDb(dbOrQuery);
  const listed = await listOkrCycles(db, { companyId, withActivityDetails: false, onlyCycleId: cycleId ?? 'latest' });
  if (!listed.ok) return listed;
  const headers = listed.cycles.map(({ id, title, startsOn, endsOn, status }) => ({ id, title, startsOn, endsOn, status }));
  const cycle = listed.cycles.find(c => c.id === listed.selectedCycleId) || null;
  if (!cycle) return { ok: true, cap: listed.cap, cycles: headers, cycle: null };
  const areas = cycle.areas;
  const ids = areas.map(a => a.id);
  const empty = { rows: [] };
  const objectiveRows = ids.length ? await db.query(`SELECT o.*,p.full_name AS owner_name FROM (SELECT o.*,ROW_NUMBER() OVER (PARTITION BY o.area_id ORDER BY o.id) AS rn FROM okr_objectives o WHERE o.company_id=$1 AND o.area_id=ANY($2::bigint[])) o LEFT JOIN candidates p ON p.id=o.owner_candidate_id AND p.company_id=o.company_id WHERE o.rn<=$3 ORDER BY o.id`, [companyId,ids,OKR_OBJECTIVE_CAP_PER_AREA]) : empty;
  const krRows = ids.length ? await db.query(`SELECT k.* FROM (SELECT k.*,ROW_NUMBER() OVER (PARTITION BY k.objective_id ORDER BY k.sort_order,k.id) AS rn FROM okr_key_results k JOIN okr_objectives o ON o.id=k.objective_id AND o.company_id=k.company_id WHERE k.company_id=$1 AND o.area_id=ANY($2::bigint[])) k WHERE k.rn<=$3 ORDER BY k.sort_order,k.id`, [companyId,ids,OKR_KR_CAP_PER_OBJECTIVE]) : empty;
  const assigneeRows = ids.length ? await db.query(`SELECT key_result_id,candidate_id,full_name FROM (SELECT a.key_result_id,a.candidate_id,p.full_name,ROW_NUMBER() OVER (PARTITION BY a.key_result_id ORDER BY p.full_name,a.candidate_id) AS rn FROM okr_key_result_assignees a JOIN okr_key_results k ON k.id=a.key_result_id AND k.company_id=a.company_id JOIN okr_objectives o ON o.id=k.objective_id AND o.company_id=k.company_id JOIN candidates p ON p.id=a.candidate_id AND p.company_id=a.company_id WHERE a.company_id=$1 AND o.area_id=ANY($2::bigint[])) s WHERE s.rn<=$3 ORDER BY full_name,candidate_id`, [companyId,ids,OKR_KR_ASSIGNEE_CAP]) : empty;
  const objectives = objectiveRows.rows.map(({ rn, ...row }) => map(row));
  const results = krRows.rows.map(({ rn, ...row }) => kr(row));
  const assigneesByKr = groupBy(assigneeRows.rows.map(map), 'keyResultId');
  for (const k of results) k.assignees = assigneesByKr.get(k.id) || [];
  const krsByObjective = groupBy(results, 'objectiveId');
  for (const o of objectives) { o.keyResults = krsByObjective.get(o.id) || []; o.progressPct = okrRollup(o.keyResults, true); }
  const objectivesByArea = groupBy(objectives, 'areaId');
  for (const area of areas) { area.objectives = objectivesByArea.get(area.id) || []; area.legacyProgressPct = area.progressPct; area.progressPct = okrRollup(area.objectives); }
  cycle.legacyProgressPct = cycle.progressPct;
  cycle.progressPct = okrRollup(cycle.areas);
  return { ok: true, cap: listed.cap, cycles: headers, cycle };
}

export async function saveAreaObjective(db, input) {
  return transaction(db, async client => {
    const { companyId, objectiveId, areaId } = input;
    const cycle = await scope(client, companyId, objectiveId ? 'objective' : 'area', objectiveId || areaId);
    const title = text(input.title,300), description = richText(input.description ?? '');
    const owner = await person(client,companyId,input.ownerCandidateId);
    const end = deadline(input.periodEnd,cycle);
    if (objectiveId && (await client.query('SELECT 1 FROM okr_key_results WHERE company_id=$1 AND objective_id=$2 AND deadline>$3 LIMIT 1',[companyId,objectiveId,end])).rowCount) fail(ERR.INVALID_DATA);
    if (!objectiveId) {
      const count = await client.query('SELECT count(*)::int AS n FROM okr_objectives WHERE company_id=$1 AND area_id=$2',[companyId,areaId]);
      if (count.rows[0].n >= OKR_OBJECTIVE_CAP_PER_AREA) fail(ERR.INVALID_DATA);
    }
    const result = objectiveId
      ? await client.query(`UPDATE okr_objectives SET title=$3,description=$4,owner_candidate_id=$5,period_end=$6,updated_at=NOW() WHERE company_id=$1 AND id=$2 RETURNING *`,[companyId,objectiveId,title,description,owner,end])
      : await client.query(`INSERT INTO okr_objectives(company_id,area_id,title,description,owner_candidate_id,period_start,period_end,created_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[companyId,areaId,title,description,owner,day(cycle.starts_on),end,input.userId]);
    if (!result.rowCount) fail(ERR.NOT_FOUND);
    return { ok:true, objective:map(result.rows[0]) };
  });
}

async function snapshot(db,input,row,kind) {
  const item = kr(row);
  await db.query(`INSERT INTO okr_key_result_checkins(company_id,key_result_id,event_kind,start_value,target_value,current_value,unit,progress_pct,note,created_by_user_id,created_by_candidate_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[input.companyId,item.id,kind,item.startValue,item.targetValue,item.currentValue,item.unit,item.progressPct,text(input.note ?? '',500,false),input.userId || null,input.candidateId || null]);
}
export async function saveAreaKeyResult(db,input) {
  return transaction(db,async client => {
    const { companyId,keyResultId,objectiveId } = input;
    const cycle = await scope(client,companyId,keyResultId ? 'kr' : 'objective',keyResultId || objectiveId);
    const title = text(input.title,300), unit = text(input.unit,40), newNotes = input.notes === undefined ? null : richText(input.notes);
    text(input.note ?? '',500,false);
    const start = amount(input.startValue), target = amount(input.targetValue);
    if (start === target) fail(ERR.INVALID_DATA);
    const weight = Number(input.weight ?? 1);
    if (!Number.isInteger(weight) || weight<0 || weight>10) fail(ERR.INVALID_DATA);
    if (!Array.isArray(input.assigneeIds) || !input.assigneeIds.length || input.assigneeIds.length>OKR_KR_ASSIGNEE_CAP) fail(ERR.INVALID_DATA);
    const assignees = [...new Set(input.assigneeIds.map(Number))];
    for (const id of assignees) await person(client,companyId,id);
    const old = keyResultId ? (await client.query('SELECT * FROM okr_key_results WHERE company_id=$1 AND id=$2 FOR UPDATE',[companyId,keyResultId])).rows[0] : null;
    if (keyResultId && !old) fail(ERR.NOT_FOUND);
    const oid = old?.objective_id || objectiveId;
    const objective = (await client.query('SELECT period_end FROM okr_objectives WHERE company_id=$1 AND id=$2',[companyId,oid])).rows[0];
    const due = deadline(input.deadline || objective.period_end,cycle);
    if (objective.period_end && due>day(objective.period_end)) fail(ERR.INVALID_DATA);
    const current = old ? Number(old.current_value) : start;
    const notes = newNotes ?? old?.notes ?? '';
    if (!keyResultId) {
      const count = await client.query('SELECT count(*)::int AS n FROM okr_key_results WHERE company_id=$1 AND objective_id=$2',[companyId,oid]);
      if (count.rows[0].n>=OKR_KR_CAP_PER_OBJECTIVE) fail(ERR.INVALID_DATA);
    }
    const result = old
      ? await client.query('UPDATE okr_key_results SET title=$3,unit=$4,start_value=$5,target_value=$6,weight=$7,deadline=$8,notes=$9,updated_at=NOW() WHERE company_id=$1 AND id=$2 RETURNING *',[companyId,keyResultId,title,unit,start,target,weight,due,notes])
      : await client.query('INSERT INTO okr_key_results(company_id,objective_id,title,unit,start_value,target_value,current_value,weight,deadline,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',[companyId,oid,title,unit,start,target,current,weight,due,notes]);
    const row = result.rows[0];
    await client.query('DELETE FROM okr_key_result_assignees WHERE company_id=$1 AND key_result_id=$2',[companyId,row.id]);
    for (const id of assignees) await client.query('INSERT INTO okr_key_result_assignees(company_id,key_result_id,candidate_id) VALUES($1,$2,$3)',[companyId,row.id,id]);
    await snapshot(client,input,row,old ? 'configuration' : 'created');
    return { ok:true,keyResult:kr(row) };
  });
}

export async function recordKeyResultCheckin(db,input) {
  return transaction(db,async client => {
    const { companyId,keyResultId,candidateId } = input;
    await scope(client,companyId,'kr',keyResultId);
    if (candidateId) {
      await person(client,companyId,candidateId);
      const link = await client.query('SELECT 1 FROM okr_key_result_assignees WHERE company_id=$1 AND key_result_id=$2 AND candidate_id=$3',[companyId,keyResultId,candidateId]);
      if (!link.rowCount) fail(ERR.FORBIDDEN);
    }
    if (!input.userId && !candidateId) fail(ERR.UNAUTHORIZED);
    const current = amount(input.currentValue);
    text(input.note ?? '',500,false);
    const row = (await client.query('UPDATE okr_key_results SET current_value=$3,updated_at=NOW() WHERE company_id=$1 AND id=$2 AND start_value IS NOT NULL RETURNING *',[companyId,keyResultId,current])).rows[0];
    if (!row) fail(ERR.NOT_FOUND);
    await snapshot(client,input,row,'checkin');
    return { ok:true,keyResult:kr(row) };
  });
}

export async function listKeyResultCheckins(dbOrQuery,{ companyId,keyResultId }) {
  const db=asDb(dbOrQuery);
  try { await scope(db,companyId,'kr',keyResultId,false); }
  catch (error) { if(error.okrCode) return {ok:false,errorCode:error.okrCode}; throw error; }
  const rows=await db.query(`SELECT h.*,COALESCE(NULLIF(BTRIM(u.display_name),''),u.email,p.full_name) AS actor_name FROM okr_key_result_checkins h LEFT JOIN users u ON u.id=h.created_by_user_id LEFT JOIN candidates p ON p.id=h.created_by_candidate_id AND p.company_id=h.company_id WHERE h.company_id=$1 AND h.key_result_id=$2 ORDER BY h.created_at DESC,h.id DESC LIMIT 40`,[companyId,keyResultId]);
  return {ok:true,items:rows.rows.map(map)};
}

export async function deleteAreaOkrEntity(db,{ companyId,id,kind }) {
  return transaction(db,async client=> {
    await scope(client,companyId,kind,id);
    const table=kind==='kr' ? 'okr_key_results' : 'okr_objectives';
    await client.query(`DELETE FROM ${table} WHERE company_id=$1 AND id=$2`,[companyId,id]);
    return {ok:true};
  });
}

export async function listAssignedKeyResults(dbOrQuery,{companyId,candidateId}) {
  const db=asDb(dbOrQuery);
  const rows=await db.query(`SELECT k.*,o.title AS objective_title,a.title AS area_title,c.title AS cycle_title,c.id AS cycle_id,c.status AS cycle_status FROM okr_key_results k JOIN okr_objectives o ON o.id=k.objective_id AND o.company_id=k.company_id JOIN okr_areas a ON a.id=o.area_id AND a.company_id=o.company_id JOIN okr_cycles c ON c.id=a.cycle_id AND c.company_id=a.company_id JOIN okr_key_result_assignees s ON s.key_result_id=k.id AND s.company_id=k.company_id WHERE k.company_id=$1 AND s.candidate_id=$2 ORDER BY c.ends_on DESC,k.deadline,k.id LIMIT 100`,[companyId,candidateId]);
  return rows.rows.map(row=>({...kr(row),keyResultId:Number(row.id)}));
}
