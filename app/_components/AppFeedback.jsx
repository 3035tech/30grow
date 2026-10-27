'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/cn';
import { ConfirmDialog } from './ConfirmDialog';
import { PromptFormDialog } from './PromptFormDialog';
import { SystemNoticeModal } from './SystemNoticeModal';
import { Icon } from './Icon';

function toastIconName(tone) {
  if (tone === 'error') return 'feedbackError';
  if (tone === 'warning') return 'feedbackWarning';
  if (tone === 'info') return 'feedbackInfo';
  return 'feedbackOk';
}

function toastIconClass(tone) {
  if (tone === 'error') return 'text-danger';
  if (tone === 'warning') return 'text-warning';
  if (tone === 'info') return 'text-info';
  return 'text-success';
}

const AppFeedbackContext = createContext(null);

/**
 * Global in-app feedback: confirm, notice (alert), promptForm, toast.
 * Replaces window.confirm / alert / prompt.
 */
export function AppFeedbackProvider({ children, locale = 'pt-BR' }) {
  const [confirmState, setConfirmState] = useState(null);
  const [noticeState, setNoticeState] = useState(null);
  const [promptState, setPromptState] = useState(null);
  const [toasts, setToasts] = useState([]);
  const toastIdRef = useRef(0);

  const confirm = useCallback((opts = {}) => {
    const message = typeof opts === 'string' ? opts : opts.message;
    if (!message) return Promise.resolve(false);
    return new Promise((resolve) => {
      setConfirmState({
        title: opts.title,
        message,
        danger: Boolean(opts.danger),
        preferCancel: Boolean(opts.preferCancel),
        confirmLabel: opts.confirmLabel,
        cancelLabel: opts.cancelLabel,
        resolve,
      });
    });
  }, []);

  const notice = useCallback((opts = {}) => {
    const message = typeof opts === 'string' ? opts : opts.message;
    if (!message) return Promise.resolve();
    return new Promise((resolve) => {
      setNoticeState({
        title: opts.title,
        message,
        tone: opts.tone || 'info',
        resolve,
      });
    });
  }, []);

  const promptForm = useCallback((opts = {}) => {
    const fields = Array.isArray(opts.fields) ? opts.fields : [];
    if (!fields.length) return Promise.resolve(null);
    return new Promise((resolve) => {
      setPromptState({
        title: opts.title,
        message: opts.message,
        fields,
        confirmLabel: opts.confirmLabel,
        cancelLabel: opts.cancelLabel,
        size: opts.size,
        submit: opts.submit,
        resolve,
      });
    });
  }, []);

  const toast = useCallback((message, tone = 'ok') => {
    if (!message) return;
    toastIdRef.current += 1;
    const id = toastIdRef.current;
    setToasts((prev) => [...prev, { id, message: String(message), tone }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((x) => x.id !== id));
    }, 3600);
  }, []);

  const value = useMemo(
    () => ({ confirm, notice, promptForm, toast, locale }),
    [confirm, notice, promptForm, toast, locale]
  );

  return (
    <AppFeedbackContext.Provider value={value}>
      {children}
      {confirmState ? (
        <ConfirmDialog
          open
          locale={locale}
          title={confirmState.title}
          message={confirmState.message}
          danger={confirmState.danger}
          preferCancel={confirmState.preferCancel}
          elevated={Boolean(promptState)}
          confirmLabel={confirmState.confirmLabel}
          cancelLabel={confirmState.cancelLabel}
          onCancel={() => {
            confirmState.resolve(false);
            setConfirmState(null);
          }}
          onConfirm={() => {
            confirmState.resolve(true);
            setConfirmState(null);
          }}
        />
      ) : null}
      {noticeState ? (
        <SystemNoticeModal
          open
          locale={locale}
          title={noticeState.title}
          message={noticeState.message}
          tone={noticeState.tone}
          onClose={() => {
            noticeState.resolve();
            setNoticeState(null);
          }}
        />
      ) : null}
      {promptState ? (
        <PromptFormDialog
          open
          locale={locale}
          title={promptState.title}
          message={promptState.message}
          fields={promptState.fields}
          suspended={Boolean(confirmState)}
          confirmLabel={promptState.confirmLabel}
          cancelLabel={promptState.cancelLabel}
          size={promptState.size}
          onCancel={() => {
            promptState.resolve(null);
            setPromptState(null);
          }}
          onSubmit={async (values) => {
            // Optional persistence hook: rejection leaves the form and its values open.
            if (promptState.submit && await promptState.submit(values) === false) return;
            promptState.resolve(values);
            setPromptState(null);
          }}
        />
      ) : null}
      {typeof document !== 'undefined' && toasts.length > 0
        ? createPortal(
            <div className="ui-toast-stack pointer-events-none fixed bottom-4 right-4 z-[10080] flex max-w-[min(360px,calc(100vw-32px))] flex-col gap-2">
              {toasts.map((item) => (
                <div
                  key={item.id}
                  role={item.tone === 'error' ? 'alert' : 'status'}
                  aria-atomic="true"
                  className={cn(
                    'pointer-events-auto flex items-start gap-2.5 rounded-xl border border-l-4 bg-white px-3.5 py-3 font-ui text-prose leading-snug text-ink shadow-toast',
                    item.tone === 'error' && 'border-danger/33 border-l-danger',
                    item.tone === 'info' && 'border-info/33 border-l-info',
                    item.tone === 'warning' && 'border-warning/33 border-l-warning',
                    item.tone !== 'error' &&
                      item.tone !== 'info' &&
                      item.tone !== 'warning' &&
                      'border-success/33 border-l-success'
                  )}
                >
                  <span className={cn('mt-0.5 shrink-0', toastIconClass(item.tone))} aria-hidden>
                    <Icon name={toastIconName(item.tone)} className="h-4 w-4 shrink-0" />
                  </span>
                  <span className="min-w-0 flex-1">{item.message}</span>
                </div>
              ))}
            </div>,
            document.body
          )
        : null}
    </AppFeedbackContext.Provider>
  );
}

export function useAppFeedback() {
  const ctx = useContext(AppFeedbackContext);
  if (!ctx) {
    throw new Error('useAppFeedback must be used within AppFeedbackProvider');
  }
  return ctx;
}

/** Safe hook when provider may be absent (returns no-ops). Prefer useAppFeedback in dashboard. */
export function useAppFeedbackOptional() {
  return useContext(AppFeedbackContext);
}
