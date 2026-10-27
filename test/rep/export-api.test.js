import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { zipSync, unzipSync } from 'fflate';
import { ERR } from '../../lib/api-error-codes.js';
import { CAP } from '../../lib/identity/permissions.js';
import { buildAfd } from '../../lib/rep/formats.js';
const query = {
  establishmentId: 1,
  from: '2026-10-01',
  to: '2026-10-02',
  format: 'afd',
};
async function fixture(error) {
  const calls = [];
  const data = buildAfd({
    establishment: {
      employer_document: '11222333000181',
      employer_name: 'Escola',
      registration: '5120261234567',
      complementary_document: '',
      timezone: 'America/Sao_Paulo',
    },
    records: [],
    from: query.from,
    to: query.to,
    developer: { document: '11222333000181' },
  });
  const values = {
    z,
    zPositiveInt: z.coerce.number().int().positive(),
    CAP,
    ERR,
    zipSync,
    NextResponse: Response,
    withAdminApi: (options, fn) => {
      assert.deepEqual(options.anyCap, [CAP.DP_VIEW, CAP.TEAM_VIEW]);
      return fn;
    },
    pool: {
      connect: async () => ({
        query: async (sql) => calls.push(sql),
        release: () => calls.push('release'),
      }),
    },
    fiscalExport: async (_db, opts) => {
      assert.equal(opts.companyId, 7);
      if (error) throw Error(error);
      return data;
    },
    withSigningCertificate: async (fn) => {
      calls.push('sign');
      return fn({ sign: async () => new Uint8Array([1, 2, 3]) });
    },
    apiError: (_request, errorCode, status) =>
      Response.json({ errorCode }, { status }),
  };
  const modules = new Map();
  const mod = new vm.SourceTextModule(
    await readFile(
      new URL(
        '../../app/api/admin/time-clock/rep/export/route.js',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  await mod.link((spec) => {
    if (!modules.has(spec))
      modules.set(
        spec,
        new vm.SyntheticModule(Object.keys(values), function () {
          for (const [k, v] of Object.entries(values)) this.setExport(k, v);
        }),
      );
    return modules.get(spec);
  });
  await mod.evaluate();
  const response = await mod.namespace.GET({
    request: {},
    companyId: 7,
    query,
  });
  return { response, calls };
}
test('AFD ZIP names use canonical INPI with no field padding, plus matching detached p7s', async () => {
  const { response, calls } = await fixture();
  assert.equal(response.status, 200);
  const filename = 'AFD512026123456711222333000181REP_P.txt';
  assert.equal(
    response.headers.get('content-disposition'),
    `attachment; filename="${filename}.zip"`,
  );
  const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
  assert.deepEqual(Object.keys(files), [filename, filename + '.p7s']);
  assert.equal(calls.filter((x) => x === 'sign').length, 1);
  assert.equal(calls.at(-1), 'release');
});
test('fiscal review failures return explicit safe codes and never sign an invalid export', async () => {
  for (const [internal, code] of Object.entries({
    REP_HISTORY_REVIEW_REQUIRED: ERR.REP_FISCAL_HISTORY_REVIEW,
    REP_DSR_REVIEW_REQUIRED: ERR.REP_FISCAL_RULE_REVIEW,
    REP_NIGHT_RULE_REQUIRED: ERR.REP_FISCAL_RULE_REVIEW,
    REP_LEGACY_RECORD_FORMAT: ERR.REP_LEGACY_RECORD_FORMAT,
  })) {
    const { response, calls } = await fixture(internal);
    assert.equal(response.status, 409);
    assert.equal((await response.json()).errorCode, code);
    assert.ok(!calls.includes('sign'));
    assert.equal(calls.at(-1), 'release');
  }
});
