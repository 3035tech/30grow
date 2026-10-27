/**
 * E-mail de acesso ao painel — convite ou redefinição de senha (link com token).
 */
import { DEFAULT_LOCALE, localeHtmlLang, normalizeLocale, t } from './i18n.js';

import brandTokens from './marketing/brand-tokens.cjs';

const { GROW } = brandTokens;
const ACCENT = GROW.action;
const TEXT = GROW.textPrimary;
const MUTED = GROW.textSecondary;

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

function mailPrefix(purpose) {
  return purpose === 'reset' ? 'mail.userAccessReset' : 'mail.userAccess';
}

/**
 * @param {{ email: string, setupUrl: string, locale?: string, displayName?: string|null, purpose?: 'invite'|'reset' }} opts
 */
export function buildUserPasswordInviteMail({
  email,
  setupUrl,
  locale = DEFAULT_LOCALE,
  displayName = null,
  purpose = 'invite',
  employee = null,
}) {
  const loc = normalizeLocale(locale);
  const prefix = employee ? 'employeeInvite' : mailPrefix(purpose);
  const copy = (key) => t(loc, `${prefix}.${key}`, { name, company: employee?.companyLabel });
  const name = String(displayName || '').trim().split(/\s+/)[0] || email;
  const subject = copy('subject');
  const safeUrl = escapeAttr(setupUrl);

  if (employee) {
    const paragraphs = ['intro', 'body'];
    const text = [copy('greeting'), ...paragraphs.map(copy), `${copy('email')}: ${email}`, `${copy('cta')}: ${setupUrl}`, copy('expiry'), copy('portalIntro'), `${copy('portal')}: ${employee.portalUrl}`, copy('help'), copy('signature')].join('\n\n');
    const p = value => `<p style="font-size:16px;line-height:1.6;overflow-wrap:anywhere;word-break:break-word;color:${TEXT};">${escapeHtml(value)}</p>`;
    const html = `<!DOCTYPE html><html lang="${localeHtmlLang(loc)}"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /></head><body style="margin:0;background:#f4f2f8;font-family:Arial,sans-serif;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px;"><table role="presentation" width="100%" style="max-width:560px;background:#fff;"><tr><td style="padding:28px;"><p style="color:${ACCENT};font-weight:bold;">30 Grow</p><h1 style="font-size:24px;">${escapeHtml(copy('greeting'))}</h1>${paragraphs.map(key => p(copy(key))).join('')}${p(`${copy('email')}: ${email}`)}<a href="${safeUrl}" style="display:inline-block;padding:16px 24px;background:${ACCENT};color:#fff;border-radius:12px;">${escapeHtml(copy('cta'))}</a>${p(copy('expiry'))}${p(`${copy('cta')}: ${setupUrl}`)}${p(copy('portalIntro'))}<a href="${escapeAttr(employee.portalUrl)}" style="color:${ACCENT};">${escapeHtml(copy('portal'))}</a>${p(employee.portalUrl)}${p(copy('help'))}${p(copy('signature'))}</td></tr></table></td></tr></table></body></html>`;
    return { subject, text, html };
  }

  const text = `${t(loc, `${prefix}.textGreeting`, { name })}

${t(loc, `${prefix}.textBody`)}

${t(loc, `${prefix}.textEmail`)}: ${email}

${setupUrl}

${t(loc, `${prefix}.textFooter`)}

—
${t(loc, `${prefix}.textSignature`)}`;

  const html = `<!DOCTYPE html>
<html lang="${localeHtmlLang(loc)}">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
<body style="margin:0;padding:0;background:#f4f2f8;font-family:Georgia,serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f2f8;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:560px;background:#fff;border-radius:16px;border:1px solid rgba(17,24,39,0.08);">
        <tr><td style="padding:28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
          <p style="margin:0 0 16px;font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:${ACCENT};font-weight:600;">${t(loc, `${prefix}.brand`)}</p>
          <h1 style="margin:0 0 14px;font-size:22px;color:${TEXT};">${t(loc, `${prefix}.htmlGreeting`, { name: escapeHtml(name) })}</h1>
          <p style="margin:0 0 14px;font-size:15px;line-height:1.65;color:${MUTED};">${t(loc, `${prefix}.htmlBody`)}</p>
          <p style="margin:0 0 20px;font-size:14px;color:${TEXT};"><strong>${t(loc, `${prefix}.textEmail`)}:</strong> ${escapeHtml(email)}</p>
          <a href="${safeUrl}" style="display:inline-block;padding:14px 28px;background:${ACCENT};color:#fff;text-decoration:none;border-radius:12px;font-weight:600;">${t(loc, `${prefix}.ctaButton`)}</a>
          <p style="margin:20px 0 0;font-size:12px;color:${MUTED};line-height:1.5;">${t(loc, `${prefix}.htmlFooter`)}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { subject, text, html };
}

function maskEmail(email) {
  const [local = '', domain = ''] = String(email || '').split('@');
  return `${local.slice(0, 2)}***@${domain}`;
}

/**
 * Notice to the previous corporate e-mail after HR changes it (account takeover signal).
 * The new address is masked.
 * @param {{ oldEmail: string, newEmail: string, companyLabel: string, locale?: string, displayName?: string|null }} opts
 */
export function buildEmployeeEmailChangedMail({ oldEmail, newEmail, companyLabel, locale = DEFAULT_LOCALE, displayName = null }) {
  return buildEmailChangedNotice('mail.employeeEmailChanged', {
    oldEmail,
    displayName,
    locale,
    vars: { companyLabel, maskedEmail: maskEmail(newEmail) },
  });
}

/**
 * Notice to the previous address after a dashboard user changes their own sign-in e-mail.
 * @param {{ oldEmail: string, newEmail: string, supportEmail: string, locale?: string, displayName?: string|null }} opts
 */
export function buildManagerEmailChangedMail({ oldEmail, newEmail, supportEmail, locale = DEFAULT_LOCALE, displayName = null }) {
  return buildEmailChangedNotice('mail.managerEmailChanged', {
    oldEmail,
    displayName,
    locale,
    vars: { maskedEmail: maskEmail(newEmail), supportEmail },
  });
}

function buildEmailChangedNotice(k, { oldEmail, displayName, locale, vars }) {
  const loc = normalizeLocale(locale);
  const name = String(displayName || '').trim().split(/\s+/)[0] || oldEmail;
  const subject = t(loc, `${k}.subject`, vars);
  const body = t(loc, `${k}.body`, vars);
  const text = `${t(loc, `${k}.greeting`, { name })}

${body}

${t(loc, `${k}.footer`, vars)}

${t(loc, `${k}.signature`)}`;

  const html = `<!DOCTYPE html>
<html lang="${localeHtmlLang(loc)}">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
<body style="margin:0;padding:0;background:#f4f2f8;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f2f8;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:560px;background:#fff;border-radius:16px;border:1px solid rgba(17,24,39,0.08);">
        <tr><td style="padding:28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
          <p style="margin:0 0 16px;font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:${ACCENT};font-weight:600;">${escapeHtml(t(loc, `${k}.brand`))}</p>
          <h1 style="margin:0 0 14px;font-size:22px;color:${TEXT};">${escapeHtml(t(loc, `${k}.greeting`, { name }))}</h1>
          <p style="margin:0 0 14px;font-size:15px;line-height:1.65;color:${MUTED};">${escapeHtml(body)}</p>
          <p style="margin:0;font-size:13px;line-height:1.5;color:${TEXT};">${escapeHtml(t(loc, `${k}.footer`, vars))}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { subject, text, html };
}

/** @deprecated use buildUserPasswordInviteMail */
export function buildUserAccessMail(opts) {
  if (opts?.setupUrl) return buildUserPasswordInviteMail(opts);
  const setupUrl = opts?.loginUrl || '';
  return buildUserPasswordInviteMail({ ...opts, setupUrl });
}
