import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FIELD_EXPENSE_CATEGORIES,
  FIELD_EXPENSE_STATUSES,
  FIELD_VISIT_STATUSES,
} from '../../lib/domain-status.js';
import { ERR, httpStatusForError } from '../../lib/api-error-codes.js';
import { t } from '../../lib/i18n.js';
import { EMPLOYEE_NOTIF, employeeNotificationHref } from '../../lib/employee-notification-catalog.js';
import { NOTIF, notificationHref } from '../../lib/manager-notification-catalog.js';
import {
  COPILOT_PEOPLE_CAP,
  COPILOT_REASON,
  buildCopilotPerson,
  buildCopilotRadar,
  copilotAuditMetadata,
  draftCopilotAgendas,
} from '../../lib/people/people-copilot.js';

const LOCALES = ['pt-BR', 'en-US', 'fr-FR', 'de-DE'];

test('B-2725: field statuses/categories have labels in 4 locales and no em dash', () => {
  for (const loc of LOCALES) {
    for (const s of FIELD_VISIT_STATUSES) assert.ok(!t(loc, `panel.field.visitStatus.${s}`).includes('panel.'), `${loc} visit ${s}`);
    for (const s of FIELD_EXPENSE_STATUSES) assert.ok(!t(loc, `panel.field.expenseStatus.${s}`).includes('panel.'), `${loc} expense ${s}`);
    for (const c of FIELD_EXPENSE_CATEGORIES) {
      const label = t(loc, `panel.field.category.${c}`);
      assert.ok(!label.includes('panel.') && !label.includes(' — '), `${loc} category ${c}`);
    }
  }
});

test('B-2725: conflict errors are 409 and notifications link to field screens', () => {
  assert.equal(httpStatusForError(ERR.FIELD_VISIT_NOT_OPEN), 409);
  assert.equal(httpStatusForError(ERR.FIELD_EXPENSE_NOT_PENDING), 409);
  assert.equal(employeeNotificationHref(EMPLOYEE_NOTIF.FIELD_VISITS_ASSIGNED), '/employee/field');
  assert.equal(employeeNotificationHref(EMPLOYEE_NOTIF.FIELD_EXPENSE_DECIDED), '/employee/field#expenses');
  assert.equal(notificationHref(NOTIF.FIELD_EXPENSE_SUBMITTED, {}), '/dashboard?tab=dp&dpSection=field');
});

test('B-3011: copilot rejects missing company and foreign person before reading signals', async () => {
  assert.equal((await buildCopilotRadar(async () => ({ rows: [] }), { companyId: null })).ok, false);
  const calls = [];
  const db = { query: async (sql, params) => { calls.push({ sql, params }); return { rows: [], rowCount: 0 }; } };
  const r = await buildCopilotPerson(db, { companyId: 2, candidateId: 99 });
  assert.equal(r.errorCode, ERR.NOT_FOUND);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].params, [99, 2]);
  assert.match(calls[0].sql, /company_id = \$2/);
});

test('B-3011: audit metadata carries counts only (no names)', () => {
  const meta = copilotAuditMetadata(
    {
      question: 'radar',
      people: [
        { candidateId: 1, name: 'Ana Secreta', reasons: [{ code: COPILOT_REASON.TURNOVER_HIGH, riskScore: 80 }, { code: COPILOT_REASON.NEVER_ONE_ON_ONE }] },
        { candidateId: 2, name: 'Bia', reasons: [{ code: COPILOT_REASON.NEVER_ONE_ON_ONE }] },
      ],
      tools: [{ name: 'turnover_radar', ok: true }, { name: 'pdi_overdue', ok: false }],
    },
    { explain: true, aiOk: false }
  );
  assert.equal(meta.peopleCount, 2);
  assert.deepEqual(meta.reasonCounts, { turnover_high: 1, never_one_on_one: 2 });
  assert.deepEqual(meta.toolsFailed, ['pdi_overdue']);
  assert.ok(!JSON.stringify(meta).includes('Ana'));
});

test('B-3011: copy for every reason/topic in 4 locales, hedged, no em dash', () => {
  for (const loc of LOCALES) {
    for (const code of Object.values(COPILOT_REASON)) {
      for (const k of [`panel.copilot.reason.${code}`, `panel.copilot.topic.${code}`]) {
        const s = t(loc, k, { score: 1, count: 1, date: 'x', days: 30 });
        assert.ok(!s.startsWith('panel.') && !s.includes(' — '), `${loc} ${k}`);
      }
    }
  }
});

test('B-3011: AI agenda sends pseudonymous refs only and maps back by ref', async () => {
  const prev = process.env.OPENAI_MOCK;
  process.env.OPENAI_MOCK = '1';
  try {
    const people = Array.from({ length: COPILOT_PEOPLE_CAP + 2 }, (_, i) => ({
      candidateId: 100 + i,
      name: `Pessoa Real ${i}`,
      reasons: [{ code: COPILOT_REASON.STALE_ONE_ON_ONE, lastMeeting: '2026-01-01' }],
    }));
    const ai = await draftCopilotAgendas({ people, locale: 'pt-BR' });
    assert.ok(ai, 'mock returns an agenda');
    const ids = Object.keys(ai.agendas).map(Number);
    assert.ok(ids.length > 0 && ids.every((id) => id >= 100 && id < 100 + COPILOT_PEOPLE_CAP));
    assert.ok(!JSON.stringify(ai).includes('Pessoa Real'));
    assert.equal(await draftCopilotAgendas({ people: [], locale: 'pt-BR' }), null);
  } finally {
    if (prev === undefined) delete process.env.OPENAI_MOCK;
    else process.env.OPENAI_MOCK = prev;
  }
});
