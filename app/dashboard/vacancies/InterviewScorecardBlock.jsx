'use client';

import { useCallback, useEffect, useState } from 'react';
import { cn } from '../../../lib/cn';
import { t } from '../../../lib/i18n';
import { S } from '../dashboard-shared';
import { FormField } from '../../_components/FormField';
import { useAppFeedback } from '../../_components/AppFeedback';
import { ScaleRatingButtons } from '../../_components/ScaleRatingButtons';

/**
 * Light interview scorecard (B-407) — ratings 1–5 vs briefing questions.
 */
export function InterviewScorecardBlock({ vacancyId, candidateId, locale = 'pt-BR', onApplySummary }) {
  const { toast } = useAppFeedback();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [suggestingFollowUp, setSuggestingFollowUp] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [interviewMode, setInterviewMode] = useState(false);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [includeProfileContext, setIncludeProfileContext] = useState(false);
  const [contextUsed, setContextUsed] = useState(null);
  const [summary, setSummary] = useState(null);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    if (!vacancyId || !candidateId) return;
    setLoading(true);
    setErr('');
    try {
      const res = await fetch(
        `/api/admin/vacancies/${encodeURIComponent(vacancyId)}/candidates/${encodeURIComponent(candidateId)}/scorecard`
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || t(locale, 'panel.common.error'));
      setItems(Array.isArray(data.scorecard?.items) ? data.scorecard.items : []);
    } catch (e) {
      setErr(e?.message || t(locale, 'panel.common.error'));
    } finally {
      setLoading(false);
    }
  }, [vacancyId, candidateId, locale]);

  useEffect(() => {
    load();
  }, [load]);

  const setRating = (idx, rating) => {
    setItems((cur) =>
      cur.map((row, i) => (i === idx ? { ...row, rating: Number(rating) } : row))
    );
  };

  const setComment = (idx, comment) => {
    setSummary(null);
    setItems((cur) => cur.map((row, i) => (i === idx ? { ...row, comment } : row)));
  };

  const activeQuestionIndex = Math.min(currentQuestionIndex, Math.max(items.length - 1, 0));
  const activeQuestion = items[activeQuestionIndex];
  const hasNotesForSummary = items.some((row) => String(row.comment || '').trim().length >= 8);

  const generateGuide = async () => {
    setGenerating(true);
    setErr('');
    try {
      const res = await fetch(
        `/api/admin/vacancies/${encodeURIComponent(vacancyId)}/candidates/${encodeURIComponent(candidateId)}/scorecard`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'generateInterviewGuide', locale, includeProfileContext }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || t(locale, 'recruiting.scorecardAiError'));
      const generated = Array.isArray(data.questions) ? data.questions : [];
      const available = Math.max(0, 12 - items.length);
      const additions = generated.slice(0, available);
      if (!additions.length) throw new Error(t(locale, 'recruiting.scorecardAiLimit'));
      setItems((current) => [...current, ...additions]);
      setContextUsed(data.contextUsed || null);
      toast(t(locale, 'recruiting.scorecardAiSuccess'), 'ok');
    } catch (e) {
      setErr(e?.message || t(locale, 'recruiting.scorecardAiError'));
      toast(e?.message || t(locale, 'recruiting.scorecardAiError'), 'error');
    } finally {
      setGenerating(false);
    }
  };

  const suggestFollowUp = async () => {
    if (!activeQuestion) return;
    setSuggestingFollowUp(true);
    setErr('');
    try {
      const res = await fetch(
        `/api/admin/vacancies/${encodeURIComponent(vacancyId)}/candidates/${encodeURIComponent(candidateId)}/scorecard`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'suggestInterviewFollowUp',
            locale,
            includeProfileContext,
            question: activeQuestion.text,
            notes: activeQuestion.comment || '',
          }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || t(locale, 'recruiting.scorecardAiFollowUpError'));
      const suggestion = String(data.question || '').trim();
      if (!suggestion) throw new Error(t(locale, 'recruiting.scorecardAiFollowUpError'));
      const questionId = activeQuestion.questionId;
      setItems((current) => current.map((row, index) => {
        const matches = questionId ? row.questionId === questionId : index === activeQuestionIndex;
        if (!matches) return row;
        const suggestions = Array.isArray(row.aiFollowUps) ? row.aiFollowUps : [];
        return {
          ...row,
          aiFollowUps: [...new Set([...suggestions, suggestion])].slice(0, 3),
        };
      }));
      toast(t(locale, 'recruiting.scorecardAiFollowUpReady'), 'ok');
    } catch (e) {
      setErr(e?.message || t(locale, 'recruiting.scorecardAiFollowUpError'));
      toast(e?.message || t(locale, 'recruiting.scorecardAiFollowUpError'), 'error');
    } finally {
      setSuggestingFollowUp(false);
    }
  };

  const summarizeScorecard = async () => {
    setSummarizing(true);
    setErr('');
    try {
      const res = await fetch(
        `/api/admin/vacancies/${encodeURIComponent(vacancyId)}/candidates/${encodeURIComponent(candidateId)}/scorecard`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'summarizeInterviewScorecard', locale, items }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || t(locale, 'recruiting.scorecardSummaryError'));
      if (!data.summary || !Array.isArray(data.summary.competencies)) {
        throw new Error(t(locale, 'recruiting.scorecardSummaryError'));
      }
      setSummary(data.summary);
      toast(t(locale, 'recruiting.scorecardSummaryReady'), 'ok');
    } catch (e) {
      setErr(e?.message || t(locale, 'recruiting.scorecardSummaryError'));
      toast(e?.message || t(locale, 'recruiting.scorecardSummaryError'), 'error');
    } finally {
      setSummarizing(false);
    }
  };

  const save = async () => {
    setBusy(true);
    setErr('');
    try {
      const res = await fetch(
        `/api/admin/vacancies/${encodeURIComponent(vacancyId)}/candidates/${encodeURIComponent(candidateId)}/scorecard`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || t(locale, 'panel.common.error'));
      setItems(Array.isArray(data.scorecard?.items) ? data.scorecard.items : items);
      toast(t(locale, 'recruiting.scorecardSaved'), 'ok');
    } catch (e) {
      setErr(e?.message || t(locale, 'panel.common.error'));
      toast(e?.message || t(locale, 'panel.common.error'), 'error');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <p className="m-0 text-xs text-ink-muted">{t(locale, 'panel.common.loading')}</p>;
  }

  return (
    <div
      className="mb-4 rounded-control border border-ink/12 bg-ink/[0.02] p-3"
      aria-busy={busy || generating || suggestingFollowUp || summarizing}
    >
      <span className={cn(S.cardSection, 'mb-1 block')}>{t(locale, 'recruiting.scorecardTitle')}</span>
      <p className="mb-3 mt-0 text-2xs leading-snug text-ink-muted">
        {t(locale, 'recruiting.scorecardHint')}
      </p>
      {!interviewMode ? (
        <>
          <p className="mb-2 mt-0 text-2xs leading-snug text-ink-muted">
            {t(locale, 'recruiting.scorecardAiHint')}
          </p>
          <label className="mb-1 flex items-start gap-2 text-xs text-ink">
            <input
              type="checkbox"
              checked={includeProfileContext}
              onChange={(event) => setIncludeProfileContext(event.target.checked)}
              className="mt-0.5 accent-brand-700"
            />
            <span>{t(locale, 'recruiting.scorecardAiIncludeProfileContext')}</span>
          </label>
          <p className="mb-3 mt-0 ml-5 text-2xs leading-snug text-ink-muted">
            {t(locale, 'recruiting.scorecardAiProfileContextHint')}
          </p>
          <button
            type="button"
            onClick={generateGuide}
            disabled={generating || items.length >= 12}
            className={cn(S.btnBrandSoft, 'mb-3', (generating || items.length >= 12) && 'opacity-60')}
          >
            {generating ? t(locale, 'recruiting.scorecardAiGenerating') : t(locale, 'recruiting.scorecardAiGenerate')}
          </button>
        </>
      ) : null}
      {contextUsed ? (
        <p className="mb-3 mt-0 rounded-control bg-ink/[0.04] px-2.5 py-2 text-2xs text-ink-muted">
          <strong>{t(locale, 'recruiting.scorecardContextSourcesTitle')}:</strong>{' '}
          {[
            contextUsed.vacancy ? t(locale, 'recruiting.scorecardContextVacancy') : null,
            contextUsed.profileSummary ? t(locale, 'recruiting.scorecardContextSummary') : null,
            contextUsed.curriculum ? t(locale, 'recruiting.scorecardContextCv') : null,
            contextUsed.workStyle ? t(locale, 'recruiting.scorecardContextWorkStyle') : null,
            contextUsed.motivators ? t(locale, 'recruiting.scorecardContextMotivators') : null,
          ].filter(Boolean).join(' · ')}
        </p>
      ) : null}
      {items.length && !interviewMode ? (
        <button
          type="button"
          onClick={() => {
            setCurrentQuestionIndex(0);
            setInterviewMode(true);
          }}
          className={cn(S.btnBrandSoft, 'mb-3 ml-2')}
        >
          {t(locale, 'recruiting.scorecardStartInterview')}
        </button>
      ) : null}
      {items.length && interviewMode && activeQuestion ? (
        <section
          className="rounded-control border border-brand-700/20 bg-surface p-3"
          aria-label={t(locale, 'recruiting.scorecardTitle')}
        >
          <p className="mb-3 mt-0 text-xs font-semibold text-ink-muted" aria-live="polite">
            {t(locale, 'recruiting.scorecardQuestionProgress', {
              current: activeQuestionIndex + 1,
              total: items.length,
            })}
          </p>
          {activeQuestion.competency ? (
            <p className="mb-1 mt-0 text-2xs font-semibold text-brand-700">
              {t(locale, 'recruiting.scorecardCompetencyLabel')}: {activeQuestion.competency}
            </p>
          ) : null}
          <p className="mb-3 mt-0 text-lg font-semibold leading-snug text-ink">{activeQuestion.text}</p>
          {activeQuestion.candidateEvidence ? (
            <p className="mb-2 mt-0 text-sm leading-snug text-ink-muted">
              <strong>{t(locale, 'recruiting.scorecardEvidenceLabel')}:</strong> {activeQuestion.candidateEvidence}
            </p>
          ) : null}
          {activeQuestion.followUp ? (
            <p className="mb-2 mt-0 text-sm leading-snug text-ink-muted">
              <strong>{t(locale, 'recruiting.scorecardFollowUpLabel')}:</strong> {activeQuestion.followUp}
            </p>
          ) : null}
          {activeQuestion.listenFor ? (
            <p className="mb-3 mt-0 text-sm leading-snug text-ink-muted">
              <strong>{t(locale, 'recruiting.scorecardListenForLabel')}:</strong> {activeQuestion.listenFor}
            </p>
          ) : null}
          <ScaleRatingButtons
            min={1}
            max={5}
            value={activeQuestion.rating}
            size="sm"
            className="mb-3"
            ariaLabel={activeQuestion.text}
            onChange={(rating) => setRating(activeQuestionIndex, rating)}
          />
          <FormField label={t(locale, 'recruiting.scorecardCommentPh')}>
            <textarea
              value={activeQuestion.comment || ''}
              onChange={(event) => setComment(activeQuestionIndex, event.target.value)}
              className={cn(S.input, 'min-h-24 w-full resize-y bg-surface/90')}
              maxLength={2000}
              rows={4}
              disabled={summarizing}
            />
          </FormField>
          <button
            type="button"
            onClick={suggestFollowUp}
            disabled={
              suggestingFollowUp ||
              String(activeQuestion.comment || '').trim().length < 8 ||
              (activeQuestion.aiFollowUps || []).length >= 3
            }
            className={cn(
              S.btnBrandSoft,
              'mt-2',
              (
                suggestingFollowUp ||
                String(activeQuestion.comment || '').trim().length < 8 ||
                (activeQuestion.aiFollowUps || []).length >= 3
              ) && 'opacity-60'
            )}
          >
            {suggestingFollowUp
              ? t(locale, 'recruiting.scorecardAiSuggestingFollowUp')
              : t(locale, 'recruiting.scorecardAiSuggestFollowUp')}
          </button>
          <p className="mb-0 mt-1 text-2xs text-ink-muted">
            {t(locale, 'recruiting.scorecardAiFollowUpNoteRequired')}
          </p>
          {Array.isArray(activeQuestion.aiFollowUps) && activeQuestion.aiFollowUps.length ? (
            <div className="mt-3 rounded-control border border-brand-700/15 bg-brand-700/[0.04] p-2.5" aria-live="polite">
              <p className="mb-1 mt-0 text-xs font-semibold text-ink">{t(locale, 'recruiting.scorecardAiFollowUps')}</p>
              <ul className="m-0 list-disc space-y-1 pl-5 text-sm leading-snug text-ink">
                {activeQuestion.aiFollowUps.map((suggestion, index) => (
                  <li key={`${activeQuestion.questionId || activeQuestionIndex}-follow-up-${index}`}>
                    {suggestion}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setCurrentQuestionIndex((index) => Math.max(index - 1, 0))}
              disabled={activeQuestionIndex === 0 || suggestingFollowUp}
              className={cn(S.btnBrandSoft, (activeQuestionIndex === 0 || suggestingFollowUp) && 'opacity-60')}
            >
              {t(locale, 'recruiting.scorecardPreviousQuestion')}
            </button>
            <button
              type="button"
              onClick={() => setInterviewMode(false)}
              disabled={suggestingFollowUp}
              className={cn(S.btnBrandSoft, 'order-3 w-full sm:order-none sm:w-auto')}
            >
              {t(locale, 'recruiting.scorecardExitInterview')}
            </button>
            <button
              type="button"
              disabled={suggestingFollowUp}
              onClick={() => {
                if (activeQuestionIndex >= items.length - 1) {
                  setInterviewMode(false);
                  toast(t(locale, 'recruiting.scorecardInterviewDone'), 'ok');
                } else {
                  setCurrentQuestionIndex((index) => index + 1);
                }
              }}
              className={S.btnBrandSoft}
            >
              {activeQuestionIndex >= items.length - 1
                ? t(locale, 'recruiting.scorecardInterviewDone')
                : t(locale, 'recruiting.scorecardNextQuestion')}
            </button>
          </div>
        </section>
      ) : null}
      {items.length ? (
        interviewMode ? null : (
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {items.map((row, idx) => (
              <li key={row.questionId || idx} className="border-t border-ink/10 pt-2.5 first:border-0 first:pt-0">
                {row.competency ? <p className="mb-1 mt-0 text-2xs font-semibold text-brand-700">{t(locale, 'recruiting.scorecardCompetencyLabel')}: {row.competency}</p> : null}
                <p className="mb-1.5 mt-0 text-prose leading-snug text-ink">{row.text}</p>
                {row.candidateEvidence ? <p className="mb-1 mt-0 text-xs leading-snug text-ink-muted"><strong>{t(locale, 'recruiting.scorecardEvidenceLabel')}:</strong> {row.candidateEvidence}</p> : null}
                {row.followUp ? <p className="mb-1 mt-0 text-xs leading-snug text-ink-muted"><strong>{t(locale, 'recruiting.scorecardFollowUpLabel')}:</strong> {row.followUp}</p> : null}
                {row.listenFor ? <p className="mb-2 mt-0 text-xs leading-snug text-ink-muted"><strong>{t(locale, 'recruiting.scorecardListenForLabel')}:</strong> {row.listenFor}</p> : null}
                {Array.isArray(row.aiFollowUps) && row.aiFollowUps.length ? (
                  <div className="mb-2 rounded-control bg-brand-700/[0.04] p-2 text-xs text-ink">
                    <strong>{t(locale, 'recruiting.scorecardAiFollowUps')}:</strong>
                    <ul className="mb-0 mt-1 list-disc space-y-1 pl-5">
                      {row.aiFollowUps.map((suggestion, index) => <li key={`${row.questionId}-follow-up-${index}`}>{suggestion}</li>)}
                    </ul>
                  </div>
                ) : null}
                <ScaleRatingButtons
                  min={1}
                  max={5}
                  value={row.rating}
                  size="sm"
                  className="mb-1.5"
                  ariaLabel={row.text}
                  onChange={(n) => setRating(idx, n)}
                />
                <FormField label={t(locale, 'recruiting.scorecardCommentPh')}>
                  <input
                    value={row.comment || ''}
                    onChange={(e) => setComment(idx, e.target.value)}
                    className={cn(S.input, 'w-full bg-surface/90')}
                    maxLength={2000}
                  disabled={summarizing}
                  />
                </FormField>
              </li>
            ))}
          </ul>
        )
      ) : (
        <p className="m-0 text-xs text-ink-muted">{t(locale, 'recruiting.scorecardEmpty')}</p>
      )}
      {err ? <p className="mb-0 mt-2 text-xs text-danger" role="alert">{err}</p> : null}
      {summary ? (
        <section className="mt-3 rounded-control border border-brand-700/20 bg-surface p-3" aria-live="polite">
          <h4 className="mb-2 mt-0 text-sm font-semibold text-ink">{t(locale, 'recruiting.scorecardSummaryTitle')}</h4>
          <p className="mb-3 mt-0 text-xs leading-snug text-ink-muted">
            {t(locale, 'recruiting.scorecardSummaryHint')}
          </p>
          {summary.overview ? <p className="mb-3 mt-0 text-sm leading-snug text-ink">{summary.overview}</p> : null}
          <div className="flex flex-col gap-3">
            {summary.competencies.map((group, index) => (
              <div key={`${group.competency}-${index}`} className="border-t border-ink/10 pt-2 first:border-0 first:pt-0">
                <p className="mb-1 mt-0 text-xs font-semibold text-brand-700">{group.competency}</p>
                {group.notesSummary ? <p className="mb-2 mt-0 text-sm leading-snug text-ink">{group.notesSummary}</p> : null}
                {Array.isArray(group.pointsToClarify) && group.pointsToClarify.length ? (
                  <>
                    <p className="mb-1 mt-0 text-xs font-semibold text-ink-muted">{t(locale, 'recruiting.scorecardSummaryPointsToClarify')}</p>
                    <ul className="mb-0 mt-0 list-disc space-y-1 pl-5 text-sm text-ink-muted">
                      {group.pointsToClarify.map((point, pointIndex) => <li key={`${index}-point-${pointIndex}`}>{point}</li>)}
                    </ul>
                  </>
                ) : null}
              </div>
            ))}
          </div>
          {onApplySummary ? (
            <button
              type="button"
              onClick={() => onApplySummary(summary)}
              className={cn(S.btnBrandSoft, 'mt-3')}
            >
              {t(locale, 'recruiting.scorecardSummaryApplyToNotes')}
            </button>
          ) : null}
        </section>
      ) : null}
      {items.length ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={save}
            disabled={busy || suggestingFollowUp || summarizing}
            className={cn(S.btnBrandSoft, (busy || suggestingFollowUp || summarizing) && 'opacity-60')}
          >
            {busy ? t(locale, 'panel.common.loading') : t(locale, 'recruiting.scorecardSave')}
          </button>
          <button
            type="button"
            onClick={summarizeScorecard}
            disabled={busy || suggestingFollowUp || summarizing || !hasNotesForSummary}
            className={cn(S.btnBrandSoft, (busy || suggestingFollowUp || summarizing || !hasNotesForSummary) && 'opacity-60')}
          >
            {summarizing
              ? t(locale, 'recruiting.scorecardSummarizing')
              : t(locale, 'recruiting.scorecardSummarize')}
          </button>
        </div>
      ) : null}
      {items.length && !hasNotesForSummary ? (
        <p className="mb-0 mt-1 text-2xs text-ink-muted">{t(locale, 'recruiting.scorecardSummaryNeedsNotes')}</p>
      ) : null}
    </div>
  );
}
