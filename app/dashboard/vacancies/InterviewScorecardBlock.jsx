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
export function InterviewScorecardBlock({ vacancyId, candidateId, locale = 'pt-BR' }) {
  const { toast } = useAppFeedback();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [interviewMode, setInterviewMode] = useState(false);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
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
    setItems((cur) => cur.map((row, i) => (i === idx ? { ...row, comment } : row)));
  };

  const activeQuestionIndex = Math.min(currentQuestionIndex, Math.max(items.length - 1, 0));
  const activeQuestion = items[activeQuestionIndex];

  const generateGuide = async () => {
    setGenerating(true);
    setErr('');
    try {
      const res = await fetch(
        `/api/admin/vacancies/${encodeURIComponent(vacancyId)}/candidates/${encodeURIComponent(candidateId)}/scorecard`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'generateInterviewGuide', locale }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || t(locale, 'recruiting.scorecardAiError'));
      const generated = Array.isArray(data.questions) ? data.questions : [];
      const available = Math.max(0, 12 - items.length);
      const additions = generated.slice(0, available);
      if (!additions.length) throw new Error(t(locale, 'recruiting.scorecardAiLimit'));
      setItems((current) => [...current, ...additions]);
      toast(t(locale, 'recruiting.scorecardAiSuccess'), 'ok');
    } catch (e) {
      setErr(e?.message || t(locale, 'recruiting.scorecardAiError'));
      toast(e?.message || t(locale, 'recruiting.scorecardAiError'), 'error');
    } finally {
      setGenerating(false);
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
    <div className="mb-4 rounded-control border border-ink/12 bg-ink/[0.02] p-3" aria-busy={busy || generating}>
      <span className={cn(S.cardSection, 'mb-1 block')}>{t(locale, 'recruiting.scorecardTitle')}</span>
      <p className="mb-3 mt-0 text-2xs leading-snug text-ink-muted">
        {t(locale, 'recruiting.scorecardHint')}
      </p>
      {!interviewMode ? (
        <>
          <p className="mb-2 mt-0 text-2xs leading-snug text-ink-muted">{t(locale, 'recruiting.scorecardAiHint')}</p>
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
        <section className="rounded-control border border-brand-700/20 bg-surface p-3" aria-label={t(locale, 'recruiting.scorecardTitle')}>
          <p className="mb-3 mt-0 text-xs font-semibold text-ink-muted" aria-live="polite">
            {t(locale, 'recruiting.scorecardQuestionProgress', {
              current: activeQuestionIndex + 1,
              total: items.length,
            })}
          </p>
          {activeQuestion.competency ? <p className="mb-1 mt-0 text-2xs font-semibold text-brand-700">{t(locale, 'recruiting.scorecardCompetencyLabel')}: {activeQuestion.competency}</p> : null}
          <p className="mb-3 mt-0 text-lg font-semibold leading-snug text-ink">{activeQuestion.text}</p>
          {activeQuestion.candidateEvidence ? <p className="mb-2 mt-0 text-sm leading-snug text-ink-muted"><strong>{t(locale, 'recruiting.scorecardEvidenceLabel')}:</strong> {activeQuestion.candidateEvidence}</p> : null}
          {activeQuestion.followUp ? <p className="mb-2 mt-0 text-sm leading-snug text-ink-muted"><strong>{t(locale, 'recruiting.scorecardFollowUpLabel')}:</strong> {activeQuestion.followUp}</p> : null}
          {activeQuestion.listenFor ? <p className="mb-3 mt-0 text-sm leading-snug text-ink-muted"><strong>{t(locale, 'recruiting.scorecardListenForLabel')}:</strong> {activeQuestion.listenFor}</p> : null}
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
            />
          </FormField>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setCurrentQuestionIndex((index) => Math.max(index - 1, 0))}
              disabled={activeQuestionIndex === 0}
              className={cn(S.btnBrandSoft, activeQuestionIndex === 0 && 'opacity-60')}
            >
              {t(locale, 'recruiting.scorecardPreviousQuestion')}
            </button>
            <button
              type="button"
              onClick={() => setInterviewMode(false)}
              className={cn(S.btnBrandSoft, 'order-3 w-full sm:order-none sm:w-auto')}
            >
              {t(locale, 'recruiting.scorecardExitInterview')}
            </button>
            <button
              type="button"
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
      {items.length ? (
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className={cn(S.btnBrandSoft, 'mt-3', busy && 'opacity-60')}
        >
          {busy ? t(locale, 'panel.common.loading') : t(locale, 'recruiting.scorecardSave')}
        </button>
      ) : null}
    </div>
  );
}
