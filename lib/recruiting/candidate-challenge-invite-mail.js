/**
 * E-mail transactional: RH convida candidato com link público `/v/:token` da vaga.
 * HTML com estilos inline para clientes comuns de e-mail.
 */
import { DEFAULT_LOCALE, localeHtmlLang, normalizeLocale, t } from '../i18n.js';

import brandTokens from '../brand-tokens.cjs';

const { GROW } = brandTokens;
const ACCENT = GROW.action;
const TEXT = GROW.textPrimary;
const MUTED = GROW.textSecondary;

/** Primeira palavra do nome para saudação. */
export function greetingName(fullName, locale = DEFAULT_LOCALE) {
  const first = String(fullName || '').trim().split(/\s+/)[0];
  return first || t(locale, 'mail.challenge.fallbackName');
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

/**
 * @param {{
 *   candidateFullName: string,
 *   vacancyTitle: string,
 *   companyName?: string|null,
 *   challengeUrl: string,
 *   locale?: string,
 * }} p
 */
export function buildCandidateChallengeInviteMail({
  candidateFullName,
  vacancyTitle,
  companyName,
  challengeUrl,
  locale = DEFAULT_LOCALE,
}) {
  const loc = normalizeLocale(locale);
  const name = greetingName(candidateFullName, loc);
  const title = String(vacancyTitle || '').trim() || t(loc, 'mail.challenge.fallbackTitle');
  const hasCompany = Boolean(companyName?.trim());
  const subject = hasCompany
    ? t(loc, 'mail.challenge.subjectWithCompany', { company: companyName.trim() })
    : t(loc, 'mail.challenge.subjectNoCompany');

  const safeUrl = escapeAttr(challengeUrl);
  const safeTitle = escapeHtml(title);

  const textIntro = hasCompany
    ? t(loc, 'mail.challenge.textIntroWithCompany', { company: companyName.trim(), title })
    : t(loc, 'mail.challenge.textIntroNoCompany', { title });

  const text = `${t(loc, 'mail.challenge.textGreeting', { name })}

${textIntro}

${t(loc, 'mail.challenge.textBody')}

${challengeUrl}

${t(loc, 'mail.challenge.textFooterNote')}

—
${t(loc, 'mail.challenge.textSignature')}`;

  const htmlIntro = hasCompany
    ? t(loc, 'mail.challenge.htmlIntroWithCompany', { company: escapeHtml(companyName.trim()), title: safeTitle })
    : t(loc, 'mail.challenge.htmlIntroNoCompany', { title: safeTitle });

  const html = `<!DOCTYPE html>
<html lang="${localeHtmlLang(loc)}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f2f8;font-family:Georgia,'Times New Roman',serif;-webkit-font-smoothing:antialiased;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
    ${escapeHtml(t(loc, 'mail.challenge.preheader', { title }))}
  </div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f2f8;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #E5E7EB;box-shadow:0 4px 24px rgba(76,29,149,0.06);">
          <tr>
            <td style="padding:28px 28px 8px 28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
              <p style="margin:0 0 20px 0;font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:${ACCENT};font-weight:600;">30Grow</p>
              <h1 style="margin:0 0 16px 0;font-size:22px;line-height:1.35;font-weight:600;color:${TEXT};">${t(loc, 'mail.challenge.htmlGreeting', { name: escapeHtml(name) })}</h1>
              <p style="margin:0 0 14px 0;font-size:16px;line-height:1.6;color:${TEXT};">
                ${htmlIntro}
              </p>
              <p style="margin:0 0 22px 0;font-size:15px;line-height:1.65;color:${MUTED};">
                ${t(loc, 'mail.challenge.htmlBody')}
              </p>
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 24px 0;">
                <tr>
                  <td style="border-radius:12px;background:${ACCENT};">
                    <a href="${safeUrl}" target="_blank" rel="noopener noreferrer"
                      style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
                      ${t(loc, 'mail.challenge.ctaButton')}
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 8px 0;font-size:13px;line-height:1.5;color:${MUTED};">
                ${t(loc, 'mail.challenge.htmlFallbackNote')}
              </p>
              <p style="margin:0 0 22px 0;font-size:12px;line-height:1.5;word-break:break-all;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;color:${ACCENT};">
                ${escapeHtml(challengeUrl)}
              </p>
              <p style="margin:0;font-size:13px;line-height:1.55;color:${MUTED};">
                ${t(loc, 'mail.challenge.htmlFooterNote')}
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 28px 26px 28px;border-top:1px solid #E5E7EB;background:#F8FAFC;">
              <p style="margin:0;font-size:12px;line-height:1.55;color:${MUTED};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
                ${t(loc, 'mail.challenge.htmlSignature')}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, text, html };
}
