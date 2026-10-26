'use client';

import { useListUrlState, useListSearchDraft } from '../hooks/useListUrlState';

import { useCallback, useEffect, useState } from 'react';
import { t, localeHtmlLang } from '../../../lib/i18n';
import { formatSalaryDisplay } from '../../../lib/br-masks';
import { PAGE_SIZE_OPTIONS } from '../../../lib/assessment/assessment-filters';
import { EMPLOYMENT_STATUS } from '../../../lib/domain-status.js';
import {
  AdminActionsCell,
  AdminActionsTh,
  AdminIconButton,
  AdminListPager,
  AdminListSearch,
  AdminPageHeader,
  PanelSubNav,
  AdminTableShell,
  AdminTh,
  AdminViewButton,
  S,
  SortableTh,
  clientSortNextDir,
} from '../dashboard-shared';
import { EmptyState } from '../../_components/EmptyState';
import { AppLoading, ContentEnter } from '../../_components/AppLoading';
import { AdminListFilters, AdminListFilterSelect } from '../../_components/AdminListFilters';
import { AdminRichFormDrawer } from '../../_components/AdminRichFormDrawer';
import { CompensationBlock } from '../../_components/CompensationBlock';
import { SalaryMapBlock } from '../../_components/SalaryMapBlock';
import { VariablePayInboxBlock } from '../../_components/VariablePayInboxBlock';
import { StatusToneChip } from '../../_components/StatusToneChip';
import { useAppFeedback } from '../../_components/AppFeedback';

function marketTone(status) {
  if (status === 'below') return 'warning';
  if (status === 'above') return 'info';
  if (status === 'in_band') return 'success';
  return null;
}

function marketChipLabel(locale, status) {
  if (status === 'below') return t(locale, 'panel.compensation.marketBelow');
  if (status === 'above') return t(locale, 'panel.compensation.marketAbove');
  if (status === 'in_band') return t(locale, 'panel.compensation.marketInBand');
  return '';
}

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

function eventTypeLabel(locale, type) {
  const key = `panel.compensation.type.${type}`;
  const label = t(locale, key);
  return label === key ? type : label;
}

/**
 * Unified internal compensation roster — list salaries + history drawer.
 */
