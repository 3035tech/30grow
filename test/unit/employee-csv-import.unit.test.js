import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { parseEmployeeCsv } from '../../lib/employee-csv.js';

async function fixture({ existing = [], conflict = false, effectFails = false } = {}) {
  const calls = [];
  let id = 100;
  const deps = {
    parseEmployeeCsv,
    query: async (sql, params) => { calls.push(['preview', params]); return { rows: existing }; },
    withTransaction: async callback => callback({ query: async (sql, params) => {
      calls.push([sql.includes('INSERT') ? 'insert' : 'recheck', params]);
      if (sql.includes('SELECT')) return { rowCount: conflict ? 1 : 0, rows: [] };
      return { rowCount: 1, rows: [{ id: ++id }] };
    } }),
    lockPositionCompany: async (_db, companyId) => { calls.push(['lock', companyId]); },
    persistCandidateHire: async (_db, args) => { calls.push(['hire', args]); return { companyId: 26, startDate: args.startDate, emailAccess: { shouldInvite: false } }; },
    runCandidateHireEffects: async args => { calls.push(['effects', args]); if (effectFails) throw new Error('optional effect'); },
  };
  const context = vm.createContext({});
  const mod = new vm.SourceTextModule(await readFile(new URL('../../lib/employee-csv-import.js', import.meta.url), 'utf8'), { context });
  await mod.link(() => new vm.SyntheticModule(Object.keys(deps), function () { for (const [name, value] of Object.entries(deps)) this.setExport(name, value); }, { context }));
  await mod.evaluate();
  return { api: mod.namespace, calls };
}
const csv = 'nome_completo,email_corporativo,data_admissao\nAna,ana@example.com,2026-01-01\nBia,bia@example.com,2026-01-02';
test('preview is tenant-scoped and never writes or activates an existing contact', async () => {
  const f = await fixture({ existing: [{ email: 'ana@example.com' }] });
  const rows = await f.api.previewEmployeeCsv(csv, 26);
  assert.ok(rows[0].errors.includes('CSV_EXISTING')); assert.equal(rows[1].errors.length, 0);
  assert.deepEqual(f.calls.map(call => call[0]), ['preview']); assert.equal(f.calls[0][1][0], 26);
});
test('confirmation imports valid rows with transactional recheck, no onboarding and no automatic invite', async () => {
  const f = await fixture({ existing: [{ email: 'ana@example.com' }] });
  const result = await f.api.importEmployeeCsv({ csv, companyId: 26, actorId: 5, locale: 'pt-BR' });
  assert.equal(result.rows[0].candidateId, undefined); assert.equal(result.rows[1].candidateId, 101);
  assert.deepEqual(f.calls.map(call => call[0]), ['preview', 'lock', 'recheck', 'insert', 'hire', 'effects']);
  const hire = f.calls.find(call => call[0] === 'hire')[1];
  assert.equal(hire.autoInvite, false); assert.equal(hire.onboardingStages.length, 0);
  assert.equal(f.calls.find(call => call[0] === 'insert')[1][0], 26);
});
test('a concurrent existing contact is skipped and never overwritten or activated', async () => {
  const f = await fixture({ conflict: true });
  const result = await f.api.importEmployeeCsv({ csv, companyId: 26, actorId: 5 });
  assert.ok(result.rows.every(row => row.errors.includes('CSV_EXISTING')));
  assert.ok(f.calls.every(call => !['insert', 'hire', 'effects'].includes(call[0])));
});
test('failure in optional post-commit effects does not report a committed record as missing', async () => {
  const f = await fixture({ effectFails: true });
  const result = await f.api.importEmployeeCsv({ csv, companyId: 26, actorId: 5 });
  assert.ok(result.rows.every(row => row.candidateId && !row.errors.length));
});
