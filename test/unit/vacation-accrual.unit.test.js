import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { getLeaveBalance } from '../../lib/people/employee-dp.js';

const sourceModule = new vm.SourceTextModule(
  await readFile(new URL('../../lib/people/vacation-accrual.js', import.meta.url), 'utf8'),
  { context: vm.createContext({ Date, Number, Math, String }) }
);
await sourceModule.link(() => { throw new Error('Unexpected dependency'); });
await sourceModule.evaluate();
const { calculateVacationAccrual } = sourceModule.namespace;

test('completed CLT cycle stays available while the next cycle forms, including time on vacation', () => {
  const balance = calculateVacationAccrual({
    startDate: '2025-03-02',
    asOf: '2026-10-28',
    vacations: [{ startsOn: '2026-02-10', endsOn: '2026-02-19', status: 'taken' }],
  });
  assert.equal(balance.availableDays, 20);
  assert.equal(balance.formingDays, 20);
  assert.equal(JSON.stringify(balance.periods.map(p => [p.periodStart, p.periodEnd, p.acquired])), JSON.stringify([
    ['2025-03-02', '2026-03-01', true],
    ['2026-03-02', '2027-03-01', false],
  ]));
});

test('an approved vacation after anniversary consumes the oldest acquired cycle first', () => {
  const balance = calculateVacationAccrual({
    startDate: '2024-03-02', asOf: '2026-10-28',
    vacations: [{ startsOn: '2026-04-01', endsOn: '2026-04-10', status: 'approved' }],
  });
  assert.equal(balance.periods[0].availableDays, 20);
  assert.equal(balance.periods[1].availableDays, 30);
  assert.equal(balance.availableDays, 50);
});

test('vacation from February 10 through February 20 consumes eleven calendar days', () => {
  const balance = calculateVacationAccrual({
    startDate: '2025-03-02', asOf: '2026-10-28',
    vacations: [{ startsOn: '2026-02-10', endsOn: '2026-02-20', status: 'taken' }],
  });
  assert.equal(balance.usedDays, 11);
  assert.equal(balance.availableDays, 19);
  assert.equal(balance.formingDays, 20);
});

test('a February 29 hire does not shift the acquisition anniversary into March', () => {
  const balance = calculateVacationAccrual({ startDate: '2024-02-29', asOf: '2025-02-28' });
  assert.equal(balance.periods[0].periodEnd, '2025-02-27');
  assert.equal(balance.periods[0].acquired, true);
});

test('the balance API uses hire date instead of an old manually configured window', async () => {
  const query = async (sql) => {
    if (sql.includes('FROM candidates')) return { rowCount: 1, rows: [{ employmentStatus: 'employee', startDate: '2025-03-02' }] };
    if (sql.includes('FROM employee_leave_balances')) return { rowCount: 1, rows: [{ entitlementDays: 30, adjustmentDays: 0, periodStart: '2025-06-02', periodEnd: '2026-10-28' }] };
    if (sql.includes('FROM employee_leave_requests')) return { rowCount: 1, rows: [{ startsOn: '2026-02-10', endsOn: '2026-02-19', status: 'taken' }] };
    throw new Error(`Unexpected SQL: ${sql}`);
  };
  const result = await getLeaveBalance({ query }, { companyId: 1, candidateId: 42 });
  assert.equal(result.ok, true);
  assert.equal(result.balance.legalAccrual, true);
  assert.equal(result.balance.periods[0].availableDays, 20);
  assert.equal(result.balance.periods[0].periodStart, '2025-03-02');
});
