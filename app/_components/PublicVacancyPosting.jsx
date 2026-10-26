'use client';

import { SelectField } from './SelectField';

import Link from 'next/link';
import { RichTextView } from './RichTextView';
import { isRichTextEmpty } from '../../lib/sanitize-html';
import { t, errorMessage } from '../../lib/i18n';
import { cn } from '../../lib/cn';
import { brandMarkSrc } from '../../lib/brand';
import { employmentTypeLabelKey } from '../../lib/recruiting/vacancy-employment-type';
import {
  formatWorkplaceLabel,
  VACANCY_WORKPLACE_MODALITIES,
  workplaceModalityLabelKey,
} from '../../lib/recruiting/vacancy-workplace';
import { formatVacancySalaryRangeDisplay } from '../../lib/br-masks';
import { PublicVacancyShareBar } from './PublicVacancyShareBar';
import { FormField, formFieldRowClass } from './FormField';
import { EmptyState } from './EmptyState';
import { ContentEnter } from './AppLoading';
import {
  fieldInputClass,
  fieldSelectBlockClass,
} from './form-control-styles';
import {
  formatPublicVacancyDate,
  publicVacancyCanApply,
  publicVacancyClosedReason,
  publicVacancyShowsClosedExperience,
} from '../../lib/public-vacancy-lifecycle';
import { publicCompanyPath, publicRemoteAggregatorPath } from '../../lib/public-job-url';
import { useEffect, useRef, useState } from 'react';

function trackJobFunnel(eventType, vacancyId) {
  const id = Number(vacancyId);
  if (!Number.isFinite(id) || id <= 0) return;
  const body = JSON.stringify({ eventType, vacancyId: id });
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const blob = new Blob([body], { type: 'application/json' });
      if (navigator.sendBeacon('/api/public/job-funnel', blob)) return;
    }
  } catch {
    /* fall through */
  }
  fetch('/api/public/job-funnel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    credentials: 'same-origin',
    keepalive: true,
  }).catch(() => {});
}

/** Public careers chrome — inputs reuse dashboard field tokens (same height, no display font). */
const SC = {
  shell: 'relative box-border min-h-screen bg-canvas font-ui text-ink',
  glow: 'pointer-events-none fixed inset-0 bg-radial-glow',
  wrap: 'relative z-[1] mx-auto max-w-[760px] px-5 pb-16 pt-10',
  card: 'box-border rounded-card border border-ink/12 bg-surface px-5 py-6 shadow-card sm:px-7 sm:py-7',
  input: cn(fieldInputClass, 'w-full bg-surface'),
  select: cn(fieldSelectBlockClass, 'bg-surface text-ink'),
  btnPrimary:
    'inline-flex min-h-touch cursor-pointer items-center justify-center rounded-control border-none bg-action px-4 py-2.5 font-mono text-prose font-medium text-action-ink disabled:cursor-default disabled:opacity-60',
  btnPrimaryBlock:
    'inline-flex min-h-touch w-full cursor-pointer items-center justify-center rounded-control border-none bg-action px-4 py-2.5 font-mono text-prose font-medium text-action-ink sm:w-auto disabled:cursor-default disabled:opacity-60',
  filterChip:
    'inline-flex min-h-touch items-center rounded-control border border-ink/12 bg-surface px-3 py-1.5 font-mono text-2xs text-ink-muted no-underline hover:border-brand-500/30 hover:text-brand-500',
};

function MetaChip({ children }) {
  return (
    <span className="inline-block rounded-full border border-ink/12 bg-ink/[0.05] px-3 py-1.5 font-mono text-2xs tracking-wide text-ink-muted">
      {children}
    </span>
  );
}

