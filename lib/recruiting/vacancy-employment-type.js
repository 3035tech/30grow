/**
 * Formato de contratação da vaga (estágio / CLT / PJ / cooperado).
 */

export const VACANCY_EMPLOYMENT_TYPES = Object.freeze([
  'internship',
  'clt',
  'pj',
  'cooperative',
]);

export function normalizeEmploymentType(raw) {
  if (raw == null || raw === '') return null;
  const v = String(raw).trim().toLowerCase();
  return VACANCY_EMPLOYMENT_TYPES.includes(v) ? v : null;
}

export function employmentTypeLabelKey(type) {
  const v = normalizeEmploymentType(type);
  if (!v) return null;
  return `recruiting.employmentType_${v}`;
}
