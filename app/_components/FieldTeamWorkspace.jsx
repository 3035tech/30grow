'use client';

import { useCallback, useEffect, useState } from 'react';
import { t } from '../../lib/i18n';
import { cn } from '../../lib/cn';
import { PAGE_SIZE_OPTIONS } from '../../lib/assessment-filters';
import { FIELD_EXPENSE_STATUS, FIELD_EXPENSE_STATUSES, FIELD_VISIT_STATUS, TIME_REQUEST_DECISION } from '../../lib/domain-status.js';
import { formatDisplayDate } from '../../lib/format-display-date';
import {
  AdminActionsCell,
  AdminActionsTh,
  AdminCreateButton,
  AdminIconButton,
  AdminListPager,
  AdminListSearch,
  AdminTableShell,
  AdminTh,
  S,
} from '../dashboard/dashboard-shared';
import { AdminListFilters, AdminListFilterSelect } from './AdminListFilters';
import { AppLoading, ContentEnter } from './AppLoading';
import { useAppFeedback } from './AppFeedback';
import { DateField } from './DateField';
import { EmptyState } from './EmptyState';
import { FormField } from './FormField';
import { SegmentedControl } from './SegmentedControl';
import { StatusToneChip } from './StatusToneChip';
import { osmLink } from './PunchLocationMap';
import {
  fieldCategoryLabel,
  fieldExpenseStatusLabel,
  fieldExpenseTone,
  fieldVisitStatusLabel,
  fieldVisitTone,
  formatCents,
  formatClock,
} from './field-team-ui';

const linkClass = 'text-brand-600 underline-offset-2 hover:underline dark:text-brand-300';
const td = 'px-3 py-2.5 align-middle';

function isoToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** DP "Field" workspace: reimbursement queue (approve/reject) and the team's visits of a day. */
export function FieldTeamWorkspace({ locale = 'pt-BR', companyId, onChanged = null }) {
  const { promptForm, toast } = useAppFeedback();
  const [view, setView] = useState('expenses');

  return (
    <div className="flex flex-col gap-4">
      <SegmentedControl
        aria-label={t(locale, 'panel.field.viewsAria')}
        value={view}
        onChange={setView}
        options={[
          { id: 'expenses', label: t(locale, 'panel.field.viewExpenses') },
          { id: 'visits', label: t(locale, 'panel.field.viewVisits') },
        ]}
      />
      {view === 'expenses' ? (
        <FieldExpensesQueue locale={locale} companyId={companyId} promptForm={promptForm} toast={toast} onChanged={onChanged} />
      ) : (
        <FieldVisitsDay locale={locale} companyId={companyId} promptForm={promptForm} toast={toast} />
      )}
    </div>
  );
}

