#!/usr/bin/env node
/**
 * Machine-translates the English UI catalog (and landing copy) into a new locale.
 * Output is a first draft: a native speaker must review before relying on wording.
 *
 *   node --env-file=.env scripts/i18n-translate-catalog.mjs --locale fr-FR
 *   node --env-file=.env scripts/i18n-translate-catalog.mjs --locale de-DE --target landing
 *
 * Options:
 *   --locale fr-FR|de-DE     required
 *   --target catalog|landing|all   default all
 *   --force                  retranslate keys that already exist in the target
 *   --limit N                translate at most N strings (smoke runs)
 *   --concurrency N          parallel requests (default 4)
 *   --export-pending DIR     write missing strings to DIR/<locale>-<target>-NNN.json (no API call)
 *   --import DIR             merge DIR/<locale>-<target>-NNN.out.json back (same validation, no API call)
 *
 * Offline flow (translator or agent without an API key): export, translate each file's
 * "items" values into a sibling .out.json with the same keys, then import.
 *
 * Only missing keys are sent, so reruns are incremental. Each result must keep
 * the source placeholders ({name}), HTML tags, line breaks and brand tokens, and
 * must not contain " — "; failures are skipped and fall back to English at runtime.
 * Env: OPENAI_API_KEY; model via OPENAI_TRANSLATE_MODEL (else OPENAI_RUBRIC_MODEL / gpt-4o-mini).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const LOCALE_GUIDES = {
  'fr-FR': {
    language: 'French (France)',
    guide: [
      'Use the formal "vous" form.',
      'HR = "RH"; employee = "collaborateur"/"collaboratrice"; manager = "manager"; hiring manager/recruiter wording stays natural for French HR software.',
      'Enneagram = "Ennéagramme"; Motivators = "Motivateurs"; 1:1 stays "1:1"; OKR, LMS, ATS and PDF stay as is.',
      'Use French typography: a non-breaking space is NOT required, keep plain spaces before ":" "?" "!".',
    ],
  },
  'de-DE': {
    language: 'German (Germany)',
    guide: [
      'Use the formal "Sie" form.',
      'HR = "HR" or "Personalabteilung" when needed; employee = "Mitarbeitende"/"Mitarbeiter:in"; manager = "Führungskraft".',
      'Enneagram = "Enneagramm"; Motivators = "Motivatoren"; 1:1 = "1:1-Gespräch" where a noun is needed; OKR, LMS, ATS and PDF stay as is.',
      'Prefer concise UI wording; avoid overly long compound words in buttons when a shorter phrasing exists.',
    ],
  },
};

/** Identifier-like fields copied verbatim instead of translated. */
const VERBATIM_KEYS = new Set(['icon', 'href', 'id', 'slug', 'url', 'src', 'path']);

const BRAND_TOKENS = ['30Grow', '3035Tech', 'T1–T9', 'OKR', 'LMS', 'PDF', '2FA'];

function parseArgs(argv) {
  const opts = { target: 'all', force: false, limit: Infinity, concurrency: 4 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--locale') opts.locale = argv[++i];
    else if (arg === '--target') opts.target = argv[++i];
    else if (arg === '--force') opts.force = true;
    else if (arg === '--limit') opts.limit = Number(argv[++i]) || Infinity;
    else if (arg === '--concurrency') opts.concurrency = Math.max(1, Number(argv[++i]) || 4);
    else if (arg === '--export-pending') opts.exportDir = argv[++i];
    else if (arg === '--import') opts.importDir = argv[++i];
  }
  return opts;
}

function flatten(node, prefix = [], out = new Map()) {
  if (typeof node === 'string') out.set(JSON.stringify(prefix), node);
  else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) flatten(value, [...prefix, Array.isArray(node) ? Number(key) : key], out);
  }
  return out;
}

