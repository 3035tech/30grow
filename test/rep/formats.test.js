import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAej,
  validDocument,
  stamp,
  field,
  latin1,
  SIGNATURE_LINE,
} from '../../lib/rep/formats.js';
import { validPeriod } from '../../lib/rep/exports.js';
test('official document check digits, Latin-1, explicit clock zone and strict periods', () => {
  for (const doc of ['52998224725', '11222333000181', '00000000E08G12'])
    assert.equal(validDocument(doc), true);
  for (const doc of ['00000000000', '52998224726', '00000000E08G13'])
    assert.equal(validDocument(doc), false);
  assert.equal(
    stamp('2026-10-17T16:20:59Z', 'America/Sao_Paulo'),
    '2026-10-17T13:20:00-0300',
  );
  assert.equal(field('52998224725', 14), '52998224725   ');
  assert.throws(() => latin1('texto\nquebra'));
  assert.throws(() => latin1('😀'));
  assert.throws(() => field('longo', 2));
  assert.equal(validPeriod('2026-02-30', '2026-03-01'), false);
  assert.equal(validPeriod('2026-10-01', '2026-10-17'), true);
});
test('AEJ 002 record fields, original/disregarded/manual sources and trailers', () => {
  const e = {
    employer_document: '11222333000181',
    employer_name: 'Escola A',
    complementary_document: '',
    registration: '12345678901234567',
    timezone: 'America/Sao_Paulo',
  };
  const workers = [{ id: 1, cpf: '52998224725', worker_name: 'Ana' }];
  const bytes = buildAej({
    establishment: e,
    workers,
    schedules: [{ code: '1', minutes: 480, pairs: [['0900', '1700']] }],
    markings: [
      {
        workerId: 1,
        at: '2026-10-16T12:00:00Z',
        kind: 'in',
        pair: 1,
        original: true,
        scheduleCode: '1',
      },
      {
        workerId: 1,
        at: '2026-10-16T20:00:00Z',
        kind: 'out',
        pair: 1,
        original: true,
        disregarded: true,
        reason: 'Duplicada',
      },
      {
        workerId: 1,
        at: '2026-10-16T20:01:00Z',
        kind: 'out',
        pair: 1,
        original: false,
        reason: 'Correcao solicitada',
      },
    ],
    absences: [
      { workerId: 1, type: 3, day: '2026-10-16', minutes: 1, movement: '1' },
    ],
    from: '2026-10-16',
    to: '2026-10-16',
    developer: {
      document: '11222333000181',
      name: '30Grow',
      version: '1.0',
      legalName: '3035TECH',
      email: 'suporte@example.com',
    },
    generatedAt: new Date('2026-10-17T16:00:00Z'),
  });
  const lines = bytes.toString('latin1').split('\r\n');
  assert.equal(
    lines[0],
    '01|1|11222333000181|||Escola A|2026-10-16|2026-10-16|2026-10-17T13:00:00-0300|002',
  );
  assert.ok(lines.includes('04|1|480|0900|1700||'));
  assert.ok(
    lines.includes('05|1|2026-10-16T17:00:00-0300|1|D|001|O||Duplicada'),
  );
  assert.ok(
    lines.includes(
      '05|1|2026-10-16T17:01:00-0300||S|001|I||Correcao solicitada',
    ),
  );
  assert.ok(lines.includes('99|1|1|1|1|3|0|1|1'));
  assert.equal(lines.at(-2), SIGNATURE_LINE);
  assert.equal(lines.at(-1), '');
});
