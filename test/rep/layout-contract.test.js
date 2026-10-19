import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import * as formats from '../../lib/rep/formats.js';
import { fiscalSchedule } from '../../lib/rep/exports.js';
import { repRegistrySchema } from '../../lib/rep/registry.js';
const establishment = {
  id: 1,
  employer_document: '11222333000181',
  employer_name: 'Escola',
  complementary_document: '',
  registration: '5120261234567',
  timezone: 'America/Sao_Paulo',
};
const developer = {
  document: '11222333000181',
  name: '30Grow',
  version: '1.0',
  legalName: '3035TECH',
  email: 'test@example.invalid',
};
const period = { from: '2026-10-04', to: '2026-10-04' };
const worker = {
  id: '1000000000',
  candidate_id: 10,
  cpf: '52998224725',
  worker_name: 'Pessoa',
  weekly_rest_day: 0,
};
const day = () => ({
  day: period.from,
  punches: [],
  occurrence: 'rest',
  historyReview: false,
  daySchedule: {
    workdayStart: '09:00',
    workdayEnd: '17:00',
    breakMinutes: 0,
    nightRule: 'none',
    shiftPattern: 'weekly',
  },
  fiscal: {
    employed: true,
    enabled: true,
    weekdays: [1, 2, 3, 4, 5],
    bankDeltaMinutes: 60,
    bankAnchorDeltaMinutes: 0,
  },
});
async function exportFixture(days, workers = [worker]) {
  const mirror = {
    ok: true,
    ...period,
    person: { startDate: '2026-10-05' },
    schedule: { hourBankEnabled: false },
    days,
  };
  const mod = new vm.SourceTextModule(
    await readFile(
      new URL('../../lib/rep/exports.js', import.meta.url),
      'utf8',
    ),
  );
  const formatMod = new vm.SyntheticModule(Object.keys(formats), function () {
    for (const [key, value] of Object.entries(formats))
      this.setExport(key, value);
  });
  const mirrorMod = new vm.SyntheticModule(
    ['getEmployeeTimeMirror'],
    function () {
      this.setExport('getEmployeeTimeMirror', async (_db, options) => {
        assert.equal(options.includeFiscal, true);
        return mirror;
      });
    },
  );
  await mod.link((spec) =>
    spec.includes('formats.js') ? formatMod : mirrorMod,
  );
  await mod.evaluate();
  const db = {
    query: async (sql) => ({
      rows: sql.includes('FROM rep_establishments')
        ? [establishment]
        : sql.includes('FROM rep_original_records')
          ? []
          : sql.includes('count(*)')
            ? [{ n: 0 }]
            : workers,
    }),
  };
  return (
    await mod.namespace.fiscalExport(db, {
      companyId: 1,
      establishmentId: 1,
      ...period,
      format: 'aej',
      developer,
    })
  )
    .toString('latin1')
    .split('\r\n');
}
function aej(overrides = {}) {
  return formats.buildAej({
    establishment,
    developer,
    ...period,
    workers: [{ ...worker, id: 1 }],
    schedules: [{ code: 'A', minutes: 480, pairs: [['0900', '1700']] }],
    markings: [],
    ...overrides,
  });
}

