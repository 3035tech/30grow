'use client';

import { useCallback, useEffect, useState } from 'react';
import { t } from '../../lib/i18n';
import {
  HOUR_BANK_ENTRY_KIND,
  HOUR_BANK_STATUS,
} from '../../lib/domain-status.js';
import { cn } from '../../lib/cn';
import {
  S,
  AdminCreateButton,
  AdminIconButton,
} from '../dashboard/dashboard-shared';
import { EmptyState } from './EmptyState';
import { AppLoading, ContentEnter } from './AppLoading';
import { useAppFeedback } from './AppFeedback';
import { CollapsibleBlock } from './CollapsibleBlock';
import { FormField } from './FormField';
import { InlineCallout } from './InlineCallout';
import { StatusToneChip } from './StatusToneChip';
import { formatMinutesHm, localIsoToday } from '../../lib/time-clock-format.js';

function localYearMonth() {
  return localIsoToday().slice(0, 7);
}

/**
 * B-2722 — Hour bank admin (DP hub): settings, balances, pending, CSV. Balance is computed from the timesheet.
 */
export function HourBankAdminBlock({
  locale = 'pt-BR',
  companyId,
  navigateDashboard,
  showBalances = true,
  title = null,
  reloadKey = 0,
  onChanged = null,
}) {
  const { toast, promptForm } = useAppFeedback();
  const [month, setMonth] = useState(localYearMonth);
  const [balances, setBalances] = useState([]);
  const [pending, setPending] = useState([]);
  const [schedule, setSchedule] = useState(null);
  const [loading, setLoading] = useState(() => Boolean(companyId));
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    if (!companyId) {
      setBalances([]);
      setPending([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const balParams = new URLSearchParams({
        companyId: String(companyId),
        mode: 'balances',
        ...(showBalances ? {} : { limit: '1' }),
      });
      const entParams = new URLSearchParams({
        companyId: String(companyId),
        mode: 'entries',
        status: HOUR_BANK_STATUS.PENDING,
      });
      const [balRes, entRes] = await Promise.all([
        fetch(`/api/admin/hour-bank?${balParams}`),
        fetch(`/api/admin/hour-bank?${entParams}`),
      ]);
      const balData = await balRes.json().catch(() => ({}));
      const entData = await entRes.json().catch(() => ({}));
      if (!balRes.ok) throw new Error(balData?.error || 'balances');
      if (!entRes.ok) throw new Error(entData?.error || 'entries');
      setBalances(Array.isArray(balData.items) ? balData.items : []);
      setSchedule(balData.schedule || null);
      setPending(Array.isArray(entData.items) ? entData.items : []);
      if ((entData.items || []).length > 0) setOpen(true);
    } catch (e) {
      toast(e?.message || t(locale, 'panel.hourBank.loadError'), 'error');
      setBalances([]);
      setPending([]);
    } finally {
      setLoading(false);
    }
  }, [companyId, locale, toast, showBalances]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  const reloadAll = async () => {
    if (onChanged) onChanged();
    else await load();
  };

  const saveSettings = async () => {
    const values = await promptForm({
      title: t(locale, 'panel.hourBank.settingsTitle'),
      confirmLabel: t(locale, 'panel.hourBank.settingsSave'),
      fields: [
        {
          key: 'hourBankEnabled',
          type: 'boolean',
          label: t(locale, 'panel.hourBank.enabledLabel'),
          defaultValue: Boolean(schedule?.hourBankEnabled),
        },
        {
          key: 'hourBankMaxMinutes',
          type: 'number',
          label: t(locale, 'panel.hourBank.maxMinutesLabel'),
          defaultValue: String(schedule?.hourBankMaxMinutes ?? 2400),
          min: 0,
          max: 20000,
          help: t(locale, 'panel.hourBank.maxMinutesHelp'),
        },
      ],
    });
    if (!values) return;
    setBusy(true);
    try {
      const res = await fetch('/api/admin/hour-bank', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          action: 'settings',
          hourBankEnabled: Boolean(values.hourBankEnabled),
          hourBankMaxMinutes: Number(values.hourBankMaxMinutes),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'settings');
      setSchedule(data.schedule);
      toast(t(locale, 'panel.hourBank.settingsSaved'), 'ok');
      await reloadAll();
    } catch (e) {
      toast(e?.message || t(locale, 'panel.hourBank.saveError'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const addManual = async () => {
    const values = await promptForm({
      title: t(locale, 'panel.hourBank.manualTitle'),
      confirmLabel: t(locale, 'panel.hourBank.manualConfirm'),
      fields: [
        {
          key: 'candidateId',
          type: 'entitySearch',
          label: t(locale, 'panel.hourBank.personLabel'),
          required: true,
          searchUrl: `/api/admin/employees/search?companyId=${encodeURIComponent(companyId)}`,
          minChars: 2,
        },
        {
          key: 'entryKind',
          type: 'select',
          label: t(locale, 'panel.hourBank.kindLabel'),
          required: true,
          defaultValue: HOUR_BANK_ENTRY_KIND.CREDIT,
          options: [
            { value: HOUR_BANK_ENTRY_KIND.CREDIT, label: t(locale, 'panel.hourBank.kindCredit') },
            { value: HOUR_BANK_ENTRY_KIND.DEBIT, label: t(locale, 'panel.hourBank.kindDebit') },
          ],
        },
        {
          key: 'minutes',
          type: 'number',
          label: t(locale, 'panel.hourBank.minutesLabel'),
          required: true,
          defaultValue: '60',
          min: 1,
          max: 1440,
        },
        {
          key: 'workOn',
          type: 'date',
          label: t(locale, 'panel.hourBank.workOnLabel'),
          required: true,
          defaultValue: localIsoToday(),
        },
        {
          key: 'note',
          type: 'text',
          label: t(locale, 'panel.hourBank.noteLabel'),
        },
      ],
    });
    if (!values) return;
    setBusy(true);
    try {
      const res = await fetch('/api/admin/hour-bank', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          action: 'manual',
          candidateId: Number(values.candidateId),
          entryKind: values.entryKind,
          minutes: Number(values.minutes),
          workOn: values.workOn,
          note: values.note || '',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'manual');
      toast(t(locale, 'panel.hourBank.manualSaved'), 'ok');
      await reloadAll();
    } catch (e) {
      toast(e?.message || t(locale, 'panel.hourBank.saveError'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const decide = async (row, status) => {
    setBusy(true);
    try {
      const res = await fetch('/api/admin/hour-bank', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, entryId: row.id, status }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'decide');
      toast(t(locale, 'panel.hourBank.decided'), 'ok');
      await reloadAll();
    } catch (e) {
      toast(e?.message || t(locale, 'panel.hourBank.saveError'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams({
        companyId: String(companyId),
        mode: 'export',
        month,
      });
      const res = await fetch(`/api/admin/hour-bank?${params}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || 'export');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `hour-bank-${month}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast(t(locale, 'panel.hourBank.exported'), 'ok');
    } catch (e) {
      toast(e?.message || t(locale, 'panel.hourBank.exportError'), 'error');
    } finally {
      setExporting(false);
    }
  };

  if (!companyId) return null;

  const enabled = Boolean(schedule?.hourBankEnabled);
  const withBalance = balances.filter((b) => b.balanceMinutes !== 0 || b.pendingCount > 0);

  return (
    <CollapsibleBlock
      locale={locale}
      title={title || t(locale, 'panel.hourBank.title')}
      count={pending.length || null}
      open={open}
      onOpenChange={setOpen}
      variant="card"
      className="mt-2"
    >
      {loading ? (
        <AppLoading variant="panel" />
      ) : (
        <ContentEnter animKey={`hour-bank|${enabled ? 1 : 0}|${pending.length}|${balances.length}`}>
          <InlineCallout tone="info" className="mb-3">
            {enabled
              ? t(locale, 'panel.hourBank.hintOn', {
                  max: formatMinutesHm(schedule?.hourBankMaxMinutes ?? 2400),
                  pending: pending.length,
                })
              : t(locale, 'panel.hourBank.hintOff')}
          </InlineCallout>
          <p className={cn(S.muted, 'mb-3 text-prose')}>{t(locale, 'panel.hourBank.note')}</p>

          <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
            <FormField label={t(locale, 'panel.hourBank.monthLabel')} className="min-w-[8rem]">
              <input
                type="month"
                className={S.input}
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                disabled={busy || exporting}
              />
            </FormField>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={cn(S.btnGhost, 'min-h-touch text-sm')}
                disabled={busy}
                onClick={() => void saveSettings()}
              >
                {t(locale, 'panel.hourBank.settingsBtn')}
              </button>
              <AdminCreateButton
                label={t(locale, 'panel.hourBank.manualBtn')}
                onClick={() => void addManual()}
                disabled={busy || !enabled}
              />
              <button
                type="button"
                className={cn(S.btnGhost, 'min-h-touch text-sm')}
                disabled={exporting}
                onClick={() => void exportCsv()}
              >
                {exporting ? t(locale, 'panel.common.loading') : t(locale, 'panel.hourBank.exportBtn')}
              </button>
            </div>
          </div>

          {!enabled ? (
            <EmptyState
              title={t(locale, 'panel.hourBank.disabledTitle')}
              message={t(locale, 'panel.hourBank.disabledHint')}
            />
          ) : (
            <>
              {pending.length > 0 ? (
                <div className="mb-4">
                  <p className={cn(S.label, 'mb-2')}>{t(locale, 'panel.hourBank.pendingTitle')}</p>
                  <ul className="m-0 flex list-none flex-col gap-2 p-0">
                    {pending.map((row) => (
                      <li
                        key={row.id}
                        className="flex flex-wrap items-center gap-2 rounded-control border border-ink/8 bg-ink/[0.02] px-3 py-2"
                      >
                        <span className="font-ui text-sm text-ink">
                          {row.candidateName || `#${row.candidateId}`}
                        </span>
                        <StatusToneChip
                          tone={row.entryKind === HOUR_BANK_ENTRY_KIND.CREDIT ? 'success' : 'warning'}
                        >
                          {row.entryKind === HOUR_BANK_ENTRY_KIND.CREDIT
                            ? t(locale, 'panel.hourBank.kindCredit')
                            : t(locale, 'panel.hourBank.kindDebit')}
                        </StatusToneChip>
                        <span className="font-mono text-2xs text-ink-muted">
                          {formatMinutesHm(row.minutes)} · {row.workOn} · {row.source}
                        </span>
                        <div className="ml-auto flex gap-1">
                          <AdminIconButton
                            icon="check"
                            label={t(locale, 'panel.hourBank.approve')}
                            tint="success"
                            disabled={busy}
                            onClick={() => void decide(row, HOUR_BANK_STATUS.APPROVED)}
                          />
                          <AdminIconButton
                            icon="x"
                            label={t(locale, 'panel.hourBank.reject')}
                            tint="danger"
                            disabled={busy}
                            onClick={() => void decide(row, HOUR_BANK_STATUS.REJECTED)}
                          />
                          {typeof navigateDashboard === 'function' ? (
                            <AdminIconButton
                              icon="user"
                              label={t(locale, 'panel.hourBank.openPerson')}
                              onClick={() =>
                                navigateDashboard({
                                  tab: 'team',
                                  candidate: row.candidateId,
                                  section: 'dp',
                                })
                              }
                            />
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {!showBalances ? (
                pending.length === 0 ? (
                  <p className={cn(S.muted, 'm-0 text-prose')}>{t(locale, 'panel.hourBank.noPending')}</p>
                ) : null
              ) : withBalance.length === 0 ? (
                <EmptyState
                  title={t(locale, 'panel.hourBank.emptyTitle')}
                  message={t(locale, 'panel.hourBank.emptyHint')}
                />
              ) : (
                <div>
                  <p className={cn(S.label, 'mb-2')}>{t(locale, 'panel.hourBank.balancesTitle')}</p>
                  <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                    {withBalance.slice(0, 40).map((row) => (
                      <li
                        key={row.candidateId}
                        className="flex flex-wrap items-center gap-2 rounded-control border border-ink/8 px-3 py-2"
                      >
                        <span className="font-ui text-sm text-ink">{row.candidateName}</span>
                        <span className="font-mono text-2xs text-ink-muted">{row.candidateEmail}</span>
                        <StatusToneChip tone={row.balanceMinutes >= 0 ? 'success' : 'danger'}>
                          {formatMinutesHm(row.balanceMinutes)}
                        </StatusToneChip>
                        {row.pendingCount > 0 ? (
                          <StatusToneChip tone="warning">
                            {t(locale, 'panel.hourBank.pendingChip', { n: row.pendingCount })}
                          </StatusToneChip>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </ContentEnter>
      )}
    </CollapsibleBlock>
  );
}