function FieldExpensesQueue({ locale, companyId, promptForm, toast, onChanged }) {
  const [status, setStatus] = useState(FIELD_EXPENSE_STATUS.PENDING);
  const [qDraft, setQDraft] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [data, setData] = useState({ items: [], total: 0, sumCents: 0 });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ companyId: String(companyId), status, page: String(page), pageSize: String(pageSize) });
      if (q) params.set('q', q);
      const res = await fetch(`/api/admin/field/expenses?${params}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || 'load');
      setData({ items: json.items || [], total: Number(json.total) || 0, sumCents: Number(json.sumCents) || 0 });
    } catch (e) {
      toast(e?.message || t(locale, 'panel.field.loadError'), 'error');
      setData({ items: [], total: 0, sumCents: 0 });
    } finally {
      setLoading(false);
    }
  }, [companyId, status, page, pageSize, q, locale, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (row, decision) => {
    const approve = decision === TIME_REQUEST_DECISION.APPROVE;
    const values = await promptForm({
      title: t(locale, approve ? 'panel.field.approveTitle' : 'panel.field.rejectTitle'),
      message: t(locale, 'panel.field.decideMessage', {
        name: row.candidateName || '—',
        amount: formatCents(locale, row.amountCents, row.currency),
        category: fieldCategoryLabel(locale, row.category),
      }),
      confirmLabel: t(locale, approve ? 'panel.field.approve' : 'panel.field.reject'),
      fields: [{
        key: 'note',
        type: 'textarea',
        rows: 2,
        maxLength: 500,
        required: !approve,
        label: t(locale, 'panel.field.decisionNoteLabel'),
        help: t(locale, approve ? 'panel.field.decisionNoteHelpApprove' : 'panel.field.decisionNoteHelpReject'),
      }],
      submit: async (v) => {
        const res = await fetch(`/api/admin/field/expenses/${row.id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ companyId, decision, note: v.note || '' }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error || 'decide');
      },
    });
    if (!values) return;
    toast(t(locale, approve ? 'panel.field.approvedOk' : 'panel.field.rejectedOk'), 'ok');
    onChanged?.();
    void load();
  };

  const filtersDirty = Boolean(q) || status !== FIELD_EXPENSE_STATUS.PENDING;
  const animKey = `field-exp|${status}|${q}|${page}|${pageSize}`;

  return (
    <>
      <AdminListFilters
        aria-label={t(locale, 'panel.field.viewExpenses')}
        locale={locale}
        onClear={() => {
          setQDraft('');
          setQ('');
          setStatus(FIELD_EXPENSE_STATUS.PENDING);
          setPage(1);
        }}
        clearEnabled={filtersDirty}
      >
        <AdminListSearch
          locale={locale}
          value={qDraft}
          onChange={setQDraft}
          onSubmit={(v) => {
            setQ(String(v || '').trim());
            setPage(1);
          }}
          placeholder={t(locale, 'panel.field.searchPh')}
          className="min-w-[200px] flex-1 items-end self-end"
          inputClassName="w-full max-w-none"
        />
        <AdminListFilterSelect
          label={t(locale, 'panel.field.filterStatus')}
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
        >
          <option value="all">{t(locale, 'panel.field.statusAll')}</option>
          {FIELD_EXPENSE_STATUSES.map((s) => (
            <option key={s} value={s}>{fieldExpenseStatusLabel(locale, s)}</option>
          ))}
        </AdminListFilterSelect>
      </AdminListFilters>

      {loading ? (
        <AppLoading locale={locale} variant="panel" />
      ) : data.items.length === 0 ? (
        <ContentEnter animKey={`${animKey}|empty`}>
          <EmptyState title={t(locale, 'panel.field.queueEmptyTitle')} message={t(locale, 'panel.field.queueEmptyHint')} />
        </ContentEnter>
      ) : (
        <ContentEnter animKey={animKey}>
          <p className={cn(S.muted, 'm-0 mb-2 text-prose')}>
            {t(locale, 'panel.field.queueSummary', { count: data.total, amount: formatCents(locale, data.sumCents) })}
          </p>
          <AdminTableShell locale={locale} minWidth="760px">
            <thead>
              <tr className="border-b border-ink/10">
                <AdminTh>{t(locale, 'panel.field.colPerson')}</AdminTh>
                <AdminTh>{t(locale, 'panel.field.colExpense')}</AdminTh>
                <AdminTh>{t(locale, 'panel.field.colAmount')}</AdminTh>
                <AdminTh>{t(locale, 'panel.field.colReceipt')}</AdminTh>
                <AdminTh>{t(locale, 'panel.field.colStatus')}</AdminTh>
                <AdminActionsTh>{t(locale, 'panel.field.colActions')}</AdminActionsTh>
              </tr>
            </thead>
            <tbody>
              {data.items.map((row) => (
                <tr key={row.id} className="border-b border-ink/[0.06] last:border-0">
                  <td className={td}>
                    <div className="font-ui text-sm text-ink">{row.candidateName || '—'}</div>
                    <div className="font-mono text-2xs text-ink-muted">{formatDisplayDate(row.day, locale)}</div>
                  </td>
                  <td className={cn(td, 'max-w-[280px]')}>
                    <div className="font-ui text-sm text-ink">{fieldCategoryLabel(locale, row.category)}</div>
                    <div className="truncate text-xs text-ink-muted" title={row.description}>
                      {row.visitTitle ? `${row.visitTitle} · ` : ''}{row.description}
                    </div>
                  </td>
                  <td className={cn(td, 'whitespace-nowrap font-mono text-sm tabular-nums text-ink')}>
                    {formatCents(locale, row.amountCents, row.currency)}
                  </td>
                  <td className={cn(td, 'text-prose')}>
                    {row.hasReceipt ? (
                      <a href={`/api/admin/field/expenses/${row.id}/receipt?companyId=${companyId}`} target="_blank" rel="noopener noreferrer" className={linkClass}>
                        {t(locale, 'panel.field.viewReceipt')}
                      </a>
                    ) : (
                      <span className="text-warning">{t(locale, 'panel.field.receiptMissing')}</span>
                    )}
                  </td>
                  <td className={cn(td, 'whitespace-nowrap')}>
                    <StatusToneChip tone={fieldExpenseTone(row.status)}>{fieldExpenseStatusLabel(locale, row.status)}</StatusToneChip>
                  </td>
                  <td className={cn(td, 'text-right')}>
                    <AdminActionsCell>
                      {row.status === FIELD_EXPENSE_STATUS.PENDING ? (
                        <>
                          <AdminIconButton icon="check" label={t(locale, 'panel.field.approve')} onClick={() => void decide(row, TIME_REQUEST_DECISION.APPROVE)} />
                          <AdminIconButton icon="x" label={t(locale, 'panel.field.reject')} onClick={() => void decide(row, TIME_REQUEST_DECISION.REJECT)} />
                        </>
                      ) : null}
                    </AdminActionsCell>
                  </td>
                </tr>
              ))}
            </tbody>
          </AdminTableShell>
          <AdminListPager
            locale={locale}
            page={page}
            pageSize={pageSize}
            total={data.total}
            pageSizeOptions={PAGE_SIZE_OPTIONS}
            onPageChange={setPage}
            onPageSizeChange={(n) => {
              setPageSize(n);
              setPage(1);
            }}
          />
        </ContentEnter>
      )}
    </>
  );
}

