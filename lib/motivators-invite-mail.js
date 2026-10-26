/**
 * E-mail: convite para Assessment de Motivadores Profissionais.
 */
import { MOTIVATORS_DEFINITION } from './ae/motivators-dimensions.js';
import { DEFAULT_LOCALE, localeHtmlLang, normalizeLocale, t } from './i18n.js';

const SESSION_MINUTES = Math.max(10, Math.round((MOTIVATORS_DEFINITION.config.questions_per_session ?? 30) * 0.4));

import brandTokens from './marketing/brand-tokens.cjs';

const { GROW } = brandTokens;
const ACCENT = GROW.action;
const TEXT = GROW.textPrimary;
const MUTED = GROW.textSecondary;

export function greetingName(fullName, locale = DEFAULT_LOCALE) {
  const first = String(fullName || '').trim().split(/\s+/)[0];
  return first || t(locale, 'mail.motivators.fallbackName');
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, '&#39;');
}

export function buildMotivatorsInviteMail({ candidateFullName, companyName, assessmentUrl, locale = DEFAULT_LOCALE }) {
  const loc = normalizeLocale(locale);
  const name = greetingName(candidateFullName, loc);
  const hasCompany = Boolean(companyName?.trim());
  const subject = hasCompany
    ? t(loc, 'mail.motivators.subjectWithCompany', { company: companyName.trim() })
    : t(loc, 'mail.motivators.subjectNoCompany');
  const safeUrl = escapeAttr(assessmentUrl);

  const textIntro = hasCompany
    ? t(loc, 'mail.motivators.textIntroWithCompany', { company: companyName.trim() })
    : t(loc, 'mail.motivators.textIntroNoCompany');

  const text = `${t(loc, 'mail.motivators.textGreeting', { name })}

${textIntro}

${t(loc, 'mail.motivators.textBody', { minutes: SESSION_MINUTES })}

${assessmentUrl}

${t(loc, 'mail.motivators.textFooterNote')}

—
${t(loc, 'mail.motivators.textSignature')}`;

  const htmlIntro = hasCompany
    ? t(loc, 'mail.motivators.htmlIntroWithCompany', { company: escapeHtml(companyName.trim()) })
    : t(loc, 'mail.motivators.htmlIntroNoCompany');

  const html = `<!DOCTYPE html>
<html lang="${localeHtmlLang(loc)}">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
<body style="margin:0;padding:0;background:#f4f2f8;font-family:Georgia,serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f2f8;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:560px;background:#fff;border-radius:16px;border:1px solid rgba(17,24,39,0.08);">
        <tr><td style="padding:28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
          <p style="margin:0 0 16px;font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:${ACCENT};font-weight:600;">${t(loc, 'mail.motivators.brand')}</p>
          <h1 style="margin:0 0 14px;font-size:22px;color:${TEXT};">${t(loc, 'mail.motivators.htmlGreeting', { name: escapeHtml(name) })}</h1>
          <p style="margin:0 0 14px;font-size:16px;line-height:1.6;color:${TEXT};">
            ${htmlIntro}
          </p>
          <p style="margin:0 0 20px;font-size:15px;line-height:1.65;color:${MUTED};">
            ${t(loc, 'mail.motivators.htmlBody', { minutes: SESSION_MINUTES })}
          </p>
          <a href="${safeUrl}" style="display:inline-block;padding:14px 28px;background:${ACCENT};color:#fff;text-decoration:none;border-radius:12px;font-weight:600;">${t(loc, 'mail.motivators.ctaButton')}</a>
          <p style="margin:20px 0 0;font-size:12px;word-break:break-all;color:${ACCENT};font-family:monospace;">${escapeHtml(assessmentUrl)}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  return { subject, text, html };
}
