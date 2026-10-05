import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildManagerEmailChangedMail } from '../../lib/user-access-mail.js';
import { NOTIFICATION_TABLE, purgeOldNotifications } from '../../lib/notification-retention.js';
import { isNationalHoliday, nationalHolidays } from '../../lib/br-holidays.js';
import { nationalHolidays as calendarHolidays } from '../../lib/people/time-clock-calendar.js';

describe('buildManagerEmailChangedMail', () => {
  const mail = buildManagerEmailChangedMail({
    oldEmail: 'gestora@empresa.com',
    newEmail: 'nova.conta@outro.com',
    supportEmail: 'contact@3035tech.com',
    locale: 'pt-BR',
    displayName: 'Ana Souza',
  });

  it('masks the new address and never prints it in full', () => {
    assert.match(mail.text, /no\*\*\*@outro\.com/);
    assert.doesNotMatch(mail.text + mail.html, /nova\.conta@outro\.com/);
  });

  it('greets by first name and points to support', () => {
    assert.match(mail.text, /Ana/);
    assert.match(mail.text, /contact@3035tech\.com/);
    assert.match(mail.html, /contact@3035tech\.com/);
    assert.ok(mail.subject.length > 5);
  });

  it('has copy in en, fr and de', () => {
    for (const locale of ['en-US', 'fr-FR', 'de-DE']) {
      const m = buildManagerEmailChangedMail({ oldEmail: 'a@b.co', newEmail: 'cd@e.co', supportEmail: 's@x.co', locale });
      assert.doesNotMatch(m.subject, /mail\.managerEmailChanged/);
      assert.match(m.text, /s@x\.co/);
    }
  });
});

describe('purgeOldNotifications', () => {
  it('rejects tables outside the allow-list', async () => {
    await assert.rejects(purgeOldNotifications({ query: async () => ({ rowCount: 0 }) }, 'users'), /unsupported table/);
  });

  it('stops after a short batch', async () => {
    let calls = 0;
    const db = { query: async () => { calls += 1; return { rowCount: 2 }; } };
    const r = await purgeOldNotifications(db, NOTIFICATION_TABLE.CANDIDATE, { batchSize: 10 });
    assert.equal(calls, 1);
    assert.equal(r.deleted, 2);
    assert.equal(r.truncated, false);
  });
});

describe('br-holidays', () => {
  it('time clock calendar re-exports the same list', () => {
    assert.deepEqual(calendarHolidays(2026), nationalHolidays(2026));
  });

  it('knows fixed and movable holidays', () => {
    assert.equal(isNationalHoliday('2026-10-12'), true);
    assert.equal(isNationalHoliday('2026-04-03'), true);
    assert.equal(isNationalHoliday('2026-10-13'), false);
  });
});
