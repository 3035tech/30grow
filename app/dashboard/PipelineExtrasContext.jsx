'use client';

import { createContext, useCallback, useContext, useMemo, useRef, useState, useEffect } from 'react';
import { REJECTION_REASONS, normalizeStartDate } from '../../lib/recruiting/pipeline';
import { t, messageNode } from '../../lib/i18n';
import { rejectionReasonLabel } from './pipeline-prompts';
import { DateField } from '../_components/DateField';
import { FormField } from '../_components/FormField';
import { S } from './dashboard-shared';
import { RichTextEditor } from '../_components/RichTextEditor';
import { htmlToPlainText, sanitizeInterviewNotesHtml } from '../../lib/sanitize-html';

const PipelineExtrasContext = createContext(null);

function feedbackToHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]).replace(/\r?\n/g, '<br />');
}

function PipelineExtrasDialog({ locale, mode, context, bulk, onConfirm, onCancel }) {
  const [reasons, setReasons] = useState([]);
  const [startDate, setStartDate] = useState('');
  const [error, setError] = useState('');
  const [sendEmail, setSendEmail] = useState(false);
  const [emailSubject, setEmailSubject] = useState(messageNode(locale, 'recruiting.rejectionEmailDefaultSubject'));
  const [emailBody, setEmailBody] = useState(messageNode(locale, 'recruiting.rejectionEmailDefaultBody'));
  const [candidateFeedback, setCandidateFeedback] = useState('');
  const [showEmailPreview, setShowEmailPreview] = useState(false);
  const [aiTone, setAiTone] = useState('warm');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiStatus, setAiStatus] = useState('');
  const [templateLoading, setTemplateLoading] = useState(Boolean(context?.vacancyId));
  const [templateError, setTemplateError] = useState(false);

  useEffect(() => {
    if (mode !== 'rejected' || bulk || !context?.vacancyId) return;
    let cancelled = false;
    fetch(`/api/admin/vacancies/${encodeURIComponent(context.vacancyId)}`)
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error('TEMPLATE_LOAD_FAILED');
        return data;
      })
      .then((data) => {
        if (cancelled) return;
        const vacancy = data.vacancy || data;
        const companyName = vacancy.companyName || '';
        const values = { candidateName: context.candidateName || '', vacancyTitle: vacancy.title || '', companyName };
        const replace = (value, html = false) => String(value || '').replace(/\{(candidateName|vacancyTitle|companyName)\}/g, (_, key) => html
          ? values[key].replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
          : values[key]);
        setEmailSubject(replace(vacancy.rejectionEmailSubject || messageNode(locale, 'recruiting.rejectionEmailDefaultSubject')));
        setEmailBody(replace(vacancy.rejectionEmailBody || messageNode(locale, 'recruiting.rejectionEmailDefaultBody'), true).replace(/\{rejectionReasons\}/g, '{candidateFeedback}'));
      })
      .catch(() => { if (!cancelled) setTemplateError(true); })
      .finally(() => { if (!cancelled) setTemplateLoading(false); });
    return () => { cancelled = true; };
  }, [context, locale, mode, bulk]);

  const title =
    mode === 'rejected'
      ? t(locale, 'recruiting.rejectModalTitle')
      : t(locale, 'recruiting.hireModalTitle');
  const body =
    mode === 'rejected'
      ? t(locale, 'recruiting.rejectModalIntro')
      : t(locale, 'recruiting.hireModalIntro');

  const feedbackHtml = feedbackToHtml(candidateFeedback);
  const emailBodyWithFeedback = emailBody.includes('{candidateFeedback}')
    ? emailBody.replace(/\{candidateFeedback\}/g, feedbackHtml)
    : `${emailBody}${feedbackHtml ? `<p>${feedbackHtml}</p>` : ''}`;
  const finalEmailBody = sanitizeInterviewNotesHtml(emailBodyWithFeedback)
    .replace(/\{rejectionReasons\}/g, '')
    .replace(/<p>\s*<\/p>/g, '');

  const suggestFeedbackWithAi = async () => {
    setAiError('');
    setAiStatus('');
    if (!context?.vacancyId || candidateFeedback.trim().length < 8) {
      setAiError(t(locale, 'recruiting.rejectionEmailAiInputRequired'));
      return;
    }
    setAiBusy(true);
    try {
      const response = await fetch(`/api/admin/vacancies/${encodeURIComponent(context.vacancyId)}/rejection-feedback-ai`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: candidateFeedback, tone: aiTone, locale }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.draft) throw new Error('REJECTION_FEEDBACK_AI_FAILED');
      setCandidateFeedback(String(data.draft));
      setAiStatus(t(locale, 'recruiting.rejectionEmailAiGenerated'));
    } catch {
      setAiError(t(locale, 'recruiting.rejectionEmailAiFailed'));
    } finally {
      setAiBusy(false);
    }
  };

  const submit = () => {
    setError('');
    if (mode === 'rejected') {
      if (!reasons.length) {
        setError(t(locale, 'recruiting.rejectReasonRequired'));
        return;
      }
      if (sendEmail && templateLoading) {
        setError(t(locale, 'recruiting.rejectionEmailLoading'));
        return;
      }
      if (sendEmail && (!emailSubject.trim() || !htmlToPlainText(finalEmailBody).trim())) {
        setError(t(locale, 'recruiting.rejectionEmailRequired'));
        return;
      }
      onConfirm({ rejectionReasons: reasons, ...(sendEmail ? { rejectionEmail: { send: true, subject: emailSubject, body: finalEmailBody } } : {}) });
      return;
    }
    const normalized = normalizeStartDate(startDate);
    if (startDate && !normalized) {
      setError(t(locale, 'formValidation.invalid'));
      return;
    }
    onConfirm({ startDate: normalized || null });
  };

  return (
    <div
      className="fixed inset-0 z-[10050] box-border flex items-center justify-center bg-ink/45 p-6"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pipeline-extras-title"
        className="max-h-[calc(100dvh-3rem)] w-full max-w-[560px] overflow-y-auto rounded-card border border-ink/12 bg-surface px-[26px] py-6 shadow-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="font-mono text-2xs uppercase tracking-[2px] text-brand-500">
          {t(locale, 'recruiting.pipelineShort')}
        </span>
        <h2
          id="pipeline-extras-title"
          className="mb-0 mt-2 font-ui text-2xl font-semibold leading-[1.25] text-ink"
        >
          {title}
        </h2>
        <p className="mb-0 mt-2.5 text-prose leading-[1.55] text-ink-muted">{body}</p>

        <div className="mt-5">
          {mode === 'rejected' ? (
            <fieldset className="m-0 min-w-0 border-0 p-0">
              <legend className="mb-2 font-ui text-sm font-medium text-ink">{t(locale, 'recruiting.rejectionReasonsLabel')}</legend>
              <div className="grid max-h-[min(40dvh,320px)] grid-cols-1 gap-1 overflow-y-auto overscroll-contain rounded-control border border-ink/12 p-2 sm:grid-cols-2">
                {REJECTION_REASONS.map((code) => (
                  <label key={code} className="flex min-h-touch cursor-pointer items-center gap-2 rounded-control px-2 py-2 font-ui text-sm text-ink hover:bg-ink/[0.04]">
                    <input type="checkbox" value={code} checked={reasons.includes(code)}
                      onChange={(event) => setReasons((selected) => event.target.checked ? [...selected, code] : selected.filter((reason) => reason !== code))}
                      className="h-4 w-4 shrink-0 accent-brand-600" />
                    <span>{rejectionReasonLabel(locale, code)}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : (
            <FormField label={t(locale, 'employeeAdmission.plannedStart')} hint={t(locale, 'employeeAdmission.plannedHelp')}>
              <DateField value={startDate} onChange={(event) => setStartDate(event.target.value)} aria-label={t(locale, 'employeeAdmission.plannedStart')} />
            </FormField>
          )}

        {mode === 'rejected' && !bulk && context?.vacancyId && context?.candidateId ? (
          <section className="mt-4 rounded-control border border-ink/12 p-3">
            <label className="flex cursor-pointer items-start gap-2 font-ui text-sm font-medium text-ink">
              <input type="checkbox" checked={sendEmail} onChange={(event) => setSendEmail(event.target.checked)} className="mt-1 h-4 w-4 accent-brand-600" />
              <span>{t(locale, 'recruiting.rejectionEmailOptional')}</span>
            </label>
            {sendEmail ? <div className="mt-3 flex flex-col gap-3">
              {templateLoading ? <p className="m-0 text-sm text-ink-muted">{t(locale, 'recruiting.rejectionEmailLoading')}</p> : null}
              {templateError ? <p role="alert" className="m-0 text-sm text-danger">{t(locale, 'recruiting.rejectionEmailTemplateUnavailable')}</p> : null}
              <FormField label={t(locale, 'recruiting.rejectionEmailSubjectLabel')}><input maxLength={180} value={emailSubject} onChange={(event) => setEmailSubject(event.target.value)} className="w-full rounded-control border border-ink/15 bg-surface px-3 py-2 font-ui text-sm text-ink" /></FormField>
              <FormField as="div" label={t(locale, 'recruiting.rejectionEmailFeedbackLabel')} hint={t(locale, 'recruiting.rejectionEmailFeedbackHint')}>
                <textarea rows={3} maxLength={1800} value={candidateFeedback} onChange={(event) => { setCandidateFeedback(event.target.value); setAiStatus(''); }} className="w-full rounded-control border border-ink/15 bg-surface px-3 py-2 font-ui text-sm text-ink" />
              </FormField>
              <div className="rounded-control border border-ink/10 bg-canvas p-3">
                <p className="mb-2 mt-0 text-xs leading-5 text-ink-muted">{t(locale, 'recruiting.rejectionEmailAiPrivacy')}</p>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <FormField label={t(locale, 'recruiting.rejectionEmailAiTone')}>
                    <select value={aiTone} onChange={(event) => setAiTone(event.target.value)} className="min-h-touch rounded-control border border-ink/15 bg-surface px-3 py-2 font-ui text-sm text-ink">
                      <option value="warm">{t(locale, 'recruiting.rejectionEmailAiWarm')}</option>
                      <option value="direct">{t(locale, 'recruiting.rejectionEmailAiDirect')}</option>
                      <option value="detailed">{t(locale, 'recruiting.rejectionEmailAiDetailed')}</option>
                    </select>
                  </FormField>
                  <button type="button" onClick={suggestFeedbackWithAi} disabled={aiBusy || candidateFeedback.trim().length < 8} aria-busy={aiBusy} className={S.btnGhost}>
                    {aiBusy ? t(locale, 'recruiting.rejectionEmailAiLoading') : t(locale, 'recruiting.rejectionEmailAiButton')}
                  </button>
                </div>
                {aiError ? <p role="alert" className="mb-0 mt-2 text-sm text-danger">{aiError}</p> : null}
                {aiStatus ? <p role="status" className="mb-0 mt-2 text-sm text-success">{aiStatus}</p> : null}
              </div>
              <div className="flex justify-end">
                <button type="button" className={S.btnGhost} onClick={() => setShowEmailPreview((shown) => !shown)}>
                  {t(locale, showEmailPreview ? 'recruiting.rejectionEmailEdit' : 'recruiting.rejectionEmailPreview')}
                </button>
              </div>
              {showEmailPreview ? (
                <section aria-label={t(locale, 'recruiting.rejectionEmailPreview')} className="rounded-control border border-ink/12 bg-canvas p-3">
                  <p className="mb-2 mt-0 break-words text-sm"><strong>{t(locale, 'recruiting.rejectionEmailSubjectLabel')}:</strong> {emailSubject}</p>
                  <div className="prose prose-sm max-w-none text-ink" dangerouslySetInnerHTML={{ __html: finalEmailBody }} />
                </section>
              ) : (
                <FormField as="div" label={t(locale, 'recruiting.rejectionEmailBodyLabel')}><RichTextEditor value={emailBody} onChange={setEmailBody} minHeight={130} scrollable locale={locale} /></FormField>
              )}
              <p className="m-0 text-xs text-ink-muted">{t(locale, 'recruiting.rejectionEmailBccHelp')}</p>
            </div> : null}
          </section>
        ) : null}
        </div>


        {error ? (
          <p role="alert" className="mb-0 mt-3 font-mono text-xs text-danger">{error}</p>
        ) : null}

        <div className="mt-[22px] flex justify-end gap-2.5">
          <button type="button" onClick={onCancel} className={S.btnGhost}>
            {t(locale, 'recruiting.modalCancel')}
          </button>
          <button type="button" onClick={submit} className={S.btnPrimary}>
            {t(locale, mode === 'hired' ? 'employeeAdmission.recordHiring' : 'recruiting.modalConfirm')}
          </button>
        </div>
      </div>
    </div>
  );
}

export function PipelineExtrasProvider({ children }) {
  const [state, setState] = useState(null);
  const resolveRef = useRef(null);

  const close = useCallback((payload) => {
    const resolve = resolveRef.current;
    resolveRef.current = null;
    setState(null);
    if (resolve) resolve(payload);
  }, []);

  // Accepts either a canonical key (preferred) or a resolved stage object with
  // `canonicalKey`. Custom stages carry their canonical from the Kanban rows.
  const requestPipelineExtras = useCallback((locale, stageOrCanonical, { bulk = false, rejectionEmailContext = null } = {}) => {
    const canonical =
      stageOrCanonical && typeof stageOrCanonical === 'object'
        ? (stageOrCanonical.canonicalKey || stageOrCanonical.id)
        : stageOrCanonical;
    if (canonical !== 'rejected' && canonical !== 'hired') {
      return Promise.resolve({});
    }
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setState({ locale, mode: canonical, bulk, context: rejectionEmailContext });
    });
  }, []);

  const value = useMemo(() => ({ requestPipelineExtras }), [requestPipelineExtras]);

  return (
    <PipelineExtrasContext.Provider value={value}>
      {children}
      {state ? (
        <PipelineExtrasDialog
          locale={state.locale}
          mode={state.mode}
          bulk={state.bulk}
          context={state.context}
          onConfirm={(payload) => close(payload)}
          onCancel={() => close(null)}
        />
      ) : null}
    </PipelineExtrasContext.Provider>
  );
}

export function usePipelineExtras() {
  const ctx = useContext(PipelineExtrasContext);
  if (!ctx) {
    throw new Error('usePipelineExtras must be used within PipelineExtrasProvider');
  }
  return ctx;
}
