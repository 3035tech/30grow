/**
 * DTOV: B-2725 (field team), B-2721 (push destinations per device) and B-3011 (people copilot).
 * Tenant isolation, CHECKs (migrations 153–155), check-in state machine, reimbursement
 * idempotency + guarded decision, push opt-in persistence, and copilot radar/person scoping.
 * Fixtures live in new companies and are removed at the end. Run with dtovEnv().
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';
import { pool, poolRead, query } from '../../lib/db.js';
import { ERR } from '../../lib/api-error-codes.js';
import { FIELD_EXPENSE_STATUS, FIELD_VISIT_STATUS, TIME_REQUEST_DECISION } from '../../lib/domain-status.js';
import {
  cancelFieldExpense,
  cancelFieldVisit,
  countPendingFieldExpenses,
  createFieldExpense,
  createFieldVisit,
  decideFieldExpense,
  getEmployeeFieldDay,
  listCompanyFieldVisits,
  listFieldExpenses,
  updateEmployeeFieldVisit,
} from '../../lib/people/field-team.js';
import { registerMobileEmployeePushToken } from '../../lib/mobile-employee-push.js';
import { COPILOT_REASON, buildCopilotPerson, buildCopilotRadar } from '../../lib/people/people-copilot.js';
import { closeRateLimitRedis } from '../../lib/rate-limit.js';

const db = new pg.Client({ host: '127.0.0.1', port: 55432, database: 'enneagram_dtov', user: 'dtov', password: 'dtov_local_only', ssl: false });
await db.connect();
const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const rejects = async (sql, params) => {
  try {
    await db.query(sql, params);
  } catch (e) {
    return e.code;
  }
  return null;
};
const tag = crypto.randomUUID().slice(0, 8);
const companies = [];

try {
  const company = async (name) => {
    const id = Number((await one('INSERT INTO companies(name,slug) VALUES($1,$2) RETURNING id', [name, `field-${tag}-${companies.length}`])).id);
    companies.push(id);
    return id;
  };
  const employee = async (companyId, name) => Number((await one(
    `INSERT INTO candidates(company_id, full_name, email, employment_status) VALUES($1,$2,$3,'employee') RETURNING id`,
    [companyId, `${name} ${tag}`, `${name.toLowerCase()}.${tag}@field.test`])).id);

  const cid = await company('Field A');
  const otherCid = await company('Field B');
  const ana = await employee(cid, 'Ana');
  const bia = await employee(cid, 'Bia');
  const foreign = await employee(otherCid, 'Caio');
  const today = (await getEmployeeFieldDay(query, { companyId: cid, candidateId: ana })).today;

  // Visits: plan → check-in (needs coords, replay is a no-op) → complete; foreign/cancel guards
  const planned = await createFieldVisit(query, { companyId: cid, candidateId: ana, day: today, plannedTime: '09:30', title: 'Cliente X', address: 'Rua 1' });
  assert.ok(planned.ok);
  assert.equal(planned.item.status, FIELD_VISIT_STATUS.PLANNED);
  assert.equal((await createFieldVisit(query, { companyId: cid, candidateId: foreign, day: today, title: 'X' })).errorCode, ERR.NOT_FOUND);
  const vid = planned.item.id;
  assert.equal((await updateEmployeeFieldVisit(query, { companyId: cid, candidateId: ana, id: vid, action: 'check_in' })).errorCode, ERR.GEOLOCATION_REQUIRED);
  assert.equal((await updateEmployeeFieldVisit(query, { companyId: cid, candidateId: bia, id: vid, action: 'check_in', latitude: -23.5, longitude: -46.6 })).errorCode, ERR.NOT_FOUND);
  const checked = await updateEmployeeFieldVisit(query, { companyId: cid, candidateId: ana, id: vid, action: 'check_in', latitude: -23.55, longitude: -46.63, accuracy: 12 });
  assert.equal(checked.item.status, FIELD_VISIT_STATUS.CHECKED_IN);
  assert.equal((await updateEmployeeFieldVisit(query, { companyId: cid, candidateId: ana, id: vid, action: 'check_in', latitude: 1, longitude: 1 })).replayed, true);
  assert.equal((await cancelFieldVisit(query, { companyId: cid, id: vid })).errorCode, ERR.FIELD_VISIT_NOT_OPEN);
  assert.equal((await cancelFieldVisit(query, { companyId: otherCid, id: vid })).errorCode, ERR.NOT_FOUND);
  const done = await updateEmployeeFieldVisit(query, { companyId: cid, candidateId: ana, id: vid, action: 'complete', note: 'Pedido fechado' });
  assert.equal(done.item.status, FIELD_VISIT_STATUS.DONE);
  assert.equal((await updateEmployeeFieldVisit(query, { companyId: cid, candidateId: ana, id: vid, action: 'complete' })).errorCode, ERR.FIELD_VISIT_NOT_OPEN);

  const list = await listCompanyFieldVisits(query, { companyId: cid, day: today });
  assert.equal(list.total, 1);
  assert.equal((await listCompanyFieldVisits(query, { companyId: otherCid, day: today })).total, 0);
  assert.equal(await rejects(`UPDATE field_visits SET status='checked_in', checkin_at=NULL WHERE id=$1`, [vid]), '23514');
  assert.equal(await rejects(`UPDATE field_visits SET status='lost' WHERE id=$1`, [vid]), '23514');

  // Reimbursements: validation, idempotent create, guarded decision, cancel only pending
  const base = { companyId: cid, candidateId: ana, day: today, category: 'fuel', amountCents: 4590, description: 'Combustível visita' };
  assert.equal((await createFieldExpense(query, { ...base, amountCents: 0 })).errorCode, ERR.INVALID_DATA);
  assert.equal((await createFieldExpense(query, { ...base, category: 'party' })).errorCode, ERR.INVALID_DATA);
  assert.equal((await createFieldExpense(query, { ...base, day: '2999-01-01' })).errorCode, ERR.INVALID_DATA);
  assert.equal((await createFieldExpense(query, { ...base, candidateId: bia, visitId: vid })).errorCode, ERR.NOT_FOUND);
  const key = `idem-${tag}`;
  const e1 = await createFieldExpense(query, { ...base, visitId: vid, idempotencyKey: key });
  const e2 = await createFieldExpense(query, { ...base, visitId: vid, idempotencyKey: key });
  assert.equal(e2.replayed, true);
  assert.equal(e2.item.id, e1.item.id);
  const e3 = await createFieldExpense(query, { ...base, category: 'meal', amountCents: 3200, description: 'Almoço' });
  assert.equal(await countPendingFieldExpenses(query, { companyId: cid }), 2);
  const queue = await listFieldExpenses(query, { companyId: cid });
  assert.equal(queue.total, 2);
  assert.equal(queue.sumCents, 7790);
  assert.equal(queue.items.find((x) => x.id === e1.item.id).visitTitle, 'Cliente X');
  assert.equal((await listFieldExpenses(query, { companyId: otherCid })).total, 0);

  assert.equal((await decideFieldExpense(query, { companyId: otherCid, id: e1.item.id, decision: TIME_REQUEST_DECISION.APPROVE })).errorCode, ERR.NOT_FOUND);
  const approved = await decideFieldExpense(query, { companyId: cid, id: e1.item.id, decision: TIME_REQUEST_DECISION.APPROVE, note: 'ok' });
  assert.equal(approved.status, FIELD_EXPENSE_STATUS.APPROVED);
  assert.equal((await decideFieldExpense(query, { companyId: cid, id: e1.item.id, decision: TIME_REQUEST_DECISION.REJECT })).errorCode, ERR.FIELD_EXPENSE_NOT_PENDING);
  assert.equal((await cancelFieldExpense({ companyId: cid, candidateId: ana, id: e1.item.id })).errorCode, ERR.FIELD_EXPENSE_NOT_PENDING);
  assert.equal((await cancelFieldExpense({ companyId: cid, candidateId: bia, id: e3.item.id })).errorCode, ERR.NOT_FOUND);
  assert.ok((await cancelFieldExpense({ companyId: cid, candidateId: ana, id: e3.item.id })).ok);
  assert.equal(await countPendingFieldExpenses(query, { companyId: cid }), 0);
  assert.equal(await rejects(`UPDATE field_expenses SET amount_cents=0 WHERE id=$1`, [e1.item.id]), '23514');
  assert.equal(await rejects(`UPDATE field_expenses SET category='party' WHERE id=$1`, [e1.item.id]), '23514');

  // Push destinations (B-2721): declared list persisted, unknown values dropped, CHECK holds
  const token = `ExpoPushToken[field_${tag}]`;
  const reg = await registerMobileEmployeePushToken(query, { candidateId: ana, companyId: cid, platform: 'ios', pushToken: token, appVersion: '2.5.0', destinations: ['time_clock', 'evil', 'field'] });
  assert.ok(reg.ok);
  assert.deepEqual(reg.destinations, ['time_clock', 'field']);
  const row = await one('SELECT app_version, push_destinations FROM mobile_employee_push_tokens WHERE expo_push_token=$1', [token]);
  assert.equal(row.app_version, '2.5.0');
  assert.deepEqual(row.push_destinations, ['time_clock', 'field']);
  await registerMobileEmployeePushToken(query, { candidateId: ana, companyId: cid, platform: 'ios', pushToken: token });
  assert.deepEqual((await one('SELECT push_destinations FROM mobile_employee_push_tokens WHERE expo_push_token=$1', [token])).push_destinations, []);
  assert.equal(await rejects(`UPDATE mobile_employee_push_tokens SET push_destinations=ARRAY['admin'] WHERE expo_push_token=$1`, [token]), '23514');

  // Copilot (B-3011): radar is company-scoped; person must belong to the session company
  const radar = await buildCopilotRadar(query, { companyId: cid });
  assert.ok(radar.ok);
  const ids = radar.people.map((p) => p.candidateId);
  assert.ok(ids.includes(ana) && ids.includes(bia), 'employees without 1:1 show up');
  assert.ok(!ids.includes(foreign));
  assert.ok(radar.people.find((p) => p.candidateId === ana).reasons.some((r) => r.code === COPILOT_REASON.NEVER_ONE_ON_ONE));
  assert.equal((await buildCopilotPerson(query, { companyId: cid, candidateId: foreign })).errorCode, ERR.NOT_FOUND);
  const person = await buildCopilotPerson(query, { companyId: cid, candidateId: ana });
  assert.equal(person.people[0].candidateId, ana);
  assert.ok(person.tools.every((x) => x.ok), JSON.stringify(person.tools));
  assert.equal(await rejects(
    `INSERT INTO ai_usage_events(company_id, feature, model, prompt_tokens, completion_tokens) VALUES($1,'not_a_feature','m',1,1)`, [cid]), '23514');
  await db.query(
    `INSERT INTO ai_usage_events(company_id, feature, model, prompt_tokens, completion_tokens) VALUES($1,'people_copilot','m',1,1)`, [cid]);

  console.log('field-team + push destinations + people copilot DTOV: ok');
} finally {
  for (const id of companies) {
    await db.query('DELETE FROM ai_usage_events WHERE company_id=$1', [id]);
    await db.query('DELETE FROM field_expenses WHERE company_id=$1', [id]);
    await db.query('DELETE FROM field_visits WHERE company_id=$1', [id]);
    await db.query('DELETE FROM mobile_employee_push_tokens WHERE company_id=$1', [id]);
    await db.query('DELETE FROM candidates WHERE company_id=$1', [id]);
    await db.query('DELETE FROM companies WHERE id=$1', [id]);
  }
  await db.end();
  await closeRateLimitRedis();
  await poolRead?.end();
  await pool.end();
}
