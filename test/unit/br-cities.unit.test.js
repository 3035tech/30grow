import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchCitiesByUf } from '../../lib/br-cities.js';
import { BR_CITIES_BY_UF } from '../../lib/data/br-cities.js';
import { BR_UF_SET } from '../../lib/recruiting/candidate-profile.js';

test('static IBGE base covers every UF without network', async () => {
  for (const uf of BR_UF_SET) {
    assert.ok(BR_CITIES_BY_UF[uf]?.length > 0, `missing cities for ${uf}`);
  }
  const total = Object.values(BR_CITIES_BY_UF).reduce((n, l) => n + l.length, 0);
  assert.ok(total > 5500);
});

test('fetchCitiesByUf normalizes UF and returns sorted names', async () => {
  const rs = await fetchCitiesByUf(' rs ');
  assert.ok(rs.includes('Porto Alegre'));
  assert.ok(rs.includes('Canoas'));
  const sp = await fetchCitiesByUf('SP');
  assert.equal(sp[0], 'Adamantina');
});

test('fetchCitiesByUf rejects invalid UF', async () => {
  await assert.rejects(() => fetchCitiesByUf('XX'), (e) => e.code === 'INVALID_UF');
});
