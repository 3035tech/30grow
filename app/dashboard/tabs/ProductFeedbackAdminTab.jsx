'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { cn } from '../../../lib/cn';
import { t, localeHtmlLang } from '../../../lib/i18n';
import { PAGE_SIZE_OPTIONS } from '../../../lib/assessment-filters';
import {
  PRODUCT_FEEDBACK_KIND,
  PRODUCT_FEEDBACK_KINDS,
  PRODUCT_FEEDBACK_SEVERITY,
  PRODUCT_FEEDBACK_SEVERITIES,
  PRODUCT_FEEDBACK_STATUS,
  PRODUCT_FEEDBACK_STATUSES,
} from '../../../lib/domain-status';
import { COMPANY_MODULES } from '../../../lib/company-modules';
import {
  S,
  AdminListPager,
  AdminListSearch,
  AdminPageHeader,
  AdminTableShell,
  AdminTh,
  AdminEditButton,
  AdminActionsCell,
  AdminActionsTh,
} from '../dashboard-shared';
import { EmptyState } from '../../_components/EmptyState';
import { AppLoading, ContentEnter } from '../../_components/AppLoading';
import { AdminListFilters, AdminListFilterSelect } from '../../_components/AdminListFilters';
import { StatusToneChip } from '../../_components/StatusToneChip';
import { StatMetricTile } from '../../_components/StatMetricTile';
import { useAppFeedback } from '../../_components/AppFeedback';
import { InlineCallout } from '../../_components/InlineCallout';

const STATUS_FILTERS = ['all', 'open', ...PRODUCT_FEEDBACK_STATUSES];

function statusTone(status) {
  if (status === PRODUCT_FEEDBACK_STATUS.NEW) return 'info';
  if (status === PRODUCT_FEEDBACK_STATUS.REVIEWING) return 'warning';
  if (status === PRODUCT_FEEDBACK_STATUS.DONE) return 'success';
  return 'neutral';
}

function kindTone(kind) {
  if (kind === PRODUCT_FEEDBACK_KIND.BUG) return 'danger';
  if (kind === PRODUCT_FEEDBACK_KIND.UX || kind === PRODUCT_FEEDBACK_KIND.COMMERCIAL) return 'warning';
  return 'info';
}

function severityTone(severity) {
  if (severity === PRODUCT_FEEDBACK_SEVERITY.CRITICAL || severity === PRODUCT_FEEDBACK_SEVERITY.HIGH) return 'danger';
  if (severity === PRODUCT_FEEDBACK_SEVERITY.MEDIUM) return 'warning';
  return 'neutral';
}

const moduleLabel = (locale, moduleKey) =>
  moduleKey ? t(locale, `onboarding.modules.item.${moduleKey}.title`) : t(locale, 'panel.productFeedback.moduleNone');

/**
 * Super-admin support inbox: bugs, questions, sales requests and ideas from managers.
 */
