'use client';

import { useCallback, useEffect, useState } from 'react';
import { EmptyState } from './EmptyState';
import { CompanyPostAttachments } from './CompanyPostAttachments';
import { KudoReactions } from './KudoReactions';
import { RichTextView } from './RichTextView';
import { useAppFeedback } from './AppFeedback';
import { S } from '../dashboard/dashboard-shared';
import { t } from '../../lib/i18n';
import { cn } from '../../lib/cn';
import { formatDisplayDate, formatDisplayDateTime } from '../../lib/format-display-date';

/** Posts list body for /employee#feed */
export function EmployeeFeedPanel({
  locale = 'pt-BR',
  items: initialItems = [],
  total: initialTotal = 0,
  onTotalChange,
}) {
  const { toast } = useAppFeedback();
  const [items, setItems] = useState(initialItems);
  const [total, setTotal] = useState(initialTotal);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setItems(initialItems);
    setTotal(initialTotal);
    setPage(1);
  }, [initialItems, initialTotal]);

  async function loadMore() {
    if (busy || items.length >= total) return;
    setBusy(true);
    try {
      const next = page + 1;
      const res = await fetch(`/api/employee/feed?page=${next}&pageSize=10`);
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setItems((prev) => [...prev, ...(data.posts || [])]);
        const nextTotal = data.total || total;
        setTotal(nextTotal);
        setPage(next);
        onTotalChange?.(nextTotal);
      } else {
        toast(t(locale, 'employeeHome.feedLoadError'), 'error');
      }
    } catch {
      toast(t(locale, 'employeeHome.feedLoadError'), 'error');
    } finally {
      setBusy(false);
    }
  }

  if (!items.length) {
    return <EmptyState message={t(locale, 'employeeHome.feedEmpty')} />;
  }

  return (
    <>
      <ul className={cn(S.stack, 'm-0 list-none gap-3 p-0')}>
        {items.map((p) => (
          <li key={p.id} className={S.cardTight}>
            <h4 className="font-ui text-sm font-semibold text-ink">{p.title}</h4>
            <p className={S.faint}>
              {p.authorName ? `${p.authorName} · ` : ''}
              {formatDisplayDate(p.createdAt, locale)}
            </p>
            {p.bodyHtml ? (
              <div className="mt-2 text-prose text-ink-muted">
                <RichTextView html={p.bodyHtml} />
              </div>
            ) : null}
            <CompanyPostAttachments postId={p.id} files={p.attachments || []} locale={locale} />
          </li>
        ))}
      </ul>
      {total > items.length ? (
        <button
          type="button"
          className={cn(S.btnGhost, 'mt-3 min-h-touch')}
          disabled={busy}
          onClick={loadMore}
        >
          {busy
            ? t(locale, 'panel.common.loading')
            : t(locale, 'employeeHome.feedLoadMore', { n: total - items.length })}
        </button>
      ) : null}
    </>
  );
}

/** Kudos list + send CTA for /employee#kudos */
export function EmployeeKudosPanel({
  locale = 'pt-BR',
  items: initialItems = [],
  total: initialTotal = 0,
  onChanged,
}) {
  const { toast, promptForm } = useAppFeedback();
  const [items, setItems] = useState(initialItems);
  const [total, setTotal] = useState(initialTotal);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setItems(initialItems);
    setTotal(initialTotal);
    setPage(1);
  }, [initialItems, initialTotal]);

  const refresh = useCallback(async () => {
    const res = await fetch('/api/employee/kudos?page=1&pageSize=15');
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok) {
      setItems(data.kudos || []);
      setTotal(data.total || 0);
      setPage(1);
      onChanged?.(data.total || 0);
    }
  }, [onChanged]);

  async function loadMore() {
    if (busy || items.length >= total) return;
    setBusy(true);
    try {
      const next = page + 1;
      const res = await fetch(`/api/employee/kudos?page=${next}&pageSize=15`);
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setItems((prev) => [...prev, ...(data.kudos || [])]);
        const nextTotal = data.total || total;
        setTotal(nextTotal);
        setPage(next);
        onChanged?.(nextTotal);
      } else {
        toast(t(locale, 'employeeHome.kudosLoadError'), 'error');
      }
    } catch {
      toast(t(locale, 'employeeHome.kudosLoadError'), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function sendKudo() {
    const values = await promptForm({
      title: t(locale, 'employeeHome.kudosSend'),
      message: t(locale, 'employeeHome.kudosSendHint'),
      fields: [
        {
          name: 'toCandidateId',
          label: t(locale, 'employeeHome.kudosTo'),
          type: 'entitySearch',
          required: true,
          searchUrl: '/api/employee/colleagues',
          minChars: 0,
          placeholder: t(locale, 'employeeHome.kudosToPh'),
        },
        {
          name: 'message',
          label: t(locale, 'employeeHome.kudosMessage'),
          type: 'textarea',
          required: true,
          maxLength: 280,
          rows: 3,
        },
      ],
      confirmLabel: t(locale, 'employeeHome.kudosSubmit'),
    });
    if (!values?.toCandidateId) return;
    const res = await fetch('/api/employee/kudos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        toCandidateId: Number(values.toCandidateId),
        message: values.message,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 429) {
      toast(t(locale, 'employeeHome.kudosRateLimit'), 'warning');
      return;
    }
    if (!res.ok) {
      toast(
        data?.errorCode === 'INVALID_DATA'
          ? t(locale, 'employeeHome.kudosInvalid')
          : t(locale, 'employeeHome.kudosError'),
        'error'
      );
      return;
    }
    toast(t(locale, 'employeeHome.kudosSent'), 'ok');
    refresh();
  }

  return (
    <>
      {items.length > 0 ? (
        <div className="mb-3">
          <button type="button" className={cn(S.btnBrandSoft, 'min-h-touch')} onClick={sendKudo}>
            {t(locale, 'employeeHome.kudosSend')}
          </button>
        </div>
      ) : null}
      {!items.length ? (
        <EmptyState
          message={t(locale, 'employeeHome.kudosEmpty')}
          actionLabel={t(locale, 'employeeHome.kudosSend')}
          onAction={sendKudo}
        />
      ) : (
        <ul className={cn(S.stack, 'm-0 list-none gap-2 p-0')}>
          {items.map((k) => (
            <li key={k.id} className={S.cardTight}>
              <p className="font-mono text-2xs text-ink-label">
                {k.fromName} → {k.toName}
                {k.createdAt ? ` · ${formatDisplayDateTime(k.createdAt, locale)}` : ''}
              </p>
              <p className="font-ui text-prose text-ink">{k.message}</p>
              <KudoReactions kudoId={k.id} initialReactions={k.reactions} locale={locale} />
            </li>
          ))}
        </ul>
      )}
      {total > items.length ? (
        <button
          type="button"
          className={cn(S.btnGhost, 'mt-3 min-h-touch')}
          disabled={busy}
          onClick={loadMore}
        >
          {busy
            ? t(locale, 'panel.common.loading')
            : t(locale, 'employeeHome.kudosLoadMore', { n: total - items.length })}
        </button>
      ) : null}
    </>
  );
}
