'use client';

import { useCallback, useEffect, useState } from 'react';
import { t } from '../../lib/i18n';
import { formatDisplayDate, formatDisplayDateTime } from '../../lib/format-display-date.js';
import { cn } from '../../lib/cn';
import { TIME_CLOCK_CLOSURE_STATUS, TIME_CLOCK_CLOSURE_STATUSES } from '../../lib/domain-status.js';
import { orgUnitOptions } from '../../lib/org-unit-constants.js';
import { localIsoToday, shiftIsoDay } from '../../lib/time-clock-format.js';
import {
  S,
  AdminActionsCell,
  AdminActionsTh,
  AdminIconButton,
  AdminListPager,
  AdminListSearch,
  AdminTableShell,
  AdminTh,
} from '../dashboard/dashboard-shared';
import { AdminListFilters, AdminListFilterSelect } from './AdminListFilters';
import { AppLoading } from './AppLoading';
import { useAppFeedback } from './AppFeedback';
import { EmptyState } from './EmptyState';
import { useOrgUnits } from './OrgUnitField';
import { StatusToneChip } from './StatusToneChip';
import { TimeClockClosureSummaryDrawer } from './TimeClockClosureSummaryDrawer';

const K = 'panel.timeClockMgr';
const PAGE_SIZE = 20;

const dateBr = (v, locale) => formatDisplayDate(v, locale, { fallback: '' });
const dateTimeBr = (v, locale) => formatDisplayDateTime(v, locale, { fallback: '' });

async function sendJson(method, body) {
  const res = await fetch('/api/admin/time-clock/closures', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || String(res.status));
  return data;
}

