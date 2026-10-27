'use client';

import AssessmentFlow from '../../_components/AssessmentFlow';
import { errorMessage, t } from '../../../lib/i18n';
import { useLocale } from '../../../lib/useLocale';

/**
 * Client shell for /t/[token] — link payload comes from RSC (no loading flash).
 */
export default function CompanyTokenClient({ token, initial }) {
  const [locale, setLocale] = useLocale();
  const tokenValue = String(token || '').trim();

  if (!initial?.ok) {
    const code = initial?.errorCode || 'EXPIRED_LINK';
    const message =
      code === 'INVALID_TOKEN'
        ? t(locale, 'publicPages.invalidLink')
        : errorMessage(locale, code, t(locale, 'errors.EXPIRED_LINK'));
    return (
      <AssessmentFlow
        companyToken={tokenValue}
        notice={{
          kind: 'warning',
          title: t(locale, 'publicPages.invalidOpenTitle'),
          message,
          hint: t(locale, 'publicPages.invalidLinkHint'),
        }}
        startDisabled={true}
        initialLocale={locale}
        onLocaleChange={setLocale}
      />
    );
  }

  const c = initial.company;
  const notice = c?.name
    ? { kind: 'info', title: t(locale, 'publicPages.companyTitle'), message: t(locale, 'publicPages.companyMessage', { name: c.name }) }
    : { kind: 'info', title: t(locale, 'publicPages.validLinkTitle'), message: t(locale, 'publicPages.validLinkMessage') };

  return (
    <AssessmentFlow
      companyToken={tokenValue}
      notice={notice}
      requireCandidateEmail={true}
      initialLocale={locale}
      onLocaleChange={setLocale}
    />
  );
}
