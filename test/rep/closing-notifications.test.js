import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import {
  EMPLOYEE_NOTIF,
  employeeNotificationCopySpec,
  employeeNotificationHref,
} from '../../lib/employee-notification-catalog.js';
import { mobilePushDestinationFor } from '../../lib/mobile-employee-push.js';
import { ERR } from '../../lib/api-error-codes.js';
import { parseIsoDay } from '../../lib/people/time-day-summary.js';
async function fixture(report) {
  const sent = [];
  const deps = {
    asDb: (x) => x,
    ERR,
    EMPLOYEE_NOTIF,
    parseIsoDay,
    getCompanyTimeSchedule: async () => ({ schedule: { timezone: 'UTC' } }),
    isoDayInTz: () => '2026-10-18',
    getTimeClosingReadiness: async () => report,
    notifyCandidates: async (_db, opts) => {
      sent.push(opts);
      return { inserted: opts.candidateIds.length };
    },
  };
  const context = vm.createContext({ Date });
  const mod = new vm.SourceTextModule(
    await readFile(
      new URL('../../lib/people/time-clock-reminders.js', import.meta.url),
      'utf8',
    ),
    { context },
  );
  await mod.link(
    () =>
      new vm.SyntheticModule(
        Object.keys(deps),
        function () {
          for (const [k, v] of Object.entries(deps)) this.setExport(k, v);
        },
        { context },
      ),
  );
  await mod.evaluate();
  return {
    sent,
    run: (opts) =>
      mod.namespace.remindTimeClosing(
        {},
        {
          companyId: 7,
          periodStart: '2026-09-01',
          periodEnd: '2026-09-30',
          deadline: '2026-10-20',
          ...opts,
        },
      ),
  };
}
test('closing reminders target employee action and retain period, deadline and stable dedupe', async () => {
  const f = await fixture({
    ok: true,
    items: [
      { candidateId: 1, incompleteDays: 1, pendingRequests: 0 },
      { candidateId: 2, missingMinutes: 60, pendingRequests: 1 },
      { candidateId: 3, absenceDays: 1, pendingRequests: 0 },
      { candidateId: 4, extraMinutes: 60 },
    ],
  });
  assert.equal((await f.run()).inserted, 2);
  assert.deepEqual(Array.from(f.sent[0].candidateIds), [1, 3]);
  assert.equal(f.sent[0].companyId, 7);
  assert.equal(f.sent[0].payload.deadline, '2026-10-20');
  assert.equal(
    f.sent[0].dedupeKeyPrefix,
    'tc_closing:2026-09-01:2026-09-30:2026-10-20',
  );
  assert.equal(
    (await f.run({ deadline: '2026-10-17' })).errorCode,
    ERR.INVALID_DATE,
  );
  assert.equal(f.sent.length, 1);
});
test('closed periods never send reminders', async () => {
  const f = await fixture({ ok: true, closed: true });
  assert.equal((await f.run()).errorCode, ERR.TIME_CLOCK_PERIOD_CLOSED);
  assert.equal(f.sent.length, 0);
});
test('closing reminders and reopened mirrors open time clock on web and mobile', () => {
  for (const type of [
    EMPLOYEE_NOTIF.TIME_CLOSING_REMINDER,
    EMPLOYEE_NOTIF.TIME_MIRROR_REOPENED,
  ]) {
    assert.equal(employeeNotificationHref(type), '/employee/time-clock');
    assert.ok(mobilePushDestinationFor(type));
    assert.ok(
      employeeNotificationCopySpec(type, {
        from: '2026-09-01',
        to: '2026-09-30',
        deadline: '2026-10-20',
      }).bodyKey.startsWith('timeClosing.'),
    );
  }
});
