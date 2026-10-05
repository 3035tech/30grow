'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { t, localeHtmlLang } from '../../../lib/i18n';
import { PAGE_SIZE_OPTIONS } from '../../../lib/assessment-filters';
import {
  DP_LEAVE_STATUS,
  DP_LEAVE_STATUSES,
  DP_LEAVE_TYPE,
  DP_LEAVE_TYPES,
} from '../../../lib/domain-status.js';
import { expandLeaveCalendarByDay } from '../../../lib/leave-days.js';
import { htmlToPlainText } from '../../../lib/sanitize-html.js';
import { cn } from '../../../lib/cn';
import {
  AdminActionsCell,
  AdminActionsTh,
  AdminCreateButton,
  AdminEditButton,
  AdminIconButton,
  AdminListPager,
  AdminListSearch,
  AdminPageHeader,
  PanelSubNav,
  AdminTableShell,
  AdminTh,
  S,
} from '../dashboard-shared';
import { EmptyState } from '../../_components/EmptyState';
import { AppLoading, ContentEnter } from '../../_components/AppLoading';
import { AdminListFilters, AdminListFilterSelect } from '../../_components/AdminListFilters';
import { CollapsibleBlock } from '../../_components/CollapsibleBlock';
import { StatusToneChip } from '../../_components/StatusToneChip';
import { useAppFeedback } from '../../_components/AppFeedback';
import { TimeClockWorkspace } from '../../_components/TimeClockWorkspace';
import { VacationPoolBlock } from '../../_components/VacationPoolBlock';
import { PreOnboardingTemplateBlock } from '../../_components/PreOnboardingTemplateBlock';
import { StatMetricTile } from '../../_components/StatMetricTile';

