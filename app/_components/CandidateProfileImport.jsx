'use client';

import { useState } from 'react';
import { t } from '../../lib/i18n';
import { cn } from '../../lib/cn';
import { S } from '../dashboard/dashboard-shared';
import { AdminRichFormDrawer } from './AdminRichFormDrawer';
import { useAppFeedback } from './AppFeedback';

export function CandidateProfileImport({ candidateId, locale, disabled, onApplied }) {
  const { toast, notice } = useAppFeedback();
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState(null);
  const [selected, setSelected] = useState({});
  const [values, setValues] = useState({});
  const endpoint = `/api/admin/candidates/${encodeURIComponent(candidateId)}/cv/import`;
  const showError = (message) =>
    notice({ title: t(locale, 'panel.common.errorTitle'), message, tone: 'error' });

  const analyze = async () => {
    setBusy(true);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locale }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t(locale, 'panel.common.error'));
      setValues(data.suggestions);
      setSelected(
        Object.fromEntries(
          Object.keys(data.suggestions).map((key) => [key, !data.candidateFields?.[key]]),
        ),
      );
      setReview(data);
    } catch (error) {
      await showError(error.message);
    } finally {
      setBusy(false);
    }
  };
  const apply = async () => {
    const fields = Object.fromEntries(Object.entries(values).filter(([key]) => selected[key]));
    if (!Object.keys(fields).length) return;
    setBusy(true);
    try {
      const res = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: review.token, fields }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t(locale, 'panel.common.error'));
      setReview(null);
      toast(t(locale, 'recruiting.cvApplyOk'));
      onApplied?.(data);
    } catch (error) {
      await showError(error.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button
        type="button"
        onClick={analyze}
        disabled={disabled || busy}
        aria-busy={busy}
        className={cn(S.btnPrimary, 'min-h-touch')}
      >
        {t(locale, busy ? 'recruiting.cvAiBusy' : 'recruiting.cvAiAnalyze')}
      </button>
      <AdminRichFormDrawer
        open={Boolean(review)}
        title={t(locale, 'recruiting.cvAiReview')}
        locale={locale}
        onClose={() => {
          if (!busy) setReview(null);
        }}
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              className={S.btnGhost}
              disabled={busy}
              onClick={() => setReview(null)}
            >
              {t(locale, 'panel.common.cancel')}
            </button>
            <button
              type="button"
              className={S.btnPrimary}
              onClick={apply}
              disabled={busy || !Object.values(selected).some(Boolean)}
            >
              {t(locale, 'recruiting.cvAiSave')}
            </button>
          </div>
        }
      >
        {review ? (
          <div className="space-y-4" aria-busy={busy}>
            <p className="m-0 text-sm text-ink-muted">{t(locale, 'recruiting.cvAiReviewHint')}</p>
            {review.warnings?.length ? (
              <ul className="rounded-control bg-warning/10 p-4 pl-8 text-sm text-ink" role="status">
                {review.warnings.map((warning, i) => (
                  <li key={i}>{warning}</li>
                ))}
              </ul>
            ) : null}
            {Object.entries(values).map(([key, value]) => (
              <div key={key} className="border-b border-ink/10 pb-4">
                <label className="mb-2 flex min-h-touch cursor-pointer items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    checked={Boolean(selected[key])}
                    disabled={busy}
                    className="ui-checkbox"
                    onChange={(e) =>
                      setSelected((current) => ({ ...current, [key]: e.target.checked }))
                    }
                  />
                  {t(locale, `recruiting.cvField.${key}`)}
                </label>
                {review.candidateFields?.[key] ? (
                  <p className="mb-2 whitespace-pre-wrap break-words text-xs text-ink-muted">
                    {t(locale, 'recruiting.cvCurrentValue')}: {review.candidateFields[key]}
                  </p>
                ) : null}
                <label className="block">
                  <span className="sr-only">{t(locale, `recruiting.cvField.${key}`)}</span>
                  <textarea
                    rows={['professionalSummary', 'workHistory'].includes(key) ? 8 : 2}
                    value={value}
                    disabled={!selected[key] || busy}
                    className={cn(S.textarea, 'w-full')}
                    onChange={(e) =>
                      setValues((current) => ({ ...current, [key]: e.target.value }))
                    }
                  />
                </label>
              </div>
            ))}
          </div>
        ) : null}
      </AdminRichFormDrawer>
    </>
  );
}
