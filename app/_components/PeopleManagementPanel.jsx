'use client';

import { useCallback, useEffect, useState } from 'react';
import { t, localeHtmlLang } from '../../lib/i18n';
import { cn } from '../../lib/cn';
import { isRichTextEmpty } from '../../lib/sanitize-html';
import { EMPLOYMENT_STATUS } from '../../lib/domain-status.js';
import { S } from '../dashboard/dashboard-shared';
import { RichTextEditor } from './RichTextEditor';
import { RichTextView } from './RichTextView';
import { HireJourneyBlock } from './HireJourneyBlock';
import { useAppFeedback } from './AppFeedback';
import { CopyableLink } from './CopyableLink';
import { CollapsibleBlock } from './CollapsibleBlock';
import { DateField } from './DateField';
import { FormField } from './FormField';
import { formatDisplayDateTime } from '../../lib/format-display-date';

function todayIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatMeetingDate(value, locale) {
  if (!value) return '—';
  const raw = String(value).slice(0, 10);
  const [y, m, d] = raw.split('-').map(Number);
  if (!y || !m || !d) return raw;
  return new Date(y, m - 1, d).toLocaleDateString(localeHtmlLang(locale), {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Hipóteses de gestão + registro de 1:1 (mesma pessoa = candidate_id).
 * @param {'context'|'oneOnOne'|'journey'|'all'} [section='all'] — recorte para sub-nav do drawer Equipe.
 */
export function PeopleManagementPanel({
  locale,
  candidateId,
  people,
  onRefresh,
  employmentStatus = null,
  section = 'all',
}) {
  const management = people?.management;
  const oneOnOnes = people?.oneOnOnes || [];
  const [meetingDate, setMeetingDate] = useState(todayIso());
  const [notes, setNotes] = useState('');
  const [nextSteps, setNextSteps] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [msgError, setMsgError] = useState(false);
  const [pdiRefresh, setPdiRefresh] = useState(0);
  const [portalUrl, setPortalUrl] = useState('');
  const [followUps, setFollowUps] = useState([]);
  const [portalTokens, setPortalTokens] = useState([]);
  const [sessionPrep, setSessionPrep] = useState(null);
  const { confirm, notice, toast, promptForm } = useAppFeedback();

  const loadFollowUps = useCallback(async () => {
    if (!candidateId) return;
    try {
      const res = await fetch(
        `/api/admin/candidates/${encodeURIComponent(candidateId)}/retention-followups`
      );
      const data = await res.json().catch(() => ({}));
      if (res.ok) setFollowUps(Array.isArray(data.items) ? data.items : []);
    } catch {
      setFollowUps([]);
    }
  }, [candidateId]);

  const loadPortalTokens = useCallback(async () => {
    if (!candidateId) return;
    try {
      const res = await fetch(
        `/api/admin/candidates/${encodeURIComponent(candidateId)}/employee-portal`
      );
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setPortalTokens(Array.isArray(data.items) ? data.items : []);
        setSessionPrep(data.sessionPrep || null);
      }
    } catch {
      setPortalTokens([]);
      setSessionPrep(null);
    }
  }, [candidateId]);

  useEffect(() => {
    if (section === 'oneOnOne') return;
    void loadFollowUps();
    void loadPortalTokens();
  }, [loadFollowUps, loadPortalTokens, section]);

  if (!management && !people && section !== 'journey') {
    return null;
  }

  const completeness = management?.completeness || {};
  const hypotheses = management?.hypotheses || [];
  const prompts = management?.oneOnOnePrompts || [];
  const signals = management?.retentionSignals || [];
  const pdiSeedIdeas = management?.synthesis?.pdiIdeas || [];
  const showJourney = section === 'all' || section === 'journey';
  const showContext = section === 'all' || section === 'context';
  const showEncounters = section === 'all' || section === 'oneOnOne';

  if (section === 'journey') {
    if (employmentStatus !== EMPLOYMENT_STATUS.EMPLOYEE) {
      return (
        <p className="m-0 rounded-control border border-ink/12 bg-ink/[0.02] px-3.5 py-3 text-prose leading-normal text-ink-muted">
          {t(locale, 'panel.team.journeyNotEmployee')}
        </p>
      );
    }
    if (!candidateId) return null;
    return (
      <div className="space-y-3">
      <p className="m-0 text-sm text-ink-muted">{t(locale, 'betaPeople.journeyHint')}</p>
      <HireJourneyBlock
        locale={locale}
        candidateId={candidateId}
        employmentStatus={employmentStatus}
        onPdiChanged={() => setPdiRefresh((n) => n + 1)}
        pdiSeedIdeas={pdiSeedIdeas}
        oneOnOnes={oneOnOnes}
        pdiRefresh={pdiRefresh}
      />
      </div>
    );
  }

  const save = async () => {
    if (!candidateId || isRichTextEmpty(notes)) return;
    setBusy(true);
    setMsg('');
    try {
      const res = await fetch(`/api/admin/candidates/${encodeURIComponent(candidateId)}/one-on-ones`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meetingDate, notes, nextSteps }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || t(locale, 'panel.team.oneOnOneSaveError'));
      const savedNext = nextSteps;
      setNotes('');
      setNextSteps('');
      setMeetingDate(todayIso());
      setMsgError(false);
      setMsg(t(locale, 'panel.team.oneOnOneSaved'));
      if (onRefresh) await onRefresh();
      if (!isRichTextEmpty(savedNext) && data?.item?.id) {
        const go = await confirm({
          message: t(locale, 'panel.team.convertToPdiPrompt'),
          confirmLabel: t(locale, 'panel.team.convertToPdiConfirm'),
        });
        if (go) await convertToPdi(data.item.id);
      }
    } catch (e) {
      setMsgError(true);
      setMsg(e?.message || t(locale, 'panel.team.oneOnOneSaveError'));
    } finally {
      setBusy(false);
    }
  };

  const convertToPdi = async (oneOnOneId) => {
    if (!candidateId || !oneOnOneId) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/admin/candidates/${encodeURIComponent(candidateId)}/development-plans`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'fromOneOnOne', oneOnOneId }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || data?.errorCode || 'convert');
      toast(
        t(locale, 'panel.team.convertToPdiOk', { n: data.addedCount || 0 }),
        'ok'
      );
      setPdiRefresh((k) => k + 1);
    } catch (e) {
      toast(e?.message || t(locale, 'panel.pdi.saveError'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const openRetentionPlan = async () => {
    if (!candidateId || !signals.length) return;
    const values = await promptForm({
      title: t(locale, 'panel.team.retentionOpenTitle'),
      confirmLabel: t(locale, 'panel.team.retentionOpenConfirm'),
      fields: [
        {
          key: 'reviewDue',
          type: 'date',
          label: t(locale, 'panel.team.retentionReviewDue'),
          defaultValue: (() => {
            const d = new Date();
            d.setDate(d.getDate() + 21);
            return d.toISOString().slice(0, 10);
          })(),
        },
      ],
    });
    if (!values) return;
    setBusy(true);
    try {
      const explanation = signals.map((s) => s.text).join(' ');
      const suggestedQuestion =
        signals.map((s) => s.suggestedQuestion).filter(Boolean)[0] || '';
      const res = await fetch(
        `/api/admin/candidates/${encodeURIComponent(candidateId)}/retention-followups`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            signals,
            explanation,
            suggestedQuestion,
            reviewDue: values.reviewDue,
            locale,
          }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'retention');
      toast(t(locale, 'panel.team.retentionOpened'), 'ok');
      setPdiRefresh((k) => k + 1);
      await loadFollowUps();
    } catch (e) {
      toast(e?.message || t(locale, 'panel.common.error'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const markFollowUpReviewed = async (followUpId) => {
    if (!candidateId || !followUpId) return;
    const values = await promptForm({
      title: t(locale, 'panel.team.retentionReviewTitle'),
      confirmLabel: t(locale, 'panel.team.retentionReviewConfirm'),
      fields: [
        {
          key: 'reviewNotes',
          label: t(locale, 'panel.team.retentionReviewNotes'),
          placeholder: t(locale, 'panel.team.retentionReviewNotesPh'),
        },
      ],
    });
    if (!values) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/admin/candidates/${encodeURIComponent(candidateId)}/retention-followups/${encodeURIComponent(followUpId)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reviewed: true, reviewNotes: values.reviewNotes }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'review');
      toast(t(locale, 'panel.team.retentionReviewed'), 'ok');
      await loadFollowUps();
    } catch (e) {
      toast(e?.message || t(locale, 'panel.common.error'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const issueEmployeePortal = async () => {
    if (!candidateId) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/admin/candidates/${encodeURIComponent(candidateId)}/employee-portal`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'portal');
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      const url = `${origin}/e/${data.invite?.token}`;
      setPortalUrl(url);
      toast(t(locale, 'panel.employeePortal.created'), 'ok');
      await loadPortalTokens();
    } catch (e) {
      toast(e?.message || t(locale, 'panel.common.error'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const sendEmployeeAccess = async () => {
    if (!candidateId) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/admin/candidates/${encodeURIComponent(candidateId)}/employee-access`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ locale }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'access');
      toast(t(locale, 'panel.employeePortal.accessSent'), 'ok');
    } catch (e) {
      toast(e?.message || t(locale, 'panel.common.error'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (ooId) => {
    if (!candidateId || !ooId) return;
    const ok = await confirm({
      message: t(locale, 'panel.team.oneOnOneDeleteConfirm'),
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/admin/candidates/${encodeURIComponent(candidateId)}/one-on-ones/${encodeURIComponent(ooId)}`,
        { method: 'DELETE' }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || t(locale, 'panel.common.error'));
      if (onRefresh) await onRefresh();
    } catch (e) {
      await notice({ message: e?.message || t(locale, 'panel.common.error'), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cn(section === 'oneOnOne' ? 'mb-2 space-y-4' : 'mb-4 rounded-control border border-ink/12 bg-ink/[0.02] p-3.5')}>
      {showContext ? <>
      <div>
        <span className={cn(S.cardSection, 'mb-1.5 block')}>
          {t(locale, 'panel.team.peopleTitle')}
        </span>
        <p className="mb-0 mt-0 text-prose leading-normal text-ink/75">
          {t(locale, 'panel.team.peopleHint')}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-ui text-prose text-ink-muted">
        <span
          className={cn(
            'inline-flex min-h-8 items-center',
            completeness.enneagram ? 'text-success' : 'text-ink/75'
          )}
        >
          {completeness.enneagram
            ? t(locale, 'panel.team.peopleHasEnneagram')
            : t(locale, 'panel.team.peopleMissingEnneagram')}
        </span>
        <span className="text-ink/20" aria-hidden>
          ·
        </span>
        <span
          className={cn(
            'inline-flex min-h-8 items-center',
            completeness.motivators ? 'text-success' : 'text-ink/75'
          )}
        >
          {completeness.motivators
            ? t(locale, 'panel.team.peopleHasMotivators')
            : t(locale, 'panel.team.peopleMissingMotivators')}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy}
          className={cn(S.btnGhost, 'inline-flex min-h-touch items-center text-sm')}
          onClick={issueEmployeePortal}
        >
          {t(locale, 'panel.employeePortal.issueBtn')}
        </button>
        <button
          type="button"
          disabled={busy}
          className={cn(S.btnBrandSoft, 'inline-flex min-h-touch items-center text-sm')}
          onClick={sendEmployeeAccess}
          title={t(locale, 'panel.employeePortal.accessHint')}
        >
          {t(locale, 'panel.employeePortal.accessBtn')}
        </button>
      </div>

      {portalUrl ? (
        <div className="rounded-control border border-brand-500/25 bg-brand-500/[0.04] px-3 py-2">
          <p className={cn(S.muted, 'm-0 mb-1 text-prose')}>{t(locale, 'panel.employeePortal.linkHint')}</p>
          <CopyableLink url={portalUrl} locale={locale} />
        </div>
      ) : null}

      {portalTokens.some((x) => x.preparedAt || (x.noteToManager && String(x.noteToManager).trim())) ||
      (sessionPrep?.preparedAt ||
        (sessionPrep?.noteToManager && String(sessionPrep.noteToManager).trim())) ? (
        <div className="mb-3 rounded-control border border-success/25 bg-success/[0.05] px-3 py-2">
          <span className={cn(S.cardSection, 'mb-1 block')}>{t(locale, 'panel.employeePortal.managerFeedbackTitle')}</span>
          {sessionPrep?.preparedAt || (sessionPrep?.noteToManager && String(sessionPrep.noteToManager).trim()) ? (
            <div className="mt-1 text-prose text-ink-muted">
              <span className="font-ui text-prose normal-case text-brand-600">
                {t(locale, 'panel.employeePortal.sessionPrepSource')}
              </span>
              {sessionPrep.preparedAt ? (
                <span className="ml-2 font-ui text-prose text-success">
                  {t(locale, 'panel.employeePortal.managerPreparedAt', {
                    when: formatDisplayDateTime(sessionPrep.preparedAt, locale),
                  })}
                </span>
              ) : null}
              {sessionPrep.noteToManager ? <p className="mb-0 mt-1">{sessionPrep.noteToManager}</p> : null}
            </div>
          ) : null}
          {portalTokens
            .filter((x) => x.preparedAt || (x.noteToManager && String(x.noteToManager).trim()))
            .slice(0, 2)
            .map((tok) => (
              <div key={tok.id} className="mt-1 text-prose text-ink-muted">
                {tok.preparedAt ? (
                  <span className="font-ui text-prose text-success">
                    {t(locale, 'panel.employeePortal.managerPreparedAt', {
                      when: formatDisplayDateTime(tok.preparedAt, locale),
                    })}
                  </span>
                ) : null}
                {tok.noteToManager ? <p className="mb-0 mt-1">{tok.noteToManager}</p> : null}
              </div>
            ))}
        </div>
      ) : null}

      {signals.length > 0 ? (
        <div className="mb-3 rounded-control border border-warning/25 bg-warning/[0.06] px-3 py-2.5">
          <span className={cn(S.label, 'mb-1.5')}>
            {t(locale, 'panel.team.peopleRetention')}
          </span>
          <ul className="m-0 mb-2 pl-[18px]">
            {signals.map((s) => (
              <li key={s.key} className="mb-1.5 text-prose leading-[1.55] text-ink-muted">
                <div>{s.text}</div>
                {s.suggestedQuestion ? (
                  <div className="mt-0.5 text-prose italic text-ink">
                    {t(locale, 'panel.team.retentionAsk')}: {s.suggestedQuestion}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
          <button
            type="button"
            disabled={busy}
            className={cn(S.btnBrandSoft, 'min-h-touch')}
            onClick={openRetentionPlan}
          >
            {t(locale, 'panel.team.retentionOpenBtn')}
          </button>
        </div>
      ) : null}

      {followUps.length > 0 ? (
        <div className="mb-3 rounded-control border border-ink/12 bg-white/40 px-3 py-2.5">
          <span className={cn(S.label, 'mb-1.5')}>
            {t(locale, 'panel.team.retentionFollowUpsTitle')}
          </span>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {followUps.slice(0, 5).map((fu) => {
              const open = !fu.reviewedAt;
              return (
                <li key={fu.id} className="rounded-md border border-ink/10 px-2.5 py-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1 text-prose text-ink-muted">
                      <div className="font-ui text-prose text-ink/75">
                        {fu.reviewDue
                          ? t(locale, 'panel.team.retentionDue', {
                              d: String(fu.reviewDue).slice(0, 10),
                            })
                          : '—'}
                        {open
                          ? ` · ${t(locale, 'panel.team.retentionOpenStatus')}`
                          : ` · ${t(locale, 'panel.team.retentionClosedStatus')}`}
                      </div>
                      {fu.suggestedQuestion ? (
                        <p className="mb-0 mt-1 italic text-ink">{fu.suggestedQuestion}</p>
                      ) : null}
                      {fu.reviewNotes ? (
                        <p className="mb-0 mt-1 text-prose">{fu.reviewNotes}</p>
                      ) : null}
                    </div>
                    {open ? (
                      <button
                        type="button"
                        disabled={busy}
                        className={cn(S.btnGhost, 'min-h-touch text-prose')}
                        onClick={() => markFollowUpReviewed(fu.id)}
                      >
                        {t(locale, 'panel.team.retentionMarkReviewed')}
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {hypotheses.length > 0 ? (
        <div className="mb-3.5">
          <span className={cn(S.label, 'mb-2')}>
            {t(locale, 'panel.team.peopleHypotheses')}
          </span>
          <div className="flex flex-col gap-2">
            {[...hypotheses]
              .sort((a, b) => Number(b.source === 'cross') - Number(a.source === 'cross'))
              .map((h) => (
                <div
                  key={h.id}
                  className={cn(
                    'rounded-lg px-3 py-2.5',
                    h.source === 'cross'
                      ? 'border border-brand-500/30 bg-brand-500/[0.04]'
                      : 'border border-ink/12 bg-white/45'
                  )}
                >
                  <div className="mb-1 font-ui text-prose normal-case tracking-normal text-ink/75">
                    {t(locale, `panel.team.evidenceSource.${h.source || 'other'}`)}
                  </div>
                  {h.source === 'cross' ? (
                    <div className="mb-1 font-ui text-prose normal-case tracking-normal text-brand-500">
                      {t(locale, 'panel.team.peopleCrossBadge')}
                    </div>
                  ) : null}
                  <div className="mb-1 text-prose font-semibold text-ink">{h.title}</div>
                  <div className="text-prose leading-[1.55] text-ink-muted">{h.body}</div>
                </div>
              ))}
          </div>
          <p className={cn(S.faint, 'mb-0 mt-2 text-prose')}>
            {t(locale, 'panel.team.evidenceLimits')}
          </p>
        </div>
      ) : (
        <p className="mb-3 mt-0 text-prose italic text-ink/75">
          {t(locale, 'panel.team.peopleHypothesesEmpty')}
        </p>
      )}

      {prompts.length > 0 ? (
        <div className="mb-3.5">
          <span className={cn(S.label, 'mb-1.5')}>
            {t(locale, 'panel.team.peoplePrompts')}
          </span>
          <ol className="m-0 pl-[18px]">
            {prompts.map((q) => (
              <li key={q} className="mb-1 text-prose leading-[1.55] text-ink">
                {q}
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      </> : null}

      {showEncounters ? <div className={section === 'oneOnOne' ? '' : 'mt-1 border-t border-ink/12 pt-3'}>
        <span className={cn(S.label, 'mb-2')}>
          {t(locale, 'panel.team.oneOnOneTitle')}
        </span>

        <div className="mb-2.5 flex flex-col gap-2">
          <FormField as="div" label={t(locale, 'panel.team.oneOnOneDate')} className="max-w-[220px]">
            <DateField
              value={meetingDate}
              onChange={(e) => setMeetingDate(e.target.value)}
              aria-label={t(locale, 'panel.team.oneOnOneDate')}
              className="block w-full rounded-lg border border-ink/12 bg-white px-2.5 py-2 font-inherit text-ink"
            />
          </FormField>
          <FormField as="div" label={t(locale, 'panel.team.oneOnOneNotes')}>
            <RichTextEditor
              value={notes}
              onChange={setNotes}
              placeholder={t(locale, 'panel.team.oneOnOneNotesPlaceholder')}
              minHeight={100}
              locale={locale}
            />
          </FormField>
          <FormField as="div" label={t(locale, 'panel.team.oneOnOneNextSteps')}>
            <RichTextEditor
              value={nextSteps}
              onChange={setNextSteps}
              placeholder={t(locale, 'panel.team.oneOnOneNextStepsPlaceholder')}
              minHeight={80}
              locale={locale}
            />
          </FormField>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              disabled={busy || isRichTextEmpty(notes)}
              onClick={save}
              className={cn(
                'rounded-lg border-none bg-action px-3.5 py-2 font-inherit text-prose text-action-ink',
                busy || isRichTextEmpty(notes) ? 'cursor-default opacity-50' : 'cursor-pointer'
              )}
            >
              {busy ? t(locale, 'panel.admin.save') : t(locale, 'panel.team.oneOnOneSave')}
            </button>
            {msg ? (
              <span className={cn('text-prose', msgError ? 'text-red-800 dark:text-danger' : 'text-success')}>{msg}</span>
            ) : null}
          </div>
        </div>

        {oneOnOnes.length === 0 ? (
          <p className="m-0 text-prose italic text-ink/75">
            {t(locale, 'panel.team.oneOnOneEmpty')}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {oneOnOnes.map((item) => (
              <div
                key={item.id}
                className="rounded-lg border border-ink/12 bg-white/40 px-3 py-2.5"
              >
                <div className="mb-1.5 flex flex-wrap justify-between gap-2">
                  <span className="font-mono text-prose text-ink-muted">
                    {formatMeetingDate(item.meetingDate, locale)}
                    {item.createdByName ? ` · ${item.createdByName}` : ''}
                  </span>
                  <div className="flex gap-2">
                    {!isRichTextEmpty(item.nextSteps) ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => convertToPdi(item.id)}
                        className="cursor-pointer border-none bg-transparent font-ui text-prose text-brand-600"
                      >
                        {t(locale, 'panel.team.convertToPdi')}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => remove(item.id)}
                      className="cursor-pointer border-none bg-transparent font-ui text-prose text-red-800 dark:text-danger"
                    >
                      {t(locale, 'panel.team.oneOnOneDelete')}
                    </button>
                  </div>
                </div>
                <RichTextView html={item.notes} />
                {!isRichTextEmpty(item.nextSteps) ? (
                  <div className="mt-1.5">
                    <div className="mb-0.5 text-prose font-semibold text-ink">
                      {t(locale, 'panel.team.oneOnOneNextSteps')}
                    </div>
                    <RichTextView html={item.nextSteps} className="text-prose text-ink-muted" />
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      : null}

      {showJourney && candidateId ? (
        <HireJourneyBlock
          locale={locale}
          candidateId={candidateId}
          employmentStatus={employmentStatus}
          onPdiChanged={() => setPdiRefresh((n) => n + 1)}
          pdiSeedIdeas={pdiSeedIdeas}
          oneOnOnes={oneOnOnes}
          pdiRefresh={pdiRefresh}
        />
      ) : null}
    </div>
  );
}
