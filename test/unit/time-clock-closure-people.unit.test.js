import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  closureSnapshotHash,
  totalsForPeriod,
} from '../../lib/people/time-clock-closure-people.js';
import { employeeNotificationCopySpec, employeeNotificationHref, EMPLOYEE_NOTIF } from '../../lib/employee-notification-catalog.js';
import { notificationCopySpec, notificationHref, NOTIF } from '../../lib/manager-notification-catalog.js';
import { mobilePushDestinationFor, MOBILE_PUSH_DESTINATION } from '../../lib/mobile-employee-push.js';
import { TIME_CLOCK_ACK_STATUS, TIME_CLOCK_ACK_STATUSES } from '../../lib/domain-status.js';
import { TIME_CLOCK_ACK_TONE } from '../../lib/time-clock-format.js';
import { t } from '../../lib/i18n.js';

const SCHED = { workdayStart: '09:00', workdayEnd: '18:00', breakMinutes: 60, lateGraceMinutes: 10 };
const punch = (iso, hm, kind) => ({ punchedAt: `${iso}T${hm}:00-03:00`, punchKind: kind, voidedAt: null });

// Mon 2026-09-07 … Sun 2026-09-13; Fri is a holiday.
const PUNCHES = {
  '2026-09-07': [punch('2026-09-07', '09:00', 'in'), punch('2026-09-07', '18:00', 'out')],
  '2026-09-10': [punch('2026-09-10', '09:00', 'in')],
};
const JUSTS = { '2026-09-09': { reason: 'medical_certificate' } };
const dayInfo = (iso) => {
  const dow = new Date(`${iso}T12:00:00Z`).getUTCDay();
  return { schedule: SCHED, isWorkday: dow >= 1 && dow <= 5, holiday: iso === '2026-09-11' ? { name: 'X' } : null };
};
const args = {
  from: '2026-09-07',
  to: '2026-09-13',
  dayInfo,
  punchesFor: (iso) => PUNCHES[iso] || [],
  justFor: (iso) => JUSTS[iso] || null,
};

test('totalsForPeriod: worked, extra, absence, justified, incomplete and holiday', () => {
  assert.deepEqual(totalsForPeriod(args), {
    expectedMinutes: 4 * 480,
    workedMinutes: 540,
    extraMinutes: 60,
    missingMinutes: 2 * 480,
    workdays: 4,
    absenceDays: 1,
    justifiedDays: 1,
    incompleteDays: 1,
  });
});

test('totalsForPeriod: days before admission expect nothing', () => {
  const out = totalsForPeriod({ ...args, startDate: '2026-09-09' });
  assert.equal(out.workdays, 2);
  assert.equal(out.absenceDays, 0);
  assert.equal(out.expectedMinutes, 2 * 480);
});

test('closureSnapshotHash: stable sha256, changes with any total', () => {
  const totals = totalsForPeriod(args);
  const base = { closureId: 7, candidateId: 9, periodStart: '2026-09-07', periodEnd: '2026-09-13', totals };
  const h = closureSnapshotHash(base);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(closureSnapshotHash({ ...base }), h);
  assert.notEqual(closureSnapshotHash({ ...base, totals: { ...totals, workedMinutes: 541 } }), h);
  assert.notEqual(closureSnapshotHash({ ...base, candidateId: 10 }), h);
});

test('mirror notifications: copy, links and push destination', () => {
  const emp = employeeNotificationCopySpec(EMPLOYEE_NOTIF.TIME_MIRROR_AVAILABLE, { from: '2026-09-01', to: '2026-09-30' });
  assert.equal(emp.titleKey, 'employeeHome.notifTimeMirrorTitle');
  assert.deepEqual(emp.values, { from: '2026-09-01', to: '2026-09-30' });
  assert.equal(employeeNotificationHref(EMPLOYEE_NOTIF.TIME_MIRROR_AVAILABLE), '/employee/time-clock#mirrors');
  assert.equal(mobilePushDestinationFor(EMPLOYEE_NOTIF.TIME_MIRROR_AVAILABLE), MOBILE_PUSH_DESTINATION.TODAY);
  assert.equal(notificationHref(NOTIF.TIME_MIRROR_DISPUTED, { candidateId: 3 }), '/dashboard?tab=dp&dpSection=time&timeView=closing');
  const mgr = notificationCopySpec(NOTIF.TIME_MIRROR_DISPUTED, { candidateName: 'Ana', from: 'a', to: 'b' });
  assert.equal(mgr.titleKey, 'dashboard.notifTimeMirrorDisputedTitle');
});

test('ack statuses: tone per status and i18n in 4 locales', () => {
  assert.deepEqual(Object.keys(TIME_CLOCK_ACK_TONE).sort(), [...TIME_CLOCK_ACK_STATUSES].sort());
  for (const loc of ['pt-BR', 'en', 'fr-FR', 'de-DE']) {
    for (const s of TIME_CLOCK_ACK_STATUSES) {
      assert.notEqual(t(loc, `panel.timeClockMgr.ack.${s}`), `panel.timeClockMgr.ack.${s}`, `${loc} ${s}`);
    }
    for (const k of ['employeeHome.timeMirror.title', 'errors.TIME_CLOCK_ACK_LOCKED', 'panel.help.timeClockStep15']) {
      assert.notEqual(t(loc, k), k, `${loc} ${k}`);
      assert.ok(!t(loc, k).includes(' — '), `${loc} ${k} em dash`);
    }
  }
  assert.equal(TIME_CLOCK_ACK_STATUS.SIGNED, 'signed');
});