/** Rebuilds `source` shape with translated strings; untranslated leaves are omitted. */
function rebuild(source, translated, prefix = []) {
  if (typeof source === 'string') return translated.get(JSON.stringify(prefix));
  if (Array.isArray(source)) {
    const items = source.map((value, index) => rebuild(value, translated, [...prefix, index]));
    return items.every((value) => value !== undefined) ? items : undefined;
  }
  if (source && typeof source === 'object') {
    const out = {};
    for (const [key, value] of Object.entries(source)) {
      const next = rebuild(value, translated, [...prefix, key]);
      if (next !== undefined) out[key] = next;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return source;
}

function quote(value) {
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r/g, '\\r').replace(/\n/g, '\\n')}'`;
}

function serialize(value, indent = 0) {
  const pad = ' '.repeat(indent);
  if (Array.isArray(value)) return `[\n${value.map((item) => `${pad}  ${serialize(item, indent + 2)},`).join('\n')}\n${pad}]`;
  if (value && typeof value === 'object') {
    return `{\n${Object.entries(value).map(([key, item]) => `${pad}  ${/^[A-Za-z_$][\w$]*$/.test(key) ? key : quote(key)}: ${serialize(item, indent + 2)},`).join('\n')}\n${pad}}`;
  }
  return typeof value === 'string' ? quote(value) : String(value);
}

function writeModule(file, header, value) {
  writeFileSync(file, `${header}\nexport default ${serialize(value ?? {}, 0)};\n`);
}

const sortedMatches = (text, re) => (String(text).match(re) || []).slice().sort();

/** Returns the fixed translation, or null when it breaks an invariant of the source. */
function validate(source, output) {
  if (typeof output !== 'string' || (!output.trim() && source.trim())) return null;
  let text = output;
  const lead = source.match(/^\s*/)[0];
  const trail = source.match(/\s*$/)[0];
  text = lead + text.trim() + trail;
  if (text.includes(' — ')) return null;
  const same = (re) => JSON.stringify(sortedMatches(source, re)) === JSON.stringify(sortedMatches(text, re));
  if (!same(/\{\w+\}/g)) return null;
  if (!same(/<\/?[a-z][^>]*>/gi)) return null;
  if ((source.match(/\n/g) || []).length !== (text.match(/\n/g) || []).length) return null;
  for (const token of BRAND_TOKENS) if (source.includes(token) && !text.includes(token)) return null;
  return text;
}

function systemPrompt(locale) {
  const { language, guide } = LOCALE_GUIDES[locale];
  return [
    `You translate UI strings of 30Grow, an HR SaaS (recruiting, work-style profiles based on the Enneagram, people management), from English into ${language}.`,
    'Rules:',
    '- Return JSON {"items": {"<id>": "<translation>"}} with exactly the same ids.',
    '- Keep every {placeholder} unchanged, keep HTML tags, URLs, e-mail addresses, emoji and symbols such as · → ← ✕ … unchanged.',
    '- Keep line breaks (\\n) and leading/trailing spaces as in the source.',
    '- Keep brand and product terms unchanged: 30Grow, 3035Tech, T1–T9 (and codes like T4), OKR, LMS, ATS, PDF, 2FA, 1:1.',
    '- Profile wording must stay hedged ("tends to", "there are signs"), never a clinical diagnosis.',
    '- Never use a spaced em dash (" — "); use ":" or a new sentence instead.',
    '- Match the length and register of UI copy: short labels stay short.',
    ...guide.map((line) => `- ${line}`),
  ].join('\n');
}

async function translateBatch(openAiChatCompletion, extractJsonObject, locale, entries) {
  const payload = Object.fromEntries(entries.map(([, text], index) => [String(index), text]));
  const raw = await openAiChatCompletion({
    messages: [
      { role: 'system', content: systemPrompt(locale) },
      { role: 'user', content: JSON.stringify({ items: payload }) },
    ],
    temperature: 0.2,
    maxTokens: 8000,
    responseFormat: 'json_object',
  });
  const items = JSON.parse(extractJsonObject(raw))?.items || {};
  return entries.map(([key, text], index) => [key, text, validate(text, items[String(index)])]);
}