function RelatedVacanciesList({ locale, items, heading }) {
  if (!items?.length) return null;
  return (
    <section aria-labelledby="public-related-heading" className="mt-7">
      <h2
        id="public-related-heading"
className="mb-3.5 mt-0 font-display text-lg font-semibold"
      >
        {heading}
      </h2>
      <ul
className="m-0 flex list-none flex-col gap-2.5 p-0"
      >
        {items.map((item) => (
          <li key={item.vacancyId}>
            <Link
              href={item.path}
className="block rounded-xl border border-ink/12 bg-surface px-4 py-3.5 text-ink no-underline"
            >
              <span className="block text-base leading-snug break-words">
                {item.title}
              </span>
              {item.companyName ? (
                <span
className="mt-1 block font-mono text-xs text-ink-muted"
                >
                  {item.companyName}
                </span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
      <p className="mb-0 mt-4">
        <Link
          href="/jobs"
          className="font-mono text-sm text-brand-500"
        >
          {t(locale, 'publicVacancy.seeAllOpen')}
        </Link>
      </p>
    </section>
  );
}

/**
 * Página pública da vaga — aberta (candidatar) ou fechada/expirada (agradecimento + outras).
 */
export function PublicVacancyPostingView({ locale = 'pt-BR', posting, related = [] }) {
  const closed = publicVacancyShowsClosedExperience(posting);
  const closedReason = publicVacancyClosedReason(posting);
  const canApply = publicVacancyCanApply(posting);
  const empKey = employmentTypeLabelKey(posting?.employmentType);
  const workplaceLabel = formatWorkplaceLabel(
    {
      workplaceModality: posting?.workplaceModality,
      workplaceCity: posting?.workplaceCity,
      workplaceState: posting?.workplaceState,
    },
    locale,
    t
  );
  const salary =
    posting?.showSalary && (posting.salaryMin || posting.salaryMax)
      ? formatVacancySalaryRangeDisplay(posting.salaryMin, posting.salaryMax)
      : null;
  const companyName = posting?.showCompany ? posting.company?.name : null;
  const companyWebsite = posting?.showCompany ? posting.company?.website : null;
  const companyAbout = posting?.showCompany ? posting.company?.aboutHtml : '';
  const companyLogoUrl = posting?.showCompany ? posting.company?.logoUrl : null;
  const companyProfileOn = Boolean(
    posting?.companyPublicProfileEnabled ?? posting?.company?.publicProfileEnabled
  );
  const companyCareersPath =
    companyProfileOn && posting?.companySlug
      ? publicCompanyPath(posting.companySlug)
      : null;
  const hasDesc = !isRichTextEmpty(posting?.description);
  const publishedLabel = formatPublicVacancyDate(posting?.createdAt, locale);
  const targetLabel = formatPublicVacancyDate(posting?.targetDate, locale);
  const viewedRef = useRef(false);

  const [applyOpen, setApplyOpen] = useState(false);
  const [applyName, setApplyName] = useState('');
  const [applyEmail, setApplyEmail] = useState('');
  const [applyPhone, setApplyPhone] = useState('');
  const [applyConsent, setApplyConsent] = useState(false);
  const [applyBusy, setApplyBusy] = useState(false);
  const [applyMsg, setApplyMsg] = useState('');
  const [applyErr, setApplyErr] = useState('');
  const [applyDone, setApplyDone] = useState(false);

  useEffect(() => {
    if (closed || viewedRef.current || !posting?.vacancyId) return;
    viewedRef.current = true;
    trackJobFunnel('job_view', posting.vacancyId);
  }, [closed, posting?.vacancyId]);

  useEffect(() => {
    setApplyOpen(false);
    setApplyDone(false);
    setApplyErr('');
    setApplyMsg('');
    setApplyName('');
    setApplyEmail('');
    setApplyPhone('');
    setApplyConsent(false);
  }, [posting?.vacancyId]);

  const submitApply = async (e) => {
    e?.preventDefault?.();
    setApplyErr('');
    setApplyMsg('');
    if (!String(applyName || '').trim()) {
      setApplyErr(errorMessage(locale, 'CANDIDATE_NAME_REQUIRED', t(locale, 'panel.common.error')));
      return;
    }
    if (!applyConsent) {
      setApplyErr(t(locale, 'publicVacancy.applyFormNeedConsent'));
      return;
    }
    setApplyBusy(true);
    trackJobFunnel('apply_start', posting.vacancyId);
    try {
      const res = await fetch('/api/public/vacancy-apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vacancyId: posting.vacancyId,
          fullName: applyName,
          email: applyEmail,
          phone: applyPhone || undefined,
          consent: applyConsent,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          data?.error ||
            errorMessage(locale, data?.errorCode, t(locale, 'panel.common.error'))
        );
      }
      setApplyDone(true);
      setApplyOpen(false);
      setApplyMsg(
        data.alreadyLinked
          ? t(locale, 'publicVacancy.applyFormAlready')
          : t(locale, 'publicVacancy.applyFormOk')
      );
    } catch (err) {
      setApplyErr(err?.message || t(locale, 'panel.common.error'));
    } finally {
      setApplyBusy(false);
    }
  };

  return (
    <div className={SC.shell}>
      <div className={SC.glow} aria-hidden />
      <div className={SC.wrap}>
        <header className="mb-5 flex items-center gap-3">
          <img src={brandMarkSrc(64)} alt="" width={40} height={40} />
          <span className="font-mono text-2xs uppercase tracking-[2px] text-ink-faint">
            30Grow
          </span>
        </header>

        <article className={SC.card}>
          {closed ? (
            <>
              <p
className="mb-2 mt-0 font-mono text-2xs uppercase tracking-[2px] text-warning"
              >
                {closedReason === 'expired'
                  ? t(locale, 'publicVacancy.expiredBadge')
                  : t(locale, 'publicVacancy.closedBadge')}
              </p>
              <h1
                className="mb-3 break-words text-ink font-display text-[clamp(1.625rem,5vw,2.25rem)] font-bold leading-snug"
              >
                {t(locale, 'publicVacancy.closedTitle')}
              </h1>
              <p className="mb-2 mt-0 text-base leading-[1.65] text-ink-muted">
                {closedReason === 'expired'
                  ? t(locale, 'publicVacancy.expiredThanks', {
                      title: posting?.title || t(locale, 'publicVacancy.thisRole'),
                    })
                  : t(locale, 'publicVacancy.closedThanks', {
                      title: posting?.title || t(locale, 'publicVacancy.thisRole'),
                    })}
              </p>
              <p className="mb-5 mt-0 text-base leading-[1.65] text-ink-muted">
                {t(locale, 'publicVacancy.closedMessage')}
              </p>
              {posting?.title ? (
                <p
className="mb-2 mt-0 font-mono text-prose text-ink-faint"
                >
                  {t(locale, 'publicVacancy.closedWas')}:{' '}
                  <strong className="text-ink">{posting.title}</strong>
                  {companyName ? ` · ${companyName}` : ''}
                </p>
              ) : null}
              <p className="mb-0 mt-5 flex flex-wrap gap-3">
                {companyCareersPath ? (
                  <Link
                    href={companyCareersPath}
                    className="inline-block cursor-pointer rounded-control border border-ink/12 bg-transparent px-5 py-3 font-ui text-sm text-ink no-underline"
                  >
                    {companyName
                      ? t(locale, 'publicVacancy.backToCompanyRoles', { name: companyName })
                      : t(locale, 'publicVacancy.backToCompanyRolesGeneric')}
                  </Link>
                ) : null}
                <Link
                  href="/jobs"
                  className="inline-block cursor-pointer rounded-control border-none bg-action px-5 py-3 font-ui text-sm font-semibold text-action-ink no-underline transition-colors duration-150 hover:bg-action-hover"
                >
                  {t(locale, 'publicVacancy.browseOpenCta')}
                </Link>
              </p>
              <RelatedVacanciesList
                locale={locale}
                items={related}
                heading={t(locale, 'publicVacancy.relatedHeading')}
              />
            </>
          ) : (
            <>
              <header>
                {companyCareersPath ? (
                  <p className="mb-3 mt-0">
                    <Link
                      href={companyCareersPath}
                      className="inline-flex min-h-touch items-center font-mono text-xs text-ink-muted no-underline hover:text-brand-600"
                    >
                      ←{' '}
                      {companyName
                        ? t(locale, 'publicVacancy.backToCompanyRoles', { name: companyName })
                        : t(locale, 'publicVacancy.backToCompanyRolesGeneric')}
                    </Link>
                  </p>
                ) : null}
                {companyName ? (
                  <p
className="mb-2.5 mt-0 font-mono text-xs tracking-wide text-ink-muted"
                  >
                    {companyCareersPath ? (
                      <Link href={companyCareersPath} className="text-ink-muted no-underline hover:text-brand-600">
                        {companyName}
                      </Link>
                    ) : (
                      <span>{companyName}</span>
                    )}
                    {companyWebsite ? (
                      <>
                        {' · '}
                        <a
                          href={companyWebsite}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-brand-500"
                        >
                          {t(locale, 'publicVacancy.companySite')}
                        </a>
                      </>
                    ) : null}
                  </p>
                ) : null}
                <h1
                  className="mb-3 break-words text-ink font-display text-[clamp(1.75rem,5vw,2.5rem)] font-bold leading-snug"
                >
                  {posting.title}
                </h1>
                <div className="mb-[22px] flex flex-wrap gap-2">
                  {empKey ? <MetaChip>{t(locale, empKey)}</MetaChip> : null}
                  {workplaceLabel ? <MetaChip>{workplaceLabel}</MetaChip> : null}
                  {salary ? (
                    <MetaChip>
                      {t(locale, 'publicVacancy.salaryLabel')}: {salary}
                    </MetaChip>
                  ) : null}
                  {publishedLabel ? (
                    <MetaChip>
                      {t(locale, 'publicVacancy.publishedLabel')}: {publishedLabel}
                    </MetaChip>
                  ) : null}
                  {targetLabel ? (
                    <MetaChip>
                      {t(locale, 'publicVacancy.targetDateLabel')}: {targetLabel}
                    </MetaChip>
                  ) : null}
                </div>
              </header>

              {hasDesc ? (
                <section aria-labelledby="public-desc-heading">
                  <h2
                    id="public-desc-heading"
                    className="mb-3 mt-0 font-display text-lg font-semibold"
                  >
                    {t(locale, 'publicVacancy.descriptionHeading')}
                  </h2>
                  <div>
                    <RichTextView
                      html={posting.description}
                      className="text-base leading-[1.7] text-ink"
                    />
                  </div>
                </section>
              ) : (
                <p className="m-0 italic text-ink-muted">
                  {t(locale, 'publicVacancy.noDescription')}
                </p>
              )}

              {companyAbout && !isRichTextEmpty(companyAbout) ? (
                <section
                  aria-labelledby="public-company-heading"
                  className="mt-7 border-t border-ink/12 pt-[22px]"
                >
                  <h2
                    id="public-company-heading"
                    className="mb-3 mt-0 text-lg font-normal"
                  >
                    {t(locale, 'publicVacancy.aboutCompany', {
                      name: companyName || t(locale, 'publicVacancy.companyFallback'),
                    })}
                  </h2>
                  {companyLogoUrl ? (
                    <img
                      src={companyLogoUrl}
                      alt=""
                      width={72}
                      height={72}
                      className="mb-3 block rounded-control bg-canvas object-contain"
                    />
                  ) : null}
                  <RichTextView
                    html={companyAbout}
                    className="text-sm leading-[1.65] text-ink-muted"
                  />
                </section>
              ) : companyLogoUrl && companyName ? (
                <section
                  className="mt-7 flex items-center gap-3 border-t border-ink/12 pt-[22px]"
                >
                  <img
                    src={companyLogoUrl}
                    alt=""
                    width={48}
                    height={48}
                    className="rounded-lg object-contain"
                  />
                  <span className="text-base text-ink">{companyName}</span>
                </section>
              ) : null}

              <footer className="mt-8">
                {canApply ? (
                  <div className="space-y-4">
                    {!applyOpen && !applyDone ? (
                      <button
                        type="button"
                        onClick={() => setApplyOpen(true)}
                        className="inline-flex min-h-touch cursor-pointer items-center justify-center rounded-control border-none bg-action px-5 py-3 font-ui text-sm font-semibold text-action-ink transition-colors duration-150 hover:bg-action-hover"
                      >
                        {t(locale, 'publicVacancy.applyCta')}
                      </button>
                    ) : null}
                    {applyOpen && !applyDone ? (
                      <form
                        onSubmit={submitApply}
                        className="space-y-3 rounded-card border border-ink/12 bg-canvas/40 p-4"
                        aria-busy={applyBusy}
                      >
                        <p className="m-0 font-mono text-2xs text-ink-faint">
                          {t(locale, 'publicVacancy.applyFormHint')}
                        </p>
                        <FormField label={t(locale, 'publicVacancy.applyFormName')}>
                          <input
                            className={SC.input}
                            value={applyName}
                            onChange={(e) => setApplyName(e.target.value)}
                            required
                            maxLength={200}
                            autoComplete="name"
                            disabled={applyBusy}
                            autoFocus
                          />
                        </FormField>
                        <FormField label={t(locale, 'publicVacancy.applyFormEmail')}>
                          <input
                            className={SC.input}
                            type="email"
                            value={applyEmail}
                            onChange={(e) => setApplyEmail(e.target.value)}
                            required
                            maxLength={200}
                            autoComplete="email"
                            disabled={applyBusy}
                          />
                        </FormField>
                        <FormField label={t(locale, 'publicVacancy.applyFormPhone')}>
                          <input
                            className={SC.input}
                            type="tel"
                            value={applyPhone}
                            onChange={(e) => setApplyPhone(e.target.value)}
                            maxLength={40}
                            autoComplete="tel"
                            disabled={applyBusy}
                          />
                        </FormField>
                        <label className="flex items-start gap-2 font-ui text-prose text-ink">
                          <input
                            type="checkbox"
                            className="mt-1 accent-brand-500"
                            checked={applyConsent}
                            onChange={(e) => setApplyConsent(e.target.checked)}
                            disabled={applyBusy}
                          />
                          <span>{t(locale, 'publicVacancy.applyFormConsent')}</span>
                        </label>
                        {applyErr ? (
                          <p className="m-0 font-mono text-xs text-danger" role="alert">
                            {applyErr}
                          </p>
                        ) : null}
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="submit"
                            disabled={applyBusy}
                            className={SC.btnPrimary}
                          >
                            {applyBusy
                              ? t(locale, 'publicVacancy.applyFormBusy')
                              : t(locale, 'publicVacancy.applyFormSubmit')}
                          </button>
                          <button
                            type="button"
                            disabled={applyBusy}
                            className="min-h-touch cursor-pointer rounded-control border border-ink/12 bg-transparent px-3 py-2 font-mono text-2xs text-ink-muted"
                            onClick={() => {
                              setApplyOpen(false);
                              setApplyErr('');
                            }}
                          >
                            {t(locale, 'panel.common.cancel')}
                          </button>
                        </div>
                      </form>
                    ) : null}
                    {applyDone ? (
                      <ContentEnter animKey="apply-ok">
                        <p className="m-0 rounded-control border border-success/30 bg-success/[0.08] px-3 py-2.5 text-prose text-success">
                          {applyMsg}
                        </p>
                      </ContentEnter>
                    ) : null}
                    {posting.applyPath && !applyDone ? (
                      <p className="mb-0 mt-1 font-mono text-2xs">
                        <a href={posting.applyPath} className="text-ink-muted underline-offset-2 hover:underline">
                          {t(locale, 'publicVacancy.applyAssessmentLink')}
                        </a>
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <p className="m-0 text-sm text-ink-muted">
                    {t(locale, 'publicVacancy.applyUnavailable')}
                  </p>
                )}
                <PublicVacancyShareBar locale={locale} posting={posting} />
                <p className="mb-0 mt-4 font-mono text-xs">
                  <Link href="/jobs" className="text-brand-500">
                    {t(locale, 'publicVacancy.seeAllOpen')}
                  </Link>
                </p>
              </footer>
            </>
          )}
        </article>
      </div>
    </div>
  );
}

/** Job listing /jobs — busca + filtro tipo + paginação (GET). Também agregadores SEO. */
export function PublicVacanciesIndexView({
  locale = 'pt-BR',
  items = [],
  total = 0,
  page = 1,
  pageSize = 12,
  filters = {},
  title = null,
  intro = null,
  basePath = '/jobs',
  showSearchForm = true,
  showJobAlert = true,
  cityChips = [],
  showRemoteChip = false,
}) {
  const q = String(filters.q || '');
  const employmentType = String(filters.employmentType || '');
  const workplaceModality = String(filters.workplaceModality || '');
  const totalPages = Math.max(1, Math.ceil(Number(total) / Math.max(1, pageSize)));
  const hasFilters = Boolean(q || employmentType || workplaceModality);
  const emptyMsg = hasFilters
    ? t(locale, 'publicVacancy.indexEmptyFiltered')
    : t(locale, 'publicVacancy.indexEmpty');
  const heading = title || t(locale, 'publicVacancy.indexTitle');
  const lead = intro || t(locale, 'publicVacancy.indexIntro');
  const listBase = String(basePath || '/jobs').replace(/\/$/, '') || '/jobs';
  const remotePath = publicRemoteAggregatorPath();
  const clearHref = listBase;

  function hrefForPage(p) {
    const params = new URLSearchParams();
    if (showSearchForm) {
      if (q) params.set('q', q);
      if (employmentType) params.set('employmentType', employmentType);
      if (workplaceModality) params.set('workplaceModality', workplaceModality);
    }
    if (p > 1) params.set('page', String(p));
    const qs = params.toString();
    return qs ? `${listBase}?${qs}` : listBase;
  }

  const [alertName, setAlertName] = useState('');
  const [alertEmail, setAlertEmail] = useState('');
  const [alertStatus, setAlertStatus] = useState(''); // '' | 'loading' | 'ok' | 'err'

  async function submitJobAlert(e) {
    e.preventDefault();
    if (alertStatus === 'loading') return;
    setAlertStatus('loading');
    try {
      const res = await fetch('/api/public/job-alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: alertEmail,
          name: alertName || null,
          filters: {
            q: q || undefined,
            employmentType: employmentType || undefined,
            workplaceModality: workplaceModality || undefined,
          },
        }),
        credentials: 'same-origin',
      });
      if (!res.ok) throw new Error('fail');
      setAlertStatus('ok');
      setAlertEmail('');
      setAlertName('');
    } catch {
      setAlertStatus('err');
    }
  }

  return (
    <div className={SC.shell}>
      <div className={SC.glow} aria-hidden />
      <div className={SC.wrap}>
        <header className="mb-6">
          <img src={brandMarkSrc(64)} alt="" width={40} height={40} className="mb-3" />
          {listBase !== '/jobs' ? (
            <p className="mb-2 mt-0 font-mono text-xs">
              <Link href="/jobs" className="text-ink-muted">
                {t(locale, 'publicVacancy.browseOpenCta')}
              </Link>
            </p>
          ) : null}
          <h1
            className="m-0 break-words text-ink font-display text-[clamp(1.625rem,4vw,2.25rem)] font-bold leading-snug"
          >
            {heading}
          </h1>
          <p className="mb-0 mt-2.5 text-base leading-relaxed text-ink-muted">
            {lead}
          </p>
        </header>

        {showSearchForm ? (
        <form
          method="get"
          action={listBase}
          className={cn(SC.card, 'mb-4 flex flex-col gap-4')}
        >
          <FormField label={t(locale, 'publicVacancy.indexSearchLabel')} className="gap-1.5">
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder={t(locale, 'publicVacancy.indexSearchPlaceholder')}
              className={SC.input}
              autoComplete="off"
            />
          </FormField>
          <div className={cn(formFieldRowClass, 'items-end gap-3')}>
            <FormField
              label={t(locale, 'publicVacancy.indexEmploymentLabel')}
              className="min-w-0 flex-[1_1_160px] gap-1.5"
            >
              <SelectField name="employmentType" defaultValue={employmentType} className={SC.select}>
                <option value="">{t(locale, 'publicVacancy.indexEmploymentAll')}</option>
                <option value="clt">{t(locale, 'recruiting.employmentType_clt')}</option>
                <option value="pj">{t(locale, 'recruiting.employmentType_pj')}</option>
                <option value="internship">{t(locale, 'recruiting.employmentType_internship')}</option>
                <option value="cooperative">{t(locale, 'recruiting.employmentType_cooperative')}</option>
              </SelectField>
            </FormField>
            <FormField
              label={t(locale, 'publicVacancy.indexWorkplaceLabel')}
              className="min-w-0 flex-[1_1_160px] gap-1.5"
            >
              <SelectField name="workplaceModality" defaultValue={workplaceModality} className={SC.select}>
                <option value="">{t(locale, 'publicVacancy.indexWorkplaceAll')}</option>
                {VACANCY_WORKPLACE_MODALITIES.map((mod) => {
                  const key = workplaceModalityLabelKey(mod);
                  return (
                    <option key={mod} value={mod}>
                      {key ? t(locale, key) : mod}
                    </option>
                  );
                })}
              </SelectField>
            </FormField>
            <button type="submit" className={cn(SC.btnPrimary, 'shrink-0')}>
              {t(locale, 'publicVacancy.indexSearchSubmit')}
            </button>
            {hasFilters ? (
              <Link
                href={clearHref}
                className="inline-flex min-h-touch shrink-0 items-center px-2 text-prose text-ink-muted no-underline hover:text-brand-600"
              >
                {t(locale, 'publicVacancy.indexClearFilters')}
              </Link>
            ) : null}
          </div>
          {showRemoteChip || cityChips?.length ? (
          <nav
            aria-label={t(locale, 'publicVacancy.indexModalityNav')}
            className="flex flex-wrap gap-2"
          >
            {showRemoteChip ? (
              <Link href={remotePath} className={SC.filterChip}>
                {t(locale, 'recruiting.workplaceModality_remote')}
              </Link>
            ) : null}
            {(cityChips || []).slice(0, 5).map((chip) => (
              <Link key={chip.slug || chip.path} href={chip.path} className={SC.filterChip}>
                {chip.city}
              </Link>
            ))}
          </nav>
          ) : null}
        </form>
        ) : null}

        <main className={SC.card}>
          {total > 0 ? (
            <p className="mb-3 mt-0 font-mono text-2xs text-ink-muted">
              {t(locale, 'publicVacancy.indexResultCount', { count: String(total) })}
            </p>
          ) : null}
          {!items.length ? (
            <EmptyState
              message={emptyMsg}
              actionLabel={
                hasFilters
                  ? t(locale, 'publicVacancy.indexClearFilters')
                  : t(locale, 'publicVacancy.browseOpenCta')
              }
              actionHref={hasFilters ? clearHref : '/jobs'}
            />
          ) : (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {items.map((item) => {
                const empKey = employmentTypeLabelKey(item.employmentType);
                const empLabel = empKey ? t(locale, empKey) : null;
                const workplaceLabel = formatWorkplaceLabel(
                  {
                    workplaceModality: item.workplaceModality,
                    workplaceCity: item.workplaceCity,
                    workplaceState: item.workplaceState,
                  },
                  locale,
                  t
                );
                const meta = [empLabel, workplaceLabel].filter(Boolean).join(' · ');
                return (
                  <li key={item.vacancyId}>
                    <div className="rounded-control border border-ink/12 bg-canvas/40 px-4 py-3">
                      <Link
                        href={item.path}
                        className="block font-ui text-base font-medium text-ink no-underline hover:text-brand-600"
                      >
                        {item.title}
                      </Link>
                      {item.companyName || meta ? (
                        <div className="mt-1 font-mono text-2xs text-ink-muted">
                          {item.companyName && item.companySlug ? (
                            <Link
                              href={publicCompanyPath(item.companySlug)}
                              className="text-ink-muted no-underline hover:text-brand-600"
                            >
                              {item.companyName}
                            </Link>
                          ) : item.companyName ? (
                            <span>{item.companyName}</span>
                          ) : null}
                          {item.companyName && meta ? ' · ' : null}
                          {meta}
                        </div>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {totalPages > 1 ? (
            <nav
              aria-label={t(locale, 'publicVacancy.indexPagination')}
className="mt-5 flex flex-wrap items-center justify-between gap-3"
            >
              {page > 1 ? (
                <Link href={hrefForPage(page - 1)} className="inline-flex min-h-touch items-center text-brand-500">
                  {t(locale, 'publicVacancy.indexPrev')}
                </Link>
              ) : (
                <span className="text-ink-faint">{t(locale, 'publicVacancy.indexPrev')}</span>
              )}
              <span className="font-mono text-xs text-ink-muted">
                {t(locale, 'publicVacancy.indexPageOf', { page: String(page), pages: String(totalPages) })}
              </span>
              {page < totalPages ? (
                <Link href={hrefForPage(page + 1)} className="inline-flex min-h-touch items-center text-brand-500">
                  {t(locale, 'publicVacancy.indexNext')}
                </Link>
              ) : (
                <span className="text-ink-faint">{t(locale, 'publicVacancy.indexNext')}</span>
              )}
            </nav>
          ) : null}
        </main>

        {showJobAlert ? (
        <section className={cn(SC.card, 'mt-4')}>
          <h2 className="mb-1.5 mt-0 font-display text-lg font-semibold text-ink">
            {t(locale, 'publicVacancy.alertTitle')}
          </h2>
          <p className="mb-4 mt-0 text-prose leading-relaxed text-ink-muted">
            {t(locale, 'publicVacancy.alertIntro')}
          </p>
          {alertStatus === 'ok' ? (
            <p className="m-0 text-prose text-success">
              {t(locale, 'publicVacancy.alertSuccess')}
            </p>
          ) : (
            <form
              method="post"
              action="/api/public/job-alerts"
              onSubmit={submitJobAlert}
              className="flex flex-col gap-4"
            >
              <div className="grid items-start gap-4 sm:grid-cols-2">
                <FormField label={t(locale, 'publicVacancy.alertNameLabel')} className="gap-1.5">
                  <input
                    type="text"
                    name="name"
                    value={alertName}
                    onChange={(ev) => setAlertName(ev.target.value)}
                    placeholder={t(locale, 'publicVacancy.alertNamePlaceholder')}
                    className={SC.input}
                    autoComplete="name"
                    maxLength={120}
                  />
                </FormField>
                <FormField label={t(locale, 'publicVacancy.alertEmailLabel')} className="gap-1.5">
                  <input
                    type="email"
                    name="email"
                    required
                    value={alertEmail}
                    onChange={(ev) => setAlertEmail(ev.target.value)}
                    placeholder={t(locale, 'publicVacancy.alertEmailPlaceholder')}
                    className={SC.input}
                    autoComplete="email"
                    inputMode="email"
                  />
                </FormField>
              </div>
              {alertStatus === 'err' ? (
                <p className="m-0 text-prose text-danger">
                  {t(locale, 'publicVacancy.alertError')}
                </p>
              ) : null}
              <button
                type="submit"
                disabled={alertStatus === 'loading'}
                className={SC.btnPrimaryBlock}
              >
                {alertStatus === 'loading'
                  ? t(locale, 'publicVacancy.alertSubmitting')
                  : t(locale, 'publicVacancy.alertSubmit')}
              </button>
            </form>
          )}
        </section>
        ) : null}
      </div>
    </div>
  );
}

/** Public company page `/companies/{slug}` (perfil da empresa). */
export function PublicCompanyPageView({ locale = 'pt-BR', company, items = [], total = 0 }) {
  const name = company?.name || t(locale, 'publicVacancy.companyFallback');
  const website = String(company?.website || '').trim();
  const aboutHtml = company?.aboutHtml || '';
  const logoUrl = String(company?.logoUrl || '').trim();
  const openCount = Number(total) > 0 ? Number(total) : items.length;

  return (
    <div className={SC.shell}>
      <div className={SC.glow} aria-hidden />
      <div className={SC.wrap}>
        <nav className="mb-4 font-mono text-xs text-ink-muted" aria-label={t(locale, 'publicVacancy.breadcrumbAria')}>
          <Link href="/jobs" className="text-ink-muted no-underline hover:text-brand-500">
            {t(locale, 'publicVacancy.browseOpenCta')}
          </Link>
          <span className="mx-1.5 text-ink-faint" aria-hidden>
            /
          </span>
          <span className="text-ink">{name}</span>
        </nav>

        <header className="relative mb-6 overflow-hidden rounded-2xl border border-ink/10 bg-surface px-5 py-6 sm:px-7 sm:py-8">
          <div className="flex flex-wrap items-center gap-4">
            {logoUrl ? (
              <img
                src={logoUrl}
                alt=""
                width={72}
                height={72}
                className="h-[72px] w-[72px] shrink-0 rounded-control bg-white/80 object-contain p-1.5 shadow-sm"
              />
            ) : (
              <img
                src={brandMarkSrc(72)}
                alt=""
                width={56}
                height={56}
                className="shrink-0 rounded-control bg-white/70 p-2"
              />
            )}
            <div className="min-w-0 flex-1">
              <p className="mb-1 mt-0 font-mono text-2xs uppercase tracking-[0.14em] text-ink-label">
                {t(locale, 'publicVacancy.companyCareersEyebrow')}
              </p>
              <h1 className="m-0 break-words font-display text-[clamp(1.625rem,4vw,2.25rem)] font-semibold leading-snug text-ink">
                {name}
              </h1>
              <p className="mb-0 mt-2 text-sm text-ink-muted">
                {t(locale, 'publicVacancy.companyOpenCount', { n: openCount })}
                {website ? (
                  <>
                    {' · '}
                    <a
                      href={website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-brand-500 no-underline hover:underline"
                    >
                      {t(locale, 'publicVacancy.companySite')}
                    </a>
                  </>
                ) : null}
              </p>
            </div>
          </div>
          {items.length > 0 ? (
            <p className="mb-0 mt-5">
              <a href="#company-open-roles" className={cn(SC.btnPrimary, 'inline-flex no-underline')}>
                {t(locale, 'publicVacancy.companySeeRolesCta')}
              </a>
            </p>
          ) : null}
        </header>

        {!isRichTextEmpty(aboutHtml) ? (
          <section className={cn(SC.card, 'mb-4')}>
            <h2 className="mb-3 mt-0 text-base font-semibold">
              {t(locale, 'publicVacancy.aboutCompany', { name })}
            </h2>
            <RichTextView html={aboutHtml} />
          </section>
        ) : null}

        <main id="company-open-roles" className={SC.card}>
          <h2 className="mb-3.5 mt-0 text-base font-semibold">
            {t(locale, 'publicVacancy.companyOpenRoles')}
          </h2>
          {!items.length ? (
            <EmptyState
              message={t(locale, 'publicVacancy.companyNoOpenRoles')}
              actionLabel={t(locale, 'publicVacancy.browseOpenCta')}
              actionHref="/jobs"
            />
          ) : (
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {items.map((item) => {
                const empKey = employmentTypeLabelKey(item.employmentType);
                const workplaceLabel = formatWorkplaceLabel(
                  {
                    workplaceModality: item.workplaceModality,
                    workplaceCity: item.workplaceCity,
                    workplaceState: item.workplaceState,
                  },
                  locale,
                  t
                );
                const salary =
                  item.showSalary && (item.salaryMin || item.salaryMax)
                    ? formatVacancySalaryRangeDisplay(item.salaryMin, item.salaryMax)
                    : null;
                const target =
                  item.targetDate
                    ? t(locale, 'publicVacancy.targetDateLabel') +
                      ': ' +
                      String(item.targetDate).slice(0, 10)
                    : null;
                const meta = [empKey ? t(locale, empKey) : null, workplaceLabel, salary, target]
                  .filter(Boolean)
                  .join(' · ');
                return (
                  <li key={item.vacancyId}>
                    <Link
                      href={item.path}
                      className="block rounded-xl border border-ink/12 px-[18px] py-4 text-ink no-underline transition-colors hover:border-brand-500/30 hover:bg-brand-500/[0.03]"
                    >
                      <span className="block text-lg font-medium">{item.title}</span>
                      {meta ? (
                        <span className="mt-1.5 block font-mono text-xs text-ink-muted">{meta}</span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
          {total > items.length ? (
            <p className="mb-0 mt-3.5 text-xs text-ink-muted">
              <Link href="/jobs" className="text-brand-500">
                {t(locale, 'publicVacancy.seeAllOpen')}
              </Link>
            </p>
          ) : null}
        </main>
      </div>
    </div>
  );
}
