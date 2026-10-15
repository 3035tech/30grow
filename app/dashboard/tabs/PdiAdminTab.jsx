'use client';

import { useListUrlState, useListSearchDraft } from '../hooks/useListUrlState';

import { useCallback, useEffect, useState } from 'react';
import { cn } from '../../../lib/cn';
import { t, messageNode, localeHtmlLang } from '../../../lib/i18n';
import { AppLoading, ContentEnter } from '../../_components/AppLoading';
import { EmptyState } from '../../_components/EmptyState';
import { SelectField } from '../../_components/SelectField';
import { Icon } from '../../_components/Icon';
import { StatMetricTile } from '../../_components/StatMetricTile';
import {
  AdminTableShell,
  AdminTh,
  AdminActionsTh,
  AdminListPager,
  AdminListSearch,
  AdminPageHeader,
  S,
} from '../dashboard-shared';

function dateLabel(value, locale) {
  if (!value) return null;
  const raw = String(value).trim();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? new Date(`${raw}T12:00:00`)
    : new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(localeHtmlLang(locale), {
    day: '2-digit',
    month: 'short',
  });
}

export function PdiAdminTab({ locale = 'pt-BR', companyId, navigateDashboard, initialSearch = '' }) {
  const copy = messageNode(locale, 'adminModules.pdiAdmin');
  const [view, setView] = useListUrlState('pdi', 'view', 'attention');
  const [q, setQ] = useListUrlState('pdi', 'q', initialSearch);
  const [qDraft, setQDraft] = useListSearchDraft(q);
  const [page, setPage] = useListUrlState('pdi', 'page', 1);
  const [pageSize, setPageSize] = useListUrlState('pdi', 'pageSize', 20);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(() => Boolean(companyId));
  const [error, setError] = useState('');



  const load = useCallback(async () => {
    if (!companyId) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({
        companyId: String(companyId),
        view,
        page: String(page),
        pageSize: String(pageSize),
      });
      if (q) params.set('q', q);
      const res = await fetch(`/api/admin/pdi?${params}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || 'pdi_load');
      setData(json);
    } catch {
      setData(null);
      setError(copy.error);
    } finally {
      setLoading(false);
    }
  }, [companyId, copy.error, page, pageSize, q, view]);

  useEffect(() => {
    void load();
  }, [load]);

  const summary = data?.summary || {};
  const attentionCount =
    (Number(summary.overdueItemCount) || 0) +
    (Number(summary.overduePlanCount) || 0) +
    (Number(summary.itemsWithoutOneOnOne) || 0);
  const rows = data?.rows || [];
  const priorityItems = [
    ...(summary.queue?.overdue || []).map((item) => ({ ...item, priorityKind: 'overdue' })),
    ...(summary.queue?.unlinked || []).map((item) => ({ ...item, priorityKind: 'unlinked' })),
    ...(summary.queue?.noPlan || []).map((item) => ({ ...item, priorityKind: 'no-plan' })),
  ].filter((item, index, list) => (
    list.findIndex((candidate) => `${candidate.priorityKind}:${candidate.candidateId}` === `${item.priorityKind}:${item.candidateId}`) === index
  )).slice(0, 4);
  const openPerson = (row) => {
    if (typeof navigateDashboard !== 'function') return;
    navigateDashboard({
      tab: 'team',
      candidate: String(row.candidateId),
      search: row.candidateName || null,
      section: 'dp',
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <AdminPageHeader title={t(locale, 'dashboard.pdi')} subtitle={copy.subtitle} />

      {!companyId ? (
        <EmptyState title={copy.selectCompanyTitle} message={copy.selectCompanyBody} />
      ) : loading && !data ? (
        <AppLoading variant="panel" />
      ) : error ? (
        <EmptyState title={copy.unavailableTitle} message={error} />
      ) : (
        <ContentEnter animKey={`pdi-${companyId}-${view}-${q}-${page}`}>
          <section className={S.cardTight} aria-label={copy.title}>
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              {[
                [summary.activePlans || 0, copy.activePlans],
                [attentionCount, copy.attention],
                [summary.noPlanEmployeeCount || 0, copy.noPlan],
                [`${summary.donePct ?? 0}%`, copy.completion],
              ].map(([value, label]) => (
                <StatMetricTile key={label} value={value} label={label} />
              ))}
            </div>

            {priorityItems.length > 0 ? (
              <div className="mt-4 overflow-hidden rounded-xl border border-warning/20 bg-warning/[0.045]">
                <div className="flex flex-col gap-1 border-b border-warning/15 px-4 py-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
                  <div>
                    <h2 className="m-0 text-sm font-semibold text-ink">{copy.nextActions}</h2>
                    <p className="m-0 mt-0.5 text-prose text-ink-muted">{copy.nextActionsBody}</p>
                  </div>
                  <span className="font-ui text-prose text-amber-800 dark:text-warning">
                    {t(locale, priorityItems.length === 1 ? 'ui.pdiAdminTab.casesShownOne' : 'ui.pdiAdminTab.casesShownOther', { count: priorityItems.length })}
                  </span>
                </div>
                <div className="divide-y divide-warning/15">
                  {priorityItems.map((item) => {
                    const isNoPlan = item.priorityKind === 'no-plan';
                    const isUnlinked = item.priorityKind === 'unlinked';
                    const title = isNoPlan ? copy.noPlanStatus : item.itemTitle || item.planTitle || copy.overdueItem;
                    const dueLabel = dateLabel(item.dueDate, locale);
                    const detail = isNoPlan
                      ? copy.noPlanRowDetail
                      : isUnlinked
                        ? copy.withoutOneOnOne
                        : dueLabel
                          ? `${copy.overdueSince} ${dueLabel}`
                          : copy.overdueItem;
                    return (
                      <div key={`${item.priorityKind}-${item.candidateId}`} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <p className="m-0 truncate text-sm font-medium text-ink">{item.candidateName}</p>
                          <p className="m-0 mt-0.5 truncate text-prose text-ink-muted">{title} · {detail}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => openPerson(item)}
                          className={cn(S.btnBrandSoft, 'min-h-touch shrink-0 whitespace-nowrap text-prose')}
                        >
                          {copy.seePerson}
                          <Icon name="chevronRight" className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}

            <div className="mt-4 flex flex-col gap-3 border-t border-ink/10 pt-4 sm:flex-row sm:items-end">
              <AdminListSearch
                locale={locale}
                value={qDraft}
                onChange={setQDraft}
                onSubmit={(value) => { setQ(value.trim()); setPage(1); }}
                label={copy.search}
                placeholder={copy.searchPh}
              />
              <label className="block min-w-[12rem] sm:max-w-[16rem]">
                <span className={cn(S.label, 'mb-1.5 block')}>{copy.viewLabel}</span>
                <SelectField
                  value={view}
                  onChange={(event) => { setView(event.target.value); setPage(1); }}
                  className="w-full"
                  aria-label={copy.viewLabel}
                >
                  <option value="attention">{copy.viewAttention}</option>
                  <option value="active">{copy.viewActive}</option>
                  <option value="no-plan">{copy.viewNoPlan}</option>
                  <option value="all">{copy.viewAll}</option>
                </SelectField>
              </label>
            </div>
          </section>

          <section className={cn(S.cardTight, 'mt-4')}>
            {rows.length === 0 ? (
              <EmptyState
                title={view === 'no-plan' ? copy.noPlanTitle : copy.noDataTitle}
                message={view === 'no-plan' ? copy.noPlanBody : copy.noDataBody}
              />
            ) : (
              <AdminTableShell locale={locale} ariaLabel={copy.title} minWidth="860px">
                <thead><tr>
                  {['person', 'plan', 'deadline', 'status', 'progress'].map((key) => <AdminTh key={key}>{t(locale, `panel.common.listColumns.${key}`)}</AdminTh>)}
                  <AdminActionsTh>{t(locale, 'panel.admin.colActions')}</AdminActionsTh>
                </tr></thead>
                <tbody className="divide-y divide-ink/5">
                  {rows.map((row) => {
                    const hasPlan = Boolean(row.planId);
                    const flagged = !hasPlan || row.periodOverdue || row.overdueItemCount > 0;
                    const progress = Math.max(0, Math.min(100, Number(row.donePct) || 0));
                    return (
                      <tr key={row.candidateId} className={cn('hover:bg-canvas-alt/50', flagged && 'bg-warning/[0.035]')}>
                        <th scope="row" className="px-4 py-3 text-left text-sm font-medium text-ink">{row.candidateName}</th>
                        <td className="max-w-[280px] px-4 py-3 text-ink-muted">{hasPlan ? row.planTitle : copy.noPlanRowDetail}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-ink-muted">{hasPlan ? dateLabel(row.periodEnd, locale) || '—' : '—'}</td>
                        <td className="px-4 py-3">
                          <span className={cn('inline-block rounded-full px-2 py-1', flagged ? 'bg-warning/10 text-amber-800 dark:text-warning' : 'bg-ink/5 text-ink-muted')}>
                            {!hasPlan ? copy.noPlanStatus : row.periodOverdue ? copy.overduePlan : t(locale, 'panel.common.listColumns.active')}
                          </span>
                          {row.overdueItemCount > 0 ? <p className="m-0 mt-1 text-ink-muted">{row.overdueItemCount} {row.overdueItemCount === 1 ? copy.overdueItem : copy.overdueItems}</p> : null}
                        </td>
                        <td className="px-4 py-3">
                          {hasPlan && row.itemCount > 0 ? <div className="min-w-[140px]">
                            <div className="mb-1 flex justify-between gap-3 text-ink-muted"><span>{row.doneCount || 0}/{row.itemCount || 0} {copy.done}</span><span>{progress}%</span></div>
                            <div role="progressbar" aria-label={row.planTitle || row.candidateName} aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} className="h-1.5 overflow-hidden rounded-full bg-ink/10">
                              <div className="h-full rounded-full bg-brand-500" style={{ width: `${progress}%` }} />
                            </div>
                          </div> : hasPlan ? <span className="text-ink-muted">{copy.noItems}</span> : '—'}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button type="button" onClick={() => openPerson(row)} className={cn(hasPlan ? S.btnGhost : S.btnBrandSoft, 'min-h-touch whitespace-nowrap text-prose')}>
                            <Icon name={hasPlan ? 'externalLink' : 'plus'} className="h-3.5 w-3.5" />{hasPlan ? copy.open : copy.create}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </AdminTableShell>
            )}
            <AdminListPager
              locale={locale}
              page={page}
              pageSize={pageSize}
              total={Number(data?.total) || 0}
              loading={loading}
              onPageChange={setPage}
              onPageSizeChange={(value) => { setPageSize(value); setPage(1); }}
            />
          </section>
        </ContentEnter>
      )}
    </div>
  );
}