function chunk(entries, maxItems = 40, maxChars = 5000) {
  const batches = [];
  let current = [];
  let chars = 0;
  for (const entry of entries) {
    if (current.length && (current.length >= maxItems || chars + entry[1].length > maxChars)) {
      batches.push(current);
      current = [];
      chars = 0;
    }
    current.push(entry);
    chars += entry[1].length;
  }
  if (current.length) batches.push(current);
  return batches;
}

async function runPool(tasks, concurrency) {
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
    while (next < tasks.length) await tasks[next++]();
  });
  await Promise.all(workers);
}

function prepareTree({ source, existing, opts }) {
  const sourceFlat = flatten(source);
  const translated = flatten(existing || {});
  for (const key of [...translated.keys()]) if (!sourceFlat.has(key)) translated.delete(key);
  const verbatim = (key) => !String(sourceFlat.get(key)).trim() || VERBATIM_KEYS.has(JSON.parse(key).at(-1));
  for (const key of sourceFlat.keys()) if (verbatim(key)) translated.set(key, sourceFlat.get(key));
  const pending = [...sourceFlat].filter(([key]) => !verbatim(key) && (opts.force || !translated.has(key))).slice(0, opts.limit);
  return { sourceFlat, translated, pending };
}

function exportPending({ locale, label, source, existing, opts }) {
  const { pending } = prepareTree({ source, existing, opts });
  mkdirSync(opts.exportDir, { recursive: true });
  const batches = chunk(pending, 400, 24000);
  batches.forEach((batch, index) => {
    const file = path.join(opts.exportDir, `${locale}-${label}-${String(index + 1).padStart(3, '0')}.json`);
    writeFileSync(file, `${JSON.stringify({
      locale,
      language: LOCALE_GUIDES[locale].language,
      rules: systemPrompt(locale),
      keys: batch.map(([key]) => key),
      items: Object.fromEntries(batch.map(([, text], i) => [String(i), text])),
    }, null, 2)}\n`);
  });
  console.log(`[${locale}] ${label}: ${pending.length} strings exported in ${batches.length} file(s) to ${opts.exportDir}`);
}

function importTranslations({ locale, label, source, existing, file, header, opts }) {
  const { sourceFlat, translated } = prepareTree({ source, existing, opts: { ...opts, limit: Infinity } });
  const prefix = `${locale}-${label}-`;
  const files = existsSync(opts.importDir)
    ? readdirSync(opts.importDir).filter((name) => name.startsWith(prefix) && name.endsWith('.out.json')).sort()
    : [];
  let applied = 0;
  const rejected = [];
  for (const name of files) {
    const data = JSON.parse(readFileSync(path.join(opts.importDir, name), 'utf8'));
    const exported = JSON.parse(readFileSync(path.join(opts.importDir, name.replace(/\.out\.json$/, '.json')), 'utf8'));
    for (const [id, output] of Object.entries(data.items || data)) {
      const key = exported.keys[Number(id)];
      const text = sourceFlat.get(key);
      if (typeof text !== 'string') continue;
      const ok = validate(text, output);
      if (ok == null) rejected.push([key, text]);
      else {
        translated.set(key, ok);
        applied += 1;
      }
    }
  }
  writeModule(file, header, rebuild(source, translated));
  console.log(`[${locale}] ${label}: ${files.length} file(s), ${applied} applied, ${rejected.length} rejected; wrote ${path.relative(ROOT, file)}`);
  for (const [key, text] of rejected.slice(0, 20)) console.log(`  - ${JSON.parse(key).join('.')}: ${text.slice(0, 80)}`);
}

