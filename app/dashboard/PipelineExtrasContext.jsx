'use client';

import { SelectField } from '../_components/SelectField';

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { REJECTION_REASONS, normalizeStartDate } from '../../lib/pipeline';
import { t } from '../../lib/i18n';
import { rejectionReasonLabel } from './pipeline-prompts';
import { DateField } from '../_components/DateField';
import { FormField } from '../_components/FormField';
import { fieldInputClass, fieldSelectClass } from '../_components/form-control-styles';
import { S } from './dashboard-shared';

const PipelineExtrasContext = createContext(null);

const FIELD = `${fieldInputClass} w-full font-ui text-sm`;
const FIELD_SELECT = `${fieldSelectClass} w-full font-ui text-sm`;

function PipelineExtrasDialog({ locale, mode, onConfirm, onCancel }) {
  const today = new Date().toISOString().slice(0, 10);
  const [reason, setReason] = useState('profile_fit');
  const [startDate, setStartDate] = useState(today);
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
      if (!reason) {
        setError(t(locale, 'recruiting.rejectReasonRequired'));
        return;
      }
      onConfirm({ rejectionReason: reason });
      return;
    }
    const normalized = normalizeStartDate(startDate);
    if (!normalized) {
      setError(t(locale, 'recruiting.hireStartDateRequired'));
      return;
    }
    onConfirm({ startDate: normalized });
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
        className="w-full max-w-[440px] rounded-card border border-ink/12 bg-surface px-[26px] py-6 shadow-dialog"
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
            <FormField
              htmlFor="pipeline-reject-reason"
              label={t(locale, 'recruiting.rejectionReasonLabel')}
            >
              <SelectField
                id="pipeline-reject-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className={FIELD_SELECT}
              >
                {REJECTION_REASONS.map((code) => (
                  <option key={code} value={code}>
                    {rejectionReasonLabel(locale, code)}
                  </option>
                ))}
              </SelectField>
            </FormField>
          ) : (
            <FormField
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
          )}
        </div>

        {error ? (
          <p className="mb-0 mt-3 font-mono text-xs text-danger">{error}</p>
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
  const requestPipelineExtras = useCallback((locale, stageOrCanonical) => {
    const canonical =
      stageOrCanonical && typeof stageOrCanonical === 'object'
        ? (stageOrCanonical.canonicalKey || stageOrCanonical.id)
        : stageOrCanonical;
    if (canonical !== 'rejected' && canonical !== 'hired') {
      return Promise.resolve({});
    }
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setState({ locale, mode: canonical });
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
