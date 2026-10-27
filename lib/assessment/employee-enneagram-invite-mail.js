import { DEFAULT_LOCALE, normalizeLocale, t } from '../i18n.js';

export function buildEmployeeEnneagramInviteMail({ fullName, companyName, assessmentUrl, locale = DEFAULT_LOCALE }) {
  const loc = normalizeLocale(locale);
  const name = String(fullName || '').trim().split(/\s+/)[0];
  return {
    subject: t(loc, 'mail.employeeEnneagram.subject', { company: companyName }),
    text: `${t(loc, 'mail.employeeEnneagram.greeting', { name })}\n\n${t(loc, 'mail.employeeEnneagram.intro', { company: companyName })}\n\n${t(loc, 'mail.employeeEnneagram.instruction')}\n\n${assessmentUrl}\n\n${t(loc, 'mail.employeeEnneagram.footer')}`,
  };
}
