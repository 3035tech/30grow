import { BR_UF_SET } from './recruiting/candidate-profile.js';
import { BR_CITIES_BY_UF } from './data/br-cities.js';

/**
 * Lista municípios de uma UF (base IBGE versionada em `lib/data/br-cities.js`;
 * regenerar com `node scripts/sync-br-cities.mjs`). Sem chamada externa em runtime.
 * @param {string} uf
 * @returns {Promise<string[]>} nomes ordenados
 */
export async function fetchCitiesByUf(uf) {
  const code = String(uf || '').trim().toUpperCase();
  if (!BR_UF_SET.has(code)) {
    const err = new Error('INVALID_UF');
    err.code = 'INVALID_UF';
    throw err;
  }
  return BR_CITIES_BY_UF[code] || [];
}
