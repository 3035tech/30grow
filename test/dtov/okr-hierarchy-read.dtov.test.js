/**
 * DTOV: B-2804.5 — OKR reads with caps in SQL and Map grouping.
 * listOkrCycles keeps assignees/check-in stats by default and drops them in the lean
 * mode used by the KR hierarchy; per-parent caps (areas, activities, objectives, KRs,
 * owners) hold even when rows bypass the write paths. Everything is rolled back.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';
import {
  listOkrCycles,
  OKR_ACTIVITY_CAP_PER_AREA,
  OKR_AREA_CAP_PER_CYCLE,
  OKR_ASSIGNEE_CAP_PER_ACTIVITY,
} from '../../lib/okr-cycles.js';
import {
  listOkrHierarchy,
  OKR_KR_ASSIGNEE_CAP,
  OKR_KR_CAP_PER_OBJECTIVE,
  OKR_OBJECTIVE_CAP_PER_AREA,
} from '../../lib/okr-hierarchy.js';
import { okrRollup } from '../../lib/okr-metrics.js';

const db = new pg.Client({ host: '127.0.0.1', port: 55432, database: 'enneagram_dtov', user: 'dtov', password: 'dtov_local_only', ssl: false });
await db.connect();
const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const ids = (rows) => rows.map((r) => r.id);

try {
  await db.query('BEGIN');
  const companyId = Number((await one("INSERT INTO companies(name,slug) VALUES('OKR read',$1) RETURNING id", [`okr-read-${crypto.randomUUID()}`])).id);
  const otherCompanyId = Number((await one("INSERT INTO companies(name,slug) VALUES('OKR read other',$1) RETURNING id", [`okr-read-${crypto.randomUUID()}`])).id);
  // 22 people: names sort as P01..P22 so owner order is checkable.
  const people = (await db.query(
    `INSERT INTO candidates(company_id,full_name,email,employment_status)
     SELECT $1, 'P' || lpad(g::text,2,'0'), 'p' || g || '@okr-read.test', 'employee' FROM generate_series(1,22) g
     RETURNING id, full_name`, [companyId])).rows.sort((a, b) => a.full_name.localeCompare(b.full_name)).map((r) => Number(r.id));

  // Cycle A: realistic tree within caps.
  const cycleA = Number((await one("INSERT INTO okr_cycles(company_id,title,starts_on,ends_on) VALUES($1,'A','2026-01-01','2026-12-31') RETURNING id", [companyId])).id);
  const area1 = Number((await one("INSERT INTO okr_areas(company_id,cycle_id,title,sort_order) VALUES($1,$2,'Sales',1) RETURNING id", [companyId, cycleA])).id);
  const area2 = Number((await one("INSERT INTO okr_areas(company_id,cycle_id,title,sort_order) VALUES($1,$2,'Ops',0) RETURNING id", [companyId, cycleA])).id);
  const act1 = Number((await one("INSERT INTO okr_activities(company_id,area_id,title,progress_pct,weight,sort_order) VALUES($1,$2,'Legacy 1',40,2,0) RETURNING id", [companyId, area1])).id);
  await db.query("INSERT INTO okr_activities(company_id,area_id,title,progress_pct,weight,sort_order) VALUES($1,$2,'Legacy 2',80,1,1)", [companyId, area1]);
  await db.query('INSERT INTO okr_activity_assignees(company_id,activity_id,candidate_id) VALUES($1,$2,$3),($1,$2,$4)', [companyId, act1, people[1], people[0]]);
  await db.query('INSERT INTO okr_activity_checkins(company_id,activity_id,progress_pct,created_by_candidate_id) VALUES($1,$2,40,$3)', [companyId, act1, people[0]]);

  const obj = async (areaId, title) => Number((await one("INSERT INTO okr_objectives(company_id,area_id,title,period_start,period_end) VALUES($1,$2,$3,'2026-01-01','2026-12-01') RETURNING id", [companyId, areaId, title])).id);
  const kr = async (objectiveId, title, sort, current, weight = 1) => Number((await one(
    "INSERT INTO okr_key_results(company_id,objective_id,title,unit,start_value,target_value,current_value,weight,deadline,sort_order) VALUES($1,$2,$3,'u',0,10,$4,$5,'2026-11-01',$6) RETURNING id",
    [companyId, objectiveId, title, current, weight, sort])).id);
  const o1 = await obj(area1, 'Grow');
  const o2 = await obj(area1, 'Retain');
  const o3 = await obj(area2, 'Empty');
  const k12 = await kr(o1, 'KR second', 1, 10, 3);
  const k11 = await kr(o1, 'KR first', 0, 5, 1);
  await kr(o2, 'KR only', 0, 2);
  await db.query('INSERT INTO okr_key_result_assignees(company_id,key_result_id,candidate_id) VALUES($1,$2,$3),($1,$2,$4),($1,$5,$4)', [companyId, k11, people[2], people[0], k12]);

  // Cycle B: rows beyond every read cap (inserted directly, bypassing write checks).
  const cycleB = Number((await one("INSERT INTO okr_cycles(company_id,title,starts_on,ends_on) VALUES($1,'B','2025-01-01','2025-12-31') RETURNING id", [companyId])).id);
  await db.query("INSERT INTO okr_areas(company_id,cycle_id,title,sort_order) SELECT $1,$2,'B' || g, 100 - g FROM generate_series(1,$3) g", [companyId, cycleB, OKR_AREA_CAP_PER_CYCLE + 2]);
  const bAreas = (await db.query('SELECT id FROM okr_areas WHERE cycle_id=$1 ORDER BY sort_order,id', [cycleB])).rows.map((r) => Number(r.id));
  const bigArea = bAreas[0];
  await db.query("INSERT INTO okr_activities(company_id,area_id,title,progress_pct,sort_order) SELECT $1,$2,'Act' || g, g, 50 - g FROM generate_series(1,$3) g", [companyId, bigArea, OKR_ACTIVITY_CAP_PER_AREA + 2]);
  const bigActivity = Number((await one('SELECT id FROM okr_activities WHERE area_id=$1 ORDER BY sort_order,id LIMIT 1', [bigArea])).id);
  await db.query('INSERT INTO okr_activity_assignees(company_id,activity_id,candidate_id) SELECT $1,$2,unnest($3::bigint[])', [companyId, bigActivity, people]);
  await db.query("INSERT INTO okr_objectives(company_id,area_id,title,period_start,period_end) SELECT $1,$2,'O' || g,'2025-01-01','2025-12-01' FROM generate_series(1,$3) g", [companyId, bigArea, OKR_OBJECTIVE_CAP_PER_AREA + 2]);
  const bigObjective = Number((await one('SELECT id FROM okr_objectives WHERE area_id=$1 ORDER BY id LIMIT 1', [bigArea])).id);
  await db.query("INSERT INTO okr_key_results(company_id,objective_id,title,unit,start_value,target_value,current_value,deadline,sort_order) SELECT $1,$2,'K' || g,'u',0,10,g,'2025-11-01',20 - g FROM generate_series(1,$3) g", [companyId, bigObjective, OKR_KR_CAP_PER_OBJECTIVE + 2]);
  const bigKr = Number((await one('SELECT id FROM okr_key_results WHERE objective_id=$1 ORDER BY sort_order,id LIMIT 1', [bigObjective])).id);
  await db.query('INSERT INTO okr_key_result_assignees(company_id,key_result_id,candidate_id) SELECT $1,$2,unnest($3::bigint[])', [companyId, bigKr, people]);

  // Another tenant's cycle must never leak.
  await db.query("INSERT INTO okr_cycles(company_id,title,starts_on,ends_on) VALUES($1,'Foreign','2026-01-01','2026-12-31')", [otherCompanyId]);

  // listOkrCycles, full detail (OKR activities screen).
  const full = await listOkrCycles(db, { companyId });
  assert.equal(full.ok, true);
  assert.deepEqual(full.cycles.map((c) => c.title), ['A', 'B']);
  const [fullA, fullB] = full.cycles;
  assert.deepEqual(ids(fullA.areas), [area2, area1], 'areas ordered by sort_order');
  const fullArea1 = fullA.areas[1];
  assert.deepEqual(fullArea1.activities.map((a) => a.title), ['Legacy 1', 'Legacy 2']);
  assert.deepEqual(fullArea1.activities[0].assignees.map((p) => p.fullName), ['P01', 'P02'], 'assignees ordered by name');
  assert.equal(fullArea1.activities[0].assignees[0].email, 'p1@okr-read.test');
  assert.equal(fullArea1.activities[0].checkinCount, 1);
  assert.ok(fullArea1.activities[0].lastCheckinAt);
  assert.equal(fullB.areas.length, OKR_AREA_CAP_PER_CYCLE);
  assert.deepEqual(ids(fullB.areas), bAreas.slice(0, OKR_AREA_CAP_PER_CYCLE), 'area cap keeps the first by sort_order');
  const fullBig = fullB.areas[0].activities;
  assert.equal(fullBig.length, OKR_ACTIVITY_CAP_PER_AREA);
  assert.deepEqual(fullBig.map((a) => a.sortOrder), [...fullBig.map((a) => a.sortOrder)].sort((a, b) => a - b));
  assert.equal(fullBig[0].assignees.length, OKR_ASSIGNEE_CAP_PER_ACTIVITY);
  assert.deepEqual(fullBig[0].assignees.map((p) => p.fullName), Array.from({ length: OKR_ASSIGNEE_CAP_PER_ACTIVITY }, (_, i) => `P${String(i + 1).padStart(2, '0')}`));

  // Lean mode: same tree and progress, no per-activity extras.
  const lean = await listOkrCycles(db, { companyId, withActivityDetails: false });
  assert.deepEqual(lean.cycles.map((c) => [c.id, c.progressPct, c.activityCount]), full.cycles.map((c) => [c.id, c.progressPct, c.activityCount]));
  assert.deepEqual(lean.cycles.flatMap((c) => c.areas.map((a) => [a.id, a.progressPct, ids(a.activities)])), full.cycles.flatMap((c) => c.areas.map((a) => [a.id, a.progressPct, ids(a.activities)])));
  for (const act of lean.cycles.flatMap((c) => c.areas.flatMap((a) => a.activities))) {
    assert.equal('assignees' in act, false, 'lean mode omits owners instead of reporting none');
    assert.equal('checkinCount' in act, false);
    assert.equal('lastCheckinAt' in act, false);
  }

  // KR hierarchy: every cycle as a header, full tree only for the selected one.
  const tree = await listOkrHierarchy(db, { companyId });
  assert.equal(tree.ok, true);
  assert.equal('objectives' in tree, false, 'no duplicated top-level objectives list');
  assert.deepEqual(tree.cycles.map((c) => c.id), [cycleA, cycleB]);
  for (const header of tree.cycles) assert.deepEqual(Object.keys(header).sort(), ['endsOn', 'id', 'startsOn', 'status', 'title']);
  assert.equal(tree.cycle.id, cycleA, 'defaults to the latest cycle');
  const treeA = tree.cycle;
  const treeB = (await listOkrHierarchy(db, { companyId, cycleId: cycleB })).cycle;
  assert.equal(treeB.id, cycleB);
  assert.equal((await listOkrHierarchy(db, { companyId, cycleId: 999999999 })).cycle.id, cycleA, 'unknown id falls back to the latest');
  const foreignCycle = Number((await one('SELECT id FROM okr_cycles WHERE company_id=$1', [otherCompanyId])).id);
  assert.equal((await listOkrHierarchy(db, { companyId, cycleId: foreignCycle })).cycle.id, cycleA, 'another tenant cycle id is ignored');
  const lonely = await listOkrCycles(db, { companyId, onlyCycleId: cycleB, withActivityDetails: false });
  assert.equal(lonely.selectedCycleId, cycleB);
  assert.equal('areas' in lonely.cycles.find((c) => c.id === cycleA), false, 'non-selected cycles are headers only');
  const [tArea2, tArea1] = treeA.areas;
  assert.deepEqual(ids(tArea1.objectives), [o1, o2]);
  assert.deepEqual(ids(tArea2.objectives), [o3]);
  assert.deepEqual(tArea2.objectives[0].keyResults, []);
  assert.deepEqual(ids(tArea1.objectives[0].keyResults), [k11, k12], 'KRs ordered by sort_order');
  assert.deepEqual(tArea1.objectives[0].keyResults[0].assignees.map((p) => p.fullName), ['P01', 'P03']);
  assert.deepEqual(tArea1.objectives[0].keyResults[1].assignees.map((p) => p.candidateId), [people[0]]);
  assert.deepEqual(tArea1.objectives[1].keyResults[0].assignees, []);
  assert.deepEqual(tArea1.activities.map((a) => [a.title, a.progressPct]), [['Legacy 1', 40], ['Legacy 2', 80]]);
  assert.equal(tArea1.legacyProgressPct, fullArea1.progressPct);
  assert.equal(tArea1.objectives[0].progressPct, okrRollup(tArea1.objectives[0].keyResults, true));
  assert.equal(tArea1.progressPct, okrRollup(tArea1.objectives));
  assert.equal(treeA.progressPct, okrRollup(treeA.areas));
  assert.equal(treeA.legacyProgressPct, fullA.progressPct);
  const tBig = treeB.areas[0];
  assert.equal(tBig.objectives.length, OKR_OBJECTIVE_CAP_PER_AREA);
  assert.equal(tBig.objectives[0].id, bigObjective);
  assert.equal(tBig.objectives[0].keyResults.length, OKR_KR_CAP_PER_OBJECTIVE);
  assert.equal(tBig.objectives[0].keyResults[0].id, bigKr);
  assert.equal(tBig.objectives[0].keyResults[0].assignees.length, OKR_KR_ASSIGNEE_CAP);

  assert.deepEqual((await listOkrHierarchy(db, { companyId: otherCompanyId })).cycles.map((c) => c.title), ['Foreign']);
  const emptyCompany = Number((await one("INSERT INTO companies(name,slug) VALUES('OKR none',$1) RETURNING id", [`okr-none-${crypto.randomUUID()}`])).id);
  assert.deepEqual(await listOkrHierarchy(db, { companyId: emptyCompany }), { ok: true, cap: 12, cycles: [], cycle: null });
  console.log('[dtov] okr-hierarchy-read ok: single-cycle tree + headers, lean/full cycles, SQL caps (areas, activities, owners, objectives, KRs), ordering, rollups, tenant isolation');
} finally {
  await db.query('ROLLBACK');
  await db.end();
}
