import { DEFAULT_LOCALE, localeHtmlLang, normalizeLocale, t } from '../i18n.js';
import brandTokens from '../marketing/brand-tokens.cjs';

function escapeHtml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function buildEmployeeEnneagramInviteMail({ fullName, companyName, assessmentUrl, locale = DEFAULT_LOCALE }) {
  const loc = normalizeLocale(locale);
  const name = String(fullName || '').trim().split(/\s+/)[0];
  const subject = t(loc, 'mail.employeeEnneagram.subject', { company: companyName });
  const greeting = t(loc, 'mail.employeeEnneagram.greeting', { name });
  const intro = t(loc, 'mail.employeeEnneagram.intro', { company: companyName });
  const instruction = t(loc, 'mail.employeeEnneagram.instruction');
  const footer = t(loc, 'mail.employeeEnneagram.footer');
  const safeUrl = escapeHtml(assessmentUrl);
  return {
    subject,
    text: `${greeting}\n\n${intro}\n\n${instruction}\n\n${assessmentUrl}\n\n${footer}`,
    html: `<!doctype html><html lang="${localeHtmlLang(loc)}"><head><meta charset="utf-8"></head><body style="margin:0;padding:24px 12px;background:#f4f2f8;font-family:Arial,sans-serif;color:${brandTokens.GROW.textPrimary}"><div style="max-width:560px;margin:auto;padding:28px;border-radius:16px;background:#fff"><p style="color:${brandTokens.GROW.action};font-weight:700">30Grow</p><h1 style="font-size:22px">${escapeHtml(greeting)}</h1><p>${escapeHtml(intro)}</p><p>${escapeHtml(instruction)}</p><p style="margin:28px 0"><a href="${safeUrl}" style="display:inline-block;padding:14px 22px;border-radius:10px;background:${brandTokens.GROW.action};color:#fff;text-decoration:none;font-weight:700">${escapeHtml(t(loc, 'mail.employeeEnneagram.cta'))}</a></p><p>${escapeHtml(t(loc, 'mail.employeeEnneagram.linkFallback'))}</p><p style="word-break:break-all"><a href="${safeUrl}">${safeUrl}</a></p><p style="font-size:13px;color:${brandTokens.GROW.textSecondary}">${escapeHtml(footer)}</p></div></body></html>`,
  };
}