/** Period closures: close a past period (locks adjustments) and cancel to unlock. */
export function TimeClockClosuresBlock({ locale = 'pt-BR', companyId }) {
  const { toast, promptForm } = useAppFeedback();
  const { units } = useOrgUnits(companyId);
  const [qDraft, setQDraft] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [state, setState] = useState({ items: [], total: 0, loading: true });
  const [summaryOf, setSummaryOf] = useState(null);

  useEffect(() => {
    const id = setTimeout(() => setQ(qDraft.trim()), 300);
    return () => clearTimeout(id);
  }, [qDraft]);
  useEffect(() => setPage(1), [q, status]);

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }));
    try {
      const params = new URLSearchParams({
        companyId: String(companyId),
        page: String(page),
        pageSize: String(PAGE_SIZE),
        ...(q ? { q } : {}),
        ...(status ? { status } : {}),
      });
      const res = await fetch(`/api/admin/time-clock/closures?${params}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || String(res.status));
      setState({ items: data.items || [], total: Number(data.total) || 0, loading: false });
    } catch (e) {
      toast(e?.message || t(locale, `${K}.loadError`), 'error');
      setState({ items: [], total: 0, loading: false });
    }
  }, [companyId, page, q, status, locale, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const startClosing = async () => {
    const today = localIsoToday();
    const firstThis = `${today.slice(0, 8)}01`;
    const lastPrev = shiftIsoDay(firstThis, -1);
    await promptForm({
      title: t(locale, `${K}.closeTitle`),
      message: t(locale, `${K}.closeMessage`),
      confirmLabel: t(locale, `${K}.closeConfirm`),
      fields: [
        {
          key: 'periodStart',
          row: 'period',
          type: 'date',
          label: t(locale, `${K}.from`),
          required: true,
          defaultValue: `${lastPrev.slice(0, 8)}01`,
        },
        {
          key: 'periodEnd',
          row: 'period',
          type: 'date',
          label: t(locale, `${K}.to`),
          required: true,
          defaultValue: lastPrev,
          validate: (v, all) => {
            if (!v) return null;
            if (all.periodStart && v < all.periodStart) return t(locale, `${K}.closeRangeInvalid`);
            if (v >= today) return t(locale, 'errors.TIME_CLOCK_CLOSURE_FUTURE');
            return null;
          },
        },
        {
          key: 'orgUnitId',
          type: 'select',
          label: t(locale, `${K}.closeFilter`),
          defaultValue: '',
          options: [
            { value: '', label: t(locale, `${K}.noFilter`) },
            ...orgUnitOptions(units).map((u) => ({ value: String(u.id), label: u.label })),
          ],
          help: t(locale, `${K}.closeFilterHelp`),
        },
        { key: 'note', type: 'textarea', label: t(locale, `${K}.closeNote`) },
      ],
      submit: async (values) => {
        const data = await sendJson('POST', {
          companyId,
          periodStart: values.periodStart,
          periodEnd: values.periodEnd,
          orgUnitId: values.orgUnitId ? Number(values.orgUnitId) : null,
          note: values.note || '',
        });
        if (data.pendingReviewCount > 0) {
          toast(t(locale, `${K}.closedWithPending`, { n: data.pendingReviewCount }), 'warning');
        } else {
          toast(t(locale, `${K}.closedOk`), 'ok');
        }
        setStatus('');
        setQDraft('');
        setPage(1);
        await load();
      },
    });
  };

  const cancelClosing = async (row) => {
    await promptForm({
      title: t(locale, `${K}.cancelTitle`, { n: row.id }),
      message: t(locale, `${K}.cancelMessage`, {
        from: dateBr(row.periodStart, locale),
        to: dateBr(row.periodEnd, locale),
      }),
      confirmLabel: t(locale, `${K}.cancelConfirm`),
      cancelLabel: t(locale, `${K}.cancelKeep`),
      fields: [
        {
          key: 'reason',
          type: 'textarea',
          label: t(locale, `${K}.reasonLabel`),
          required: true,
          validate: (v) => (String(v || '').trim().length >= 3 ? null : t(locale, `${K}.reasonShort`)),
        },
      ],
      submit: async (values) => {
        await sendJson('PATCH', { companyId, closureId: row.id, reason: String(values.reason).trim() });
        toast(t(locale, `${K}.cancelledOk`), 'ok');
        await load();
      },
    });
  };

  const dirty = Boolean(qDraft.trim() || status);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <p className={cn(S.muted, 'm-0 max-w-[62ch] text-prose')}>{t(locale, `${K}.closingIntro`)}</p>
        <button type="button" className={cn(S.btnPrimary, 'min-h-touch shrink-0')} onClick={() => void startClosing()}>
          {t(locale, `${K}.closeStart`)}
        </button>
      </div>

      <AdminListFilters
        aria-label={t(locale, `${K}.closingFilters`)}
        locale={locale}
        clearEnabled={dirty}
        onClear={() => {
          setQDraft('');
          setStatus('');
        }}
      >
        <AdminListSearch
          locale={locale}
          value={qDraft}
          onChange={setQDraft}
          placeholder={t(locale, `${K}.searchClosings`)}
        />
        <AdminListFilterSelect
          label={t(locale, `${K}.colStatus`)}
          value={status}
          onChange={setStatus}
        >
          <option value="">{t(locale, `${K}.statusAll`)}</option>
          {TIME_CLOCK_CLOSURE_STATUSES.map((s) => (
            <option key={s} value={s}>{t(locale, `${K}.status.${s}`)}</option>
          ))}
        </AdminListFilterSelect>
      </AdminListFilters>

      {state.loading && state.items.length === 0 ? (
        <AppLoading variant="panel" />
      ) : state.items.length === 0 ? (
        <EmptyState
          title={t(locale, dirty ? `${K}.closingEmptyFiltered` : `${K}.closingEmpty`)}
          message={t(locale, `${K}.closingEmptyHint`)}
        />
      ) : (
        <>
          <AdminTableShell
            locale={locale}
            minWidth="880px"
            animKey={`tc-closings|${page}|${q}|${status}|${state.total}`}
            ariaLabel={t(locale, `${K}.closingAria`)}
          >
            <thead>
              <tr>
                <AdminTh>{t(locale, `${K}.colNumber`)}</AdminTh>
                <AdminTh>{t(locale, `${K}.colPeriod`)}</AdminTh>
                <AdminTh>{t(locale, `${K}.colFilter`)}</AdminTh>
                <AdminTh>{t(locale, `${K}.colStatus`)}</AdminTh>
                <AdminTh>{t(locale, `${K}.colSignatures`)}</AdminTh>
                <AdminTh>{t(locale, `${K}.colDoneBy`)}</AdminTh>
                <AdminActionsTh>{t(locale, `${K}.colActions`)}</AdminActionsTh>
              </tr>
            </thead>
            <tbody>
              {state.items.map((row) => {
                const closed = row.status === TIME_CLOCK_CLOSURE_STATUS.CLOSED;
                return (
                  <tr key={row.id} className="border-b border-ink/8 align-top last:border-b-0">
                    <td className="px-4 py-2.5 font-mono tabular-nums text-ink">{row.id}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 font-mono tabular-nums text-ink">
                      {dateBr(row.periodStart, locale)}–{dateBr(row.periodEnd, locale)}
                    </td>
                    <td className="px-4 py-2.5 text-ink-muted">
                      {row.orgUnitPath || <span className={S.faint}>{t(locale, `${K}.noFilter`)}</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusToneChip tone={closed ? 'success' : 'danger'}>
                        {t(locale, `${K}.status.${row.status}`)}
                      </StatusToneChip>
                      {!closed && row.cancelReason ? (
                        <p className={cn(S.faint, 'm-0 mt-1 max-w-[16rem]')}>
                          {t(locale, `${K}.cancelledBy`, {
                            name: row.cancelledByName || '',
                            at: dateTimeBr(row.cancelledAt, locale),
                          })}
                          {': '}
                          {row.cancelReason}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5">
                      {row.acks?.total ? (
                        <>
                          <p className="m-0 font-mono text-sm tabular-nums text-ink">
                            {t(locale, `${K}.signaturesOf`, { signed: row.acks.signed, total: row.acks.total })}
                          </p>
                          {row.acks.disputed ? (
                            <p className="m-0 mt-0.5 font-mono text-2xs text-danger">
                              {t(locale, `${K}.disputedCount`, { n: row.acks.disputed })}
                            </p>
                          ) : null}
                        </>
                      ) : (
                        <span className={S.faint}>·</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <p className="m-0 font-ui text-sm text-ink">{row.closedByName || '·'}</p>
                      <p className={cn(S.faint, 'm-0')}>{dateTimeBr(row.closedAt, locale)}</p>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <AdminActionsCell>
                        <AdminIconButton
                          icon="list"
                          label={t(locale, `${K}.summaryAction`, { n: row.id })}
                          onClick={() => setSummaryOf(row)}
                        />
                        {closed ? (
                          <AdminIconButton
                            icon="x"
                            tint="danger"
                            label={t(locale, `${K}.cancelAction`, { n: row.id })}
                            onClick={() => void cancelClosing(row)}
                          />
                        ) : null}
                      </AdminActionsCell>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </AdminTableShell>
          <AdminListPager
            locale={locale}
            page={page}
            pageSize={PAGE_SIZE}
            total={state.total}
            loading={state.loading}
            onPageChange={setPage}
            pageSizeOptions={[PAGE_SIZE]}
          />
        </>
      )}

      {summaryOf ? (
        <TimeClockClosureSummaryDrawer
          locale={locale}
          companyId={companyId}
          closure={summaryOf}
          onClose={() => setSummaryOf(null)}
          onChanged={() => void load()}
        />
      ) : null}
    </div>
  );
}
