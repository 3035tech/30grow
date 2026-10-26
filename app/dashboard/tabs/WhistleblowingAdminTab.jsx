'use client';

import { useListUrlState } from '../hooks/useListUrlState';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { t, localeHtmlLang } from '../../../lib/i18n';
import { cn } from '../../../lib/cn';
import {
  AdminTableShell,
  AdminTh,
  AdminActionsTh,
  AdminCreateButton,
  AdminPageHeader,
  S,
} from '../dashboard-shared';
import { AppLoading, ContentEnter } from '../../_components/AppLoading';
import { EmptyState } from '../../_components/EmptyState';
import { CopyableLink } from '../../_components/CopyableLink';
import { StatusToneChip } from '../../_components/StatusToneChip';
import { SegmentedControl } from '../../_components/SegmentedControl';
import { useAppFeedback } from '../../_components/AppFeedback';
import { CollapsibleBlock } from '../../_components/CollapsibleBlock';
import { InlineCallout } from '../../_components/InlineCallout';
import { ChartPanel } from '../../_components/ChartPanel';
import { CategoryBars } from '../../_components/CategoryBars';
import { WHISTLEBLOWING_REPORT_STATUS } from '../../../lib/domain-status';
import { CHART_MIN_N, whistleStatusFunnel, topCategoryCounts } from '../../../lib/analytics/chart-aggregates';

function statusTone(status) {
  if (status === WHISTLEBLOWING_REPORT_STATUS.NEW) return 'warning';
  if (status === WHISTLEBLOWING_REPORT_STATUS.TRIAGING) return 'info';
  if (status === WHISTLEBLOWING_REPORT_STATUS.RESPONDED) return 'success';
  return 'neutral';
}

function isOpenStatus(status) {
  return (
    status === WHISTLEBLOWING_REPORT_STATUS.NEW ||
    status === WHISTLEBLOWING_REPORT_STATUS.TRIAGING
  );
}

function isOverdue(dueAt, status) {
  if (!dueAt || !isOpenStatus(status)) return false;
  return new Date(dueAt).getTime() < Date.now();
}

