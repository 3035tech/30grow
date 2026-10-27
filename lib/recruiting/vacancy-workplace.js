/**
 * Modalidade e local da vaga (presencial / híbrido / remoto + cidade/UF).
 * Base para agregadores SEO (B-119) quando houver massa.
 */

import { BR_UF_SET } from './candidate-profile.js';

export const VACANCY_WORKPLACE_MODALITIES = Object.freeze(['onsite', 'hybrid', 'remote']);

export function normalizeWorkplaceModality(raw) {
  if (raw == null || raw === '') return null;
  const v = String(raw).trim().toLowerCase();
  return VACANCY_WORKPLACE_MODALITIES.includes(v) ? v : null;
}

export function workplaceModalityLabelKey(type) {
  const v = normalizeWorkplaceModality(type);
  if (!v) return null;
  return `recruiting.workplaceModality_${v}`;
}

export function normalizeWorkplaceState(raw) {
  if (raw == null || raw === '') return null;
  const uf = String(raw).trim().toUpperCase();
  return BR_UF_SET.has(uf) ? uf : null;
}

export function normalizeWorkplaceCity(raw) {
  if (raw == null) return null;
  const city = String(raw).trim().replace(/\s+/g, ' ').slice(0, 120);
  return city || null;
}

/**
 * Linha curta para chips / listas: "Remoto · São Paulo, SP"
 */
export function formatWorkplaceLabel(
  { workplaceModality, workplaceCity, workplaceState } = {},
  locale = 'pt-BR',
  tFn
) {
  const parts = [];
  const modKey = workplaceModalityLabelKey(workplaceModality);
  if (modKey && typeof tFn === 'function') parts.push(tFn(locale, modKey));
  const city = normalizeWorkplaceCity(workplaceCity);
  const uf = normalizeWorkplaceState(workplaceState);
  if (city && uf) parts.push(`${city}, ${uf}`);
  else if (city) parts.push(city);
  else if (uf) parts.push(uf);
  return parts.join(' · ') || '';
}