export function CompensationAdminTab({ locale = 'pt-BR', companyId, navigateDashboard, canManage = false, canViewJobRoles = false }) {
  const { toast } = useAppFeedback();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(() => Boolean(companyId));
  const [page, setPage] = useListUrlState('compensation', 'page', 1);
  const [pageSize, setPageSize] = useListUrlState('compensation', 'pageSize', 20);
  const [total, setTotal] = useState(0);
  const [sort, setSort] = useListUrlState('compensation', 'sort', 'name');
  const [sortDir, setSortDir] = useListUrlState('compensation', 'sortDir', 'asc');
  const [q, setQ] = useListUrlState('compensation', 'q', '');
  const [qDraft, setQDraft] = useListSearchDraft(q);
  const [statusFilter, setStatusFilter] = useListUrlState('compensation', 'statusFilter', EMPLOYMENT_STATUS.EMPLOYEE);
  const [hasSalary, setHasSalary] = useListUrlState('compensation', 'hasSalary', 'all');
  const [marketBand, setMarketBand] = useListUrlState('compensation', 'marketBand', 'all');
  const [historyPerson, setHistoryPerson] = useState(null);
  const [workspaceSection, setWorkspaceSection] = useState('people');
  const [accessDenied, setAccessDenied] = useState(false);

  const load = useCallback(async () => {
    if (!companyId) {
      setItems([]);
      setTotal(0);
      setLoading(false);
      return;
    }
    setLoading(true);
    setAccessDenied(false);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        sort,
        sortDir,
        employmentStatus: statusFilter,
        hasSalary,
        marketBand,
      });
      if (q) params.set('q', q);
      if (companyId) params.set('companyId', String(companyId));
      const res = await fetch(`/api/admin/compensation?${params}`);
      const data = await res.json().catch(() => ({}));
      if (res.status === 403) {
        setAccessDenied(true);
        setItems([]);
        setTotal(0);
        return;
      }
      if (!res.ok) throw new Error(data?.error || 'load');
      setItems(Array.isArray(data.items) ? data.items : []);
      setTotal(Number(data.total) || 0);
    } catch (e) {
      toast(e?.message || t(locale, 'panel.compensationRoster.loadError'), 'error');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [companyId, page, pageSize, sort, sortDir, statusFilter, hasSalary, marketBand, q, locale, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const onSort = (columnKey) => {
    const nextDir = clientSortNextDir(columnKey, sort, sortDir);
    setSort(columnKey);
    setSortDir(nextDir);
    setPage(1);
  };

  const commitSearch = () => {
    const next = qDraft.trim();
    if (next === q) return;
    setQ(next);
    setPage(1);
  };

  const money = (amount) =>
    amount ? formatSalaryDisplay(amount, locale) : t(locale, 'panel.compensation.noCurrent');

  if (!companyId) {
    return (
      <EmptyState
        title={t(locale, 'panel.compensationRoster.needCompanyTitle')}
        message={t(locale, 'panel.compensationRoster.needCompanyHint')}
      />
    );
  }

  if (accessDenied) {
    return (
      <EmptyState
        title={t(locale, 'panel.compensationRoster.accessDeniedTitle')}
        message={t(locale, 'panel.compensationRoster.accessDeniedHint')}
      />
    );
  }

  if (loading && items.length === 0) return <AppLoading variant="panel" />;

  return (
    <div className="flex flex-col gap-4">
      <AdminPageHeader
        title={t(locale, 'panel.compensationRoster.title')}
        subtitle={t(locale, 'panel.compensationRoster.subtitle')}
      />

      <PanelSubNav
        ariaLabel={t(locale, 'panel.compensationRoster.workspaceTabsAria')}
        active={workspaceSection}
        onChange={setWorkspaceSection}
        tabs={[
          { id: 'people', label: t(locale, 'panel.compensationRoster.workspacePeople'), badge: total || undefined },
          { id: 'insights', label: t(locale, 'panel.compensationRoster.workspaceInsights') },
        ]}
      />

      <ContentEnter animKey={workspaceSection} className="flex flex-col gap-4">
      {workspaceSection === 'insights' ? <SalaryMapBlock locale={locale} companyId={companyId} /> : null}

      {workspaceSection === 'insights' ? <VariablePayInboxBlock
        locale={locale}
        companyId={companyId}
        canManage={canManage}
        onOpenPerson={
          typeof navigateDashboard === 'function'
            ? (candidateId) =>
                navigateDashboard({
                  tab: 'team',
                  candidate: candidateId,
                  section: 'compensation',
                })
            : null
        }
      /> : null}

      {workspaceSection === 'people' ? <><AdminListFilters
        aria-label={t(locale, 'panel.compensationRoster.title')}
        locale={locale}
        onClear={() => {
          setQDraft('');
          setQ('');
          setStatusFilter(EMPLOYMENT_STATUS.EMPLOYEE);
          setHasSalary('all');
          setMarketBand('all');
          setPage(1);
        }}
        clearEnabled={Boolean(
          String(qDraft || '').trim() ||
            q ||
            statusFilter !== EMPLOYMENT_STATUS.EMPLOYEE ||
            hasSalary !== 'all' ||
            marketBand !== 'all'
        )}
      >
        <AdminListSearch
          locale={locale}
          value={qDraft}
          onChange={setQDraft}
          onSubmit={() => commitSearch()}
          placeholder={t(locale, 'panel.compensationRoster.searchPh')}
          className="min-w-[12rem] flex-1"
          inputClassName="w-full max-w-none"
        />
        <AdminListFilterSelect
          label={t(locale, 'panel.compensationRoster.statusLabel')}
          value={statusFilter}
          onChange={(v) => {
            setStatusFilter(v);
            setPage(1);
          }}
        >
          <option value={EMPLOYMENT_STATUS.EMPLOYEE}>
            {t(locale, 'panel.compensationRoster.statusEmployee')}
          </option>
          <option value={EMPLOYMENT_STATUS.ALUMNI}>
            {t(locale, 'panel.compensationRoster.statusAlumni')}
          </option>
          <option value="all">{t(locale, 'panel.compensationRoster.statusAll')}</option>
        </AdminListFilterSelect>
        <AdminListFilterSelect
          label={t(locale, 'panel.compensationRoster.hasSalaryLabel')}
          value={hasSalary}
          onChange={(v) => {
            setHasSalary(v);
            setPage(1);
          }}
        >
          <option value="all">{t(locale, 'panel.compensationRoster.hasSalaryAll')}</option>
          <option value="with">{t(locale, 'panel.compensationRoster.hasSalaryWith')}</option>
          <option value="without">{t(locale, 'panel.compensationRoster.hasSalaryWithout')}</option>
        </AdminListFilterSelect>
        <AdminListFilterSelect
          label={t(locale, 'panel.compensationRoster.marketBandLabel')}
          value={marketBand}
          onChange={(v) => {
            setMarketBand(v);
            setPage(1);
          }}
        >
          <option value="all">{t(locale, 'panel.compensationRoster.marketBandAll')}</option>
          <option value="below">{t(locale, 'panel.compensationRoster.marketBandBelow')}</option>
          <option value="in_band">{t(locale, 'panel.compensationRoster.marketBandIn')}</option>
          <option value="above">{t(locale, 'panel.compensationRoster.marketBandAbove')}</option>
          <option value="no_band">{t(locale, 'panel.compensationRoster.marketBandNone')}</option>
        </AdminListFilterSelect>
      </AdminListFilters>

      {items.length === 0 ? (
        <EmptyState
          title={t(locale, 'panel.compensationRoster.emptyTitle')}
          message={t(locale, 'panel.compensationRoster.emptyHint')}
        />
      ) : (
        <AdminTableShell locale={locale}
          minWidth="640px"
          animKey={`${q}|${statusFilter}|${hasSalary}|${marketBand}|${page}|${pageSize}`}
        >
            <thead>
              <tr>
                <SortableTh columnKey="name" sortKey={sort} dir={sortDir} onSort={onSort}>
                  {t(locale, 'panel.compensationRoster.colName')}
                </SortableTh>
                <SortableTh columnKey="amount" sortKey={sort} dir={sortDir} onSort={onSort}>
                  {t(locale, 'panel.compensationRoster.colAmount')}
                </SortableTh>
                <SortableTh columnKey="effectiveDate" sortKey={sort} dir={sortDir} onSort={onSort}>
                  {t(locale, 'panel.compensationRoster.colSince')}
                </SortableTh>
                <AdminTh>{t(locale, 'panel.compensationRoster.colType')}</AdminTh>
                <SortableTh columnKey="eventCount" sortKey={sort} dir={sortDir} onSort={onSort}>
                  {t(locale, 'panel.compensationRoster.colEvents')}
                </SortableTh>
                <AdminActionsTh>{t(locale, 'panel.compensationRoster.colActions')}</AdminActionsTh>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.candidateId} className="border-b border-ink/8 last:border-b-0">
                  <td className="px-4 py-3 align-middle">
                    <div className="font-ui text-sm text-ink">{row.fullName}</div>
                    {row.email ? (
                      <div className="mt-0.5 font-mono text-2xs text-ink-muted">{row.email}</div>
                    ) : null}
                    {row.employmentStatus === EMPLOYMENT_STATUS.ALUMNI ? (
                      <span className="mt-1 inline-block rounded-control bg-ink/[0.06] px-1.5 py-0.5 font-mono text-2xs uppercase text-ink-muted">
                        {t(locale, 'panel.compensationRoster.badgeAlumni')}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 align-middle font-ui text-sm tabular-nums text-ink">
                    <div className="flex flex-wrap items-center gap-2">
                      <span>{money(row.current?.amount)}</span>
                      {marketTone(row.marketCompare) ? (
                        <StatusToneChip tone={marketTone(row.marketCompare)} bordered>
                          {marketChipLabel(locale, row.marketCompare)}
                        </StatusToneChip>
                      ) : null}
                    </div>
                    {row.jobRoleName ? (
                      <div className="mt-0.5 font-mono text-2xs text-ink-faint">
                        {row.jobRoleName}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 align-middle font-mono text-xs text-ink-muted">
                    {formatDate(row.current?.effectiveDate, locale)}
                  </td>
                  <td className="px-4 py-3 align-middle text-sm text-ink-muted">
                    {row.current?.eventType
                      ? eventTypeLabel(locale, row.current.eventType)
                      : '—'}
                  </td>
                  <td className="px-4 py-3 align-middle font-mono text-xs text-ink-muted">
                    {row.eventCount}
                  </td>
                  <td className="px-4 py-3 align-middle text-right">
                    <AdminActionsCell>
                      <AdminViewButton
                        label={t(locale, 'panel.compensationRoster.historyBtn')}
                        icon="list"
                        onClick={() => setHistoryPerson(row)}
                      />
                      <AdminIconButton
                        href={`/dashboard?tab=team&candidate=${row.candidateId}&section=compensation`}
                        label={t(locale, 'panel.compensationRoster.openTeam')}
                        icon="team"
                      />
                    </AdminActionsCell>
                  </td>
                </tr>
              ))}
            </tbody>
        </AdminTableShell>
      )}

      <AdminListPager
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={setPage}
        onPageSizeChange={(n) => {
          setPageSize(n);
          setPage(1);
        }}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
        locale={locale}
      /></> : null}
      </ContentEnter>

      <AdminRichFormDrawer
        open={Boolean(historyPerson)}
        title={
          historyPerson
            ? t(locale, 'panel.compensationRoster.historyTitle', {
                name: historyPerson.fullName,
              })
            : ''
        }
        locale={locale}
        onClose={() => {
          setHistoryPerson(null);
          void load();
        }}
        maxWidth="640px"
      >
        {historyPerson ? (
          <CompensationBlock
            locale={locale}
            candidateId={historyPerson.candidateId}
            employmentStatus={historyPerson.employmentStatus}
            companyId={companyId}
            canManage={canManage}
            canViewJobRoles={canViewJobRoles}
            navigateDashboard={navigateDashboard}
          />
        ) : null}
      </AdminRichFormDrawer>
    </div>
  );
}