function formatDue(raw, locale) {
  if (!raw) return '';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return '';
  const loc = localeHtmlLang(locale);
  return d.toLocaleDateString(loc, { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/**
 * B-3005 admin inbox: channels + triage (not climate).
 */
export function WhistleblowingAdminTab({ locale = 'pt-BR', companyId }) {
  const { toast, promptForm } = useAppFeedback();
  const [loading, setLoading] = useState(true);
  const [channels, setChannels] = useState([]);
  const [reports, setReports] = useState([]);
  const [aggregates, setAggregates] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [inboxFilter, setInboxFilter] = useListUrlState('whistleblowing', 'inboxFilter', 'open');

  const load = useCallback(async () => {
    if (!companyId) {
      setChannels([]);
      setReports([]);
      setAggregates(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(
        `/api/admin/whistleblowing?companyId=${encodeURIComponent(companyId)}&includeInactive=1`
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'load');
      setChannels(Array.isArray(data.channels) ? data.channels : []);
      setReports(Array.isArray(data.reports) ? data.reports : []);
      setAggregates(data.aggregates || null);
    } catch (e) {
      toast(e?.message || t(locale, 'panel.whistleblowing.loadError'), 'error');
      setChannels([]);
      setReports([]);
      setAggregates(null);
    } finally {
      setLoading(false);
    }
  }, [companyId, locale, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const openCount = useMemo(
    () => reports.filter((r) => isOpenStatus(r.status)).length,
    [reports]
  );
  const overdueCount = useMemo(
    () => reports.filter((r) => isOverdue(r.dueAt, r.status)).length,
    [reports]
  );
  const visibleReports = useMemo(() => {
    if (inboxFilter === 'all') return reports;
    return reports.filter((r) => isOpenStatus(r.status));
  }, [reports, inboxFilter]);

  const statusToneClassForBar = (status) => {
    if (status === WHISTLEBLOWING_REPORT_STATUS.NEW) return 'rounded-full bg-warning';
    if (status === WHISTLEBLOWING_REPORT_STATUS.TRIAGING) return 'rounded-full bg-info';
    if (status === WHISTLEBLOWING_REPORT_STATUS.RESPONDED) return 'rounded-full bg-success';
    return 'rounded-full bg-ink/30';
  };

  const funnelBars = useMemo(() => {
    const funnel = whistleStatusFunnel(aggregates?.byStatus || []);
    if (funnel.total < CHART_MIN_N) return null;
    return {
      total: funnel.total,
      items: funnel.items
        .filter((i) => i.value > 0)
        .map((i) => ({
          id: i.id,
          label: t(locale, `panel.whistleblowing.status.${i.id}`),
          value: i.value,
          toneClass: statusToneClassForBar(i.id),
        })),
    };
  }, [aggregates, locale]);

  const categoryBars = useMemo(() => {
    const total = Number(aggregates?.total) || 0;
    if (total < CHART_MIN_N) return null;
    const top = topCategoryCounts(aggregates?.byCategory || [], {
      key: 'category',
      limit: 6,
    });
    if (!top.length) return null;
    return {
      total,
      items: top.map((c) => ({
        id: c.id,
        label: t(locale, `panel.whistleblowing.category.${c.id}`),
        value: c.value,
        toneClass: 'rounded-full bg-info',
      })),
    };
  }, [aggregates, locale]);

  const createChannel = async () => {
    const values = await promptForm({
      title: t(locale, 'panel.whistleblowing.createTitle'),
      fields: [
        {
          key: 'title',
          label: t(locale, 'panel.whistleblowing.channelTitle'),
          required: true,
          maxLength: 200,
        },
        {
          key: 'dueDays',
          label: t(locale, 'panel.whistleblowing.dueDays'),
          type: 'number',
          defaultValue: '15',
        },
      ],
    });
    if (!values) return;
    try {
      const res = await fetch('/api/admin/whistleblowing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: Number(companyId),
          title: values.title,
          dueDays: Number(values.dueDays) || 15,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'create');
      toast(t(locale, 'panel.whistleblowing.created'), 'ok');
      await load();
    } catch (e) {
      toast(e?.message || t(locale, 'panel.whistleblowing.saveError'), 'error');
    }
  };

  const updateReport = async (report, patch) => {
    setBusyId(report.id);
    try {
      const res = await fetch(`/api/admin/whistleblowing/reports/${report.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: Number(companyId), ...patch }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'patch');
      toast(t(locale, 'panel.whistleblowing.updated'), 'ok');
      await load();
    } catch (e) {
      toast(e?.message || t(locale, 'panel.whistleblowing.saveError'), 'error');
    } finally {
      setBusyId(null);
    }
  };

  const triageReport = async (report) => {
    const values = await promptForm({
      title: t(locale, 'panel.whistleblowing.triageTitle'),
      fields: [
        {
          key: 'status',
          label: t(locale, 'panel.whistleblowing.statusLabel'),
          type: 'select',
          defaultValue:
            report.status === WHISTLEBLOWING_REPORT_STATUS.NEW
              ? WHISTLEBLOWING_REPORT_STATUS.TRIAGING
              : report.status,
          options: [
            { value: 'new', label: t(locale, 'panel.whistleblowing.status.new') },
            { value: 'triaging', label: t(locale, 'panel.whistleblowing.status.triaging') },
            { value: 'responded', label: t(locale, 'panel.whistleblowing.status.responded') },
            { value: 'closed', label: t(locale, 'panel.whistleblowing.status.closed') },
          ],
        },
        {
          key: 'triageNotes',
          label: t(locale, 'panel.whistleblowing.triageNotes'),
          type: 'textarea',
          defaultValue: report.triageNotes || '',
          maxLength: 2000,
        },
        {
          key: 'responseNotes',
          label: t(locale, 'panel.whistleblowing.responseNotes'),
          type: 'textarea',
          defaultValue: report.responseNotes || '',
          maxLength: 4000,
        },
      ],
    });
    if (!values) return;
    await updateReport(report, {
      status: values.status,
      triageNotes: values.triageNotes,
      responseNotes: values.responseNotes,
    });
  };

  if (!companyId) {
    return (
      <EmptyState
        title={t(locale, 'panel.whistleblowing.needCompany')}
        description={t(locale, 'panel.whistleblowing.needCompanyHint')}
      />
    );
  }

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title={t(locale, 'panel.whistleblowing.title')}
        description={t(locale, 'panel.whistleblowing.hint')}
        actions={
          <AdminCreateButton
            locale={locale}
            label={t(locale, 'panel.whistleblowing.createChannel')}
            onClick={() => void createChannel()}
          />
        }
      />

      {loading ? (
        <AppLoading variant="panel" />
      ) : (
        <ContentEnter animKey={`wb|${companyId}|${channels.length}|${reports.length}`}>
          {overdueCount > 0 ? (
            <InlineCallout tone="warning" className="mb-3">
              {t(locale, 'panel.whistleblowing.overdueBanner', { n: overdueCount })}
            </InlineCallout>
          ) : null}

          {funnelBars || categoryBars ? (
            <div className="mb-4 grid gap-3 md:grid-cols-2">
              {funnelBars ? (
                <ChartPanel
                  title={t(locale, 'panel.whistleblowing.funnelTitle')}
                  hint={t(locale, 'panel.whistleblowing.funnelHint')}
                >
                  <CategoryBars items={funnelBars.items} total={funnelBars.total} height={8} />
                </ChartPanel>
              ) : null}
              {categoryBars ? (
                <ChartPanel
                  title={t(locale, 'panel.whistleblowing.categoriesTitle')}
                  hint={t(locale, 'panel.whistleblowing.categoriesHint')}
                >
                  <CategoryBars items={categoryBars.items} total={categoryBars.total} height={8} />
                </ChartPanel>
              ) : null}
            </div>
          ) : null}

          <CollapsibleBlock
            locale={locale}
            title={t(locale, 'panel.whistleblowing.channelsTitle')}
            count={channels.length || null}
            defaultOpen={channels.length === 0}
            variant="card"
            collapsedHint={
              channels.length
                ? t(locale, 'panel.whistleblowing.channelsHint', { n: channels.length })
                : t(locale, 'panel.whistleblowing.noChannelsHint')
            }
          >
            {channels.length === 0 ? (
              <EmptyState
                title={t(locale, 'panel.whistleblowing.noChannels')}
                description={t(locale, 'panel.whistleblowing.noChannelsHint')}
              />
            ) : (
              <AdminTableShell locale={locale} minWidth="580px" ariaLabel={t(locale, 'panel.whistleblowing.channelsTitle')}>
                <thead><tr>
                  {['channel', 'deadline', 'status'].map((key) => <AdminTh key={key}>{t(locale, `panel.common.listColumns.${key}`)}</AdminTh>)}
                  <AdminActionsTh>{t(locale, 'panel.admin.colActions')}</AdminActionsTh>
                </tr></thead>
                <tbody className="divide-y divide-ink/5">
                  {channels.map((ch) => <tr key={ch.id} className="hover:bg-canvas-alt/50">
                    <th scope="row" className="px-4 py-3 text-left font-medium text-ink">{ch.title}</th>
                    <td className="px-4 py-3 text-ink-muted">{t(locale, 'panel.whistleblowing.dueDaysMeta', { n: ch.dueDays })}</td>
                    <td className="px-4 py-3 text-ink-muted">{t(locale, ch.active ? 'panel.common.listColumns.active' : 'panel.whistleblowing.inactive')}</td>
                    <td className="px-4 py-3 text-right"><CopyableLink href={ch.publicPath} locale={locale} iconOnly /></td>
                  </tr>)}
                </tbody>
              </AdminTableShell>
            )}
          </CollapsibleBlock>

          <CollapsibleBlock
            locale={locale}
            title={t(locale, 'panel.whistleblowing.inboxTitle')}
            count={openCount || null}
            defaultOpen={openCount > 0 || reports.length > 0}
            variant="card"
            className="mt-3"
            collapsedHint={
              openCount
                ? t(locale, 'panel.whistleblowing.inboxOpenHint', { n: openCount })
                : t(locale, 'panel.whistleblowing.noReports')
            }
          >
            {reports.length === 0 ? (
              <EmptyState title={t(locale, 'panel.whistleblowing.noReports')} />
            ) : (
              <>
                <div className="mb-3">
                  <SegmentedControl
                    aria-label={t(locale, 'panel.whistleblowing.filterAria')}
                    value={inboxFilter}
                    onChange={setInboxFilter}
                    size="sm"
                    options={[
                      {
                        id: 'open',
                        label: t(locale, 'panel.whistleblowing.filterOpen', { n: openCount }),
                      },
                      {
                        id: 'all',
                        label: t(locale, 'panel.whistleblowing.filterAll', {
                          n: reports.length,
                        }),
                      },
                    ]}
                  />
                </div>
                {visibleReports.length === 0 ? (
                  <p className={cn(S.muted, 'm-0 text-prose')}>
                    {t(locale, 'panel.whistleblowing.filterEmpty')}
                  </p>
                ) : (
                  <ul className="m-0 list-none space-y-2 p-0">
                    {visibleReports.map((r) => {
                      const due = formatDue(r.dueAt, locale);
                      return (
                        <li
                          key={r.id}
                          className={cn(
                            'rounded-control border bg-canvas px-3 py-3',
                            isOverdue(r.dueAt, r.status)
                              ? 'border-danger/30'
                              : 'border-ink/12'
                          )}
                        >
                          <div className="mb-2 flex flex-wrap items-center gap-2">
                            <StatusToneChip tone={statusTone(r.status)}>
                              {t(locale, `panel.whistleblowing.status.${r.status}`)}
                            </StatusToneChip>
                            <span className={cn(S.faint)}>
                              {t(locale, `panel.whistleblowing.category.${r.category}`)}
                            </span>
                            {r.anonymous ? (
                              <span className={cn(S.faint)}>
                                {t(locale, 'panel.whistleblowing.anonymous')}
                              </span>
                            ) : null}
                            {isOverdue(r.dueAt, r.status) ? (
                              <StatusToneChip tone="danger">
                                {t(locale, 'panel.whistleblowing.overdue')}
                              </StatusToneChip>
                            ) : due && isOpenStatus(r.status) ? (
                              <span className={cn(S.faint)}>
                                {t(locale, 'panel.whistleblowing.dueOn', { d: due })}
                              </span>
                            ) : null}
                          </div>
                          <p className={cn(S.muted, 'm-0 whitespace-pre-wrap text-prose')}>
                            {r.body}
                          </p>
                          <div className="mt-2">
                            <button
                              type="button"
                              className={cn(S.btnBrandSoft, 'min-h-touch')}
                              disabled={busyId === r.id}
                              onClick={() => void triageReport(r)}
                            >
                              {t(locale, 'panel.whistleblowing.triageCta')}
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </>
            )}
          </CollapsibleBlock>
        </ContentEnter>
      )}
    </div>
  );
}