async function translateTree({ locale, label, source, existing, file, header, opts, ai }) {
  const { translated, pending } = prepareTree({ source, existing, opts });
  console.log(`[${locale}] ${label}: ${translated.size + pending.length} strings, ${pending.length} to translate`);

  const failed = [];
  let done = 0;
  let sinceWrite = 0;
  const save = () => writeModule(file, header, rebuild(source, translated));
  const batches = chunk(pending);
  await runPool(batches.map((batch) => async () => {
    let results;
    try {
      results = await translateBatch(ai.openAiChatCompletion, ai.extractJsonObject, locale, batch);
    } catch (error) {
      if (error.code === 'RUBRIC_AI_AUTH') throw error;
      console.warn(`[${locale}] batch failed (${error.message}); retrying items one by one`);
      results = batch.map(([key, text]) => [key, text, null]);
    }
    const retry = results.filter(([, , out]) => out == null).map(([key, text]) => [key, text]);
    for (const [key, , out] of results) if (out != null) translated.set(key, out);
    for (const small of chunk(retry, 5)) {
      try {
        for (const [key, text, out] of await translateBatch(ai.openAiChatCompletion, ai.extractJsonObject, locale, small)) {
          if (out != null) translated.set(key, out);
          else failed.push([key, text]);
        }
      } catch (error) {
        if (error.code === 'RUBRIC_AI_AUTH') throw error;
        failed.push(...small);
      }
    }
    done += batch.length;
    sinceWrite += batch.length;
    if (sinceWrite >= 400) {
      sinceWrite = 0;
      save();
    }
    process.stdout.write(`\r[${locale}] ${label}: ${done}/${pending.length}`);
  }), opts.concurrency);
  process.stdout.write('\n');
  save();
  console.log(`[${locale}] ${label}: wrote ${path.relative(ROOT, file)}; ${failed.length} strings kept in English`);
  for (const [key, text] of failed.slice(0, 20)) console.log(`  - ${JSON.parse(key).join('.')}: ${text.slice(0, 80)}`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!LOCALE_GUIDES[opts.locale]) {
    console.error(`Usage: --locale ${Object.keys(LOCALE_GUIDES).join('|')} [--target catalog|landing|all] [--force] [--limit N]`);
    process.exit(1);
  }
  const load = async (rel) => {
    const file = path.join(ROOT, rel);
    return existsSync(file) ? (await import(`${pathToFileURL(file).href}?t=${Date.now()}`)).default : {};
  };
  const header = (what) => `// Generated by scripts/i18n-translate-catalog.mjs from the English ${what}. Machine translation: review before relying on wording.`;

  let ai = null;
  if (!opts.exportDir && !opts.importDir) {
    if (process.env.OPENAI_TRANSLATE_MODEL) process.env.OPENAI_RUBRIC_MODEL = process.env.OPENAI_TRANSLATE_MODEL;
    ai = await import(pathToFileURL(path.join(ROOT, 'lib/openai-chat.js')).href);
    if (ai.isOpenAiMock() || !ai.isOpenAiConfigured()) {
      console.error('OPENAI_API_KEY missing or OPENAI_MOCK/DTOV set: refusing to write mock translations.');
      process.exit(1);
    }
  }
  const run = (args) => {
    if (opts.exportDir) return exportPending(args);
    if (opts.importDir) return importTranslations(args);
    return translateTree(args);
  };

  if (opts.target === 'all' || opts.target === 'catalog') {
    const rel = `lib/i18n/catalogs/${opts.locale}.js`;
    await run({
      locale: opts.locale, label: 'catalog', opts, ai,
      source: await load('lib/i18n/catalogs/en-US.js'),
      existing: await load(rel),
      file: path.join(ROOT, rel),
      header: header('catalog (en-US)'),
    });
  }
  if (opts.target === 'all' || opts.target === 'landing') {
    const rel = `lib/i18n/landing/${opts.locale}.js`;
    const { PRODUCT_LANDING_SOURCE_COPY } = await import(pathToFileURL(path.join(ROOT, 'lib/marketing/product-landing-seo.js')).href);
    await run({
      locale: opts.locale, label: 'landing', opts, ai,
      source: PRODUCT_LANDING_SOURCE_COPY,
      existing: await load(rel),
      file: path.join(ROOT, rel),
      header: header('landing copy'),
    });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
