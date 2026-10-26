/**
 * Evita open redirect: só aceita caminho relativo ao mesmo site (/…),
 * rejeita protocol-relative (//…), esquemas embutidos e sequências suspeitas.
 * @param {string | null | undefined} raw — valor bruto de ?redirect=
 * @param {string} [fallback='/dashboard']
 */
export function sanitizeLoginRedirect(raw, fallback = '/dashboard') {
  if (raw == null || typeof raw !== 'string') return fallback;

  let path = raw.trim();
  if (!path) return fallback;

  try {
    path = decodeURIComponent(path);
  } catch {
    return fallback;
  }

  path = path.trim();
  if (!path.startsWith('/') || path.startsWith('//')) return fallback;
  if (/^[\\/]{2,}/.test(path)) return fallback;
  if (path.includes('://')) return fallback;
  if (path.includes('\\')) return fallback;
  if (path.includes('\0')) return fallback;

  if (path.length > 2048) return fallback;

  return path;
}
