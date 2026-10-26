/**
 * Redact opaque auth tokens from URLs before logging / audit metadata.
 * Tokens in path or query must never appear in logs.
 */

const PATH_TOKEN_RE =
  /\/(e|r|t|v|clima|pulso|assessment\/motivators|employee\/enter|employee\/set-password|a\/set-password)\/[^/?#]+/gi;
const QUERY_TOKEN_RE = /([?&](?:token|inviteToken|setupToken)=)[^&]*/gi;
const PRIVATE_KEYS = new Set(['password', 'passwd', 'senha', 'secret', 'authorization', 'cookie', 'setcookie', 'headers', 'body', 'payload', 'params', 'sql', 'sqlpreview', 'error', 'stack', 'detail', 'email', 'personalemail', 'phone', 'cpf', 'cnpj', 'document', 'documents', 'documentnumber', 'answers', 'responses', 'scores', 'salary', 'salaryexpectation', 'compensation', 'notes', 'hrnotes', 'content', 'cvtext', 'cvextractedtext', 'fullname', 'address']);

/**
 * @param {string|null|undefined} value
 * @returns {string}
 */
export function redactSensitiveUrl(value) {
  const raw = String(value || '');
  if (!raw) return '';
  return raw
    .replace(PATH_TOKEN_RE, '/$1/[redacted]')
    .replace(QUERY_TOKEN_RE, '$1[redacted]');
}

/**
 * @param {unknown} value
 * @returns {unknown}
 */
export function redactSensitiveValue(value) {
  if (value == null) return value;
  if (typeof value === 'string') {
    if (/^[A-Za-z0-9_-]{20,}$/.test(value) && value.length >= 24) return '[redacted]';
    return redactSensitiveUrl(value);
  }
  if (Array.isArray(value)) return value.map(redactSensitiveValue);
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const key = String(k).toLowerCase();
      if (
        key.includes('token') ||
        key.includes('password') ||
        key.includes('secret') ||
        PRIVATE_KEYS.has(key.replace(/[^a-z]/g, '')) ||
        key === 'setupurl' ||
        key === 'loginurl' ||
        key === 'applypath' ||
        key === 'applyurl'
      ) {
        out[k] = '[redacted]';
      } else {
        out[k] = redactSensitiveValue(v);
      }
    }
    return out;
  }
  return value;
}
