'use client';

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { REJECTION_REASONS, normalizeStartDate } from '../../lib/pipeline';
import { t } from '../../lib/i18n';
import { rejectionReasonLabel } from './pipeline-prompts';
import { DateField } from '../_components/DateField';
import { FormField } from '../_components/FormField';
import { fieldInputClass } from '../_components/form-control-styles';
import { S } from './dashboard-shared';

const PipelineExtrasContext = createContext(null);

const FIELD = `${fieldInputClass} w-full font-ui text-sm`;

function PipelineExtrasDialog({ locale, mode, bulk, onConfirm, onCancel }) {
  const today = new Date().toISOString().slice(0, 10);
  const [reasons, setReasons] = useState([]);
  const [startDate, setStartDate] = useState(today);
  const [corporateEmail, setCorporateEmail] = useState('');
  const [error, setError] = useState('');

  const title =
    mode === 'rejected'
      ? t(locale, 'recruiting.rejectModalTitle')
      : t(locale, 'recruiting.hireModalTitle');
  const body =
    mode === 'rejected'
      ? t(locale, 'recruiting.rejectModalIntro')
      : t(locale, 'recruiting.hireModalIntro');

  const submit = () => {
    setError('');
    if (mode === 'rejected') {
      if (!reasons.length) {
        setError(t(locale, 'recruiting.rejectReasonRequired'));
        return;
      }
      onConfirm({ rejectionReasons: reasons });
      return;
    }
    const normalized = normalizeStartDate(startDate);
    if (!normalized) {
      setError(t(locale, 'recruiting.hireStartDateRequired'));
      return;
    }
    const email = corporateEmail.trim().toLowerCase();
    if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
      setError(t(locale, 'recruiting.hireEmailInvalid'));
      return;
    }
    onConfirm({ startDate: normalized, ...(!bulk && email ? { corporateEmail: email } : {}) });
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
            <div className="space-y-4"><FormField
              as="div"
              label={t(locale, 'recruiting.startDateLabel')}
              hint={t(locale, 'recruiting.hireDateHint')}
            >
              <DateField
                id="pipeline-hire-date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className={FIELD}
                aria-label={t(locale, 'recruiting.startDateLabel')}
              />
            </FormField>
            {!bulk ? <FormField as="div" label={t(locale, 'recruiting.hireCorporateEmailLabel')} hint={t(locale, 'recruiting.hireCorporateEmailHint')}>
              <input type="email" autoComplete="off" maxLength={254} value={corporateEmail} onChange={event => setCorporateEmail(event.target.value)} className={FIELD} aria-label={t(locale, 'recruiting.hireCorporateEmailLabel')} />
            </FormField> : <p className="text-sm text-ink-muted">{t(locale, 'recruiting.hireBulkEmailHint')}</p>}
            </div>
          )}
        </div>

        {error ? (
          <p role="alert" className="mb-0 mt-3 font-mono text-xs text-danger">{error}</p>
        ) : null}

        <div className="mt-[22px] flex justify-end gap-2.5">
          <button type="button" onClick={onCancel} className={S.btnGhost}>
            {t(locale, 'recruiting.modalCancel')}
          </button>
          <button type="button" onClick={submit} className={S.btnPrimary}>
            {t(locale, 'recruiting.modalConfirm')}
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
  const requestPipelineExtras = useCallback((locale, stageOrCanonical, { bulk = false } = {}) => {
    const canonical =
      stageOrCanonical && typeof stageOrCanonical === 'object'
        ? (stageOrCanonical.canonicalKey || stageOrCanonical.id)
        : stageOrCanonical;
    if (canonical !== 'rejected' && canonical !== 'hired') {
      return Promise.resolve({});
    }
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setState({ locale, mode: canonical, bulk });
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
