'use client';

import { ListLoadError } from './ListLoadError';

import { useCallback, useEffect, useState } from 'react';
import { t, localeHtmlLang } from '../../lib/i18n';
import { cn } from '../../lib/cn';
import { HOLIDAY_RECURRENCE, HOLIDAY_RECURRENCES, HOLIDAY_SOURCE } from '../../lib/domain-status.js';
import { orgUnitOptions } from '../../lib/org-unit-constants.js';
import {
  S,
  AdminActionsCell,
  AdminActionsTh,
  AdminDeleteButton,
  AdminEditButton,
  AdminListPager,
  AdminListSearch,
  AdminTableShell,
  AdminTh,
} from '../dashboard/dashboard-shared';
import { AdminListFilterSelect, AdminListFilters } from './AdminListFilters';
import { AppLoading } from './AppLoading';
import { useAppFeedback } from './AppFeedback';
import { EmptyState } from './EmptyState';
import { useOrgUnits } from './OrgUnitField';
import { StatusToneChip } from './StatusToneChip';

const KH = 'panel.timeClockHolidays';
const PAGE_SIZE = 25;
const WIDE_COL = 'hidden lg:table-cell';

function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

function dayLabel(iso, locale) {
  const d = new Date(`${iso}T12:00:00Z`);
  return d.toLocaleDateString(localeHtmlLang(locale), { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'UTC' });
}

/**
 * DP › Ponto › Feriados: company / unit holidays (one-off or yearly) and the national
 * import of a year. A holiday has no expected hours; time worked on it counts as extra.
 */
