import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  PRIVACY_CONTACT_EMAIL,
  PUBLIC_LEGAL_VERSION,
  PUBLIC_TERMS_VERSION,
  CANCELLATION_POLICY_PATH,
  buildPublicLegalMetadata,
  getPublicLegalDocument,
} from '../../lib/marketing/public-legal.js';

describe('public legal documents', () => {
  it('publishes complete bilingual privacy and terms copy', () => {
    for (const locale of ['pt-BR', 'en']) {
      for (const kind of ['privacy', 'terms']) {
        const copy = getPublicLegalDocument(kind, locale);
        assert.equal(copy.kind, kind);
        assert.equal(copy.locale, locale);
        assert.ok(copy.document.title);
        assert.ok(copy.document.description);
        assert.ok(copy.document.sections.length >= 9);
        assert.doesNotMatch(JSON.stringify(copy), / — /);
      }
    }
    assert.match(PRIVACY_CONTACT_EMAIL, /@/);
    assert.match(PUBLIC_LEGAL_VERSION, /^\d{4}\.\d{2}$/);
  });

  it('publishes the approved cancellation policy without an extra first-charge guarantee', () => {
    for (const locale of ['pt-BR', 'en']) {
      const terms = getPublicLegalDocument('terms', locale);
      const privacy = getPublicLegalDocument('privacy', locale);
      assert.ok(terms.common.version.includes(PUBLIC_TERMS_VERSION));
      assert.ok(!privacy.common.version.includes(PUBLIC_TERMS_VERSION));
      const sections = terms.document.sections;
      const ids = sections.filter(s => s.id).map(s => s.id);
      assert.equal(new Set(ids).size, ids.length);
      for (const id of ['assinaturas', 'cancelamento-e-reembolso', 'reembolsos', 'solicitar-reembolso']) assert.ok(ids.includes(id));
      const refunds = sections.find(s => s.id === 'reembolsos').paragraphs.join(' ');
      assert.match(refunds, /7 (dias|days)/);
      assert.doesNotMatch(refunds, /garantia comercial|commercial guarantee/i);
      assert.match(refunds, /proporcional|proportional/);
      assert.match(sections.find(s => s.id === 'solicitar-reembolso').paragraphs.join(' '), /contact@3035tech.com/);
      assert.match(terms.common.contactLabel, /Atendimento|Support/);
    }
    assert.equal(CANCELLATION_POLICY_PATH, '/terms#cancelamento-e-reembolso');
  });

  it('keeps legal pages indexable with their own canonical URL', () => {
    const privacy = buildPublicLegalMetadata('privacy', 'pt-BR');
    const terms = buildPublicLegalMetadata('terms', 'en');
    assert.equal(privacy.robots.index, true);
    assert.match(String(privacy.alternates.canonical), /\/privacy$/);
    assert.match(String(terms.alternates.canonical), /\/terms$/);
  });

  it('exposes legal links in public acquisition surfaces and sitemap', () => {
    const landing = readFileSync('app/_components/ProductLandingClient.jsx', 'utf8');
    const pricing = readFileSync('app/_components/PricingPageClient.jsx', 'utf8');
    const signup = readFileSync('app/signup/page.jsx', 'utf8');
    const sitemap = readFileSync('app/sitemap.js', 'utf8');
    for (const source of [landing, pricing, signup, sitemap]) {
      assert.match(source, /\/privacy/);
      assert.match(source, /\/terms/);
    }
  });

  it('keeps sensitive whistleblowing queries company scoped', () => {
    const source = readFileSync('lib/people/whistleblowing.js', 'utf8');
    assert.match(source, /WHERE r\.company_id = \$1/);
    assert.match(source, /WHERE company_id = \$\$\{params\.length - 1\} AND id =/);
    assert.match(source, /never report body text/i);
  });
});
