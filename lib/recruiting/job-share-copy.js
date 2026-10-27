/**
 * Textos sugeridos + URLs com UTM para compartilhar vaga pública.
 */

import { t as i18nT, contentLocale } from '../i18n.js';

/**
 * @param {string} pageUrl
 * @param {{ source: string, medium?: string, campaign?: string }} utm
 */
export function withShareUtm(pageUrl, utm) {
  const raw = String(pageUrl || '').trim();
  if (!raw) return '';
  try {
    const u = new URL(raw, 'http://localhost');
    if (utm?.source) u.searchParams.set('utm_source', String(utm.source));
    if (utm?.medium) u.searchParams.set('utm_medium', String(utm.medium || 'social'));
    if (utm?.campaign) u.searchParams.set('utm_campaign', String(utm.campaign));
    if (/^https?:\/\//i.test(raw)) return u.toString();
    return `${u.pathname}${u.search}${u.hash}`;
  } catch {
    return raw;
  }
}

/**
 * @param {{ title?: string, companyName?: string|null, pageUrl?: string, employmentLabel?: string|null }} posting
 * @param {'pt-BR'|'en'|string} locale
 */
export function buildJobShareCopy(posting, locale = 'pt-BR') {
  const en = contentLocale(locale) === 'en';
  const title = String(posting?.title || (i18nT(locale, 'ui.jobShareCopy.openRole'))).trim();
  const company = String(posting?.companyName || '').trim();
  const emp = String(posting?.employmentLabel || '').trim();
  const baseUrl = String(posting?.pageUrl || '').trim();

  const waUrl = withShareUtm(baseUrl, { source: 'whatsapp', medium: 'social' });
  const liUrl = withShareUtm(baseUrl, { source: 'linkedin', medium: 'social' });

  const whatsappText = en
    ? [
        `Role: ${title}`,
        company ? `Company: ${company}` : null,
        emp ? `Employment: ${emp}` : null,
        `Details and apply:`,
        waUrl,
      ]
        .filter(Boolean)
        .join('\n')
    : [
        `Vaga: ${title}`,
        company ? `Empresa: ${company}` : null,
        emp ? `Contratação: ${emp}` : null,
        `Detalhes e candidatura:`,
        waUrl,
      ]
        .filter(Boolean)
        .join('\n');

  const linkedinText = en
    ? [
        `We're hiring: ${title}`,
        company ? company : null,
        emp || null,
        `Learn more:`,
        liUrl,
      ]
        .filter(Boolean)
        .join('\n')
    : [
        `Estamos contratando: ${title}`,
        company || null,
        emp || null,
        `Saiba mais:`,
        liUrl,
      ]
        .filter(Boolean)
        .join('\n');

  return {
    pageUrl: baseUrl,
    whatsappUrl: waUrl,
    linkedinUrl: liUrl,
    whatsappText,
    linkedinText,
    whatsappShareHref: waUrl
      ? `https://wa.me/?text=${encodeURIComponent(whatsappText)}`
      : '',
    linkedinShareHref: liUrl
      ? `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(liUrl)}`
      : '',
  };
}
