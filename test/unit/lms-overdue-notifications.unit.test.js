import assert from 'node:assert/strict';
import test from 'node:test';
import { notifyLmsOverdueEnrollments } from '../../lib/lms.js';

test('overdue cron uses the supplied database and scopes notifications to each company', async () => {
  const calls = [];
  const rows = [2, 7].map((companyId) => ({
    id: companyId * 10, companyId, candidateId: companyId * 100,
    dueDate: '2026-10-01', fullName: 'Colaborador', courseId: 5, courseTitle: 'Curso',
  }));
  const db = { query: async (sql, values) => {
    calls.push({ sql, values });
    if (sql.includes('FROM lms_enrollments')) return { rows, rowCount: rows.length };
    if (sql.includes('SELECT 1 FROM candidates')) return { rows: [{}], rowCount: 1 };
    if (sql.includes('FROM users')) return { rows: [{ id: values[0] * 1000 }], rowCount: 1 };
    // A deduplicated insert should not trigger mobile push delivery.
    if (sql.includes('INSERT INTO')) return { rows: [], rowCount: 0 };
    throw new Error(`Unexpected query: ${sql}`);
  } };
  assert.deepEqual(await notifyLmsOverdueEnrollments(db), { scanned: 2, notified: 2 });
  for (const row of rows) {
    const manager = calls.find(({ sql, values }) => sql.includes('INSERT INTO manager_notifications') && values[0] === row.companyId);
    const employee = calls.find(({ sql, values }) => sql.includes('INSERT INTO candidate_notifications') && values[0] === row.companyId);
    assert.ok(manager);
    assert.ok(employee);
    assert.deepEqual(manager.values[6], [row.companyId * 1000]);
    assert.equal(employee.values[1], row.candidateId);
    assert.equal(manager.values[4], row.id);
    assert.equal(manager.values[5], employee.values[6]);
    assert.match(manager.values[5], new RegExp(`^lms_overdue:${row.id}:\\d{4}-\\d{2}-\\d{2}$`));
  }
});

test('overdue cron with no enrollments does not insert notifications', async () => {
  let queries = 0;
  const result = await notifyLmsOverdueEnrollments(async () => {
    queries++;
    return { rows: [], rowCount: 0 };
  });
  assert.deepEqual(result, { scanned: 0, notified: 0 });
  assert.equal(queries, 1);
});
