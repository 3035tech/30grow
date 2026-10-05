import assert from 'node:assert/strict';

const { localeFromAcceptLanguage, matchSupportedLocale, normalizeLocale, contentLocale, LOCALES } = await import(
  '../../lib/locale-negotiation.js'
);
const i18n = await import('../../lib/i18n.js');

assert.deepEqual(i18n.LOCALES, LOCALES);
assert.equal(i18n.LOCALE_COOKIE, 'NEXT_LOCALE');
assert.equal(i18n.localeShortCode('es-419'), 'ES');
assert.equal(i18n.localeShortCode('pt-PT'), 'PT');
assert.equal(i18n.localeShortCode('en'), 'EN');
assert.equal(i18n.localeShortCode('xx'), i18n.localeShortCode(normalizeLocale('xx')));
for (const loc of LOCALES) assert.match(i18n.localeShortCode(loc), /^[A-Z]{2}$/);

assert.equal(localeFromAcceptLanguage('pt-BR,pt;q=0.9,en;q=0.8'), 'pt-BR');
assert.equal(localeFromAcceptLanguage('pt-PT,pt;q=0.9'), 'pt-PT');
assert.equal(localeFromAcceptLanguage('pt'), 'pt-BR');
assert.equal(localeFromAcceptLanguage('es-MX,es;q=0.9'), 'es-419');
assert.equal(localeFromAcceptLanguage('es-AR'), 'es-419');
assert.equal(localeFromAcceptLanguage('es-ES'), 'es-ES');
assert.equal(localeFromAcceptLanguage('en-GB,en;q=0.9'), 'en');

assert.equal(localeFromAcceptLanguage('fr-FR,fr;q=0.9,de;q=0.8'), 'fr-FR');
assert.equal(localeFromAcceptLanguage('fr-CA'), 'fr-FR');
assert.equal(localeFromAcceptLanguage('de-AT,de;q=0.9'), 'de-DE');
assert.equal(localeFromAcceptLanguage('it-IT,de;q=0.4'), 'de-DE');
assert.equal(localeFromAcceptLanguage('ja,es;q=0.5'), 'es-419');
assert.equal(localeFromAcceptLanguage('en;q=0.3,pt-BR;q=0.9'), 'pt-BR');
assert.equal(localeFromAcceptLanguage('pt-BR;q=0,it'), 'en');
assert.equal(localeFromAcceptLanguage(''), 'en');
assert.equal(localeFromAcceptLanguage(null), 'en');
assert.equal(localeFromAcceptLanguage('*'), 'en');

assert.equal(matchSupportedLocale('pt_BR'), 'pt-BR');
assert.equal(matchSupportedLocale('it-IT'), null);

assert.equal(normalizeLocale('fr'), 'fr-FR');
assert.equal(normalizeLocale('de_ch'), 'de-DE');
assert.equal(normalizeLocale('xx'), 'pt-BR');
assert.equal(contentLocale('pt-PT'), 'pt-BR');
assert.equal(contentLocale('fr-FR'), 'en');
assert.equal(contentLocale('es-419'), 'en');

assert.deepEqual(i18n.localeFallbackChain('es-ES'), ['es-ES', 'es-419', 'en', 'pt-BR']);
assert.deepEqual(i18n.localeFallbackChain('pt-PT'), ['pt-PT', 'pt-BR', 'en']);
assert.deepEqual(i18n.localeFallbackChain('de-DE'), ['de-DE', 'en', 'pt-BR']);
assert.equal(i18n.localizedField('fr-FR', { pt: 'a', en: 'b' }), 'b');
assert.equal(i18n.localizedField('fr-FR', { pt: 'a', en: 'b', fr: 'c' }), 'c');
assert.equal(i18n.localizedField('pt-PT', { pt: 'a', en: 'b' }), 'a');
assert.equal(typeof i18n.messageNode('de-DE', 'panel.help').title, 'string');
for (const loc of LOCALES) {
  assert.equal(i18n.normalizeLocale(loc), loc);
  assert.ok(i18n.localeLabel(loc));
  assert.ok(i18n.localeHtmlLang(loc));
  assert.ok(i18n.localeRegionConfig(loc).currency);
}

console.log('locale negotiation unit: ok');