export function TimeClockHolidaysBlock({ locale = 'pt-BR', companyId, onChanged }) {
  const { toast, promptForm, confirm } = useAppFeedback();
  const { units } = useOrgUnits(companyId);
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(String(thisYear));
  const [qDraft, setQDraft] = useState('');
  const q = useDebounced(qDraft);
  const [page, setPage] = useState(1);
  const [state, setState] = useState({ items: [], total: 0, loading: true, error: null });
  const [busy, setBusy] = useState(false);
  useEffect(() => setPage(1), [q, year]);

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const params = new URLSearchParams({
        companyId: String(companyId),
        year,
        page: String(page),
        pageSize: String(PAGE_SIZE),
        ...(q.trim() ? { q: q.trim() } : {}),
      });
      const res = await fetch(`/api/admin/time-clock/holidays?${params}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || String(res.status));
      setState({ items: data.items || [], total: Number(data.total) || 0, loading: false });
    } catch (e) {
      toast(e?.message || t(locale, `${KH}.loadError`), 'error');
      setState({ items: [], total: 0, loading: false, error: e?.message || String(e) });
    }
  }, [companyId, year, page, q, locale, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const send = async (url, method, body) => {
    setBusy(true);
    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify({ companyId, ...body }) } : {}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || String(res.status));
      await load();
      onChanged?.();
      return data;
    } catch (e) {
      toast(e?.message || t(locale, `${KH}.saveError`), 'error');
      return null;
    } finally {
      setBusy(false);
    }
  };

  const edit = async (row = null) => {
    const values = await promptForm({
      title: t(locale, row ? `${KH}.editTitle` : `${KH}.createTitle`),
      confirmLabel: t(locale, `${KH}.save`),
      fields: [
        { key: 'name', type: 'text', label: t(locale, `${KH}.nameLabel`), required: true, defaultValue: row?.name || '', maxLength: 120 },
        { key: 'day', type: 'date', label: t(locale, `${KH}.dayLabel`), required: true, defaultValue: row?.day || `${year}-01-01` },
        {
          key: 'recurrence',
          type: 'select',
          label: t(locale, `${KH}.recurrenceLabel`),
          defaultValue: row?.recurrence || HOLIDAY_RECURRENCE.ONCE,
          options: HOLIDAY_RECURRENCES.map((r) => ({ value: r, label: t(locale, `${KH}.recurrence.${r}`) })),
          help: t(locale, `${KH}.recurrenceHelp`),
        },
        {
          key: 'orgUnitId',
          type: 'select',
          label: t(locale, `${KH}.scopeLabel`),
          defaultValue: row?.orgUnitId ? String(row.orgUnitId) : '',
          options: [
            { value: '', label: t(locale, `${KH}.scopeCompany`) },
            ...orgUnitOptions(units).map((u) => ({ value: String(u.id), label: u.label })),
          ],
          help: t(locale, `${KH}.scopeHelp`),
        },
      ],
    });
    if (!values) return;
    const body = {
      name: values.name,
      day: values.day,
      recurrence: values.recurrence,
      orgUnitId: values.orgUnitId ? Number(values.orgUnitId) : null,
    };
    const data = row
      ? await send(`/api/admin/time-clock/holidays/${row.id}`, 'PATCH', body)
      : await send('/api/admin/time-clock/holidays', 'POST', { action: 'create', ...body });
    if (data) toast(t(locale, `${KH}.saved`), 'ok');
  };

  const remove = async (row) => {
    const ok = await confirm({
      title: t(locale, `${KH}.deleteTitle`),
      message: t(locale, `${KH}.deleteMessage`, { name: row.name, day: dayLabel(row.occursOn, locale) }),
      confirmLabel: t(locale, `${KH}.deleteConfirm`),
      danger: true,
    });
    if (!ok) return;
    const params = new URLSearchParams({ companyId: String(companyId) });
    const data = await send(`/api/admin/time-clock/holidays/${row.id}?${params}`, 'DELETE');
    if (data) toast(t(locale, `${KH}.deleted`), 'ok');
  };

  const importNational = async () => {
    const ok = await confirm({
      title: t(locale, `${KH}.importTitle`, { year }),
      message: t(locale, `${KH}.importMessage`, { year }),
      confirmLabel: t(locale, `${KH}.importConfirm`),
    });
    if (!ok) return;
    const data = await send('/api/admin/time-clock/holidays', 'POST', { action: 'import', year: Number(year) });
    if (data) {
      toast(t(locale, `${KH}.imported`, { inserted: data.inserted, existing: data.existing, closed: data.closed }), 'ok');
    }
  };

  const years = [thisYear - 1, thisYear, thisYear + 1, thisYear + 2].map(String);
  const { items, total, loading, error } = state;
  const dirty = Boolean(qDraft.trim());

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <p className={cn(S.muted, 'm-0 max-w-[62ch] text-prose')}>{t(locale, `${KH}.intro`)}</p>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            type="button"
            className={cn(S.btnGhost, 'min-h-touch text-sm')}
            disabled={busy}
            onClick={() => void importNational()}
          >
            {t(locale, `${KH}.importBtn`, { year })}
          </button>
          <button
            type="button"
            className={cn(S.btnPrimary, 'min-h-touch')}
            disabled={busy}
            onClick={() => void edit()}
          >
            {t(locale, `${KH}.createBtn`)}
          </button>
        </div>
      </div>

      <AdminListFilters
        aria-label={t(locale, `${KH}.filters`)}
        locale={locale}
        clearEnabled={dirty}
        onClear={() => setQDraft('')}
      >
        <AdminListSearch locale={locale} value={qDraft} onChange={setQDraft} placeholder={t(locale, `${KH}.search`)} />
        <AdminListFilterSelect label={t(locale, `${KH}.yearLabel`)} value={year} onChange={setYear}>
          {years.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </AdminListFilterSelect>
      </AdminListFilters>

      {error ? (
        <ListLoadError locale={locale} message={t(locale, `${KH}.loadError`)} onRetry={load} />
      ) : loading && items.length === 0 ? (
        <AppLoading variant="panel" />
      ) : items.length === 0 ? (
        <EmptyState
          title={t(locale, dirty ? `${KH}.emptyFiltered` : `${KH}.empty`, { year })}
          message={t(locale, `${KH}.emptyHint`, { year })}
        />
      ) : (
        <>
          <AdminTableShell
            locale={locale}
            minWidth="360px"
            animKey={`tc-holidays|${year}|${page}|${q}|${total}`}
            ariaLabel={t(locale, `${KH}.aria`)}
          >
            <thead>
              <tr>
                <AdminTh>{t(locale, `${KH}.colDay`)}</AdminTh>
                <AdminTh>{t(locale, `${KH}.colName`)}</AdminTh>
                <AdminTh className={WIDE_COL}>{t(locale, `${KH}.colScope`)}</AdminTh>
                <AdminTh className={WIDE_COL}>{t(locale, `${KH}.colRecurrence`)}</AdminTh>
                <AdminActionsTh>{t(locale, `${KH}.colActions`)}</AdminActionsTh>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.id} className="border-b border-ink/8 last:border-b-0">
                  <td className="whitespace-nowrap px-4 py-2.5 align-middle font-mono text-sm tabular-nums text-ink">
                    {dayLabel(row.occursOn, locale)}
                  </td>
                  <td className="px-4 py-2.5 align-middle">
                    <p className="m-0 font-ui text-sm text-ink">{row.name}</p>
                    <p className={cn(S.faint, 'm-0 lg:hidden')}>
                      {[row.orgUnitPath || t(locale, `${KH}.scopeCompany`), t(locale, `${KH}.recurrence.${row.recurrence}`)].join(' · ')}
                    </p>
                  </td>
                  <td className={cn(WIDE_COL, 'px-4 py-2.5 align-middle text-ink-muted')}>
                    {row.orgUnitPath || t(locale, `${KH}.scopeCompany`)}
                  </td>
                  <td className={cn(WIDE_COL, 'px-4 py-2.5 align-middle')}>
                    <div className="flex flex-wrap gap-1">
                      <StatusToneChip tone={row.recurrence === HOLIDAY_RECURRENCE.YEARLY ? 'info' : 'neutral'}>
                        {t(locale, `${KH}.recurrence.${row.recurrence}`)}
                      </StatusToneChip>
                      {row.source === HOLIDAY_SOURCE.NATIONAL ? (
                        <StatusToneChip tone="neutral">{t(locale, `${KH}.sourceNational`)}</StatusToneChip>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right align-middle">
                    <AdminActionsCell>
                      <AdminEditButton
                        label={t(locale, `${KH}.editAria`, { name: row.name })}
                        disabled={busy}
                        onClick={() => void edit(row)}
                      />
                      <AdminDeleteButton
                        label={t(locale, `${KH}.deleteAria`, { name: row.name })}
                        disabled={busy}
                        onClick={() => void remove(row)}
                      />
                    </AdminActionsCell>
                  </td>
                </tr>
              ))}
            </tbody>
          </AdminTableShell>
          <AdminListPager
            locale={locale}
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            loading={loading}
            onPageChange={setPage}
            pageSizeOptions={[PAGE_SIZE]}
          />
        </>
      )}
    </div>
  );
}
