/** Canonicalize legacy numeric keys without rescaling independent weights. */
export function normalizeRubric(rubric) {
  if (!rubric || typeof rubric !== 'object' || Array.isArray(rubric)) return {};
  const normalized = {};
  for (let type = 1; type <= 9; type++) {
    const key = `T${type}`;
    // An explicit canonical zero overrides a legacy nonzero value.
    const raw = Object.hasOwn(rubric, key) ? rubric[key] : rubric[String(type)];
    const value = parseFloat(raw);
    if (Number.isFinite(value) && value >= 0 && value <= 100) normalized[key] = Math.round(value);
  }
  return normalized;
}
