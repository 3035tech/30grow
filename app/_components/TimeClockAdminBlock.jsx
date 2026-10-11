'use client';

import { ListLoadError } from './ListLoadError';

import { useCallback, useEffect, useState } from 'react';
import { t, localeHtmlLang } from '../../lib/i18n';
import {
  TIME_PUNCH_KIND,
  TIME_PUNCH_REVIEW,
} from '../../lib/domain-status.js';
import { cn } from '../../lib/cn';
import {
  S,
  AdminIconButton,
  AdminCreateButton,
} from '../dashboard/dashboard-shared';
import { EmptyState } from './EmptyState';
import { AppLoading, ContentEnter } from './AppLoading';
import { useAppFeedback } from './AppFeedback';
import { CollapsibleBlock } from './CollapsibleBlock';
import { DateField } from './DateField';
import { FormField } from './FormField';
import { InlineCallout } from './InlineCallout';
import { StatusToneChip } from './StatusToneChip';
import { localIsoToday } from '../../lib/time-clock-format.js';

function formatTime(value, locale) {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString(localeHtmlLang(locale), {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * B-2721 — Admin day mirror + schedule + CSV (inside DP tab).
 */
export function TimeClockAdminBlock({ locale = 'pt-BR', companyId, navigateDashboard, title = null }) {
  const { toast, promptForm } = useAppFeedback();
  const [day, setDay] = useState(localIsoToday);
  const [items, setItems] = useState([]);
  const [schedule, setSchedule] = useState(null);
  const [flaggedCount, setFlaggedCount] = useState(0);
  const [loadError, setLoadError] = useState(null);
  const [loading, setLoading] = useState(() => Boolean(companyId));
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [open, setOpen] = useState(false);
  const [autoOpenedForFlags, setAutoOpenedForFlags] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    if (!companyId) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams({ companyId: String(companyId), day });
      const res = await fetch(`/api/admin/time-clock?${params}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'load');
      setItems(Array.isArray(data.items) ? data.items : []);
      setSchedule(data.schedule || null);
      setFlaggedCount(Number(data.flaggedCount) || 0);
    } catch (e) {
      toast(e?.message || t(locale, 'panel.timeClock.loadError'), 'error');
      setLoadError(t(locale, 'panel.timeClock.loadError'));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [companyId, day, locale, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!loading && flaggedCount > 0 && !autoOpenedForFlags) {
      setOpen(true);
      setAutoOpenedForFlags(true);
    }
  }, [loading, flaggedCount, autoOpenedForFlags]);

  const saveSchedule = async () => {
    const values = await promptForm({
      title: t(locale, 'panel.timeClock.scheduleTitle'),
      confirmLabel: t(locale, 'panel.timeClock.scheduleSave'),
      fields: [
        {
          key: 'workdayStart',
          type: 'text',
          label: t(locale, 'panel.timeClock.startLabel'),
          defaultValue: schedule?.workdayStart || '09:00',
          required: true,
        },
        {
          key: 'workdayEnd',
          type: 'text',
          label: t(locale, 'panel.timeClock.endLabel'),
          defaultValue: schedule?.workdayEnd || '18:00',
          required: true,
        },
        {
          key: 'breakMinutes',
          type: 'range',
          label: t(locale, 'panel.timeClock.breakLabel'),
          defaultValue: String(schedule?.breakMinutes ?? 60),
          min: 0,
          max: 240,
        },
        {
          key: 'lateGraceMinutes',
          type: 'range',
          label: t(locale, 'panel.timeClock.graceLabel'),
          defaultValue: String(schedule?.lateGraceMinutes ?? 10),
          min: 0,
          max: 120,
        },
        {
          key: 'timezone',
          type: 'text',
          label: t(locale, 'panel.timeClock.tzLabel'),
          defaultValue: schedule?.timezone || 'America/Sao_Paulo',
        },
      ],
    });
    if (!values) return;
    setBusy(true);
    try {
      const res = await fetch('/api/admin/time-clock', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          action: 'schedule',
          workdayStart: values.workdayStart,
          workdayEnd: values.workdayEnd,
          breakMinutes: Number(values.breakMinutes),
          lateGraceMinutes: Number(values.lateGraceMinutes),
          timezone: values.timezone,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'schedule');
      setSchedule(data.schedule);
      toast(t(locale, 'panel.timeClock.scheduleSaved'), 'ok');
      await load();
    } catch (e) {
      toast(e?.message || t(locale, 'panel.timeClock.saveError'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const review = async (row, reviewStatus) => {
    setBusy(true);
    try {
      const res = await fetch('/api/admin/time-clock', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          action: 'review',
          punchId: row.id,
          reviewStatus,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'review');
      toast(t(locale, 'panel.timeClock.reviewed'), 'ok');
      await load();
    } catch (e) {
      toast(e?.message || t(locale, 'panel.timeClock.saveError'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const addManual = async () => {
    const values = await promptForm({
      title: t(locale, 'panel.timeClock.manualTitle'),
      confirmLabel: t(locale, 'panel.timeClock.manualConfirm'),
      fields: [
        {
          key: 'candidateId',
          type: 'entitySearch',
          label: t(locale, 'panel.timeClock.personLabel'),
          required: true,
          searchUrl: `/api/admin/employees/search?companyId=${encodeURIComponent(companyId)}`,
          minChars: 2,
        },
        {
          key: 'punchKind',
          type: 'select',
          label: t(locale, 'panel.timeClock.kindLabel'),
          defaultValue: TIME_PUNCH_KIND.IN,
          options: [
            { value: TIME_PUNCH_KIND.IN, label: t(locale, 'panel.timeClock.kindIn') },
            { value: TIME_PUNCH_KIND.OUT, label: t(locale, 'panel.timeClock.kindOut') },
          ],
        },
        {
          key: 'notes',
          type: 'textarea',
          label: t(locale, 'panel.timeClock.notesLabel'),
        },
      ],
    });
    if (!values?.candidateId) return;
    setBusy(true);
    try {
      const res = await fetch('/api/admin/time-clock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          candidateId: Number(values.candidateId),
          punchKind: values.punchKind || TIME_PUNCH_KIND.IN,
          notes: values.notes || '',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'manual');
      toast(t(locale, 'panel.timeClock.manualSaved'), 'ok');
      await load();
    } catch (e) {
      toast(e?.message || t(locale, 'panel.timeClock.saveError'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams({
        companyId: String(companyId),
        day,
        mode: 'export',
      });
      const res = await fetch(`/api/admin/time-clock?${params}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || 'export');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `time-clock-${day}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast(t(locale, 'panel.timeClock.exported'), 'ok');
    } catch (e) {
      toast(e?.message || t(locale, 'panel.timeClock.exportError'), 'error');
    } finally {
      setExporting(false);
    }
  };

  if (!companyId) return null;

  return (
    <CollapsibleBlock
      locale={locale}
      title={title || t(locale, 'panel.timeClock.title')}
      count={flaggedCount || null}
      open={open}
      onOpenChange={setOpen}
      variant="card"
      className="mt-2"
      collapsedHint={t(locale, 'panel.timeClock.hint')}
    >
      {loadError ? (
        <ListLoadError locale={locale} message={loadError} onRetry={load} />
      ) : loading ? (
        <AppLoading variant="panel" />
      ) : (
        <ContentEnter animKey={`tc|${companyId}|${day}|${items.length}|${flaggedCount}`}>
          <InlineCallout tone="info" className="mb-3">
            {t(locale, 'panel.timeClock.note')}
          </InlineCallout>
          <div className={cn(S.fieldRow, 'mb-3 items-end')}>
            <FormField label={t(locale, 'panel.timeClock.dayLabel')} className="min-w-[10rem]">
              <DateField
                value={day}
                onChange={(e) => setDay(e.target.value || localIsoToday())}
                aria-label={t(locale, 'panel.timeClock.dayLabel')}
              />
            </FormField>
            <div className="flex flex-wrap gap-2 pb-0.5">
              <AdminCreateButton
                label={t(locale, 'panel.timeClock.manualBtn')}
                onClick={() => void addManual()}
                disabled={busy}
              />
              <button
                type="button"
                className={cn(S.btnGhost, 'min-h-touch')}
                onClick={() => void saveSchedule()}
                disabled={busy}
              >
                {t(locale, 'panel.timeClock.scheduleBtn')}
              </button>
              <button
                type="button"
                className={cn(S.btnGhost, 'min-h-touch')}
                onClick={() => void exportCsv()}
                disabled={exporting || busy}
              >
                {exporting ? t(locale, 'panel.common.loading') : t(locale, 'panel.timeClock.exportBtn')}
              </button>
            </div>
          </div>
          {schedule ? (
            <p className="mb-3 mt-0 font-mono text-2xs text-ink-faint">
              {t(locale, 'panel.timeClock.scheduleSummary', {
                start: schedule.workdayStart,
                end: schedule.workdayEnd,
                grace: schedule.lateGraceMinutes,
              })}
            </p>
          ) : null}
          {items.length === 0 ? (
            <EmptyState
              title={t(locale, 'panel.timeClock.emptyTitle')}
              message={t(locale, 'panel.timeClock.emptyHint')}
            />
          ) : (
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
              {items.map((row) => (
                <li
                  key={row.id}
                  className={cn(
                    'flex flex-wrap items-center justify-between gap-2 rounded-control border bg-surface px-3 py-2',
                    row.reviewStatus === TIME_PUNCH_REVIEW.FLAGGED
                      ? 'border-warning/30 bg-warning/[0.04]'
                      : 'border-ink/10'
                  )}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-ui text-sm text-ink">
                        {row.candidateName || row.candidateEmail || `#${row.candidateId}`}
                      </span>
                      <span className="font-mono text-2xs text-ink-muted">
                        {formatTime(row.punchedAt, locale)}
                      </span>
                      <StatusToneChip
                        tone={row.punchKind === TIME_PUNCH_KIND.IN ? 'success' : 'info'}
                      >
                        {row.punchKind === TIME_PUNCH_KIND.IN
                          ? t(locale, 'panel.timeClock.kindIn')
                          : t(locale, 'panel.timeClock.kindOut')}
                      </StatusToneChip>
                      {row.flag ? (
                        <StatusToneChip tone="warning">
                          {t(locale, `panel.timeClock.flag.${row.flag}`)}
                        </StatusToneChip>
                      ) : null}
                      {row.reviewStatus === TIME_PUNCH_REVIEW.OK ? (
                        <StatusToneChip tone="success">
                          {t(locale, 'panel.timeClock.reviewOk')}
                        </StatusToneChip>
                      ) : null}
                      {row.reviewStatus === TIME_PUNCH_REVIEW.FLAGGED ? (
                        <StatusToneChip tone="danger">
                          {t(locale, 'panel.timeClock.reviewFlagged')}
                        </StatusToneChip>
                      ) : null}
                    </div>
                    {row.notes ? (
                      <p className={cn(S.muted, 'mb-0 mt-1 line-clamp-1 text-prose')}>{row.notes}</p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {typeof navigateDashboard === 'function' ? (
                      <AdminIconButton
                        icon="user"
                        label={t(locale, 'panel.timeClock.openPerson')}
                        onClick={() =>
                          navigateDashboard({
                            tab: 'team',
                            candidate: row.candidateId,
                            section: 'dp',
                          })
                        }
                      />
                    ) : null}
                    {row.reviewStatus === TIME_PUNCH_REVIEW.FLAGGED ? (
                      <AdminIconButton
                        icon="check"
                        label={t(locale, 'panel.timeClock.markOk')}
                        tint="success"
                        onClick={() => void review(row, TIME_PUNCH_REVIEW.OK)}
                        disabled={busy}
                      />
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </ContentEnter>
      )}
    </CollapsibleBlock>
  );
}