function formatDate(value, locale) {
  if (!value) return '—';
  const raw = String(value).slice(0, 10);
  const [y, m, d] = raw.split('-').map(Number);
  if (!y || !m || !d) return raw;
  return new Date(y, m - 1, d).toLocaleDateString(localeHtmlLang(locale), {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function leaveTypeLabel(locale, type) {
  const key = `panel.dp.leaveType.${type}`;
  const label = t(locale, key);
  return label === key ? type : label;
}

function leaveStatusLabel(locale, status) {
  const key = `panel.dp.leaveStatus.${status}`;
  const label = t(locale, key);
  return label === key ? status : label;
}

function leaveStatusTone(status) {
  if (status === DP_LEAVE_STATUS.APPROVED || status === DP_LEAVE_STATUS.TAKEN) return 'success';
  if (status === DP_LEAVE_STATUS.REJECTED) return 'danger';
  if (status === DP_LEAVE_STATUS.CANCELLED) return 'neutral';
  return 'warning';
}

function isoToday() {
  return new Date().toISOString().slice(0, 10);
}

function isoPlusDays(days) {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
}

/**
 * Company leave inbox + simple 60-day calendar list (DP leve).
 */
const DP_SECTIONS = ['pending', 'leaves', 'documents', 'time', 'onboarding'];

export function DpAdminTab({ locale = 'pt-BR', companyId, navigateDashboard, initialSection = '', initialTimeView = '' }) {
  const { promptForm, toast } = useAppFeedback();
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(() => Boolean(companyId));
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [statusFilter, setStatusFilter] = useState('all');
  const [leaveTypeFilter, setLeaveTypeFilter] = useState('all');
  const [qDraft, setQDraft] = useState('');
  const [q, setQ] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  const [calendarItems, setCalendarItems] = useState([]);
  const [calendarByDay, setCalendarByDay] = useState([]);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [requestedCount, setRequestedCount] = useState(0);
  const [pendingDocsPeople, setPendingDocsPeople] = useState(0);
  const [pendingDocsList, setPendingDocsList] = useState([]);
  const [absenteeismPeople, setAbsenteeismPeople] = useState(0);
  const [firstAbsenteeismCandidateId, setFirstAbsenteeismCandidateId] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [workspaceSection, setWorkspaceSection] = useState(() => (DP_SECTIONS.includes(initialSection) ? initialSection : 'pending'));
  const [timeView, setTimeView] = useState(initialTimeView || '');
  const [pendingTimeRequests, setPendingTimeRequests] = useState(0);

  const load = useCallback(async () => {
    if (!companyId) {
      setItems([]);
      setTotal(0);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams({
        companyId: String(companyId),
        page: String(page),
        pageSize: String(pageSize),
        status: statusFilter,
        leaveType: leaveTypeFilter,
      });
      if (q) params.set('q', q);
      const res = await fetch(`/api/admin/dp/leave?${params}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'load');
      setItems(Array.isArray(data.items) ? data.items : []);
      setTotal(typeof data.total === 'number' ? data.total : 0);
      if (typeof data.page === 'number' && data.page !== page) setPage(data.page);
    } catch (e) {
      toast(e?.message || t(locale, 'panel.dp.loadError'), 'error');
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [companyId, page, pageSize, statusFilter, leaveTypeFilter, q, locale, toast]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  const loadAttention = useCallback(async () => {
    if (!companyId) {
      setRequestedCount(0);
      setPendingDocsPeople(0);
      setPendingDocsList([]);
      setAbsenteeismPeople(0);
      setFirstAbsenteeismCandidateId(null);
      setPendingTimeRequests(0);
      return;
    }
    try {
      const params = new URLSearchParams({ companyId: String(companyId) });
      const res = await fetch(`/api/admin/dp/attention?${params}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return;
      setRequestedCount(Number(data.requestedLeaves) || 0);
      setPendingDocsPeople(Number(data.pendingDocsPeople) || 0);
      const docs = Array.isArray(data.pendingDocs) ? data.pendingDocs : [];
      setPendingDocsList(docs);
      setAbsenteeismPeople(Number(data.absenteeismPeople) || 0);
      setPendingTimeRequests(Number(data.pendingTimeRequests) || 0);
      const firstAbs = Array.isArray(data.absenteeism) ? data.absenteeism[0] : null;
      setFirstAbsenteeismCandidateId(
        firstAbs?.candidateId != null ? Number(firstAbs.candidateId) : null
      );
    } catch {
      /* non-blocking */
    }
  }, [companyId]);

  useEffect(() => {
    void loadAttention();
  }, [loadAttention, reloadKey]);

  const loadCalendar = useCallback(async () => {
    if (!companyId) {
      setCalendarItems([]);
      setCalendarByDay([]);
      return;
    }
    setCalendarLoading(true);
    try {
      const from = isoToday();
      const to = isoPlusDays(60);
      const params = new URLSearchParams({
        companyId: String(companyId),
        mode: 'calendar',
        from,
        to,
      });
      const res = await fetch(`/api/admin/dp/leave?${params}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'load');
      const items = Array.isArray(data.items) ? data.items : [];
      setCalendarItems(items);
      setCalendarByDay(
        Array.isArray(data.byDay) && data.byDay.length
          ? data.byDay
          : expandLeaveCalendarByDay(items, from, to)
      );
    } catch (e) {
      toast(e?.message || t(locale, 'panel.dp.loadError'), 'error');
      setCalendarItems([]);
      setCalendarByDay([]);
    } finally {
      setCalendarLoading(false);
    }
  }, [companyId, locale, toast]);

  useEffect(() => {
    void loadCalendar();
  }, [loadCalendar, reloadKey]);

  const calendarByDate = useMemo(() => calendarByDay, [calendarByDay]);

  const createLeave = async () => {
    const today = isoToday();
    const values = await promptForm({
      title: t(locale, 'panel.dp.leaveAdd'),
      confirmLabel: t(locale, 'panel.dp.save'),
      fields: [
        {
          key: 'candidateId',
          label: t(locale, 'panel.dp.colName'),
          type: 'entitySearch',
          required: true,
          searchUrl: `/api/admin/employees/search?companyId=${encodeURIComponent(companyId)}`,
          placeholder: t(locale, 'panel.dp.personSearchPh'),
          help: t(locale, 'panel.dp.personSearchHelp'),
          minChars: 1,
        },
        {
          key: 'leaveType',
          type: 'select',
          label: t(locale, 'panel.dp.leaveTypeLabel'),
          defaultValue: DP_LEAVE_TYPE.VACATION,
          required: true,
          options: DP_LEAVE_TYPES.map((v) => ({
            value: v,
            label: leaveTypeLabel(locale, v),
          })),
        },
        {
          key: 'startsOn',
          type: 'date',
          label: t(locale, 'panel.dp.leaveStarts'),
          defaultValue: today,
          required: true,
          row: 'leaveDates',
        },
        {
          key: 'endsOn',
          type: 'date',
          label: t(locale, 'panel.dp.leaveEnds'),
          defaultValue: today,
          required: true,
          row: 'leaveDates',
        },
        {
          key: 'reason',
          type: 'richText',
          label: t(locale, 'panel.dp.leaveReason'),
          defaultValue: '',
          minHeight: 120,
          help: t(locale, 'panel.dp.leaveReasonHelp'),
        },
        {
          key: 'autoApprove',
          type: 'boolean',
          label: t(locale, 'panel.dp.createAutoApprove'),
          defaultValue: true,
        },
        {
          key: 'allowOverBalance',
          type: 'boolean',
          label: t(locale, 'panel.dp.leaveAllowOver'),
          defaultValue: false,
          showWhen: (v) => v.leaveType === DP_LEAVE_TYPE.VACATION,
        },
      ],
    });
    if (!values) return;
    try {
      const res = await fetch('/api/admin/dp/leave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          candidateId: values.candidateId,
          leaveType: values.leaveType,
          startsOn: values.startsOn,
          endsOn: values.endsOn,
          reason: values.reason,
          autoApprove: values.autoApprove !== false,
          allowOverBalance: values.allowOverBalance === true,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'create');
      toast(t(locale, 'panel.dp.leaveCreated'), 'ok');
      setReloadKey((k) => k + 1);
    } catch (e) {
      toast(e?.message || t(locale, 'panel.dp.leaveCreateError'), 'error');
    }
  };

  const editLeave = async (row) => {
    const values = await promptForm({
      title: t(locale, 'panel.dp.editLeave'),
      confirmLabel: t(locale, 'panel.dp.save'),
      fields: [
        {
          key: 'status',
          type: 'select',
          label: t(locale, 'panel.dp.leaveStatusLabel'),
          defaultValue: row.status,
          required: true,
          options: DP_LEAVE_STATUSES.map((s) => ({
            value: s,
            label: leaveStatusLabel(locale, s),
          })),
        },
        {
          key: 'managerNotes',
          type: 'textarea',
          label: t(locale, 'panel.dp.managerNotes'),
          defaultValue: row.managerNotes || '',
          rows: 3,
          maxLength: 2000,
        },
      ],
    });
    if (!values) return;
    try {
      const res = await fetch(`/api/admin/dp/leave/${encodeURIComponent(row.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          status: values.status,
          managerNotes: values.managerNotes,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'save');
      toast(t(locale, 'panel.dp.leaveUpdated'), 'ok');
      setReloadKey((k) => k + 1);
    } catch (e) {
      toast(e?.message || t(locale, 'panel.dp.leaveUpdateError'), 'error');
    }
  };

  const decideLeave = async (row, status) => {
    try {
      const res = await fetch(`/api/admin/dp/leave/${encodeURIComponent(row.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, status }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'save');
      toast(
        status === DP_LEAVE_STATUS.APPROVED
          ? t(locale, 'panel.dp.leaveApproved')
          : t(locale, 'panel.dp.leaveRejected'),
        'ok'
      );
      setReloadKey((k) => k + 1);
    } catch (e) {
      toast(e?.message || t(locale, 'panel.dp.leaveUpdateError'), 'error');
    }
  };

  const exportCsv = async () => {
    if (!companyId || exporting) return;
    setExporting(true);
    try {
      const params = new URLSearchParams({ companyId: String(companyId) });
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (leaveTypeFilter !== 'all') params.set('leaveType', leaveTypeFilter);
      if (q) params.set('q', q);
      const res = await fetch(`/api/admin/dp/leave/export?${params}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || 'export');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `dp-leave_${isoToday()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast(t(locale, 'panel.dp.exportOk'), 'ok');
    } catch (e) {
      toast(e?.message || t(locale, 'panel.dp.exportError'), 'error');
    } finally {
      setExporting(false);
    }
  };

  if (!companyId) {
    return (
      <ContentEnter animKey="dp-need-company">
        <EmptyState
          title={t(locale, 'panel.dp.needCompanyTitle')}
          message={t(locale, 'panel.dp.needCompanyHint')}
        />
      </ContentEnter>
    );
  }

  const filtersDirty =
    Boolean(String(qDraft || '').trim()) ||
    statusFilter !== 'all' ||
    leaveTypeFilter !== 'all';

  const workspaceHeading = {
    pending: ['panel.dp.workspacePending', 'panel.dp.workspacePendingHint'],
    leaves: ['panel.dp.inboxTitle', 'panel.dp.inboxSubtitle'],
    documents: ['panel.dp.workspaceDocuments', 'panel.dp.workspaceDocumentsHint'],
    time: ['panel.dp.workspaceTime', 'panel.dp.workspaceTimeHint'],
    onboarding: ['panel.dp.workspaceOnboarding', 'panel.dp.workspaceOnboardingHint'],
  }[workspaceSection] || ['panel.dp.inboxTitle', 'panel.dp.inboxSubtitle'];

  return (
    <div className="flex flex-col gap-6">
      <PanelSubNav
        ariaLabel={t(locale, 'panel.dp.workspaceTabsAria')}
        active={workspaceSection}
        onChange={setWorkspaceSection}
        tabs={[
          // The summary mixes requests and people; omit an aggregate badge with no single unit.
          { id: 'pending', label: t(locale, 'panel.dp.workspacePending') },
          { id: 'leaves', label: t(locale, 'panel.dp.workspaceLeaves') },
          { id: 'documents', label: t(locale, 'panel.dp.workspaceDocuments'), badge: pendingDocsPeople || undefined },
          { id: 'time', label: t(locale, 'panel.dp.workspaceTime'), badge: pendingTimeRequests || undefined },
          { id: 'onboarding', label: t(locale, 'panel.dp.workspaceOnboarding') },
        ]}
      />

      <AdminPageHeader
        title={t(locale, workspaceHeading[0])}
        subtitle={workspaceHeading[1] ? t(locale, workspaceHeading[1]) : undefined}
        actions={
          workspaceSection === 'leaves' ? (
            <div className="flex flex-wrap items-center justify-end gap-2">
              <AdminCreateButton
              label={t(locale, 'panel.dp.leaveAdd')}
              onClick={() => void createLeave()}
              />
              <button
                type="button"
                disabled={exporting}
                className={cn(S.btnGhost, 'min-h-touch text-sm')}
                onClick={() => void exportCsv()}
              >
                {exporting ? t(locale, 'panel.common.loading') : t(locale, 'panel.dp.exportCsv')}
              </button>
            </div>
          ) : null
        }
      />

      {workspaceSection === 'pending' ? (
        requestedCount + pendingDocsPeople + absenteeismPeople + pendingTimeRequests > 0 ? (
          <ContentEnter animKey={`dp-pending|${requestedCount}|${pendingDocsPeople}|${absenteeismPeople}|${pendingTimeRequests}`}>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatMetricTile
                value={requestedCount}
                label={t(locale, 'panel.dp.pendingLeaveTitle')}
                hint={t(locale, 'panel.dp.pendingLeaveHint')}
                onClick={() => {
                  setWorkspaceSection('leaves');
                  setStatusFilter(DP_LEAVE_STATUS.REQUESTED);
                  setPage(1);
                }}
              />
              <StatMetricTile
                value={pendingTimeRequests}
                label={t(locale, 'panel.dp.pendingTimeRequestsTitle')}
                hint={t(locale, 'panel.dp.pendingTimeRequestsHint')}
                onClick={() => {
                  setTimeView('requests');
                  setWorkspaceSection('time');
                }}
              />
              <StatMetricTile
                value={pendingDocsPeople}
                label={t(locale, 'panel.dp.pendingDocsTitle')}
                hint={t(locale, 'panel.dp.pendingDocsHint')}
                onClick={() => setWorkspaceSection('documents')}
              />
              <StatMetricTile
                value={absenteeismPeople}
                label={t(locale, 'panel.dp.pendingAbsenceTitle')}
                hint={t(locale, 'panel.dp.pendingAbsenceHint')}
                onClick={() => {
                  if (firstAbsenteeismCandidateId && typeof navigateDashboard === 'function') {
                    navigateDashboard({
                      tab: 'team',
                      candidate: String(firstAbsenteeismCandidateId),
                      section: 'dp',
                    });
                    return;
                  }
                  setWorkspaceSection('leaves');
                  setLeaveTypeFilter(DP_LEAVE_TYPE.SICK);
                  setStatusFilter('all');
                  setPage(1);
                }}
              />
            </div>
          </ContentEnter>
        ) : (
          <EmptyState
            title={t(locale, 'panel.dp.pendingEmptyTitle')}
            message={t(locale, 'panel.dp.pendingEmptyHint')}
          />
        )
      ) : null}

      {workspaceSection === 'time' ? <TimeClockWorkspace
        locale={locale}
        companyId={companyId}
        navigateDashboard={navigateDashboard}
        initialView={timeView}
        onViewChange={setTimeView}
        onRequestsChanged={() => void loadAttention()}
      /> : null}

      {workspaceSection === 'leaves' ? <VacationPoolBlock locale={locale} companyId={companyId} reloadKey={reloadKey} /> : null}

      {workspaceSection === 'onboarding' ? <PreOnboardingTemplateBlock locale={locale} companyId={companyId} /> : null}

      {workspaceSection === 'leaves' ? <><AdminListFilters
        aria-label={t(locale, 'panel.dp.inboxTitle')}
        locale={locale}
        onClear={() => {
          setQDraft('');
          setQ('');
          setStatusFilter('all');
          setLeaveTypeFilter('all');
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
          placeholder={t(locale, 'panel.dp.searchPh')}
          className="min-w-[200px] flex-1 items-end self-end"
          inputClassName="w-full max-w-none"
        />
        <AdminListFilterSelect
          label={t(locale, 'panel.dp.filterStatus')}
          value={statusFilter}
          onChange={(v) => {
            setStatusFilter(v);
            setPage(1);
          }}
        >
          <option value="all">{t(locale, 'panel.dp.statusAll')}</option>
          {DP_LEAVE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {leaveStatusLabel(locale, s)}
            </option>
          ))}
        </AdminListFilterSelect>
        <AdminListFilterSelect
          label={t(locale, 'panel.dp.filterLeaveType')}
          value={leaveTypeFilter}
          onChange={(v) => {
            setLeaveTypeFilter(v);
            setPage(1);
          }}
        >
          <option value="all">{t(locale, 'panel.dp.typeAll')}</option>
          {DP_LEAVE_TYPES.map((type) => (
            <option key={type} value={type}>
              {leaveTypeLabel(locale, type)}
            </option>
          ))}
        </AdminListFilterSelect>
      </AdminListFilters>

      {loading ? (
        <AppLoading locale={locale} variant="panel" />
      ) : items.length === 0 ? (
        <ContentEnter animKey={`dp-empty|${statusFilter}|${leaveTypeFilter}|${q}`}>
          <EmptyState
            title={t(locale, 'panel.dp.emptyTitle')}
            message={t(locale, 'panel.dp.emptyHint')}
            actionLabel={t(locale, 'panel.dp.leaveAdd')}
            onAction={() => void createLeave()}
          />
        </ContentEnter>
      ) : (
        <ContentEnter animKey={`dp|${statusFilter}|${leaveTypeFilter}|${q}|${page}|${pageSize}`}>
          <AdminTableShell locale={locale} minWidth="640px">
              <thead>
                <tr className="border-b border-ink/10">
                  <AdminTh>{t(locale, 'panel.dp.colName')}</AdminTh>
                  <AdminTh>{t(locale, 'panel.dp.colType')}</AdminTh>
                  <AdminTh>{t(locale, 'panel.dp.colStatus')}</AdminTh>
                  <AdminTh>{t(locale, 'panel.dp.colDates')}</AdminTh>
                  <AdminTh>{t(locale, 'panel.dp.colReason')}</AdminTh>
                  <AdminActionsTh>{t(locale, 'panel.dp.colActions')}</AdminActionsTh>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr key={row.id} className="border-b border-ink/[0.06] last:border-0">
                    <td className="px-3 py-2.5 align-middle">
                      <div className="font-ui text-sm text-ink">{row.candidateName || '—'}</div>
                      {row.candidateEmail ? (
                        <div className="font-mono text-2xs text-ink-muted">{row.candidateEmail}</div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5 align-middle text-sm text-ink">
                      {leaveTypeLabel(locale, row.leaveType)}
                    </td>
                    <td className="px-3 py-2.5 align-middle">
                      <StatusToneChip tone={leaveStatusTone(row.status)}>
                        {leaveStatusLabel(locale, row.status)}
                      </StatusToneChip>
                    </td>
                    <td className="px-3 py-2.5 align-middle font-mono text-2xs text-ink-muted">
                      {formatDate(row.startsOn, locale)}
                      {' · '}
                      {formatDate(row.endsOn, locale)}
                    </td>
                    <td className="max-w-[220px] truncate px-3 py-2.5 align-middle text-xs text-ink-muted">
                      {htmlToPlainText(row.reason || '') || '—'}
                    </td>
                    <td className="px-3 py-2.5 text-right align-middle">
                      <AdminActionsCell>
                        {row.status === DP_LEAVE_STATUS.REQUESTED ? (
                          <>
                            <AdminIconButton
                              icon="check"
                              label={t(locale, 'panel.dp.approveLeave')}
                              onClick={() => void decideLeave(row, DP_LEAVE_STATUS.APPROVED)}
                            />
                            <AdminIconButton
                              icon="x"
                              label={t(locale, 'panel.dp.rejectLeave')}
                              onClick={() => void decideLeave(row, DP_LEAVE_STATUS.REJECTED)}
                            />
                          </>
                        ) : null}
                        <AdminEditButton
                          label={t(locale, 'panel.dp.editLeave')}
                          onClick={() => void editLeave(row)}
                        />
                        {typeof navigateDashboard === 'function' && row.candidateId ? (
                          <AdminIconButton
                            icon="users"
                            label={t(locale, 'panel.dp.openTeam')}
                            onClick={() =>
                              navigateDashboard({
                                tab: 'team',
                                candidate: String(row.candidateId),
                                section: 'dp',
                              })
                            }
                          />
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
            total={total}
            pageSizeOptions={PAGE_SIZE_OPTIONS}
            onPageChange={setPage}
            onPageSizeChange={(n) => {
              setPageSize(n);
              setPage(1);
            }}
          />
        </ContentEnter>
      )}</> : null}

      {workspaceSection === 'documents' ? <CollapsibleBlock
        locale={locale}
        variant="card"
        title={t(locale, 'panel.dp.docsQueueTitle')}
        defaultOpen
        count={pendingDocsList.length || null}
      >
        {pendingDocsList.length === 0 ? (
          <EmptyState message={t(locale, 'panel.dp.docsQueueEmpty')} />
        ) : (
          <ContentEnter animKey={`dp-docs|${pendingDocsList.length}`}>
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
              {pendingDocsList.map((row) => (
                <li
                  key={row.candidateId}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-ink/10 bg-surface px-3 py-2"
                >
                  <div className="min-w-0">
                    <span className="font-ui text-sm text-ink">{row.candidateName || '—'}</span>
                    <span className="ml-2 font-mono text-2xs text-ink-muted">
                      {t(locale, 'panel.dp.docsQueuePending', { n: row.pending })}
                    </span>
                  </div>
                  {typeof navigateDashboard === 'function' ? (
                    <AdminIconButton
                      icon="users"
                      label={t(locale, 'panel.dp.openTeam')}
                      onClick={() =>
                        navigateDashboard({
                          tab: 'team',
                          candidate: String(row.candidateId),
                          section: 'dp',
                        })
                      }
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          </ContentEnter>
        )}
      </CollapsibleBlock> : null}

      {workspaceSection === 'leaves' ? <CollapsibleBlock
        locale={locale}
        variant="card"
        title={t(locale, 'panel.dp.calendarTitle')}
        defaultOpen={false}
        count={calendarItems.length || null}
      >
        {calendarLoading ? (
          <AppLoading locale={locale} variant="inline" />
        ) : calendarByDate.length === 0 ? (
          <EmptyState message={t(locale, 'panel.dp.calendarEmpty')} />
        ) : (
          <ContentEnter animKey={`dp-cal|${calendarItems.length}`}>
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {calendarByDate.map(([date, rows]) => (
              <li key={date}>
                <div className={cn(S.label, 'mb-1.5')}>{formatDate(date, locale)}</div>
                <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                  {rows.map((row) => (
                    <li
                      key={`${date}-${row.id}`}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-ink/10 bg-surface px-3 py-2"
                    >
                      <div className="min-w-0">
                        <span className="font-ui text-sm text-ink">
                          {row.candidateName || '—'}
                        </span>
                        <span className="ml-2 font-mono text-2xs text-ink-muted">
                          {leaveTypeLabel(locale, row.leaveType)}
                          {' · '}
                          {formatDate(row.startsOn, locale)}
                          {'–'}
                          {formatDate(row.endsOn, locale)}
                        </span>
                      </div>
                      <StatusToneChip tone={leaveStatusTone(row.status)}>
                        {leaveStatusLabel(locale, row.status)}
                      </StatusToneChip>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          </ContentEnter>
        )}
      </CollapsibleBlock> : null}
    </div>
  );
}
