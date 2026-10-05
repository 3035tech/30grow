'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '../../lib/cn';
import { t } from '../../lib/i18n';
import { helpSuggestionLabels, helpTabLabel } from '../../lib/help-screen-context';
import {
  PRODUCT_FEEDBACK_KIND,
  PRODUCT_FEEDBACK_KINDS,
  PRODUCT_FEEDBACK_SEVERITY,
  PRODUCT_FEEDBACK_SEVERITIES,
} from '../../lib/domain-status';
import { SUPPORT_CONTACT_EMAIL, SUPPORT_RESPONSE_BUSINESS_DAYS } from '../../lib/product-feedback';
import { S } from './dashboard-shared';
import { Icon } from '../_components/Icon';
import { useAppFeedback } from '../_components/AppFeedback';
import { AppLoading } from '../_components/AppLoading';

/**
 * Floating AI product-help assistant (B-801) — Guia / navigation only.
 * Uses the open dashboard tab for tips and contextual suggestions.
 */
export function HelpAssistantWidget({
  locale = 'pt-BR',
  navigateDashboard,
  activeTab = null,
  activeSection = null,
}) {
  const { promptForm, toast } = useAppFeedback();
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [messages, setMessages] = useState([]);
  const [followUps, setFollowUps] = useState([]);
  const listRef = useRef(null);
  const latestMsgRef = useRef(null);
  const scrollPinnedLenRef = useRef(0);

  const emptySuggestions = useMemo(() => helpSuggestionLabels(locale, activeTab), [locale, activeTab]);
  const hereLabel = useMemo(() => helpTabLabel(locale, activeTab), [locale, activeTab]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Pin the *start* of the newest message into view (not the bottom of a long answer).
  useEffect(() => {
    if (!open || !listRef.current || !latestMsgRef.current) return;
    if (messages.length === 0) {
      scrollPinnedLenRef.current = 0;
      return;
    }
    if (messages.length === scrollPinnedLenRef.current) return;
    scrollPinnedLenRef.current = messages.length;
    const container = listRef.current;
    const target = latestMsgRef.current;
    const cRect = container.getBoundingClientRect();
    const tRect = target.getBoundingClientRect();
    container.scrollTop += tRect.top - cRect.top - 4;
  }, [messages, open]);

  const send = async (raw) => {
    const q = String(raw || '').trim();
    if (!q || busy) return;
    setError('');
    setQuestion('');
    setFollowUps([]);
    const nextHistory = [...messages, { role: 'user', content: q }].slice(-6);
    setMessages(nextHistory);
    setBusy(true);
    try {
      const res = await fetch('/api/admin/help-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: q,
          locale,
          history: nextHistory.slice(0, -1),
          activeTab: activeTab || null,
          activeSection: activeSection || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || t(locale, 'panel.helpAssist.error'));
      }
      setMessages((cur) => [
        ...cur,
        {
          role: 'assistant',
          content: data.answer || '',
          tab: data.tab || null,
          citations: Array.isArray(data.citations) ? data.citations : [],
        },
      ]);
      if (Array.isArray(data.suggestions) && data.suggestions.length) {
        setFollowUps(data.suggestions.slice(0, 6));
      }
    } catch (e) {
      setError(e?.message || t(locale, 'panel.helpAssist.error'));
    } finally {
      setBusy(false);
    }
  };

  const chipList = messages.length === 0 ? emptySuggestions : followUps;

  const openSuggestForm = async () => {
    const values = await promptForm({
      title: t(locale, 'panel.productFeedback.suggestTitle'),
      message: t(locale, 'panel.productFeedback.supportLine', {
        days: SUPPORT_RESPONSE_BUSINESS_DAYS,
        email: SUPPORT_CONTACT_EMAIL,
      }),
      fields: [
        {
          key: 'kind',
          label: t(locale, 'panel.productFeedback.filterKind'),
          type: 'select',
          defaultValue: PRODUCT_FEEDBACK_KIND.QUESTION,
          options: PRODUCT_FEEDBACK_KINDS.map((k) => ({
            value: k,
            label: t(locale, `panel.productFeedback.kind.${k}`),
          })),
        },
        {
          key: 'severity',
          label: t(locale, 'panel.productFeedback.severityLabel'),
          type: 'select',
          defaultValue: PRODUCT_FEEDBACK_SEVERITY.MEDIUM,
          options: PRODUCT_FEEDBACK_SEVERITIES.map((s) => ({
            value: s,
            label: t(locale, `panel.productFeedback.severity.${s}`),
          })),
        },
        {
          key: 'message',
          label: t(locale, 'panel.productFeedback.messageLabel'),
          type: 'textarea',
          rows: 5,
          maxLength: 4000,
          placeholder: t(locale, 'panel.productFeedback.messagePh'),
          help: t(locale, 'panel.productFeedback.messageHelp'),
        },
        {
          key: 'contactOk',
          label: t(locale, 'panel.productFeedback.contactOk'),
          type: 'boolean',
          defaultValue: true,
        },
      ],
    });
    if (!values) return;
    const message = String(values.message || '').trim();
    if (message.length < 10) {
      toast(t(locale, 'panel.productFeedback.messageTooShort'), 'error');
      return;
    }
    try {
      const res = await fetch('/api/admin/product-feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: values.kind,
          severity: values.severity,
          message,
          contactOk: values.contactOk !== false,
          activeTab: activeTab || null,
          activeSection: activeSection || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || t(locale, 'panel.productFeedback.sendFailed'));
      toast(t(locale, 'panel.productFeedback.sendOk', { days: SUPPORT_RESPONSE_BUSINESS_DAYS }), 'ok');
    } catch (e) {
      toast(e?.message || t(locale, 'panel.productFeedback.sendFailed'), 'error');
    }
  };

  return (
    <div className="pointer-events-none fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-[max(1rem,env(safe-area-inset-right))] z-[100] flex max-w-[calc(100vw-2rem)] flex-col items-end gap-2">
      {open ? (
        <div
          className="pointer-events-auto flex w-[min(380px,calc(100vw-24px))] flex-col overflow-hidden rounded-card border border-ink/12 bg-surface shadow-dialog"
          role="dialog"
          aria-modal="true"
          aria-label={t(locale, 'panel.helpAssist.title')}
        >
          <div className="flex items-center justify-between gap-2 border-b border-ink/10 bg-canvas/80 px-3 py-2.5">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-ui text-sm font-semibold text-ink">
                  {t(locale, 'panel.helpAssist.title')}
                </span>
                <span className="inline-flex items-center rounded-control border border-brand-500/30 bg-brand-500/10 px-1.5 py-0.5 font-mono text-2xs font-semibold uppercase tracking-wide text-brand-600">
                  {t(locale, 'panel.helpAssist.badge')}
                </span>
              </div>
              <p className="m-0 mt-0.5 font-mono text-2xs text-ink-faint">
                {t(locale, 'panel.helpAssist.subtitle')}
              </p>
            </div>
            <button
              type="button"
              className={cn(S.btnGhost, 'min-h-touch min-w-touch px-2')}
              onClick={() => setOpen(false)}
              aria-label={t(locale, 'panel.helpAssist.close')}
            >
              <Icon name="clear" />
            </button>
          </div>

          <div ref={listRef} className="flex max-h-[min(420px,50vh)] flex-col gap-2 overflow-y-auto px-3 py-3">
            {messages.length === 0 ? (
              <div className="flex flex-col gap-2">
                <p className={cn(S.muted, 'm-0 text-xs')}>{t(locale, 'panel.helpAssist.empty')}</p>
                {hereLabel ? (
                  <p className="m-0 font-mono text-2xs font-semibold text-ink-muted">
                    {t(locale, 'panel.helpAssist.emptyHere', { tab: hereLabel })}
                  </p>
                ) : null}
                <p className="m-0 font-mono text-2xs text-ink-faint">
                  {t(locale, 'panel.helpAssist.emptyHint')}
                </p>
              </div>
            ) : null}
            {messages.map((m, i) => (
              <div
                key={`${m.role}-${i}`}
                ref={i === messages.length - 1 ? latestMsgRef : undefined}
                className={cn(
                  'rounded-control px-2.5 py-2 text-prose leading-snug',
                  m.role === 'user' ? 'ml-6 bg-brand-500/10 text-ink' : 'mr-2 bg-canvas text-ink'
                )}
              >
                <div className="whitespace-pre-wrap">{m.content}</div>
                {m.role === 'assistant' && m.tab && typeof navigateDashboard === 'function' ? (
                  <button
                    type="button"
                    className="mt-2 inline-flex min-h-touch items-center gap-1 border-none bg-transparent p-0 font-mono text-2xs text-brand-600 underline"
                    onClick={() => navigateDashboard({ tab: m.tab })}
                  >
                    {t(locale, 'panel.helpAssist.openTab')}
                  </button>
                ) : null}
              </div>
            ))}
            {chipList.length ? (
              <div className="flex flex-wrap gap-1.5">
                {chipList.map((label) => (
                  <button
                    key={label}
                    type="button"
                    className="min-h-touch rounded-control border border-ink/12 bg-canvas px-2.5 py-1.5 text-left font-mono text-2xs text-ink-muted"
                    onClick={() => send(label)}
                    disabled={busy}
                  >
                    {label}
                  </button>
                ))}
              </div>
            ) : null}
            {busy ? (
              <AppLoading locale={locale} variant="inline" label={t(locale, 'panel.common.loading')} />
            ) : null}
            {error ? <p className="m-0 text-xs text-danger">{error}</p> : null}
          </div>

          <div className="border-t border-ink/10 px-3 py-2">
            <button
              type="button"
              className={cn(S.btnBrandSoft, 'min-h-touch w-full justify-center gap-2 text-prose')}
              onClick={() => void openSuggestForm()}
              disabled={busy}
            >
              <Icon name="sparkles" className="h-4 w-4 shrink-0" />
              {t(locale, 'panel.productFeedback.suggestCta')}
            </button>
          </div>

          <form
            className="flex gap-2 border-t border-ink/10 p-2.5"
            onSubmit={(e) => {
              e.preventDefault();
              send(question);
            }}
          >
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder={t(locale, 'panel.helpAssist.placeholder')}
              aria-label={t(locale, 'panel.helpAssist.placeholder')}
              disabled={busy}
              className={cn(S.input, 'min-h-touch flex-1 bg-surface')}
            />
            <button
              type="submit"
              disabled={busy || !question.trim()}
              className={cn(S.btnPrimary, 'px-3')}
            >
              {t(locale, 'panel.helpAssist.send')}
            </button>
          </form>
        </div>
      ) : null}

      <button
        type="button"
        className={cn(
          'pointer-events-auto inline-flex min-h-touch min-w-touch items-center gap-2 rounded-full border border-brand-500/35 bg-action px-4 py-2.5 font-ui text-prose font-semibold text-action-ink  shadow-toast',
          open && 'bg-brand-600'
        )}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={t(locale, 'panel.helpAssist.open')}
        title={t(locale, 'panel.helpAssist.open')}
      >
        <Icon name="sparkles" className="h-[18px] w-[18px] shrink-0" />
        <span className="hidden sm:inline">{t(locale, 'panel.helpAssist.fab')}</span>
        <span className="inline-flex items-center rounded-full bg-white/20 dark:bg-canvas/10 px-1.5 py-0.5 font-ui text-prose font-semibold sm:hidden">
          {t(locale, 'panel.helpAssist.badge')}
        </span>
      </button>
    </div>
  );
}