export function ProductFeedbackAdminTab({ locale = 'pt-BR', navigateDashboard }) {
  const { promptForm, toast } = useAppFeedback();
  const urlParams = useSearchParams();
  const spKey = urlParams.toString();
  const dateLocale = localeHtmlLang(locale);

  const filters = useMemo(() => {
    const pick = (key, allowed, fallback = 'all') => {
      const raw = (urlParams.get(key) || fallback).toLowerCase();
      return allowed.includes(raw) ? raw : fallback;
    };
    const pageRaw = parseInt(urlParams.get('fbPage') || '1', 10);
    const sizeRaw = parseInt(urlParams.get('fbPageSize') || '20', 10);
    return {
      status: pick('fbStatus', STATUS_FILTERS),
      kind: pick('fbKind', ['all', ...PRODUCT_FEEDBACK_KINDS]),
      severity: pick('fbSeverity', ['all', ...PRODUCT_FEEDBACK_SEVERITIES]),
      module: pick('fbModule', ['all', ...COMPANY_MODULES]),
      overdue: urlParams.get('fbOverdue') === '1',
      q: (urlParams.get('fbQ') || '').trim(),
      page: Number.isFinite(pageRaw) && pageRaw >= 1 ? pageRaw : 1,
      pageSize: PAGE_SIZE_OPTIONS.includes(sizeRaw) ? sizeRaw : 20,
    };
  }, [spKey]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState(null);
  const [assignees, setAssignees] = useState([]);
  const [qDraft, setQDraft] = useState(filters.q);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    setQDraft(filters.q);
  }, [filters.q]);

  const pushFilters = (patch) => {
    if (!navigateDashboard) return;
    const next = { ...filters, ...patch };
    navigateDashboard({
      tab: 'product-feedback',
      fbStatus: next.status,
      fbKind: next.kind,
      fbSeverity: next.severity,
      fbModule: next.module,
      fbOverdue: next.overdue ? '1' : null,
      fbQ: next.q || null,
      fbPage: next.page,
      fbPageSize: next.pageSize,
    });
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const qs = new URLSearchParams({
          page: String(filters.page),
          pageSize: String(filters.pageSize),
          status: filters.status,
          kind: filters.kind,
          severity: filters.severity,
          module: filters.module,
        });
        if (filters.overdue) qs.set('overdue', '1');
        if (filters.q) qs.set('q', filters.q);
        const res = await fetch(`/api/admin/product-feedback?${qs.toString()}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || t(locale, 'panel.productFeedback.loadFailed'));
        if (!cancelled) {
          setItems(Array.isArray(data.items) ? data.items : []);
          setTotal(typeof data.total === 'number' ? data.total : 0);
          setSummary(data.summary || null);
          setAssignees(Array.isArray(data.assignees) ? data.assignees : []);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e?.message || t(locale, 'panel.common.error'));
          setItems([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [filters.page, filters.pageSize, filters.status, filters.kind, filters.severity, filters.module, filters.overdue, filters.q, locale, reloadKey]);

  const formatWhen = (iso) => {
    const na = t(locale, 'panel.common.notApplicable');
    if (!iso) return na;
    try {
      return new Date(iso).toLocaleString(dateLocale, { dateStyle: 'short', timeStyle: 'short' });
    } catch {
      return na;
    }
  };

  const reviewItem = async (row) => {
    const result = await promptForm({
      title: t(locale, 'panel.productFeedback.reviewTitle'),
      message: `#${row.id} · ${t(locale, `panel.productFeedback.kind.${row.kind}`)}`,
      fields: [
        {
          key: 'status',
          label: t(locale, 'panel.productFeedback.colStatus'),
          type: 'select',
          defaultValue: row.status,
          options: PRODUCT_FEEDBACK_STATUSES.map((s) => ({ value: s, label: t(locale, `panel.productFeedback.status.${s}`) })),
        },
        {
          key: 'severity',
          label: t(locale, 'panel.productFeedback.severityLabel'),
          type: 'select',
          defaultValue: row.severity,
          options: PRODUCT_FEEDBACK_SEVERITIES.map((s) => ({ value: s, label: t(locale, `panel.productFeedback.severity.${s}`) })),
        },
        {
          key: 'moduleKey',
          label: t(locale, 'panel.productFeedback.colModule'),
          type: 'select',
          defaultValue: row.moduleKey || '',
          options: [
            { value: '', label: t(locale, 'panel.productFeedback.moduleNone') },
            ...COMPANY_MODULES.map((m) => ({ value: m, label: moduleLabel(locale, m) })),
          ],
        },
        {
          key: 'assigneeUserId',
          label: t(locale, 'panel.productFeedback.assigneeLabel'),
          type: 'select',
          defaultValue: row.assigneeUserId ? String(row.assigneeUserId) : '',
          options: [
            { value: '', label: t(locale, 'panel.productFeedback.assigneeNone') },
            ...assignees.map((a) => ({ value: String(a.id), label: a.displayName || a.email })),
          ],
        },
        {
          key: 'duplicateOfId',
          label: t(locale, 'panel.productFeedback.duplicateOfLabel'),
          type: 'number',
          defaultValue: row.duplicateOfId ? String(row.duplicateOfId) : '',
          help: t(locale, 'panel.productFeedback.duplicateOfHint'),
        },
        {
          key: 'adminNotes',
          label: t(locale, 'panel.productFeedback.adminNotes'),
          type: 'textarea',
          defaultValue: row.adminNotes || '',
          rows: 4,
          maxLength: 4000,
        },
      ],
    });
    if (!result) return;
    const toId = (v) => {
      const n = parseInt(String(v ?? '').trim(), 10);
      return Number.isFinite(n) && n > 0 ? n : null;
    };
    try {
      const res = await fetch(`/api/admin/product-feedback/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: result.status,
          severity: result.severity,
          moduleKey: result.moduleKey || null,
          assigneeUserId: toId(result.assigneeUserId),
          duplicateOfId: toId(result.duplicateOfId),
          adminNotes: result.adminNotes ?? '',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || t(locale, 'panel.productFeedback.saveFailed'));
      toast(t(locale, 'panel.productFeedback.saved'), 'ok');
      setReloadKey((k) => k + 1);
    } catch (e) {
      toast(e?.message || t(locale, 'panel.productFeedback.saveFailed'), 'error');
    }
  };

  const filtersActive = Boolean(
    String(qDraft || '').trim() ||
      filters.status !== 'all' ||
      filters.kind !== 'all' ||
      filters.severity !== 'all' ||
      filters.module !== 'all' ||
      filters.overdue
  );

  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader
        title={t(locale, 'panel.productFeedback.title')}
        subtitle={t(locale, 'panel.productFeedback.intro')}
      />

      <InlineCallout tone="info">{t(locale, 'panel.productFeedback.superAdminHint')}</InlineCallout>

      {summary ? (
        <section className="flex flex-col gap-3" aria-label={t(locale, 'panel.productFeedback.summaryHint', { days: summary.responseBusinessDays })}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatMetricTile
              value={summary.open}
              label={t(locale, 'panel.productFeedback.summaryOpen')}
              onClick={() => pushFilters({ status: 'open', overdue: false, page: 1 })}
            />
            <StatMetricTile value={summary.awaitingResponse} label={t(locale, 'panel.productFeedback.summaryAwaiting')} />
            <StatMetricTile
              value={summary.overdue}
              label={t(locale, 'panel.productFeedback.summaryOverdue')}
              className={summary.overdue > 0 ? 'border-danger/50 bg-danger/[0.05]' : ''}
              onClick={() => pushFilters({ overdue: true, page: 1 })}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {PRODUCT_FEEDBACK_KINDS.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => pushFilters({ status: 'open', kind: k, page: 1 })}
                className={cn(S.filterChip, 'min-h-touch')}
              >
                {t(locale, `panel.productFeedback.kind.${k}`)} · {summary.openByKind?.[k] ?? 0}
              </button>
            ))}
          </div>
          {summary.topModules?.length ? (
            <p className={cn(S.muted, 'm-0')}>
              {t(locale, 'panel.productFeedback.summaryTopModules')}:{' '}
              {summary.topModules.map((m) => `${moduleLabel(locale, m.moduleKey)} (${m.n})`).join(' · ')}
            </p>
          ) : null}
          <p className={cn(S.faint, 'm-0')}>
            {t(locale, 'panel.productFeedback.summaryHint', { days: summary.responseBusinessDays })}
          </p>
        </section>
      ) : null}

      <AdminListFilters
        aria-label={t(locale, 'panel.productFeedback.title')}
        locale={locale}
        onClear={() => {
          setQDraft('');
          pushFilters({ status: 'all', kind: 'all', severity: 'all', module: 'all', overdue: false, q: '', page: 1 });
        }}
        clearEnabled={filtersActive}
      >
        <AdminListSearch
          locale={locale}
          value={qDraft}
          onChange={setQDraft}
          onSubmit={(v) => pushFilters({ q: String(v || '').trim(), page: 1 })}
          placeholder={t(locale, 'panel.productFeedback.searchPh')}
          className="min-w-[200px] flex-1"
          inputClassName="w-full max-w-none"
        />
        <AdminListFilterSelect
          label={t(locale, 'panel.productFeedback.filterStatus')}
          value={filters.status}
          onChange={(v) => pushFilters({ status: v, page: 1 })}
        >
          <option value="all">{t(locale, 'panel.productFeedback.statusAll')}</option>
          <option value="open">{t(locale, 'panel.productFeedback.statusOpen')}</option>
          {PRODUCT_FEEDBACK_STATUSES.map((s) => (
            <option key={s} value={s}>{t(locale, `panel.productFeedback.status.${s}`)}</option>
          ))}
        </AdminListFilterSelect>
        <AdminListFilterSelect
          label={t(locale, 'panel.productFeedback.filterKind')}
          value={filters.kind}
          onChange={(v) => pushFilters({ kind: v, page: 1 })}
        >
          <option value="all">{t(locale, 'panel.productFeedback.kindAll')}</option>
          {PRODUCT_FEEDBACK_KINDS.map((k) => (
            <option key={k} value={k}>{t(locale, `panel.productFeedback.kind.${k}`)}</option>
          ))}
        </AdminListFilterSelect>
        <AdminListFilterSelect
          label={t(locale, 'panel.productFeedback.filterSeverity')}
          value={filters.severity}
          onChange={(v) => pushFilters({ severity: v, page: 1 })}
        >
          <option value="all">{t(locale, 'panel.productFeedback.severityAll')}</option>
          {PRODUCT_FEEDBACK_SEVERITIES.map((s) => (
            <option key={s} value={s}>{t(locale, `panel.productFeedback.severityShort.${s}`)}</option>
          ))}
        </AdminListFilterSelect>
        <AdminListFilterSelect
          label={t(locale, 'panel.productFeedback.filterModule')}
          value={filters.module}
          onChange={(v) => pushFilters({ module: v, page: 1 })}
        >
          <option value="all">{t(locale, 'panel.productFeedback.moduleAll')}</option>
          {COMPANY_MODULES.map((m) => (
            <option key={m} value={m}>{moduleLabel(locale, m)}</option>
          ))}
        </AdminListFilterSelect>
        <AdminListFilterSelect
          label={t(locale, 'panel.productFeedback.filterOverdue')}
          value={filters.overdue ? '1' : 'all'}
          onChange={(v) => pushFilters({ overdue: v === '1', page: 1 })}
        >
          <option value="all">{t(locale, 'panel.productFeedback.overdueAll')}</option>
          <option value="1">{t(locale, 'panel.productFeedback.overdueOnly')}</option>
        </AdminListFilterSelect>
      </AdminListFilters>

      {error ? <p className="m-0 text-sm text-danger">{error}</p> : null}
      {loading ? <AppLoading locale={locale} variant="panel" /> : null}

      {!loading && !error && items.length === 0 ? (
        <ContentEnter animKey={`fb-empty|${spKey}`}>
          <EmptyState
            title={t(locale, 'panel.productFeedback.emptyTitle')}
            message={t(locale, 'panel.productFeedback.emptyBody')}
          />
        </ContentEnter>
      ) : null}

      {!loading && items.length > 0 ? (
        <ContentEnter animKey={`${spKey}-${items.length}`}>
          <>
            <p className={cn(S.muted, 'm-0 text-xs')}>
              {t(locale, 'panel.productFeedback.count', { n: total })}
            </p>
            <AdminTableShell
              locale={locale}
              minWidth="1040px"
              ariaLabel={t(locale, 'panel.productFeedback.title')}
              animKey={`fb-${reloadKey}-${items.map((r) => r.id).join(',')}`}
            >
              <thead>
                <tr>
                  <AdminTh>{t(locale, 'panel.productFeedback.colId')}</AdminTh>
                  <AdminTh>{t(locale, 'panel.productFeedback.colKind')}</AdminTh>
                  <AdminTh>{t(locale, 'panel.productFeedback.colMessage')}</AdminTh>
                  <AdminTh>{t(locale, 'panel.productFeedback.colFrom')}</AdminTh>
                  <AdminTh>{t(locale, 'panel.productFeedback.colModule')}</AdminTh>
                  <AdminTh>{t(locale, 'panel.productFeedback.colSla')}</AdminTh>
                  <AdminTh>{t(locale, 'panel.productFeedback.colOwner')}</AdminTh>
                  <AdminTh>{t(locale, 'panel.productFeedback.colStatus')}</AdminTh>
                  <AdminActionsTh />
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr key={row.id}>
                    <td className="whitespace-nowrap font-mono text-2xs text-ink-muted">
                      #{row.id}
                      <div>{formatWhen(row.createdAt)}</div>
                    </td>
                    <td>
                      <div className="flex flex-col items-start gap-1">
                        <StatusToneChip tone={kindTone(row.kind)}>
                          {t(locale, `panel.productFeedback.kind.${row.kind}`)}
                        </StatusToneChip>
                        <StatusToneChip tone={severityTone(row.severity)}>
                          {t(locale, `panel.productFeedback.severityShort.${row.severity}`)}
                        </StatusToneChip>
                      </div>
                    </td>
                    <td className="max-w-md">
                      <p className="m-0 whitespace-pre-wrap text-prose text-ink">{row.message}</p>
                      {row.duplicateOfId ? (
                        <p className="m-0 mt-1 text-2xs text-ink-muted">
                          {t(locale, 'panel.productFeedback.duplicateBadge', { id: row.duplicateOfId })}
                        </p>
                      ) : null}
                      {row.duplicateCount > 0 ? (
                        <p className="m-0 mt-1 text-2xs font-medium text-ink">
                          {t(locale, 'panel.productFeedback.duplicatesCount', { n: row.duplicateCount })}
                        </p>
                      ) : null}
                      {row.adminNotes ? (
                        <p className="m-0 mt-1 text-2xs text-ink-faint">
                          {t(locale, 'panel.productFeedback.adminNotes')}: {row.adminNotes}
                        </p>
                      ) : null}
                    </td>
                    <td className="text-prose">
                      <div className="font-medium text-ink">
                        {row.userName || row.userEmail || t(locale, 'panel.common.notApplicable')}
                      </div>
                      {row.userEmail && row.userName ? (
                        <div className="text-2xs text-ink-faint">{row.userEmail}</div>
                      ) : null}
                      <div className="text-2xs text-ink-muted">
                        {row.companyName || t(locale, 'panel.productFeedback.noCompany')}
                        {row.companySlug ? ` · ${row.companySlug}` : ''}
                      </div>
                      {!row.contactOk ? (
                        <div className="text-2xs text-warning">{t(locale, 'panel.productFeedback.noContact')}</div>
                      ) : null}
                    </td>
                    <td className="text-prose text-ink-muted">
                      {moduleLabel(locale, row.moduleKey)}
                      <div className="font-mono text-2xs text-ink-faint">
                        {row.activeTab || t(locale, 'panel.common.notApplicable')}
                        {row.activeSection ? ` / ${row.activeSection}` : ''}
                      </div>
                    </td>
                    <td className="text-2xs">
                      {row.answered ? (
                        <span className="text-success">
                          {t(locale, 'panel.productFeedback.slaAnswered', { date: formatWhen(row.firstResponseAt) })}
                        </span>
                      ) : row.overdue ? (
                        <span className="font-medium text-danger">
                          {t(locale, 'panel.productFeedback.slaOverdue', { date: formatWhen(row.dueAt) })}
                        </span>
                      ) : (
                        <span className="text-ink-muted">
                          {t(locale, 'panel.productFeedback.slaDue', { date: formatWhen(row.dueAt) })}
                        </span>
                      )}
                    </td>
                    <td className="text-prose text-ink-muted">
                      {row.assigneeName || row.assigneeEmail || t(locale, 'panel.productFeedback.assigneeNone')}
                    </td>
                    <td>
                      <StatusToneChip tone={statusTone(row.status)}>
                        {t(locale, `panel.productFeedback.status.${row.status}`)}
                      </StatusToneChip>
                    </td>
                    <td className="text-right">
                      <AdminActionsCell>
                        <AdminEditButton
                          label={t(locale, 'panel.productFeedback.review')}
                          onClick={() => void reviewItem(row)}
                        />
                      </AdminActionsCell>
                    </td>
                  </tr>
                ))}
              </tbody>
            </AdminTableShell>

            <AdminListPager
              locale={locale}
              page={filters.page}
              pageSize={filters.pageSize}
              total={total}
              onPageChange={(p) => pushFilters({ page: p })}
              onPageSizeChange={(ps) => pushFilters({ pageSize: ps, page: 1 })}
            />
          </>
        </ContentEnter>
      ) : null}
    </div>
  );
}
