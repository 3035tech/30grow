import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pt from '../lib/i18n/catalogs/pt-BR.js';
import en from '../lib/i18n/catalogs/en-US.js';
import fr from '../lib/i18n/catalogs/fr-FR.js';
import de from '../lib/i18n/catalogs/de-DE.js';
import { getPublicLegalDocument } from '../lib/public-legal.js';

// Offline review artifact only. Never imports approvals into production.
const root = fileURLToPath(new URL('../', import.meta.url));
const destination = process.argv[2];
if (!destination) throw new Error('Usage: node scripts/export-i18n-review.mjs <output-directory>');
const output = resolve(destination);
const hash = value => createHash('sha256').update(value).digest('hex');
function flatten(node, prefix = '', rows = {}) {
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object') flatten(value, path, rows);
    else rows[path] = value;
  }
  return rows;
}
const catalogs = Object.fromEntries(Object.entries({ pt, en, fr, de }).map(([key, value]) => [key, flatten(value)]));
await mkdir(output, { recursive: true });
const sources = [
  'lib/data.js', 'lib/i18n-data.js', 'lib/type-en.js',
  'lib/ae/motivators-question-bank.js', 'lib/ae/motivators-dimensions.js',
  'lib/ae/templates.js', 'lib/ae/motivators-radar.js', 'lib/public-legal.js',
  ...['pt-BR', 'en-US', 'fr-FR', 'de-DE'].map(locale => `lib/i18n/catalogs/${locale}.js`),
];
const fingerprints = {};
for (const source of sources) {
  const content = await readFile(resolve(root, source), 'utf8');
  fingerprints[source] = hash(content);
}
for (const [locale, key] of [['fr-FR', 'fr'], ['de-DE', 'de']]) {
  const rows = Object.keys(catalogs.en).map(path => ({
    key: path, pt: catalogs.pt[path], en: catalogs.en[path], translation: catalogs[key][path],
    suggestedTranslation: '', reviewer: '', status: 'pending', notes: '',
  }));
  await writeFile(resolve(output, `ui-${locale}.json`), JSON.stringify(rows, null, 2) + '\n');
}
for (const locale of ['fr-FR', 'de-DE', 'es-ES', 'es-419']) {
  const documents = Object.fromEntries(['terms', 'privacy'].map(kind => [kind, {
    sourcePt: getPublicLegalDocument(kind, 'pt-BR'), sourceEn: getPublicLegalDocument(kind, 'en'),
    translation: null, reviewer: '', jurisdiction: '', status: 'pending', approvalReference: '',
  }]));
  await writeFile(resolve(output, `legal-${locale}.json`), JSON.stringify(documents, null, 2) + '\n');
}
const instruments = sources.filter(source => !source.includes('/catalogs/') && source !== 'lib/public-legal.js');
await writeFile(resolve(output, 'instrument-sources.json'), JSON.stringify({
  status: 'pending', note: 'Repository sources only; deployed Motivators questions/templates also require a versioned export by an authorized operator.',
  sources: await Promise.all(instruments.map(async path => ({ path, sha256: fingerprints[path], content: await readFile(resolve(root, path), 'utf8') }))),
  approvals: ['fr-FR', 'de-DE', 'es-ES', 'es-419'].map(locale => ({ locale, reviewer: '', status: 'pending', validationMethod: '', approvalReference: '' })),
}, null, 2) + '\n');
await writeFile(resolve(output, 'manifest.json'), JSON.stringify({
  generatedAt: new Date().toISOString(), sources: fingerprints,
  reviewStatus: 'pending', productionPublicationAuthorized: false,
}, null, 2) + '\n');
console.log(`Review package generated in ${output}; no translations approved or published.`);