test('real numeric INPI length is accepted without changing the identifier', () => {
  const value = repRegistrySchema.parse({
    action: 'establishment',
    employerDocument: establishment.employer_document,
    employerName: 'Escola',
    workplace: 'Rua',
    registration: '5120261234567',
    timezone: establishment.timezone,
    responsibleCpf: '52998224725',
  });
  assert.equal(value.registration, '5120261234567');
});
test('AFD 004 has exact official offsets, right-space padding and CRLF bytes', () => {
  const buffer = formats.buildAfd({
    establishment,
    developer,
    records: [],
    ...period,
    generatedAt: new Date('2026-10-05T12:00:00Z'),
  });
  const lines = buffer.toString('latin1').split('\r\n');
  assert.equal(lines[0].length, 302);
  assert.equal(lines[0].slice(0, 25), '0000000001111222333000181');
  assert.equal(lines[0].slice(25, 39), '              ');
  assert.equal(lines[0].slice(189, 206), '5120261234567    ');
  assert.equal(
    lines[0].slice(206, 253),
    '2026-10-042026-10-042026-10-05T09:00:00-0300004',
  );
  assert.equal(lines[0].slice(253, 268), '111222333000181');
  assert.equal(lines[0].slice(268, 298), '                              ');
  assert.equal(
    lines[1],
    '9999999990        0        0        0        0        0        9',
  );
  assert.equal(lines[1].length, 64);
  assert.equal(lines[2].length, 100);
  assert.equal(lines[3], '');
  assert.ok(!buffer.toString('latin1').replaceAll('\r\n', '').includes('\n'));
  const cno = formats
    .buildAfd({
      establishment: {
        ...establishment,
        complementary_document: '123456789012',
      },
      developer,
      records: [],
      ...period,
    })
    .toString('latin1');
  assert.equal(cno.slice(25, 39), '123456789012  ');
});
test('malformed legacy original bytes are preserved and block AFD export', () => {
  const raw =
    '0000000012' +
    '2026-10-04T09:00:00-0300' +
    '00052998224725' +
    '1' +
    '11222333000181' +
    '00000000000000' +
    'Escola'.padEnd(150) +
    'Rua'.padEnd(100);
  const record = {
    nsr: 1,
    record_type: 2,
    record_text: raw + formats.crc16(raw),
  };
  const original = record.record_text;
  assert.throws(
    () =>
      formats.buildAfd({
        establishment,
        developer,
        records: [record],
        ...period,
      }),
    /REP_LEGACY_RECORD_FORMAT/,
  );
  assert.equal(record.record_text, original);
});
test('AEJ contractual urban duration includes the reduced night hour and overnight breaks', () => {
  assert.deepEqual(
    fiscalSchedule({
      workdayStart: '22:00',
      workdayEnd: '05:00',
      breakMinutes: 0,
      nightRule: 'urban_clt',
    }),
    { pairs: [['2200', '0500']], minutes: 480 },
  );
  assert.deepEqual(
    fiscalSchedule({
      workdayStart: '22:00',
      workdayEnd: '06:00',
      breakMinutes: 60,
      breakStart: '02:00',
      breakEnd: '03:00',
      nightRule: 'urban_clt',
    }),
    {
      pairs: [
        ['2200', '0200'],
        ['0300', '0600'],
      ],
      minutes: 471,
    },
  );
  assert.equal(
    fiscalSchedule({
      workdayStart: '09:00',
      workdayEnd: '18:00',
      breakMinutes: 60,
      breakStart: '12:00',
      breakEnd: '13:00',
      nightRule: 'none',
    }).minutes,
    480,
  );
  assert.throws(
    () =>
      fiscalSchedule({
        workdayStart: '22:00',
        workdayEnd: '05:00',
        nightRule: 'none',
      }),
    /REP_NIGHT_RULE_REQUIRED/,
  );
  assert.throws(
    () =>
      fiscalSchedule({
        workdayStart: '22:00',
        workdayEnd: '05:00',
        nightRule: 'urban_clt',
        breakMinutes: 60,
        breakStart: '06:00',
        breakEnd: '07:00',
      }),
    /REP_INVALID_SCHEDULE/,
  );
});
test('AEJ uses historical bank movements despite current disabled setting and remaps large internal IDs', async () => {
  const lines = await exportFixture([day()]);
  assert.ok(lines.includes('03|1|52998224725|Pessoa'));
  assert.ok(lines.includes('07|1|3|2026-10-04|60|1'));
  assert.ok(lines.includes('07|1|1|2026-10-04||'));
  const debit = day();
  debit.fiscal.bankDeltaMinutes = -15;
  assert.ok((await exportFixture([debit])).includes('07|1|3|2026-10-04|15|2'));
});
test('historical employment controls absence and DSR instead of current admission', async () => {
  const inactive = day();
  inactive.fiscal.employed = false;
  inactive.fiscal.bankDeltaMinutes = 0;
  assert.equal(
    (await exportFixture([inactive])).filter((line) => line.startsWith('07|'))
      .length,
    0,
  );
  const absence = day();
  absence.occurrence = 'absence';
  absence.fiscal.bankDeltaMinutes = 0;
  assert.ok((await exportFixture([absence])).includes('07|1|2|2026-10-04||'));
});
test('unresolved history, bank reconciliation and pending changes refuse certification', async () => {
  for (const patch of [
    { historyReview: true },
    { requiresScheduleReview: true },
    { bankPendingCount: 1 },
    { requests: [{ status: 'pending' }] },
  ])
    await assert.rejects(
      exportFixture([{ ...day(), ...patch }]),
      /REP_HISTORY_REVIEW_REQUIRED/,
    );
  const anchored = day();
  anchored.fiscal.bankAnchorDeltaMinutes = 5;
  await assert.rejects(
    exportFixture([anchored]),
    /REP_HISTORY_REVIEW_REQUIRED/,
  );
});
test('cyclic or contradictory weekly rest is explicitly blocked rather than inferred', async () => {
  const cyclic = day();
  cyclic.daySchedule.shiftPattern = '12x36';
  await assert.rejects(exportFixture([cyclic]), /REP_DSR_REVIEW_REQUIRED/);
  const inconsistent = day();
  inconsistent.fiscal.weekdays = [0, 1, 2, 3, 4, 5, 6];
  await assert.rejects(
    exportFixture([inconsistent]),
    /REP_DSR_REVIEW_REQUIRED/,
  );
});
test('AEJ final validation rejects oversized IDs, duplicate CPF, missing reasons and invalid references', () => {
  assert.throws(() => aej({ workers: [worker] }), /REP_INVALID_FIELD/);
  assert.throws(
    () =>
      aej({
        workers: [
          { ...worker, id: 1 },
          { ...worker, id: 2 },
        ],
      }),
    /REP_MULTIPLE_EMPLOYMENTS_UNSUPPORTED/,
  );
  const marking = {
    workerId: 1,
    at: '2026-10-04T12:00:00Z',
    kind: 'in',
    pair: 1,
    original: false,
    scheduleCode: 'A',
  };
  assert.throws(() => aej({ markings: [marking] }), /REP_INVALID_FIELD/);
  assert.throws(
    () =>
      aej({
        markings: [{ ...marking, reason: 'Correção', scheduleCode: 'missing' }],
      }),
    /REP_INVALID_REFERENCE/,
  );
  assert.throws(
    () =>
      aej({ markings: [{ ...marking, reason: 'Correção', workerId: 999 }] }),
    /REP_INVALID_REFERENCE/,
  );
  assert.throws(
    () =>
      aej({
        absences: [
          {
            workerId: 1,
            type: 3,
            day: '2026-10-04',
            minutes: 0,
            movement: '1',
          },
        ],
      }),
    /REP_INVALID_FIELD/,
  );
});
