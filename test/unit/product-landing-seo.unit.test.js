import assert from 'node:assert/strict';

const seo = await import('../../lib/product-landing-seo.js');
const crawler = await import('../../lib/crawler-guard.js');

const pt = seo.getProductLandingCopy('pt-BR');
const en = seo.getProductLandingCopy('en');

assert.equal(pt.journeyStages.length, 4);
assert.equal(en.journeyStages.length, 4);
assert.match(pt.metaTitle, /recrutamento/i);
assert.match(en.metaTitle, /recruiting/i);
assert.match(pt.metaDescription, /RH|recrut|pessoas/i);
assert.match(en.metaDescription, /HR|recruit|people/i);
assert.match(pt.footerLegal, /não diagnóstico/i);
assert.match(en.footerLegal, /not diagnosis/i);
assert.equal(pt.ui.types.length, 9);
assert.equal(en.ui.types.length, 9);
assert.match(pt.employeeApp.title, /bolso/i);
assert.match(en.employeeApp.title, /pocket/i);
assert.match(pt.employeeApp.status, /outubro de 2026/i);
assert.match(en.employeeApp.status, /October 2026/i);
assert.match(seo.getProductLandingCopy('es-ES').employeeApp.status, /octubre de 2026/i);
assert.ok(pt.employeeApp.features.some((item) => /2FA/.test(item)));
assert.match(pt.hrReports.title, /dado|reunião/i);
assert.match(en.hrReports.title, /data|meeting/i);
assert.equal(pt.hrReports.groups.length, 3);
assert.equal(en.hrReports.groups.length, 3);
assert.doesNotMatch(JSON.stringify({ pt, en }), /\bDISC\b/i);

const llms = seo.buildProductLlmsTxt();
assert.match(llms, /\/jobs\/{slug\}-\{id\}/);
assert.match(llms, /\/companies\/\{companySlug\}/);
assert.doesNotMatch(llms, /Public jobs: .*\/j\n/);
assert.match(llms, /T1–T9/);
assert.match(llms, /Motivadores|Motivators/);
assert.match(llms, /App do colaborador/);
assert.match(llms, /iOS e Android/);
assert.match(llms, /Relatórios para gestão de RH/);
assert.match(llms, /Time-to-hire/i);
assert.match(llms, /não é diagnóstico clínico|not a clinical diagnosis/i);
assert.doesNotMatch(llms, /\bDISC\b/i);

const jsonLd = JSON.parse(seo.buildProductLandingJsonLd('pt-BR'));
const types = jsonLd['@graph'].map((entry) => entry['@type']);
assert.ok(types.includes('Organization'));
assert.ok(types.includes('WebSite'));
assert.ok(types.includes('SoftwareApplication'));
assert.ok(types.includes('WebPage'));
assert.ok(types.includes('FAQPage'));
const software = jsonLd['@graph'].find((entry) => entry['@type'] === 'SoftwareApplication');
assert.match(software.operatingSystem, /iOS/);
assert.ok(software.featureList.some((item) => /2FA/.test(item)));
assert.ok(software.featureList.some((item) => /Contratar melhor/i.test(item)));

// Translated landings must not fall back to English copy (ids, icons and brand excepted).
const flatStrings = (node, path = '', out = []) => {
  if (typeof node === 'string') out.push([path, node]);
  else if (Array.isArray(node)) node.forEach((v, i) => flatStrings(v, `${path}[${i}]`, out));
  else if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) flatStrings(v, path ? `${path}.${k}` : k, out);
  return out;
};
const enStrings = new Map(flatStrings(en));
const sameAsEnglishOk = /(\.id|\.icon|^footerBrand|^ui\.navModules|^ui\.navBlog|^ui\.types\[\d\]\.name|^ui\.pipelineStages\[0\]|metrics\[0\]\.label)$/;
for (const locale of ['es-419', 'es-ES', 'fr-FR', 'de-DE', 'pt-PT']) {
  const untranslated = flatStrings(seo.getProductLandingCopy(locale))
    .filter(([path, value]) => enStrings.get(path) === value && /[a-z]{3,}/i.test(value) && !sameAsEnglishOk.test(path))
    .map(([path]) => path);
  assert.deepEqual(untranslated, [], `${locale} landing has English fallback`);
}
for (const locale of ['pt-BR', 'en', 'es-419', 'fr-FR', 'de-DE']) {
  const step1 = seo.getProductLandingCopy(locale).steps[0].body;
  assert.match(step1, /conta|account|cuenta|compte|Konto/i, `${locale} step 1 mentions self-serve signup`);
}

const gptRule = crawler.buildRobotsRules().find((rule) => rule.userAgent === 'GPTBot');
assert.ok(gptRule.allow.includes('/'));
assert.ok(gptRule.allow.includes('/llms.txt'));
assert.ok(gptRule.disallow.includes('/dashboard'));
assert.ok(gptRule.disallow.includes('/v/'));
assert.ok(!gptRule.disallow.includes('/jobs'));

console.log('product landing SEO unit: ok');
