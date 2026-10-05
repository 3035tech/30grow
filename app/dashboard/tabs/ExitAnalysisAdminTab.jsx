'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAppFeedback } from '../../_components/AppFeedback';
import { EmptyState } from '../../_components/EmptyState';
import { AppLoading, ContentEnter } from '../../_components/AppLoading';
import { StatusToneChip } from '../../_components/StatusToneChip';
import { AdminListFilters, AdminListFilterSelect } from '../../_components/AdminListFilters';
import { AdminRecordViewDrawer, RECORD_FIELD_KIND } from '../../_components/AdminRecordViewDrawer';
import { dialogBtnGhostClass } from '../../_components/app-dialog-styles';
import { htmlToPlainText } from '../../../lib/sanitize-html';
import { EMPLOYMENT_STATUS, EXIT_REASONS, EXIT_TYPES } from '../../../lib/domain-status.js';
import { useRehireEmployee } from '../../_components/useRehireEmployee';
import { formatDisplayDate, toDateOnlyIso } from '../../../lib/format-display-date.js';
import { PAGE_SIZE_OPTIONS } from '../../../lib/assessment-filters';
import { cn } from '../../../lib/cn';
import { CHART_MIN_N, topCategoryCounts } from '../../../lib/chart-aggregates';
import { CategoryBars } from '../../_components/CategoryBars';
import { ChartPanel } from '../../_components/ChartPanel';
import {
  AdminActionsCell,
  AdminActionsTh,
  AdminCreateButton,
  AdminDeleteButton,
  AdminEditButton,
  AdminListPager,
  AdminListSearch,
  AdminPageHeader,
  AdminTableShell,
  AdminViewButton,
  S,
  SortableTh,
  clientSortNextDir,
} from '../dashboard-shared';
import { t as i18nT, contentLocale } from '../../../lib/i18n';