function FieldVisitsDay({ locale, companyId, promptForm, toast }) {
  const { confirm } = useAppFeedback();
  const [day, setDay] = useState(isoToday);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [data, setData] = useState({ items: [], total: 0 });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ companyId: String(companyId), day, page: String(page), pageSize: String(pageSize) });
      const res = await fetch(`/api/admin/field/visits?${params}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || 'load');
      setData({ items: json.items || [], total: Number(json.total) || 0 });
    } catch (e) {
      toast(e?.message || t(locale, 'panel.field.loadError'), 'error');
      setData({ items: [], total: 0 });
    } finally {
      setLoading(false);
    }
  }, [companyId, day, page, pageSize, locale, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const plan = async () => {
    const values = await promptForm({
      title: t(locale, 'panel.field.planVisit'),
      message: t(locale, 'panel.field.planVisitHint'),
      confirmLabel: t(locale, 'panel.field.save'),
      size: 'wide',
      fields: [
        {
          key: 'candidateId',
          label: t(locale, 'panel.field.colPerson'),
          type: 'entitySearch',
          required: true,
          searchUrl: `/api/admin/employees/search?companyId=${encodeURIComponent(companyId)}`,
          placeholder: t(locale, 'panel.dp.personSearchPh'),
          minChars: 1,
        },
        { key: 'day', type: 'date', label: t(locale, 'panel.field.visitDayLabel'), defaultValue: day, required: true, row: 'when' },
        { key: 'plannedTime', label: t(locale, 'panel.field.visitTimeLabel'), placeholder: '14:30', row: 'when' },
        { key: 'title', label: t(locale, 'panel.field.visitTitleLabel'), required: true, maxLength: 200, row: 'where', rowWeight: 1 },
        { key: 'address', label: t(locale, 'panel.field.visitAddressLabel'), maxLength: 300, row: 'where', rowWeight: 1.4 },
        { key: 'notes', type: 'textarea', rows: 2, maxLength: 1000, label: t(locale, 'panel.field.visitNotesLabel') },
      ],
      submit: async (v) => {
        const res = await fetch('/api/admin/field/visits', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            companyId,
            candidateId: Number(v.candidateId),
            day: v.day,
            plannedTime: v.plannedTime || '',
            title: v.title,
            address: v.address || '',
            notes: v.notes || '',
          }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error || 'plan');
      },
    });
    if (!values) return;
    toast(t(locale, 'panel.field.plannedOk'), 'ok');
    if (values.day !== day) setDay(values.day);
    else void load();
  };

  const cancel = async (row) => {
    const ok = await confirm({
      title: t(locale, 'panel.field.cancelVisit'),
      message: t(locale, 'panel.field.cancelVisitConfirm', { title: row.title, name: row.candidateName || '—' }),
      confirmLabel: t(locale, 'panel.field.cancelVisit'),
      danger: true,
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/admin/field/visits/${row.id}?companyId=${companyId}`, { method: 'DELETE' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || 'cancel');
      toast(t(locale, 'panel.field.visitCancelled'), 'ok');
      void load();
    } catch (e) {
      toast(e?.message || t(locale, 'panel.common.error'), 'error');
    }
  };

  const animKey = `field-visits|${day}|${page}|${pageSize}`;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <FormField label={t(locale, 'panel.field.visitDayLabel')} className="w-full max-w-[14rem]">
          <DateField
            value={day}
            onChange={(e) => {
              setDay(e.target.value || isoToday());
              setPage(1);
            }}
            locale={locale}
            aria-label={t(locale, 'panel.field.visitDayLabel')}
          />
        </FormField>
        <AdminCreateButton label={t(locale, 'panel.field.planVisit')} onClick={() => void plan()} />
      </div>

      {loading ? (
        <AppLoading locale={locale} variant="panel" />
      ) : data.items.length === 0 ? (
        <ContentEnter animKey={`${animKey}|empty`}>
          <EmptyState
            title={t(locale, 'panel.field.visitsEmptyTitle')}
            message={t(locale, 'panel.field.visitsEmptyHint')}
            actionLabel={t(locale, 'panel.field.planVisit')}
            onAction={() => void plan()}
          />
        </ContentEnter>
      ) : (
        <ContentEnter animKey={animKey}>
          <AdminTableShell locale={locale} minWidth="720px">
            <thead>
              <tr className="border-b border-ink/10">
                <AdminTh>{t(locale, 'panel.field.colPerson')}</AdminTh>
                <AdminTh>{t(locale, 'panel.field.colVisit')}</AdminTh>
                <AdminTh>{t(locale, 'panel.field.colCheckin')}</AdminTh>
                <AdminTh>{t(locale, 'panel.field.colStatus')}</AdminTh>
                <AdminActionsTh>{t(locale, 'panel.field.colActions')}</AdminActionsTh>
              </tr>
            </thead>
            <tbody>
              {data.items.map((row) => (
                <tr key={row.id} className="border-b border-ink/[0.06] last:border-0">
                  <td className={cn(td, 'font-ui text-sm text-ink')}>{row.candidateName || '—'}</td>
                  <td className={cn(td, 'max-w-[300px]')}>
                    <div className="font-ui text-sm text-ink">
                      {row.plannedTime ? <span className="mr-2 font-mono text-2xs text-ink-muted">{row.plannedTime}</span> : null}
                      {row.title}
                    </div>
                    {row.address ? <div className="truncate text-xs text-ink-muted" title={row.address}>{row.address}</div> : null}
                    {row.outcomeNote ? <div className="truncate text-xs text-ink-muted" title={row.outcomeNote}>{row.outcomeNote}</div> : null}
                  </td>
                  <td className={cn(td, 'text-prose')}>
                    {row.checkinAt ? (
                      <span className="font-mono text-2xs text-ink-muted">
                        {formatClock(row.checkinAt, locale)}
                        {row.latitude != null ? (
                          <>
                            {' · '}
                            <a href={osmLink(row.latitude, row.longitude)} target="_blank" rel="noopener noreferrer" className={linkClass}>
                              {t(locale, 'panel.field.openMap')}
                            </a>
                          </>
                        ) : null}
                        {row.hasPhoto ? (
                          <>
                            {' · '}
                            <a href={`/api/admin/field/visits/${row.id}/photo?companyId=${companyId}`} target="_blank" rel="noopener noreferrer" className={linkClass}>
                              {t(locale, 'panel.field.viewPhoto')}
                            </a>
                          </>
                        ) : null}
                      </span>
                    ) : (
                      <span className="text-ink-faint">—</span>
                    )}
                  </td>
                  <td className={cn(td, 'whitespace-nowrap')}>
                    <StatusToneChip tone={fieldVisitTone(row.status)}>{fieldVisitStatusLabel(locale, row.status)}</StatusToneChip>
                  </td>
                  <td className={cn(td, 'text-right')}>
                    <AdminActionsCell>
                      {row.status === FIELD_VISIT_STATUS.PLANNED ? (
                        <AdminIconButton icon="x" label={t(locale, 'panel.field.cancelVisit')} onClick={() => void cancel(row)} />
                      ) : null}
                    </AdminActionsCell>
                  </td>
                </tr>
              ))}
            </tbody>
          </AdminTableShell>
          <AdminListPager
            locale={locale}
            page={page}
            pageSize={pageSize}
            total={data.total}
            pageSizeOptions={PAGE_SIZE_OPTIONS}
            onPageChange={setPage}
            onPageSizeChange={(n) => {
              setPageSize(n);
              setPage(1);
            }}
          />
        </ContentEnter>
      )}
    </>
  );
}
