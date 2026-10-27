'use client';

import { useState } from 'react';
import { t } from '../../lib/i18n';
import { cn } from '../../lib/cn';
import { S } from '../dashboard/dashboard-shared';
import { AdminRichFormDrawer } from './AdminRichFormDrawer';
import { useAppFeedback } from './AppFeedback';

const fieldOrder = ['fullName', 'email', 'phone', 'linkedinUrl', 'city', 'state', 'workHistory', 'professionalSummary'];
const maxFileBytes = 5 * 1024 * 1024;

export function CandidateCvFirstImport({ vacancyId, locale, onCreated }) {
  const { toast, notice } = useAppFeedback();
  const [file, setFile] = useState(null);
  const [review, setReview] = useState(null);
  const [values, setValues] = useState({});
  const [busy, setBusy] = useState(false);
  const endpoint = `/api/admin/vacancies/${encodeURIComponent(vacancyId)}/candidates/cv-import`;

  const send = async (mode) => {
    if (!file || busy) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.set('file', file);
      form.set('mode', mode);
      if (mode === 'analyze') form.set('locale', locale);
      else {
        form.set('token', review.token);
        form.set('fields', JSON.stringify(Object.fromEntries(
          Object.entries(values).filter(([, value]) => String(value || '').trim()),
        )));
      }
      const response = await fetch(endpoint, { method: 'POST', body: form });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || t(locale, 'panel.common.error'));
      if (mode === 'analyze') {
        setValues(Object.fromEntries(fieldOrder.map((key) => [key, data.suggestions?.[key] || ''])));
        setReview(data);
      } else {
        setReview(null);
        setFile(null);
        setValues({});
        toast(t(locale, 'recruiting.cvCreateOk'));
        onCreated?.(data.candidateId);
      }
    } catch (error) {
      await notice({ title: t(locale, 'panel.common.errorTitle'), message: error.message, tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const duplicateEmail = Boolean(review?.duplicate &&
    values.email?.trim().toLowerCase() === review.suggestions?.email?.toLowerCase());
  return (
    <>
      <div className="mb-4 rounded-control border border-brand-500/25 bg-brand-500/[0.04] p-3.5">
        <p className="mb-2 mt-0 text-sm font-semibold text-ink">{t(locale, 'recruiting.cvCreateTitle')}</p>
        <p className="mb-3 mt-0 text-xs text-ink-muted">{t(locale, 'recruiting.cvCreateHint')}</p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="min-h-touch cursor-pointer rounded-control border border-ink/20 px-3 py-2 text-sm text-ink">
            {t(locale, 'recruiting.cvCreateChoose')}
            <input
              type="file"
              accept=".pdf,.docx,.txt,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className="sr-only"
              disabled={busy}
              onChange={(event) => {
                const selected = event.target.files?.[0] || null;
                setReview(null);
                setFile(selected && selected.size > maxFileBytes ? null : selected);
                if (selected?.size > maxFileBytes) {
                  notice({ title: t(locale, 'panel.common.errorTitle'), message: t(locale, 'recruiting.cvCreateFileTooLarge'), tone: 'error' });
                }
                event.target.value = '';
              }}
            />
          </label>
          {file ? <span className="max-w-full truncate text-xs text-ink-muted" title={file.name}>{file.name}</span> : null}
          <button type="button" className={cn(S.btnPrimary, 'min-h-touch')} disabled={!file || busy} onClick={() => send('analyze')}>
            {t(locale, busy ? 'recruiting.cvAiBusy' : 'recruiting.cvCreateAnalyze')}
          </button>
        </div>
      </div>
      <AdminRichFormDrawer
        open={Boolean(review)}
        title={t(locale, 'recruiting.cvCreateReview')}
        locale={locale}
        onClose={() => { if (!busy) setReview(null); }}
        footer={<div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={S.btnGhost} disabled={busy} onClick={() => setReview(null)}>{t(locale, 'panel.common.cancel')}</button>
          <button type="button" className={S.btnPrimary} disabled={busy || duplicateEmail || !values.fullName?.trim() || !values.email?.trim()} onClick={() => send('create')}>
            {t(locale, 'recruiting.cvCreateConfirm')}
          </button>
        </div>}
      >
        {review ? <div className="space-y-4" aria-busy={busy}>
          <p className="m-0 text-sm text-ink-muted">{t(locale, 'recruiting.cvCreateReviewHint')}</p>
          {duplicateEmail ? <p role="alert" className="rounded-control bg-warning/10 p-3 text-sm text-ink">
            {t(locale, 'recruiting.cvCreateDuplicate', { name: review.duplicate.fullName })}
          </p> : null}
          {review.warnings?.length ? <ul className="rounded-control bg-warning/10 p-3 pl-8 text-sm text-ink">
            {review.warnings.map((warning, index) => <li key={index}>{warning}</li>)}
          </ul> : null}
          {fieldOrder.map((key) => <label key={key} className="block text-sm font-medium text-ink">
            {t(locale, `recruiting.cvField.${key}`)}
            {['workHistory', 'professionalSummary'].includes(key) ? <textarea
              rows={6}
              value={values[key] || ''}
              disabled={busy}
              onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))}
              className={cn(S.textarea, 'mt-1 w-full')}
            /> : <input
              type={key === 'email' ? 'email' : key === 'phone' ? 'tel' : key === 'linkedinUrl' ? 'url' : 'text'}
              value={values[key] || ''}
              disabled={busy}
              onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))}
              className={cn(S.input, 'mt-1 w-full')}
            />}
          </label>)}
        </div> : null}
      </AdminRichFormDrawer>
    </>
  );
}
