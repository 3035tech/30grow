'use client';

import { SelectField } from '../_components/SelectField';

import { useCallback, useEffect, useState } from 'react';
import { cn } from '../../lib/cn';
import { t, contentLocale, t as i18nT } from '../../lib/i18n';
import { RichTextEditor } from '../_components/RichTextEditor';
import { BrStateSelect } from '../_components/BrStateSelect';
import { BrCitySelect } from '../_components/BrCitySelect';
import { formatPhoneBr, formatSalaryBr, stripPhone, salaryToCentsDigits, stripSalary, digitsOnly } from '../../lib/br-masks';
import { titleCasePersonName } from '../../lib/person-name';
import { S } from './dashboard-shared';
import { useAppFeedback } from '../_components/AppFeedback';
import { AppLoading, Spinner } from '../_components/AppLoading';
import { HrActionBrief } from '../_components/HrActionBrief';
import { InterviewScorecardBlock } from './vacancies/InterviewScorecardBlock';
import { InterviewPrepBlock } from './vacancies/InterviewPrepBlock';
import { VacancyOfferBlock } from './vacancies/VacancyOfferBlock';
import { HireReadinessBlock } from './vacancies/HireReadinessBlock';
import { VacancyFitDecisionStrip } from './vacancies/VacancyFitDecisionStrip';
import { CandidateCvBlock } from '../_components/CandidateCvBlock';
import { CandidateCvFirstImport } from '../_components/CandidateCvFirstImport';
import { FormField, formFieldGrowClass, formFieldRowClass } from '../_components/FormField';
import { VacancyInterviewSlotsBlock } from '../_components/VacancyInterviewSlotsBlock';
import { DisclosureToggle, disclosureToggleButtonClass } from '../_components/CollapsibleBlock';
import { OFFER_STATUS } from '../../lib/domain-status';

const FIELD = cn(S.input, 'w-full bg-surface/80');
const FIELD_SELECT = cn(S.select, 'w-full bg-surface/80');

function inviteStatusLabel(locale, status) {
  const s = String(status || '');
  if (s === 'opened') return t(locale, 'recruiting.inviteOpened');
  if (s === 'completed') return t(locale, 'recruiting.inviteCompleted');
  if (s === 'cancelled') return t(locale, 'recruiting.inviteCancelled');
  if (s === 'sent') return t(locale, 'recruiting.inviteSent');
  return t(locale, 'recruiting.noInviteYet');
}

function motivatorsStatusLabel(locale, status) {
  const s = String(status || '');
  if (s === 'opened') return t(locale, 'recruiting.motivatorsInviteOpened');
  if (s === 'completed') return t(locale, 'recruiting.motivatorsInviteCompleted');
  if (s === 'cancelled') return t(locale, 'recruiting.motivatorsInviteCancelled');
  if (s === 'sent') return t(locale, 'recruiting.motivatorsInviteSent');
  return t(locale, 'recruiting.motivatorsNoInviteYet');
}

function availabilityLabel(locale, code) {
  const map = {
    immediate: 'recruiting.availabilityImmediate',
    '15_days': 'recruiting.availability15',
    '30_days': 'recruiting.availability30',
    '60_days': 'recruiting.availability60',
    other: 'recruiting.availabilityOther',
  };
  return code ? t(locale, map[code] || 'recruiting.availabilityOther') : null;
}

function sourceLabel(locale, code) {
  const map = {
    linkedin: 'recruiting.sourceLinkedin',
    referral: 'recruiting.sourceReferral',
    agency: 'recruiting.sourceAgency',
    job_board: 'recruiting.sourceJobBoard',
    other: 'recruiting.sourceOther',
  };
  return code ? t(locale, map[code] || 'recruiting.sourceOther') : null;
}

function CandidateMetaItem({ label, value, tone = 'neutral' }) {
  if (!value) return null;
  return (
    <div
      className={cn(
        'min-w-0 rounded-control border px-2.5 py-2',
        tone === 'brand'
          ? 'border-brand-500/20 bg-brand-500/[0.05]'
          : 'border-ink/8 bg-surface/55'
      )}
    >
      <span className="block truncate font-mono text-2xs uppercase tracking-[0.06em] text-ink-faint">
        {label}
      </span>
      <span className={cn('mt-1 block truncate font-mono text-2xs', tone === 'brand' ? 'text-brand-600' : 'text-ink-muted')}>
        {value}
      </span>
    </div>
  );
}

