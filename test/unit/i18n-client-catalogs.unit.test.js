import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { catalogKeyForLocale, messages, t } from '../../lib/i18n.js';

function flatKeys(node, prefix = '', out = new Set()) {
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) flatKeys(value, path, out);
    else out.add(path);
  }
  return out;
}

describe('i18n client catalogs', () => {
  it('keeps every full catalog on the same key set (browser loads only one)', () => {
    const base = flatKeys(messages['pt-BR']);
    for (const key of ['en', 'fr-FR', 'de-DE']) {
      const other = flatKeys(messages[key]);
      const missing = [...other].filter((k) => !base.has(k));
      const extra = [...base].filter((k) => !other.has(k));
      assert.deepEqual(missing, [], `pt-BR missing keys present in ${key}`);
      assert.deepEqual(extra, [], `${key} missing keys present in pt-BR`);
    }
  });

  it('maps each UI locale to one full catalog', () => {
    assert.equal(catalogKeyForLocale('pt-PT'), 'pt-BR');
    assert.equal(catalogKeyForLocale('en-US'), 'en');
    assert.equal(catalogKeyForLocale('es-419'), 'en');
    assert.equal(catalogKeyForLocale('fr-FR'), 'fr-FR');
    assert.equal(catalogKeyForLocale('de-DE'), 'de-DE');
    assert.equal(t('pt-BR', 'panel.tour.stepHelpTitle'), 'Ajuda');
  });

  it('keeps catalogs out of the client bundle', () => {
    const i18n = readFileSync('lib/i18n.js', 'utf8');
    assert.doesNotMatch(i18n, /from '\.\/i18n\/catalogs\//);
    const config = readFileSync('next.config.js', 'utf8');
    assert.match(config, /NormalModuleReplacementPlugin/);
    assert.match(config, /bundled-catalogs\.client\.js/);
    const layout = readFileSync('app/layout.jsx', 'utf8');
    assert.match(layout, /<I18nBoot locales=\{\[locale, DEFAULT_LOCALE\]\}>/);
  });
});

it('keeps commercial interpolation markers intact in every full catalog', () => {
  const keys = ['faq5Q', 'faq5A', 'faq6Q', 'faq6A', 'usageNote', 'launchTitle', 'launchBody', 'launchSignupNote', 'launchCta', 'plansTitle', 'plansLead', 'firstTierRange', 'annualTierNote', 'customTierNote', 'quoteCta', 'featuresIncluded'];
  const markers = value => (value.match(/\{\w+\}/g) || []).sort();
  for (const key of keys) {
    const expected = markers(messages['pt-BR'].pricing[key]);
    for (const locale of ['en', 'fr-FR', 'de-DE']) {
      const value = messages[locale].pricing[key];
      assert.equal(typeof value, 'string', `${locale}: pricing.${key}`);
      assert.ok(value.trim());
      assert.deepEqual(markers(value), expected, `${locale}: pricing.${key}`);
    }
  }
});
