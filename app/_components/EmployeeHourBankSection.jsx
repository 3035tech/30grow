'use client';

import { useCallback, useEffect, useState } from 'react';
import { t } from '../../lib/i18n';
import {
  HOUR_BANK_ENTRY_KIND,
  HOUR_BANK_STATUS,
} from '../../lib/domain-status.js';
import { cn } from '../../lib/cn';
import { S } from '../dashboard/dashboard-shared';
import { AppLoading, ContentEnter } from './AppLoading';
import { useAppFeedback } from './AppFeedback';
import { EmptyState } from './EmptyState';
import { InlineCallout } from './InlineCallout';
import { StatusToneChip } from './StatusToneChip';
import { FormField } from './FormField';
import { DateField } from './DateField';

function formatMinutesHm(totalMinutes) {
  const n = Math.round(Number(totalMinutes) || 0);
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${h}h${String(m).padStart(2, '0')}`;
}

function localIsoToday() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Collaborator hour bank (B-2722): balance + debit request.
 */
export function EmployeeHourBankSection({ locale = 'pt-BR' }) {
  const { toast } = useAppFeedback();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [minutes, setMinutes] = useState('60');
  const [workOn, setWorkOn] = useState(localIsoToday);
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/employee/hour-bank');
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || 'load');
      setData(json);
    } catch (e) {
      toast(e?.message || t(locale, 'employeeHome.hourBank.loadError'), 'error');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [locale, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const requestDebit = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/employee/hour-bank', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          minutes: Number(minutes),
          workOn,
          note,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || 'request');
      setData((prev) => ({
        ...(prev || {}),
        balanceMinutes: json.balanceMinutes ?? prev?.balanceMinutes,
        items: json.items ?? prev?.items,
        enabled: json.enabled ?? prev?.enabled,
        maxMinutes: json.maxMinutes ?? prev?.maxMinutes,
      }));
      setNote('');
      toast(t(locale, 'employeeHome.hourBank.requested'), 'ok');
    } catch (e) {
      toast(e?.message || t(locale, 'employeeHome.hourBank.requestError'), 'error');
    } finally {
      setBusy(false);
    }
  };

  if (loading && !data) return <AppLoading variant="panel" />;
  if (!data) {
    return (
      <EmptyState
        title={t(locale, 'employeeHome.hourBank.emptyTitle')}
        message={t(locale, 'employeeHome.hourBank.loadError')}
      />
    );
  }

  if (!data.enabled) {
    return (
      <ContentEnter animKey="emp-hour-bank-off">
        <InlineCallout tone="info">
          {t(locale, data.bankParticipant === false ? 'employeeHome.hourBank.disabledPersonHint' : 'employeeHome.hourBank.disabledHint')}
        </InlineCallout>
      </ContentEnter>
    );
  }

  return (
    <ContentEnter animKey={`emp-hour-bank|${data.balanceMinutes}|${(data.items || []).length}`}>
      <InlineCallout tone="info" className="mb-3">
        {t(locale, 'employeeHome.hourBank.hint', {
          balance: formatMinutesHm(data.balanceMinutes),
          max: formatMinutesHm(data.maxMinutes),
        })}
      </InlineCallout>

      <div className={cn(S.cardShell, 'mb-4 p-3')}>
        <p className={cn(S.label, 'mb-2')}>{t(locale, 'employeeHome.hourBank.requestTitle')}</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:items-start">
          <FormField label={t(locale, 'employeeHome.hourBank.minutesLabel')}>
            <input
              type="number"
              className={S.input}
              min={1}
              max={1440}
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              disabled={busy}
            />
          </FormField>
          <FormField label={t(locale, 'employeeHome.hourBank.workOnLabel')}>
            <DateField
              value={workOn}
              onChange={(e) => setWorkOn(e.target.value || localIsoToday())}
              disabled={busy}
            />
          </FormField>
          <FormField label={t(locale, 'employeeHome.hourBank.noteLabel')}>
            <input
              type="text"
              className={S.input}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={busy}
              maxLength={500}
            />
          </FormField>
        </div>
        <button
          type="button"
          className={cn(S.btnPrimary, 'mt-3 min-h-touch')}
          disabled={busy || Number(minutes) < 1}
          onClick={() => void requestDebit()}
        >
          {busy ? t(locale, 'employeeHome.hourBank.requesting') : t(locale, 'employeeHome.hourBank.requestBtn')}
        </button>
      </div>

      {(data.items || []).length === 0 ? (
        <p className={cn(S.muted, 'mb-0 text-prose')}>{t(locale, 'employeeHome.hourBank.noEntries')}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {data.items.map((e) => (
            <li
              key={e.id}
              className="flex flex-wrap items-center gap-2 rounded-control border border-ink/8 bg-ink/[0.02] px-3 py-2"
            >
              <span className="font-mono text-prose text-ink">{e.workOn}</span>
              <StatusToneChip
                tone={e.entryKind === HOUR_BANK_ENTRY_KIND.CREDIT ? 'success' : 'warning'}
              >
                {e.entryKind === HOUR_BANK_ENTRY_KIND.CREDIT
                  ? t(locale, 'employeeHome.hourBank.kindCredit')
                  : t(locale, 'employeeHome.hourBank.kindDebit')}
              </StatusToneChip>
              <span className="font-mono text-2xs text-ink-muted">{formatMinutesHm(e.minutes)}</span>
              <StatusToneChip
                tone={
                  e.status === HOUR_BANK_STATUS.APPROVED
                    ? 'success'
                    : e.status === HOUR_BANK_STATUS.REJECTED
                      ? 'danger'
                      : 'warning'
                }
              >
                {t(locale, `employeeHome.hourBank.status.${e.status}`)}
              </StatusToneChip>
            </li>
          ))}
        </ul>
      )}
    </ContentEnter>
  );
}