function CandidateCard({
  row,
  vacancyId,
  locale,
  onChanged,
  onPipelineChange,
  selected = false,
  onToggleSelect = null,
  selectDisabled = false,
}) {
  const { notice, toast, confirm } = useAppFeedback();
  const [notes, setNotes] = useState(row.interviewNotes || '');
  const [phone, setPhone] = useState(stripPhone(row.phone) || '');
  const [linkedinUrl, setLinkedinUrl] = useState(row.linkedinUrl || '');
  const [city, setCity] = useState(row.city || '');
  const [stateUf, setStateUf] = useState(row.state || '');
  const [salaryExpectation, setSalaryExpectation] = useState(salaryToCentsDigits(row.salaryExpectation));
  const [availability, setAvailability] = useState(row.availability || '');
  const [source, setSource] = useState(row.source || '');
  const [busy, setBusy] = useState(false);
  const [notesAiBusy, setNotesAiBusy] = useState(false);
  const [profileBusy, setProfileBusy] = useState(false);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [motivatorsBusy, setMotivatorsBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [decisionBrief, setDecisionBrief] = useState(null);
  const [fitScores, setFitScores] = useState(null);
  const [briefLoading, setBriefLoading] = useState(false);

  const showError = async (message) => {
    await notice({
      title: t(locale, 'panel.common.errorTitle'),
      message: String(message || t(locale, 'panel.common.error')),
      tone: 'error',
    });
  };

  useEffect(() => {
    setNotes(row.interviewNotes || '');
    setPhone(stripPhone(row.phone) || '');
    setLinkedinUrl(row.linkedinUrl || '');
    setCity(row.city || '');
    setStateUf(row.state || '');
    setSalaryExpectation(salaryToCentsDigits(row.salaryExpectation));
    setAvailability(row.availability || '');
    setSource(row.source || '');
  }, [row]);

  useEffect(() => {
    if (!expanded || !row.candidateId) return undefined;
    let cancelled = false;
    (async () => {
      setBriefLoading(true);
      try {
        const res = await fetch(
          `/api/admin/candidates/${encodeURIComponent(row.candidateId)}?locale=${encodeURIComponent(contentLocale(locale))}`
        );
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setDecisionBrief(null);
          setFitScores(null);
          return;
        }
        setDecisionBrief(data?.people?.decisionBrief || null);
        const assessments = Array.isArray(data?.assessments) ? data.assessments : [];
        const forVac = assessments.find(
          (a) => a.scores && String(a.vacancyId) === String(vacancyId)
        );
        setFitScores(forVac?.scores || assessments.find((a) => a.scores)?.scores || null);
      } catch {
        if (!cancelled) {
          setDecisionBrief(null);
          setFitScores(null);
        }
      } finally {
        if (!cancelled) setBriefLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [expanded, row.candidateId, locale, vacancyId]);

  const saveNotes = async () => {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/admin/vacancies/${encodeURIComponent(vacancyId)}/candidates/${encodeURIComponent(row.candidateId)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ interviewNotes: notes }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || t(locale, 'panel.common.error'));
      toast(t(locale, 'recruiting.notesSaved'), 'ok');
      onChanged?.();
    } catch (e) {
      void showError(e?.message || t(locale, 'panel.common.error'));
    } finally {
      setBusy(false);
    }
  };

  const summarizeNotesWithAi = async () => {
    setNotesAiBusy(true);
    try {
      const res = await fetch(`/api/admin/vacancies/${encodeURIComponent(vacancyId)}/assist-ai`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'summarizeNotes',
          notesHtml: notes,
          candidateName: row.fullName || row.name || '',
          locale,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          data?.errorCode ? t(locale, `errors.${data.errorCode}`) : data?.error || t(locale, 'panel.common.error')
        );
      }
      if (data.summaryHtml) setNotes(String(data.summaryHtml));
      toast(t(locale, 'recruiting.notesSummarizedAi'), 'ok');
    } catch (e) {
      void showError(e?.message || t(locale, 'panel.common.error'));
    } finally {
      setNotesAiBusy(false);
    }
  };

  const saveProfile = async () => {
    setProfileBusy(true);
    try {
      const res = await fetch(`/api/admin/candidates/${encodeURIComponent(row.candidateId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone,
          linkedinUrl,
          city,
          state: stateUf,
          salaryExpectation: stripSalary(salaryExpectation),
          availability: availability || null,
          source: source || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || t(locale, 'panel.common.error'));
      toast(t(locale, 'recruiting.profileSaved'), 'ok');
      onChanged?.();
    } catch (e) {
      void showError(e?.message || t(locale, 'panel.common.error'));
    } finally {
      setProfileBusy(false);
    }
  };

  const sendChallenge = async () => {
    setInviteBusy(true);
    try {
      const res = await fetch(
        `/api/admin/vacancies/${encodeURIComponent(vacancyId)}/candidates/${encodeURIComponent(row.candidateId)}/invite`,
        { method: 'POST' }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || t(locale, 'panel.common.error'));
      toast(t(locale, 'recruiting.challengeSentTo', { email: data.sentTo || row.email }), 'ok');
      onChanged?.();
      onPipelineChange?.();
    } catch (e) {
      void showError(e?.message || t(locale, 'panel.common.error'));
    } finally {
      setInviteBusy(false);
    }
  };

  const sendMotivators = async () => {
    setMotivatorsBusy(true);
    try {
      const res = await fetch(
        `/api/admin/vacancies/${encodeURIComponent(vacancyId)}/candidates/${encodeURIComponent(row.candidateId)}/motivators-invite`,
        { method: 'POST' }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || t(locale, 'panel.common.error'));
      toast(t(locale, 'recruiting.motivatorsSentTo', { email: data.sentTo || row.email }), 'ok');
      onChanged?.();
    } catch (e) {
      void showError(e?.message || t(locale, 'panel.common.error'));
    } finally {
      setMotivatorsBusy(false);
    }
  };

  const alreadyCompleted = Boolean(row.assessmentId) || row.inviteStatus === 'completed';
  const motivatorsDone =
    Boolean(row.motivatorsAttemptId) || row.motivatorsInviteStatus === 'completed';
  const motivatorsStatus =
    motivatorsDone && row.motivatorsInviteStatus !== 'completed'
      ? 'completed'
      : row.motivatorsInviteStatus;
  const anyInviteBusy = inviteBusy || motivatorsBusy || deleting;
  const locBits = [row.city, row.state].filter(Boolean).join(' / ');

  const deleteCandidate = async () => {
    const ok = await confirm({
      message: t(locale, 'panel.team.confirmDeletePerson', { name: titleCasePersonName(row.fullName) }),
      danger: true,
      confirmLabel: t(locale, 'panel.team.deletePerson'),
    });
    if (!ok) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/candidates/${encodeURIComponent(row.candidateId)}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || t(locale, 'panel.team.deletePersonError'));
      onChanged?.();
      onPipelineChange?.();
    } catch (e) {
      await showError(e?.message || t(locale, 'panel.team.deletePersonError'));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div
      className="rounded-xl border border-ink/12 bg-ink/[0.02] p-3.5"
    >
      <div className="flex flex-wrap items-start justify-between gap-2.5">
        <div className="min-w-0 flex items-start gap-2.5">
          {typeof onToggleSelect === 'function' ? (
            <label className="mt-0.5 flex min-h-touch cursor-pointer items-center justify-center px-1">
              <input
                type="checkbox"
                checked={selected}
                onChange={() => onToggleSelect(row.candidateId)}
                disabled={selectDisabled}
                aria-label={t(locale, 'recruiting.batchSelectAria', {
                  name: titleCasePersonName(row.fullName),
                })}
                className={S.checkbox}
              />
            </label>
          ) : null}
          <div className="min-w-0">
            <div className="text-sm text-ink">
              <strong className="font-semibold">{titleCasePersonName(row.fullName)}</strong>
            </div>
            <div className="mt-1 text-xs font-mono text-ink-muted">
              {row.email}
              {row.phone ? ` · ${formatPhoneBr(row.phone)}` : ''}
            </div>
            {(locBits || row.linkedinUrl) ? (
              <div className="mt-1 text-2xs font-mono text-ink-faint">
                {locBits || null}
                {locBits && row.linkedinUrl ? ' · ' : null}
                {row.linkedinUrl ? (
                  <a href={row.linkedinUrl} target="_blank" rel="noreferrer" className="text-brand-500">
                    LinkedIn
                  </a>
                ) : null}
              </div>
            ) : null}
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <span
                className="rounded-full border border-ink/12 bg-surface/60 px-2.5 py-1 font-mono text-2xs text-ink-muted"
                title={t(locale, 'recruiting.enneagramBadgeTitle')}
              >
                {t(locale, 'recruiting.enneagramBadgeShort')}: {inviteStatusLabel(locale, row.inviteStatus)}
              </span>
              <span
                className={cn(
                  'rounded-full border px-2.5 py-1 font-mono text-2xs',
                  motivatorsDone
                    ? 'border-success/35 bg-success/[0.07] text-success'
                    : 'border-ink/12 bg-surface/60 text-ink-muted'
                )}
                title={t(locale, 'recruiting.motivatorsBadgeTitle')}
              >
                {t(locale, 'recruiting.motivatorsBadgeShort')}: {motivatorsStatusLabel(locale, motivatorsStatus)}
              </span>
            </div>
            {(row.topType != null || row.availability || row.source || row.salaryExpectation) ? (
              <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                <CandidateMetaItem
                  label={i18nT(locale, 'ui.vacancyInterviewCandidates.type')}
                  value={row.topType != null ? t(locale, 'recruiting.typeShort', { type: row.topType }) : null}
                  tone="brand"
                />
                <CandidateMetaItem
                  label={t(locale, 'recruiting.availabilityLabel')}
                  value={availabilityLabel(locale, row.availability)}
                />
                <CandidateMetaItem
                  label={t(locale, 'recruiting.sourceLabel')}
                  value={sourceLabel(locale, row.source)}
                />
                <CandidateMetaItem
                  label={t(locale, 'recruiting.salaryExpectationLabel')}
                  value={row.salaryExpectation ? formatSalaryBr(row.salaryExpectation) : null}
                />
              </div>
            ) : null}
          </div>
        </div>
        <div className="flex w-full flex-wrap gap-2 border-t border-ink/8 pt-3 lg:w-auto lg:justify-end lg:border-t-0 lg:pt-0">
          <button
            type="button"
            onClick={() => setExpanded((x) => !x)}
            className={disclosureToggleButtonClass}
            aria-expanded={expanded}
          >
            <DisclosureToggle locale={locale} open={expanded} />
          </button>
          <button
            type="button"
            onClick={sendChallenge}
            disabled={anyInviteBusy || alreadyCompleted}
            title={
              alreadyCompleted
                ? t(locale, 'recruiting.testAlreadyDone')
                : t(locale, 'recruiting.sendEnneagramTitle')
            }
            className={cn(
                  'min-h-touch rounded-control border px-2.5 py-2 font-mono text-xs',
                  alreadyCompleted
                    ? 'cursor-default border-ink/12 bg-transparent text-ink-muted'
                    : 'border-success/35 bg-success/[0.09] text-success',
                  inviteBusy ? 'cursor-default opacity-60' : !alreadyCompleted && 'cursor-pointer'
                )}
          >
            {inviteBusy
              ? t(locale, 'recruiting.inviteSending')
              : alreadyCompleted
                ? t(locale, 'recruiting.testDone')
                : t(locale, 'recruiting.sendEnneagram')}
          </button>
          <button
            type="button"
            onClick={sendMotivators}
            disabled={anyInviteBusy || !row.email || motivatorsDone}
            title={
              motivatorsDone
                ? t(locale, 'recruiting.motivatorsAlreadyDone')
                : !row.email
                  ? t(locale, 'recruiting.motivatorsNeedEmail')
                  : t(locale, 'recruiting.sendMotivatorsTitle')
            }
            className={cn(
                  'min-h-touch rounded-control border px-2.5 py-2 font-mono text-xs',
                  motivatorsDone
                    ? 'cursor-default border-ink/12 bg-transparent text-ink-muted'
                    : 'border-brand-500/25 bg-brand-500/[0.08] text-brand-500',
                  motivatorsBusy ? 'cursor-default opacity-60' : !motivatorsDone && 'cursor-pointer'
                )}
          >
            {motivatorsBusy
              ? t(locale, 'recruiting.inviteSending')
              : motivatorsDone
                ? t(locale, 'recruiting.motivatorsDone')
                : t(locale, 'recruiting.sendMotivators')}
          </button>
          <button
            type="button"
            onClick={deleteCandidate}
            disabled={anyInviteBusy || busy || profileBusy || notesAiBusy || selectDisabled}
            aria-label={t(locale, 'panel.team.ariaDeletePerson')}
            aria-busy={deleting || undefined}
            className="min-h-touch rounded-control border border-danger/35 px-2.5 py-2 font-mono text-xs text-danger disabled:cursor-default disabled:opacity-60"
          >
            {deleting ? <Spinner className="h-4 w-4" /> : t(locale, 'panel.team.deletePerson')}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="mt-3 border-t border-ink/12 pt-3">
          {row.candidateId ? (
            <HireReadinessBlock
              vacancyId={vacancyId}
              candidateId={row.candidateId}
              locale={locale}
              row={row}
            />
          ) : null}

          {row.candidateId ? (
            <VacancyFitDecisionStrip
              vacancyId={vacancyId}
              locale={locale}
              scores={fitScores}
            />
          ) : null}

          {briefLoading ? (
            <div className="mb-3 flex items-center gap-2 text-prose text-ink-muted">
              <Spinner size={16} />
              <span>{t(locale, 'common.loading')}</span>
            </div>
          ) : (
            <HrActionBrief
              locale={locale}
              brief={decisionBrief}
              dense
              personName={row.fullName || row.name || ''}
            />
          )}

          {row.candidateId ? (
            <div className="mb-3">
              <CandidateCvBlock candidateId={row.candidateId} locale={locale} embedded onApplied={() => onChanged?.()} />
            </div>
          ) : null}

          {row.candidateId ? (
            <VacancyOfferBlock
              vacancyId={vacancyId}
              candidateId={row.candidateId}
              assessmentId={row.assessmentId}
              locale={locale}
              initialOffer={{
                offerSalary: row.offerSalary,
                offerStartDate: row.offerStartDate,
                offerStatus: row.offerStatus || OFFER_STATUS.NONE,
                offerNotes: row.offerNotes,
              }}
              onSaved={() => onChanged?.()}
            />
          ) : null}

          {row.candidateId ? (
            <InterviewPrepBlock
              vacancyId={vacancyId}
              candidateId={row.candidateId}
              locale={locale}
            />
          ) : null}

          {row.candidateId ? (
            <InterviewScorecardBlock
              vacancyId={vacancyId}
              candidateId={row.candidateId}
              locale={locale}
            />
          ) : null}

          <div className={cn(formFieldRowClass, 'mb-2.5')}>
            <FormField label={t(locale, 'recruiting.phoneLabel')} className={formFieldGrowClass}>
              <input
                value={formatPhoneBr(phone)}
                onChange={(e) => setPhone(stripPhone(e.target.value) || '')}
                placeholder={t(locale, 'recruiting.phonePh')}
                inputMode="tel"
                aria-label={t(locale, 'recruiting.phoneLabel')}
                className={FIELD}
              />
            </FormField>
            <FormField label={t(locale, 'recruiting.linkedinLabel')} className="min-w-0 flex-[2_1_200px]">
              <input
                value={linkedinUrl}
                onChange={(e) => setLinkedinUrl(e.target.value)}
                placeholder={t(locale, 'recruiting.linkedinPh')}
                aria-label={t(locale, 'recruiting.linkedinLabel')}
                className={FIELD}
              />
            </FormField>
            <FormField label={t(locale, 'recruiting.stateLabel')} className="min-w-0 flex-[0_1_160px]">
              <BrStateSelect
                value={stateUf}
                onChange={(uf) => {
                  setStateUf(uf);
                  setCity('');
                }}
                locale={locale}
                className={FIELD_SELECT}
              />
            </FormField>
            <FormField label={t(locale, 'recruiting.cityLabel')} className="min-w-0 flex-[1_1_180px]">
              <BrCitySelect
                uf={stateUf}
                value={city}
                onChange={setCity}
                locale={locale}
                className={FIELD_SELECT}
              />
            </FormField>
            <FormField label={t(locale, 'recruiting.salaryExpectationLabel')} className={formFieldGrowClass}>
              <input
                value={formatSalaryBr(salaryExpectation)}
                onChange={(e) => setSalaryExpectation(digitsOnly(e.target.value).slice(0, 15))}
                placeholder={t(locale, 'recruiting.salaryPh')}
                inputMode="numeric"
                aria-label={t(locale, 'recruiting.salaryExpectationLabel')}
                className={FIELD}
              />
            </FormField>
            <FormField label={t(locale, 'recruiting.availabilityLabel')} className={formFieldGrowClass}>
              <SelectField
                value={availability}
                onChange={(e) => setAvailability(e.target.value)}
                className={FIELD_SELECT}
                aria-label={t(locale, 'recruiting.availabilityLabel')}
              >
                <option value="">{t(locale, 'recruiting.availabilityLabel')}</option>
                <option value="immediate">{t(locale, 'recruiting.availabilityImmediate')}</option>
                <option value="15_days">{t(locale, 'recruiting.availability15')}</option>
                <option value="30_days">{t(locale, 'recruiting.availability30')}</option>
                <option value="60_days">{t(locale, 'recruiting.availability60')}</option>
                <option value="other">{t(locale, 'recruiting.availabilityOther')}</option>
              </SelectField>
            </FormField>
            <FormField label={t(locale, 'recruiting.sourceLabel')} className={formFieldGrowClass}>
              <SelectField
                value={source}
                onChange={(e) => setSource(e.target.value)}
                className={FIELD_SELECT}
                aria-label={t(locale, 'recruiting.sourceLabel')}
              >
                <option value="">{t(locale, 'recruiting.sourceLabel')}</option>
                <option value="linkedin">{t(locale, 'recruiting.sourceLinkedin')}</option>
                <option value="referral">{t(locale, 'recruiting.sourceReferral')}</option>
                <option value="agency">{t(locale, 'recruiting.sourceAgency')}</option>
                <option value="job_board">{t(locale, 'recruiting.sourceJobBoard')}</option>
                <option value="other">{t(locale, 'recruiting.sourceOther')}</option>
              </SelectField>
            </FormField>
          </div>
          <button
            type="button"
            onClick={saveProfile}
            disabled={profileBusy}
            className={cn(
              'mb-3.5 min-h-touch cursor-pointer rounded-control border border-brand-500/25 bg-brand-500/[0.07] px-3.5 py-2 font-mono text-xs text-brand-500',
              profileBusy && 'opacity-60'
            )}
          >
            {profileBusy ? t(locale, 'recruiting.savingNotes') : t(locale, 'recruiting.saveProfile')}
          </button>

          <span
            className="block mb-2 text-2xs font-mono text-ink-muted uppercase tracking-[0.6px]"
          >
            {t(locale, 'recruiting.interviewNotesTitle')}
          </span>
          <RichTextEditor value={notes} onChange={setNotes} locale={locale} disabled={busy || notesAiBusy} />
          <div className="flex gap-2 mt-2.5">
            <button
              type="button"
              onClick={summarizeNotesWithAi}
              disabled={busy || notesAiBusy}
              aria-busy={notesAiBusy || undefined}
              className={cn(
                'min-h-touch rounded-control border border-brand-500/35 bg-transparent px-3.5 py-2 font-mono text-xs text-brand-500',
                busy || notesAiBusy ? 'cursor-default opacity-60' : 'cursor-pointer'
              )}
            >
              {notesAiBusy ? (
                <AppLoading locale={locale} variant="button" label={t(locale, 'recruiting.summarizeNotesAiWorking')} />
              ) : (
                t(locale, 'recruiting.summarizeNotesAi')
              )}
            </button>
            <button
              type="button"
              onClick={saveNotes}
              disabled={busy || notesAiBusy}
              aria-busy={busy || undefined}
              className={cn(
                'min-h-touch rounded-control border border-brand-500/35 bg-brand-500/[0.09] px-3.5 py-2 font-mono text-xs text-brand-500',
                busy || notesAiBusy ? 'cursor-default opacity-60' : 'cursor-pointer'
              )}
            >
              {busy ? (
                <AppLoading locale={locale} variant="button" label={t(locale, 'recruiting.savingNotes')} />
              ) : (
                t(locale, 'recruiting.saveNotes')
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function VacancyInterviewCandidates({ vacancyId, locale = 'pt-BR', onPipelineChange }) {
  const { notice, toast } = useAppFeedback();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [city, setCity] = useState('');
  const [stateUf, setStateUf] = useState('');
  const [salaryExpectation, setSalaryExpectation] = useState('');
  const [availability, setAvailability] = useState('');
  const [source, setSource] = useState('');
  const [createNotes, setCreateNotes] = useState('');
  const [sendEnneagramInvite, setSendEnneagramInvite] = useState(false);
  const [sendMotivatorsInvite, setSendMotivatorsInvite] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createMsg, setCreateMsg] = useState('');
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [batchBusy, setBatchBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const res = await fetch(`/api/admin/vacancies/${encodeURIComponent(vacancyId)}/candidates`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || t(locale, 'panel.common.error'));
      setItems(Array.isArray(data.items) ? data.items : []);
      setSelectedIds(new Set());
    } catch (e) {
      setErr(e?.message || t(locale, 'panel.common.error'));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [vacancyId, locale]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleSelect = useCallback((candidateId) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const key = String(candidateId);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const batchSend = async (kind) => {
    const ids = [...selectedIds];
    if (!ids.length || batchBusy) return;
    setBatchBusy(true);
    setErr('');
    let ok = 0;
    let fail = 0;
    let skipped = 0;
    try {
      for (const candidateId of ids) {
        const row = items.find((x) => String(x.candidateId) === String(candidateId));
        if (!row) {
          fail += 1;
          continue;
        }
        if (kind === 'enneagram') {
          const done = Boolean(row.assessmentId) || row.inviteStatus === 'completed';
          if (done) {
            skipped += 1;
            continue;
          }
        } else {
          const done =
            Boolean(row.motivatorsAttemptId) || row.motivatorsInviteStatus === 'completed';
          if (done) {
            skipped += 1;
            continue;
          }
        }
        const path = kind === 'motivators' ? 'motivators-invite' : 'invite';
        try {
          const res = await fetch(
            `/api/admin/vacancies/${encodeURIComponent(vacancyId)}/candidates/${encodeURIComponent(candidateId)}/${path}`,
            { method: 'POST' }
          );
          if (res.ok) ok += 1;
          else fail += 1;
        } catch {
          fail += 1;
        }
      }
      toast(
        t(locale, 'recruiting.batchSendResult', { ok, fail, skipped }),
        fail > 0 ? 'warning' : 'ok'
      );
      await load();
      if (kind === 'enneagram' && ok > 0) onPipelineChange?.();
    } finally {
      setBatchBusy(false);
    }
  };

  const create = async () => {
    setCreating(true);
    setErr('');
    setCreateMsg('');
    try {
      const res = await fetch(`/api/admin/vacancies/${encodeURIComponent(vacancyId)}/candidates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: titleCasePersonName(name),
          email: email.trim().toLowerCase(),
          phone,
          linkedinUrl,
          city,
          state: stateUf,
          salaryExpectation: stripSalary(salaryExpectation),
          availability: availability || null,
          source: source || null,
          interviewNotes: createNotes,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || t(locale, 'panel.common.error'));

      const requestedInvites = [
        sendEnneagramInvite ? 'invite' : null,
        sendMotivatorsInvite ? 'motivators-invite' : null,
      ].filter(Boolean);
      let invitesFailed = false;
      let enneagramSent = false;
      if (requestedInvites.length) {
        if (data.candidateId == null) {
          invitesFailed = true;
        } else {
          const inviteResults = await Promise.allSettled(
            requestedInvites.map(async (endpoint) => {
              const inviteRes = await fetch(
                `/api/admin/vacancies/${encodeURIComponent(vacancyId)}/candidates/${encodeURIComponent(data.candidateId)}/${endpoint}`,
                { method: 'POST' }
              );
              const inviteData = await inviteRes.json().catch(() => ({}));
              if (!inviteRes.ok) {
                throw new Error(inviteData?.error || t(locale, 'panel.common.error'));
              }
              return inviteData;
            })
          );
          invitesFailed = inviteResults.some((result) => result.status === 'rejected');
          const enneagramIndex = requestedInvites.indexOf('invite');
          enneagramSent =
            enneagramIndex >= 0 && inviteResults[enneagramIndex]?.status === 'fulfilled';
          if (!invitesFailed) toast(t(locale, 'recruiting.createInvitesSent'), 'ok');
        }
      }

      setName('');
      setEmail('');
      setPhone('');
      setLinkedinUrl('');
      setCity('');
      setStateUf('');
      setSalaryExpectation('');
      setAvailability('');
      setSource('');
      setCreateNotes('');
      setSendEnneagramInvite(false);
      setSendMotivatorsInvite(false);
      setCreateMsg(t(locale, 'recruiting.candidateRegistered'));
      await load();
      if (invitesFailed) {
        await notice({
          title: t(locale, 'panel.common.errorTitle'),
          message: t(locale, 'recruiting.createInvitePartial'),
          tone: 'error',
        });
      }
      if (enneagramSent) onPipelineChange?.();
      setTimeout(() => setCreateMsg(''), 3000);
    } catch (e) {
      setErr(e?.message || t(locale, 'panel.common.error'));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div>
      <span className={S.label}>{t(locale, 'recruiting.interviewCandidatesTitle')}</span>
      <p className="mt-2 mb-3 text-xs text-ink-muted leading-[1.55]">
        {t(locale, 'recruiting.interviewCandidatesIntro')}
      </p>

      <div
        className="mb-3.5 rounded-xl border border-brand-500/20 bg-brand-500/[0.03] p-3.5"
      >
        <span
          className="block mb-2.5 text-2xs font-mono text-brand-500 uppercase tracking-[0.6px]"
        >
          {t(locale, 'recruiting.newCandidate')}
        </span>
        <CandidateCvFirstImport vacancyId={vacancyId} locale={locale} onCreated={load} />
        <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <FormField label={t(locale, 'recruiting.fullNamePh')} className="min-w-0">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => setName(titleCasePersonName(name))}
              placeholder={t(locale, 'recruiting.fullNamePh')}
              aria-label={t(locale, 'recruiting.fullNamePh')}
              className={FIELD}
            />
          </FormField>
          <FormField label={t(locale, 'recruiting.inviteCandidateEmailPh')} className="min-w-0">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t(locale, 'recruiting.inviteCandidateEmailPh')}
              aria-label={t(locale, 'recruiting.inviteCandidateEmailPh')}
              className={FIELD}
            />
          </FormField>
          <FormField label={t(locale, 'recruiting.phoneLabel')} className="min-w-0">
            <input
              value={formatPhoneBr(phone)}
              onChange={(e) => setPhone(stripPhone(e.target.value) || '')}
              placeholder={t(locale, 'recruiting.phonePh')}
              inputMode="tel"
              aria-label={t(locale, 'recruiting.phoneLabel')}
              className={FIELD}
            />
          </FormField>
          <FormField label={t(locale, 'recruiting.linkedinLabel')} className="min-w-0">
            <input
              value={linkedinUrl}
              onChange={(e) => setLinkedinUrl(e.target.value)}
              placeholder={t(locale, 'recruiting.linkedinPh')}
              aria-label={t(locale, 'recruiting.linkedinLabel')}
              className={FIELD}
            />
          </FormField>
        </div>
        <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <FormField label={t(locale, 'recruiting.stateLabel')} className="min-w-0">
            <BrStateSelect
              value={stateUf}
              onChange={(uf) => {
                setStateUf(uf);
                setCity('');
              }}
              locale={locale}
              className={FIELD_SELECT}
            />
          </FormField>
          <FormField label={t(locale, 'recruiting.cityLabel')} className="min-w-0">
            <BrCitySelect
              uf={stateUf}
              value={city}
              onChange={setCity}
              locale={locale}
              className={FIELD_SELECT}
            />
          </FormField>
          <FormField label={t(locale, 'recruiting.salaryExpectationLabel')} className="min-w-0">
            <input
              value={formatSalaryBr(salaryExpectation)}
              onChange={(e) => setSalaryExpectation(digitsOnly(e.target.value).slice(0, 15))}
              placeholder={t(locale, 'recruiting.salaryPh')}
              inputMode="numeric"
              aria-label={t(locale, 'recruiting.salaryExpectationLabel')}
              className={FIELD}
            />
          </FormField>
          <FormField label={t(locale, 'recruiting.availabilityLabel')} className="min-w-0">
            <SelectField
              value={availability}
              onChange={(e) => setAvailability(e.target.value)}
              className={FIELD_SELECT}
              aria-label={t(locale, 'recruiting.availabilityLabel')}
            >
              <option value="">{t(locale, 'recruiting.availabilityLabel')}</option>
              <option value="immediate">{t(locale, 'recruiting.availabilityImmediate')}</option>
              <option value="15_days">{t(locale, 'recruiting.availability15')}</option>
              <option value="30_days">{t(locale, 'recruiting.availability30')}</option>
              <option value="60_days">{t(locale, 'recruiting.availability60')}</option>
              <option value="other">{t(locale, 'recruiting.availabilityOther')}</option>
            </SelectField>
          </FormField>
          <FormField label={t(locale, 'recruiting.sourceLabel')} className="min-w-0">
            <SelectField
              value={source}
              onChange={(e) => setSource(e.target.value)}
              className={FIELD_SELECT}
              aria-label={t(locale, 'recruiting.sourceLabel')}
            >
              <option value="">{t(locale, 'recruiting.sourceLabel')}</option>
              <option value="linkedin">{t(locale, 'recruiting.sourceLinkedin')}</option>
              <option value="referral">{t(locale, 'recruiting.sourceReferral')}</option>
              <option value="agency">{t(locale, 'recruiting.sourceAgency')}</option>
              <option value="job_board">{t(locale, 'recruiting.sourceJobBoard')}</option>
              <option value="other">{t(locale, 'recruiting.sourceOther')}</option>
            </SelectField>
          </FormField>
        </div>
        <RichTextEditor
          value={createNotes}
          onChange={setCreateNotes}
          placeholder={t(locale, 'recruiting.interviewNotesInitialPh')}
          minHeight={100}
          locale={locale}
        />
        <div className="mt-3 flex flex-col items-start gap-2">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <label htmlFor="create-send-enneagram" className="flex min-h-6 cursor-pointer items-center gap-2 text-xs text-ink-muted">
              <input
                id="create-send-enneagram"
                name="sendEnneagramInvite"
                type="checkbox"
                checked={sendEnneagramInvite}
                onChange={(e) => setSendEnneagramInvite(e.target.checked)}
                className="accent-brand-500"
              />
              {t(locale, 'recruiting.createSendEnneagram')}
            </label>
            <label htmlFor="create-send-motivators" className="flex min-h-6 cursor-pointer items-center gap-2 text-xs text-ink-muted">
              <input
                id="create-send-motivators"
                name="sendMotivatorsInvite"
                type="checkbox"
                checked={sendMotivatorsInvite}
                onChange={(e) => setSendMotivatorsInvite(e.target.checked)}
                className="accent-brand-500"
              />
              {t(locale, 'recruiting.createSendMotivators')}
            </label>
          </div>
          <p className="m-0 text-2xs leading-snug text-ink-faint">
            {t(locale, 'recruiting.createInvitesHint')}
          </p>
        </div>
        <div className="mt-2.5">
          <button
            type="button"
            onClick={create}
            disabled={creating || !name.trim() || !email.trim()}
            className={cn(
              'min-h-touch cursor-pointer rounded-control border border-brand-500/35 bg-brand-500/[0.09] px-4 py-[9px] font-mono text-prose text-brand-500',
              (creating || !name.trim() || !email.trim()) && 'opacity-55'
            )}
          >
            {creating
              ? t(locale, 'recruiting.registeringCandidate')
              : t(locale, 'recruiting.registerCandidate')}
          </button>
        </div>
        {createMsg ? (
          <p className="mb-0 mt-2 font-mono text-2xs text-success">
            {createMsg}
          </p>
        ) : null}
      </div>

      {err ? (
        <p className="mb-2.5 text-xs font-mono text-danger">{err}</p>
      ) : null}

      <div className="mb-4">
        <VacancyInterviewSlotsBlock vacancyId={vacancyId} candidates={items} locale={locale} />
      </div>

      {loading ? (
        <AppLoading locale={locale} variant="panel" />
      ) : items.length === 0 ? (
        <p className="font-mono text-xs text-ink-faint">
          {t(locale, 'recruiting.noCandidatesYet')}
        </p>
      ) : (
        <div className="flex flex-col gap-2.5">
          {selectedIds.size > 0 ? (
            <div
              className={cn(
                'flex flex-wrap items-center gap-2 rounded-xl border border-brand-500/25 bg-brand-500/[0.04] px-3.5 py-2.5',
                batchBusy && 'opacity-70'
              )}
              aria-busy={batchBusy || undefined}
            >
              <span className="font-mono text-prose text-brand-500">
                {t(locale, 'recruiting.batchSelected', { n: selectedIds.size })}
              </span>
              <button
                type="button"
                disabled={batchBusy}
                onClick={() => batchSend('enneagram')}
                className={cn(S.btnBrandSoft, 'min-h-touch')}
              >
                {batchBusy
                  ? t(locale, 'recruiting.inviteSending')
                  : t(locale, 'recruiting.batchSendEnneagram')}
              </button>
              <button
                type="button"
                disabled={batchBusy}
                onClick={() => batchSend('motivators')}
                className={cn(S.btnGhost, 'min-h-touch')}
              >
                {batchBusy
                  ? t(locale, 'recruiting.inviteSending')
                  : t(locale, 'recruiting.batchSendMotivators')}
              </button>
              <button
                type="button"
                disabled={batchBusy}
                onClick={() => setSelectedIds(new Set())}
                className={cn(S.btnGhost, 'min-h-touch')}
              >
                {t(locale, 'recruiting.batchClear')}
              </button>
            </div>
          ) : null}
          {items.map((row) => (
            <CandidateCard
              key={row.candidateId}
              row={row}
              vacancyId={vacancyId}
              locale={locale}
              onChanged={load}
              onPipelineChange={onPipelineChange}
              selected={selectedIds.has(String(row.candidateId))}
              onToggleSelect={toggleSelect}
              selectDisabled={batchBusy}
            />
          ))}
        </div>
      )}
    </div>
  );
}
