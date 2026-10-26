import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LOCALES,
  localeHtmlLang,
  localeAccessibleLabel,
  localeFlag,
  localeRegionConfig,
  localeLabel,
  normalizeLocale,
  t,
} from '../../lib/i18n.js';
import { buildProductLandingMetadata, getProductLandingCopy } from '../../lib/marketing/product-landing-seo.js';

test('regional locales normalize with stable aliases and region metadata', () => {
  assert.deepEqual(LOCALES, ['pt-BR', 'pt-PT', 'en', 'es-419', 'es-ES', 'fr-FR', 'de-DE']);
  assert.equal(normalizeLocale('en-US'), 'en');
  assert.equal(normalizeLocale('pt_pt'), 'pt-PT');
  assert.equal(normalizeLocale('es'), 'es-419');
  assert.equal(localeHtmlLang('en'), 'en-US');
  assert.equal(localeHtmlLang('es-419'), 'es-419');
  assert.equal(localeRegionConfig('pt-PT').currency, 'EUR');
  assert.equal(localeRegionConfig('es-419').region, '419');
  assert.equal(localeLabel('pt-PT'), 'Português');
  assert.equal(localeAccessibleLabel('pt-PT'), 'Português, Portugal');
  assert.equal(localeFlag('pt-BR'), '🇧🇷');
  assert.equal(localeFlag('es-419'), '🌎');
});

test('regional catalogs override high-traffic copy and fall back safely', () => {
  assert.equal(t('pt-PT', 'pricing.navEarly'), 'Experimentar 30 dias grátis');
  assert.equal(t('pt-BR', 'pricing.planName'), '30Grow Completo');
  assert.equal(t('en', 'pricing.planName'), '30Grow Complete');
  assert.equal(t('pt-BR', 'pricing.completePlanName'), '30Grow Completo');
  assert.equal(t('en', 'pricing.completePlanName'), '30Grow Complete');
  assert.equal(t('es-419', 'pricing.navEarly'), 'Probar 30 días gratis');
  assert.equal(t('es-419', 'pricing.completePlanName'), '30Grow Completo');
  assert.equal(t('es-419', 'common.closeMenu'), 'Cerrar menú');
  assert.equal(t('es-419', 'login.enter'), 'Iniciar sesión →');
  assert.equal(t('es-419', 'signup.title'), 'Crea tu cuenta');
  assert.equal(t('es-419', 'panel.dp.editProfile'), 'Editar ficha');
  assert.equal(t('es-419', 'panel.dp.profileTitle'), 'Información personal');
  assert.notEqual(t('es-419', 'pricing.planName'), 'pricing.planName');
});

test('Spanish landing copy is selected consistently', () => {
  const copy = getProductLandingCopy('es-419');
  assert.match(copy.metaTitle, /reclutamiento/i);
  assert.equal(copy.heroTitle, t('es-419', 'pricing.heroTitle'));
  assert.match(copy.heroTitle, /Gestión de personas/);
  assert.equal(copy.navPricing, 'Precios');
  assert.equal(copy.ui.navJourney, 'Cómo funciona');
  assert.equal(buildProductLandingMetadata('es-419').openGraph.locale, 'es_419');
});


test('Spain and Latin America retain distinct terminology and shared Spanish copy', () => {
  assert.equal(normalizeLocale('es_ES'), 'es-ES');
  assert.equal(localeHtmlLang('es-ES'), 'es-ES');
  assert.equal(localeFlag('es-ES'), '🇪🇸');
  assert.equal(localeLabel('es-ES'), 'Español (España)');
  assert.equal(localeLabel('es-419'), 'Español (Latinoamérica)');
  assert.equal(localeRegionConfig('es-ES').region, 'ES');
  assert.equal(t('es-ES', 'login.enter'), 'Iniciar sesión →');
  assert.equal(t('es-ES', 'panel.orgChart.managerTitle'), 'Responsable directo');
  assert.equal(t('es-419', 'panel.orgChart.managerTitle'), 'Jefe directo');
  assert.equal(t('es-ES', 'panel.dp.mobile'), 'Teléfono móvil');
  assert.equal(t('es-419', 'panel.dp.mobile'), 'Celular');
  assert.equal(t('pt-PT', 'panel.common.save'), 'Guardar');
  assert.equal(t('en', 'dashboard.notifInterviewScheduledTitle'), 'Interview scheduled');
  assert.equal(buildProductLandingMetadata('es-ES').openGraph.locale, 'es_ES');
  assert.equal(getProductLandingCopy('es-ES').navPricing, 'Precios');
});
