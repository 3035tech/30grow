/** Namespaced list state is navigation context, never form/document data. */
export const LIST_URL_PREFIX = 'list.';
export function parseListValue(raw, fallback, field) {
  if (raw == null || raw.length > 2000) return fallback;
  try {
    const value = JSON.parse(raw);
    if (typeof value !== typeof fallback || value == null || Array.isArray(value)) return fallback;
    if (typeof fallback === 'number') {
      if (!Number.isSafeInteger(value) || value < 1 || value > 1_000_000) return fallback;
      if (field === 'pageSize' && ![10, 20, 30, 50, 100].includes(value)) return fallback;
    }
    if (typeof fallback === 'string' && value.length > 300) return fallback;
    if (typeof fallback === 'object') {
      if (Object.keys(value).some((key) => !Object.hasOwn(fallback, key))) return fallback;
      if (
        'tagIds' in fallback &&
        (!Array.isArray(value.tagIds) ||
          value.tagIds.length > 30 ||
          value.tagIds.some((id) => !Number.isSafeInteger(id) || id <= 0) ||
          !['any', 'all', 'none'].includes(value.tagMode))
      )
        return fallback;
    }
    return value;
  } catch {
    return fallback;
  }
}
