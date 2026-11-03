'use client';

import { useEffect, useState } from 'react';
import { cn } from '../../../lib/cn';
import { t, localeHtmlLang } from '../../../lib/i18n';
import { useAppFeedback } from '../../_components/AppFeedback';
import { AppLoading } from '../../_components/AppLoading';
import { EmptyState } from '../../_components/EmptyState';
import { AdminTableShell, AdminTh, AdminActionsTh } from '../dashboard-shared';
import { inviteStatusLabel } from './vacancy-admin-shared';

export function VacancyInvitesBlock({ vacancyId, locale, refreshKey }) {
  const { confirm } = useAppFeedback();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState('');

  const fetchInvites = async (cancelled = { current: false }) => {
    setErr('');
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/vacancies/${encodeURIComponent(vacancyId)}/invites`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || t(locale, 'panel.common.error'));
      if (!cancelled.current) setRows(Array.isArray(data.invites) ? data.invites : []);
    } catch (e) {
      if (!cancelled.current) setErr(e?.message || t(locale, 'panel.common.error'));
    } finally {
      if (!cancelled.current) setLoading(false);
    }
  };

  useEffect(() => {
    const cancelled = { current: false };
    setRows([]);
    fetchInvites(cancelled);
    return () => { cancelled.current = true; };
  }, [vacancyId, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const remind = async (inviteId) => {
    setBusy(String(inviteId));
    setErr('');
    try {
      const res = await fetch(
        `/api/admin/vacancies/${encodeURIComponent(vacancyId)}/invites/${encodeURIComponent(inviteId)}/remind`,
        { method: 'POST' }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || t(locale, 'panel.common.error'));
      await fetchInvites();
    } catch (e) {
      setErr(e?.message || t(locale, 'panel.common.error'));
    } finally {
      setBusy(null);
    }
  };

  const removeInvite = async (inv) => {
    const ok = await confirm({
      message: t(locale, 'recruiting.inviteDeleteConfirm', {
        name: inv.candidateName || '—',
        email: inv.candidateEmail || '—',
      }),
      danger: true,
    });
    if (!ok) return;
    setBusy(`del:${inv.id}`);
    setErr('');
    try {
      const res = await fetch(
        `/api/admin/vacancies/${encodeURIComponent(vacancyId)}/invites/${encodeURIComponent(inv.id)}`,
        { method: 'DELETE' }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || t(locale, 'panel.common.error'));
      await fetchInvites();
    } catch (e) {
      setErr(e?.message || t(locale, 'panel.common.error'));
    } finally {
      setBusy(null);
    }
  };

  if (loading && !rows.length) return <AppLoading locale={locale} variant="panel" />;

  if (!rows.length && !err) {
    return (
      <EmptyState
        title={t(locale, 'recruiting.inviteEmptyTitle')}
        message={t(locale, 'recruiting.inviteEmptyBody')}
        className="py-4"
      />
    );
  }

  return (
    <div aria-busy={loading || Boolean(busy)}>
      {err ? (
        <p role="alert" className="mb-2 mt-0 font-ui text-sm text-danger">{err}</p>
      ) : null}
      <AdminTableShell locale={locale} minWidth="680px" className="max-h-[360px] overflow-y-auto">
        <thead><tr>
          {['candidate', 'status', 'reminders'].map((key) => <AdminTh key={key}>{t(locale, `panel.common.listColumns.${key}`)}</AdminTh>)}
          <AdminActionsTh>{t(locale, 'panel.admin.colActions')}</AdminActionsTh>
        </tr></thead>
        <tbody className="divide-y divide-ink/5">
        {rows.map((inv) => {
          const lastReminder = inv.lastReminderAt ? new Date(inv.lastReminderAt) : null;
          const reminderCount = inv.reminderCount ?? 0;
          const canRemind = ['sent', 'opened'].includes(String(inv.status || '')) && reminderCount < 2;
          return (
            <tr key={inv.id} className="hover:bg-canvas-alt/50">
              <td className="px-4 py-3">
                <div className="font-medium text-ink">{inv.candidateName}</div>
                <div className="text-2xs text-ink-muted">{inv.candidateEmail}</div>
              </td>
              <td className="px-4 py-3 text-brand-600">{inviteStatusLabel(locale, inv.status)}</td>
              <td className="px-4 py-3">
                  {reminderCount > 0 && (
                    <span className="text-prose text-ink-muted">
                      {t(locale, 'recruiting.reminderSentCount', { n: reminderCount })}
                      {lastReminder
                        ? t(locale, 'recruiting.lastReminderSuffix', {
                            date: lastReminder.toLocaleDateString(localeHtmlLang(locale)),
                          })
                        : ''}
                    </span>
                  )}
                  {reminderCount === 0 ? '—' : null}
              </td>
              <td className="px-4 py-3 text-right"><div className="inline-flex items-center gap-1.5 whitespace-nowrap">
                {canRemind ? (
                  <button
                    type="button"
                    disabled={!!busy || loading}
                    onClick={() => remind(inv.id)}
                    className={cn(
                      'flex min-h-touch items-center gap-1.5 rounded-md border border-success/35 bg-success/[0.07] px-2.5 py-1.5 text-2xs text-success',
                      busy ? 'cursor-default' : 'cursor-pointer'
                    )}
                  >
                    {busy === String(inv.id)
                      ? <><span className="spinner" />{t(locale, 'recruiting.sendingShort')}</>
                      : t(locale, 'recruiting.inviteRemind')}
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={!!busy || loading}
                  onClick={() => removeInvite(inv)}
                  title={t(locale, 'recruiting.inviteDelete')}
                  className={cn(
                    'flex min-h-touch items-center gap-1.5 rounded-md border border-danger/35 bg-danger/[0.08] px-2.5 py-1.5 text-2xs text-danger',
                    busy ? 'cursor-default' : 'cursor-pointer'
                  )}
                >
                  {busy === `del:${inv.id}`
                    ? <><span className="spinner" />{t(locale, 'recruiting.removingShort')}</>
                    : t(locale, 'recruiting.inviteRemove')}
                </button>
              </div></td>
            </tr>
          );
        })}
        </tbody>
      </AdminTableShell>
    </div>
  );
}
