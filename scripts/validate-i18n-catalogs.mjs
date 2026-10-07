import pt from '../lib/i18n/catalogs/pt-BR.js';
import en from '../lib/i18n/catalogs/en-US.js';
import fr from '../lib/i18n/catalogs/fr-FR.js';
import de from '../lib/i18n/catalogs/de-DE.js';
function flatten(node, prefix = '', result = {}) {
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) flatten(value, path, result);
    else result[path] = value;
  }
  return result;
}
const placeholders = (value) => [...new Set(String(value).match(/\{[a-zA-Z_][a-zA-Z0-9_]*\}/g) || [])].sort().join(',');
const base = flatten(en);
const results = {};
for (const [locale, catalog] of Object.entries({ 'pt-BR': pt, en, 'fr-FR': fr, 'de-DE': de })) {
  const values = flatten(catalog);
  const missing = Object.keys(base).filter((key) => !(key in values));
  const extra = Object.keys(values).filter((key) => !(key in base));
  const placeholderMismatch = Object.keys(base).filter((key) => key in values && placeholders(values[key]) !== placeholders(base[key]));
  const invalidValues = Object.keys(base).filter((key) => key in values && (
    typeof values[key] !== typeof base[key]
    || Array.isArray(values[key]) !== Array.isArray(base[key])
    || (typeof values[key] === 'string' && !values[key].trim() && String(base[key]).trim())
  ));
  results[locale] = { keys: Object.keys(values).length, missing, extra, placeholderMismatch, invalidValues };
}
console.log(JSON.stringify({ technicalValidationOnly: true, catalogs: results }, null, 2));
if (Object.values(results).some((r) => r.missing.length || r.extra.length || r.placeholderMismatch.length || r.invalidValues.length)) process.exitCode = 1;
