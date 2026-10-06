'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { t } from '../../lib/i18n';
import { cn } from '../../lib/cn';
import { S } from '../dashboard/dashboard-shared';
import { FormField } from './FormField';
import { ScaleRatingButtons } from './ScaleRatingButtons';
import { EmptyState } from './EmptyState';
import { formatDisplayDate } from '../../lib/format-display-date';
import { useAppFeedback } from './AppFeedback';
import { AppLoading } from './AppLoading';
import { CLIMATE_QUESTION_KIND } from '../../lib/domain-status';

function isQuestionAnswered(q, value) {
  if (q.questionKind === CLIMATE_QUESTION_KIND.TEXT) return String(value || '').trim().length > 0;
  return value != null && value !== '';
}

/**
 * Clima / pulso autenticados — B-2501.
 * @param {(meta: { openCount: number, hasAny: boolean }) => void} [onMeta]
 */
export function EmployeeSurveysSection({ locale = 'pt-BR', onMeta }) {
  const { toast } = useAppFeedback();
  const [loading, setLoading] = useState(true);
  const [inbox, setInbox] = useState(null);
  const [answers, setAnswers] = useState({});
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/employee/surveys?locale=${encodeURIComponent(locale)}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || 'load');
      setInbox(json);
      const openCount =
        (json?.openClimate?.length || 0) + (json?.openPulse?.length || 0);
      const hasAny = openCount > 0 || (json?.history?.length || 0) > 0;
      onMeta?.({ openCount, hasAny });
    } catch (e) {
      toast(e?.message || t(locale, 'employeeHome.surveysLoadError'), 'error');
      setInbox(null);
      onMeta?.({ openCount: 0, hasAny: false });
    } finally {
      setLoading(false);
    }
  }, [locale, toast, onMeta]);

  useEffect(() => {
    void load();
  }, [load]);

  const activeProgress = useMemo(() => {
    if (!active) return { answered: 0, total: 0, complete: false };
    const qs = active.questions || [];
    const bag = answers[active.key] || {};
    const answered = qs.filter((q) => isQuestionAnswered(q, bag[q.id])).length;
    return { answered, total: qs.length, complete: qs.length > 0 && answered === qs.length };
  }, [active, answers]);

  const submit = async () => {
    if (!active?.token || !active?.kind || !activeProgress.complete) return;
    setBusy(true);
    try {
      const res = await fetch('/api/employee/surveys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: active.kind,
          token: active.token,
          answers: answers[active.key] || {},
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.errorCode || json?.error || 'submit');
      toast(t(locale, 'employeeHome.surveysSubmitted'), 'ok');
      setActive(null);
      setAnswers({});
      await load();
    } catch (e) {
      toast(t(locale, 'employeeHome.surveysSubmitError'), 'error');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <AppLoading variant="panel" />;

  const open = [
    ...(inbox?.openClimate || []).map((s) => ({ ...s, kind: 'climate', key: `c-${s.surveyId}` })),
    ...(inbox?.openPulse || []).map((s) => ({ ...s, kind: 'pulse', key: `p-${s.pulseId}` })),
  ];
  const history = inbox?.history || [];

  if (!open.length && !history.length) {
    return (
      <div data-emp-empty tabIndex={-1} className="outline-none">
        <EmptyState message={t(locale, 'employeeHome.surveysEmpty')} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {open.length > 0 ? (
        <div>
          <p className={cn(S.muted, 'm-0 mb-2 text-prose')}>{t(locale, 'employeeHome.surveysOpenHint')}</p>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {open.map((item) => (
              <li key={item.key} className="rounded-control border border-ink/12 bg-canvas/50 px-3 py-2.5">
                <div className="text-sm text-ink">{item.title}</div>
                <div className="mt-1 text-prose text-ink-muted">
                  {item.kind === 'climate'
                    ? t(locale, 'employeeHome.surveyKindClimate')
                    : t(locale, 'employeeHome.surveyKindPulse')}
                </div>
                <button
                  type="button"
                  className={cn(S.btnBrandSoft, 'mt-2 min-h-touch text-sm')}
                  onClick={() => setActive(item)}
                >
                  {t(locale, 'employeeHome.surveysAnswer')}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {active ? (
        <div className="rounded-control border border-brand-500/25 bg-brand-500/[0.04] p-3">
          <div className="mb-2 flex items-start justify-between gap-2">
            <div>
              <div className="font-ui text-sm text-ink">{active.title}</div>
              <p className={cn(S.muted, 'm-0 mt-1 text-prose')}>{t(locale, 'employeeHome.surveysAnonymousHint')}</p>
              {activeProgress.total > 0 ? (
                <p className="m-0 mt-1 text-prose text-ink-muted">
                  {t(locale, 'employeeHome.surveysProgress', {
                    answered: activeProgress.answered,
                    total: activeProgress.total,
                  })}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              className={cn(S.btnGhost, 'min-h-touch shrink-0 text-sm')}
              onClick={() => setActive(null)}
            >
              {t(locale, 'panel.common.cancel')}
            </button>
          </div>
          <div className="space-y-3">
            {(active.questions || []).map((q) => (
              <FormField key={q.id} label={q.prompt}>
                {q.questionKind === CLIMATE_QUESTION_KIND.TEXT ? (
                  <textarea
                    className={S.textarea}
                    maxLength={1500}
                    value={answers[active.key]?.[q.id] || ''}
                    onChange={(e) =>
                      setAnswers((prev) => ({
                        ...prev,
                        [active.key]: { ...(prev[active.key] || {}), [q.id]: e.target.value },
                      }))
                    }
                  />
                ) : (
                  <ScaleRatingButtons
                    min={q.scaleMin ?? 1}
                    max={q.scaleMax ?? 5}
                    value={answers[active.key]?.[q.id] ?? null}
                    ariaLabel={q.prompt}
                    disabled={busy}
                    onChange={(n) =>
                      setAnswers((prev) => ({
                        ...prev,
                        [active.key]: { ...(prev[active.key] || {}), [q.id]: n },
                      }))
                    }
                  />
                )}
              </FormField>
            ))}
          </div>
          <button
            type="button"
            disabled={busy || !activeProgress.complete}
            className={cn(S.btnPrimary, 'mt-3 min-h-touch w-full sm:w-auto')}
            onClick={submit}
          >
            {t(locale, 'employeeHome.surveysSubmit')}
          </button>
        </div>
      ) : null}

      {history.length > 0 ? (
        <div>
          <h3 className={cn(S.cardSection, 'mb-2 mt-0 text-sm')}>
            {t(locale, 'employeeHome.surveysHistory')}
          </h3>
          <ul className={cn(S.cardMuted, 'm-0 list-none space-y-1.5 p-0')}>
            {history.slice(0, 8).map((h, i) => (
              <li key={`${h.kind}-${h.title}-${i}`}>
                ✓ {h.title}
                {h.submittedAt ? (
                  <span className={cn(S.faint, 'ml-1')}>
                    {formatDisplayDate(h.submittedAt, locale)}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