export function ExitAnalysisAdminTab({ locale = 'pt-BR', companyId, isAdmin }) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(() => Boolean(companyId));
  const [viewRecord, setViewRecord] = useState(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [sort, setSort] = useState('exitDate');
  const [sortDir, setSortDir] = useState('desc');
  const [nameQ, setNameQ] = useState('');
  const [exitTypeFilter, setExitTypeFilter] = useState('');
  const [exitReasonFilter, setExitReasonFilter] = useState('');
  const { promptForm, toast, confirm } = useAppFeedback();
  const { rehire, busyId: rehireBusyId } = useRehireEmployee({ locale, companyId });

  async function handleRehire(rec) {
    const ok = await rehire({
      candidateId: rec.candidateId,
      name: rec.candidateName,
      exitDate: rec.exitDate,
    });
    if (ok) loadRecords();
  }

  /** Tab already gated by USERS_MANAGE; allow write for hr/direction too. */
  const canWrite = Boolean(isAdmin) || Boolean(companyId);

  function companyQs(prefix = '?') {
    if (!companyId) return '';
    return `${prefix}companyId=${companyId}`;
  }

  function withCompanyBody(payload) {
    return companyId ? { ...payload, companyId } : payload;
  }

  function employeesSearchUrl() {
    return companyId
      ? `/api/admin/employees/search?companyId=${companyId}`
      : '/api/admin/employees/search';
  }

  function t(key, values = {}) {
    const path = `adminModules.exitAnalysis.${key}`;
    const out = i18nT(locale, path, values);
    return out === path ? key : out;
  }

  useEffect(() => {
    loadRecords();
  }, [companyId]);

  async function loadRecords() {
    if (!companyId) {
      setRecords([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/exit-analysis?limit=100${companyQs('&')}`);
      const data = await res.json();
      if (data.ok) setRecords(data.records || []);
      else toast(t('loadError'), 'error');
    } catch {
      toast(t('loadError'), 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleRegisterExit() {
    const today = (() => {
      const d = new Date();
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    })();

    const result = await promptForm({
      title: t('formTitle'),
      fields: [
        {
          name: 'candidateId',
          label: t('formCandidate'),
          type: 'entitySearch',
          required: true,
          searchUrl: employeesSearchUrl(),
          placeholder: t('formCandidatePh'),
          help: t('formCandidateHelp'),
          minChars: 1,
        },
        {
          name: 'exitDate',
          label: t('formExitDate'),
          type: 'date',
          required: true,
          defaultValue: today,
        },
        {
          name: 'exitType',
          label: t('formExitType'),
          type: 'select',
          required: true,
          defaultValue: 'voluntary',
          options: EXIT_TYPES.map((value) => ({ value, label: t(value) })),
        },
        {
          name: 'exitReason',
          label: t('formExitReason'),
          type: 'select',
          required: true,
          defaultValue: 'other',
          options: EXIT_REASONS.map((value) => ({ value, label: t(value) })),
        },
        {
          name: 'notes',
          label: t('formNotes'),
          type: 'richText',
          required: false,
          minHeight: 120,
        },
      ],
    });
    if (!result) return;

    const candidateId = Number(result.candidateId);
    if (!Number.isFinite(candidateId) || candidateId <= 0) {
      toast(t('pickEmployee'), 'warning');
      return;
    }

    try {
      const res = await fetch('/api/admin/exit-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          withCompanyBody({
            candidateId,
            exitDate: result.exitDate,
            exitType: result.exitType,
            exitReason: result.exitReason,
            notes: result.notes,
          })
        ),
      });
      const data = await res.json();
      if (data.ok) {
        toast(t('registered'), 'ok');
        loadRecords();
      } else {
        toast(data.error || t('saveError'), 'error');
      }
    } catch {
      toast(t('saveError'), 'error');
    }
  }

  async function handleEdit(rec) {
    const result = await promptForm({
      title: t('formEditTitle'),
      fields: [
        {
          name: 'exitDate',
          label: t('formExitDate'),
          type: 'date',
          required: true,
          defaultValue: toDateOnlyIso(rec.exitDate) || '',
        },
        {
          name: 'exitType',
          label: t('formExitType'),
          type: 'select',
          required: true,
          defaultValue: rec.exitType || 'voluntary',
          options: EXIT_TYPES.map((value) => ({ value, label: t(value) })),
        },
        {
          name: 'exitReason',
          label: t('formExitReason'),
          type: 'select',
          required: true,
          defaultValue: rec.exitReason || 'other',
          options: EXIT_REASONS.map((value) => ({ value, label: t(value) })),
        },
        {
          name: 'notes',
          label: t('formNotes'),
          type: 'richText',
          required: false,
          minHeight: 120,
          defaultValue: rec.notes || '',
        },
      ],
    });
    if (!result) return;

    try {
      const res = await fetch(`/api/admin/exit-analysis/${rec.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          withCompanyBody({
            exitDate: result.exitDate,
            exitType: result.exitType,
            exitReason: result.exitReason,
            notes: result.notes,
          })
        ),
      });
      const data = await res.json();
      if (data.ok) {
        toast(t('updated'), 'ok');
        setViewRecord(null);
        loadRecords();
      } else {
        toast(data.error || t('updateError'), 'error');
      }
    } catch {
      toast(t('updateError'), 'error');
    }
  }

  async function handleDelete(rec) {
    const ok = await confirm({
      message: t('confirmDelete'),
      danger: true,
      confirmLabel: t('delete'),
    });
    if (!ok) return;

    try {
      const res = await fetch(`/api/admin/exit-analysis/${rec.id}${companyQs('?')}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (data.ok) {
        toast(t('deleted'), 'ok');
        setViewRecord((cur) => (cur?.id === rec.id ? null : cur));
        loadRecords();
      } else {
        toast(data.error || t('deleteError'), 'error');
      }
    } catch {
      toast(t('deleteError'), 'error');
    }
  }

  function formatDate(dateStr) {
    return formatDisplayDate(dateStr, locale, { fallback: '-' });
  }

  const sortedRecords = useMemo(() => {
    const dirMul = sortDir === 'asc' ? 1 : -1;
    const q = String(nameQ || '').trim().toLowerCase();
    const rows = [...records].filter((row) => {
      if (exitTypeFilter && row.exitType !== exitTypeFilter) return false;
      if (exitReasonFilter && row.exitReason !== exitReasonFilter) return false;
      if (!q) return true;
      return String(row.candidateName || '').toLowerCase().includes(q);
    });
    rows.sort((a, b) => {
      const av = a?.[sort];
      const bv = b?.[sort];
      if (sort === 'exitDate') {
        const as = toDateOnlyIso(av) || '';
        const bs = toDateOnlyIso(bv) || '';
        return as.localeCompare(bs) * dirMul;
      }
      return String(av || '').localeCompare(String(bv || ''), contentLocale(locale)) * dirMul;
    });
    return rows;
  }, [records, sort, sortDir, locale, nameQ, exitTypeFilter, exitReasonFilter]);

  const reasonBars = useMemo(() => {
    const counted = records.map((r) => ({ exitReason: r.exitReason, count: 1 }));
    return topCategoryCounts(counted, { key: 'exitReason', limit: 5 }).map((r) => ({
      id: r.id,
      label: t(r.id),
      value: r.value,
      toneClass: 'rounded-full bg-warning',
    }));
  }, [records, locale]);

  const total = sortedRecords.length;
  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  const safePage = Math.min(page, totalPages);
  const pageRows = sortedRecords.slice((safePage - 1) * pageSize, safePage * pageSize);

  const toggleSort = (columnKey) => {
    const nextDir = clientSortNextDir(columnKey, sort, sortDir);
    setSort(columnKey);
    setSortDir(nextDir);
    setPage(1);
  };

  if (!companyId) {
    return (
      <ContentEnter>
        <EmptyState title={t('needCompanyTitle')} message={t('needCompanyHint')} />
      </ContentEnter>
    );
  }

  if (loading) return <AppLoading variant="panel" />;

  return (
    <ContentEnter>
    <div className="flex flex-col gap-6">
      <AdminPageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          canWrite ? (
            <AdminCreateButton label={t('register')} onClick={handleRegisterExit} />
          ) : null
        }
      />

      {records.length >= CHART_MIN_N && reasonBars.length > 0 ? (
        <ChartPanel title={t('reasonsTitle')} hint={t('reasonsHint')}>
          <CategoryBars items={reasonBars} height={8} total={records.length} />
        </ChartPanel>
      ) : null}

      {records.length > 0 ? (
        <AdminListFilters
          aria-label={t('title')}
          locale={locale}
          onClear={() => {
            setNameQ('');
            setExitTypeFilter('');
            setExitReasonFilter('');
            setPage(1);
          }}
          clearEnabled={Boolean(
            String(nameQ || '').trim() || exitTypeFilter || exitReasonFilter
          )}
        >
          <AdminListSearch
            locale={locale}
            value={nameQ}
            onChange={(v) => {
              setNameQ(v);
              setPage(1);
            }}
            placeholder={t('searchNamePh')}
          />
          <AdminListFilterSelect
            label={t('exitType')}
            value={exitTypeFilter}
            onChange={(v) => {
              setExitTypeFilter(v);
              setPage(1);
            }}
          >
            <option value="">{t('filterAll')}</option>
            {EXIT_TYPES.map((value) => (
              <option key={value} value={value}>
                {t(value)}
              </option>
            ))}
          </AdminListFilterSelect>
          <AdminListFilterSelect
            label={t('exitReason')}
            value={exitReasonFilter}
            onChange={(v) => {
              setExitReasonFilter(v);
              setPage(1);
            }}
          >
            <option value="">{t('filterAll')}</option>
            {EXIT_REASONS.map((value) => (
              <option key={value} value={value}>
                {t(value)}
              </option>
            ))}
          </AdminListFilterSelect>
        </AdminListFilters>
      ) : null}

      {records.length === 0 ? (
        <div className="flex flex-col gap-3">
          <EmptyState
            title={t('noRecords')}
            message={t('noRecordsDesc')}
            actionLabel={canWrite ? t('register') : undefined}
            onAction={canWrite ? handleRegisterExit : undefined}
          />
          <div className="flex flex-wrap gap-3 px-1">
            <Link href="/dashboard?tab=company-benefits" className="font-mono text-xs text-brand-600 hover:underline">
              {t('ctaBenefits')} →
            </Link>
            <Link href="/dashboard?tab=team" className="font-mono text-xs text-brand-600 hover:underline">
              {t('ctaTeam')} →
            </Link>
          </div>
        </div>
      ) : (
        <>
          <AdminTableShell locale={locale} minWidth="640px" animKey={`${nameQ}|${exitTypeFilter}|${exitReasonFilter}|${safePage}|${pageSize}`}>
            <thead className="border-b border-ink/10 bg-canvas-alt">
              <tr>
                <SortableTh columnKey="exitDate" sortKey={sort} dir={sortDir} onSort={toggleSort}>
                  {t('exitDate')}
                </SortableTh>
                <SortableTh columnKey="candidateName" sortKey={sort} dir={sortDir} onSort={toggleSort}>
                  {t('candidateName')}
                </SortableTh>
                <SortableTh columnKey="exitType" sortKey={sort} dir={sortDir} onSort={toggleSort}>
                  {t('exitType')}
                </SortableTh>
                <SortableTh columnKey="exitReason" sortKey={sort} dir={sortDir} onSort={toggleSort}>
                  {t('exitReason')}
                </SortableTh>
                <AdminActionsTh>{t('actions')}</AdminActionsTh>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/5">
              {pageRows.map((rec) => (
                <tr key={rec.id} className="hover:bg-canvas-alt/50">
                  <td className="px-4 py-3 text-sm text-ink">{formatDate(rec.exitDate)}</td>
                  <td className="px-4 py-3 text-sm text-ink">
                    {rec.candidateId ? (
                      <Link
                        href={`/dashboard?tab=team&candidate=${rec.candidateId}`}
                        className="text-brand-600 hover:underline"
                        title={t('openPerson')}
                      >
                        {rec.candidateName}
                      </Link>
                    ) : (
                      rec.candidateName
                    )}
                    {rec.rehiredAt ? (
                      <div className="mt-1">
                        <StatusToneChip tone="success">
                          {i18nT(locale, 'panel.rehire.rehiredOn', { date: formatDate(rec.rehiredAt) })}
                        </StatusToneChip>
                      </div>
                    ) : null}
                    {rec.exitReason === 'benefits' || rec.exitReason === 'compensation' ? (
                      <div className="mt-1">
                        <Link
                          href="/dashboard?tab=company-benefits"
                          className="font-mono text-2xs text-brand-600 hover:underline"
                        >
                          {t('ctaBenefits')}
                        </Link>
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <StatusToneChip
                      tone={
                        rec.exitType === 'voluntary'
                          ? 'info'
                          : rec.exitType === 'involuntary'
                            ? 'danger'
                            : 'warning'
                      }
                      bordered={false}
                      className="rounded px-2 py-0.5 font-ui text-xs font-medium"
                    >
                      {t(rec.exitType)}
                    </StatusToneChip>
                  </td>
                  <td className="px-4 py-3 text-sm text-ink-muted">{t(rec.exitReason)}</td>
                  <td className="px-4 py-3 text-right">
                    <AdminActionsCell>
                      <AdminViewButton label={t('view')} onClick={() => setViewRecord(rec)} />
                      {canWrite ? (
                        <>
                          {!rec.rehiredAt && rec.employmentStatus === EMPLOYMENT_STATUS.ALUMNI ? (
                            <AdminViewButton
                              icon="refresh"
                              label={i18nT(locale, 'panel.rehire.action')}
                              disabled={rehireBusyId === rec.candidateId}
                              onClick={() => handleRehire(rec)}
                            />
                          ) : null}
                          <AdminEditButton label={t('edit')} onClick={() => handleEdit(rec)} />
                          <AdminDeleteButton label={t('delete')} onClick={() => handleDelete(rec)} />
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
            page={safePage}
            pageSize={pageSize}
            total={total}
            loading={loading}
            pageSizeOptions={PAGE_SIZE_OPTIONS}
            onPageChange={setPage}
            onPageSizeChange={(ps) => {
              setPageSize(ps);
              setPage(1);
            }}
          />
        </>
      )}

      <AdminRecordViewDrawer
        open={Boolean(viewRecord)}
        title={viewRecord?.candidateName || t('viewTitle')}
        locale={locale}
        onClose={() => setViewRecord(null)}
        onEdit={canWrite && viewRecord ? () => handleEdit(viewRecord) : null}
        editLabel={t('edit')}
        headerMeta={viewRecord?.candidateEmail ? <span>{viewRecord.candidateEmail}</span> : null}
        secondaryActions={
          canWrite && viewRecord ? (
            <button
              type="button"
              onClick={() => handleDelete(viewRecord)}
              className={cn(dialogBtnGhostClass, 'border-danger/30 text-danger')}
            >
              {t('delete')}
            </button>
          ) : null
        }
        sections={
          viewRecord
            ? [
                {
                  key: 'exit',
                  fields: [
                    { key: 'exitDate', label: t('exitDate'), value: viewRecord.exitDate ? formatDate(viewRecord.exitDate) : '' },
                    { key: 'exitType', label: t('exitType'), value: viewRecord.exitType ? t(viewRecord.exitType) : '' },
                    { key: 'exitReason', label: t('exitReason'), value: viewRecord.exitReason ? t(viewRecord.exitReason) : '', full: true },
                    {
                      key: 'notes',
                      label: t('notes'),
                      value: htmlToPlainText(viewRecord.notes || '') ? viewRecord.notes : '',
                      kind: RECORD_FIELD_KIND.HTML,
                      emptyText: t('noNotes'),
                    },
                  ],
                },
              ]
            : []
        }
      />
    </div>
    </ContentEnter>
  );
}
