'use client';

import { Suspense, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import AssessmentFlow from '../../_components/AssessmentFlow';
import { errorMessage, t } from '../../../lib/i18n';
import { useLocale } from '../../../lib/useLocale';

function VacancyEntryInner({ token, initial }) {
  const searchParams = useSearchParams();
  const inviteToken = String(searchParams?.get('invite') || '').trim();
  const [locale, setLocale] = useLocale();
  const tokenValue = String(token || '').trim();

  useEffect(() => {
    if (!inviteToken) return;
    (async () => {
      try {
        await fetch(`/api/public/invite-track?token=${encodeURIComponent(inviteToken)}`);
      } catch {
        /* best-effort */
      }
    })();
  }, [inviteToken]);

  if (!initial?.ok) {
    const code = initial?.errorCode || 'EXPIRED_LINK';
    const message =
      code === 'INVALID_TOKEN'
        ? t(locale, 'publicPages.invalidLink')
        : errorMessage(locale, code, t(locale, 'errors.EXPIRED_LINK'));
    return (
      <AssessmentFlow
        vacancyToken={tokenValue}
        inviteToken={inviteToken}
        notice={{
          kind: 'warning',
          title: t(locale, 'publicPages.invalidOpenTitle'),
          message,
          hint: t(locale, 'publicPages.invalidLinkHint'),
          action: { href: '/jobs', label: t(locale, 'publicVacancy.browseOpenCta') },
        }}
        startDisabled={true}
        initialLocale={locale}
        onLocaleChange={setLocale}
      />
    );
  }

  const v = initial.vacancy;
  const isClosed = String(v?.status || '') === 'closed';
  const notice = isClosed
    ? {
        kind: 'warning',
        title: t(locale, 'publicVacancy.closedTitle'),
        message: t(locale, 'publicVacancy.closedThanksAndBrowse', {
          title: v?.title || t(locale, 'publicVacancy.thisRole'),
        }),
        action: { href: '/jobs', label: t(locale, 'publicVacancy.browseOpenCta') },
      }
    : {
        kind: 'info',
        title: t(locale, 'publicPages.vacancyTitle'),
        message: v?.title
          ? t(locale, 'publicPages.vacancyMessage', { title: v.title })
          : t(locale, 'publicPages.validLinkMessage'),
      };

  return (
    <AssessmentFlow
      vacancyToken={tokenValue}
      inviteToken={inviteToken}
      notice={notice}
      startDisabled={isClosed}
      requireCandidateEmail={true}
      initialLocale={locale}
      onLocaleChange={setLocale}
    />
  );
}

export default function VacancyTokenClient({ token, initial }) {
  const [locale] = useLocale();
  return (
    <Suspense
      fallback={
        <AssessmentFlow
          vacancyToken={String(token || '')}
          notice={{
            kind: 'info',
            title: t(locale, 'publicPages.loadingVacancyTitle'),
            message: t(locale, 'publicPages.loadingVacancyMessage'),
          }}
          initialLocale={locale}
        />
      }
    >
      <VacancyEntryInner token={token} initial={initial} />
    </Suspense>
  );
}
