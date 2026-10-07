'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { cn } from '../../../lib/cn';
import { t, localeHtmlLang } from '../../../lib/i18n';
import { S, AdminListPager, AdminListSearch, AdminPageHeader, AdminTableShell, AdminTh } from '../dashboard-shared';
import { EmptyState } from '../../_components/EmptyState';
import { AppLoading, ContentEnter } from '../../_components/AppLoading';
import { AdminListFilters, AdminListFilterSelect } from '../../_components/AdminListFilters';
import { DisclosureToggle } from '../../_components/CollapsibleBlock';

function formatActor(row, locale) {
  if (row.actorKind === 'employee') {
    return row.actorCandidateName || row.actorCandidateEmail || `#${row.actorCandidateId || '?'}`;
  }
  if (row.actorKind === 'system') return t(locale, 'panel.audit.actorSystem');
  if (row.actorKind === 'public') return t(locale, 'panel.audit.actorPublic');
  if (row.actorUserEmail) {
    const name = row.actorUserName ? `${row.actorUserName} · ` : '';
    return `${name}${row.actorUserEmail}${row.actorUserRole ? ` (${row.actorUserRole})` : ''}`;
  }
  return row.actorUserId ? `#${row.actorUserId}` : '—';
}

function formatTarget(row) {
  if (!row.targetType && !row.targetId) return '—';
  if (row.targetType && row.targetId) return `${row.targetType} #${row.targetId}`;
  return row.targetType || row.targetId || '—';
}

function metadataPreview(meta) {
  if (!meta || typeof meta !== 'object') return '';
  try {
    const s = JSON.stringify(meta);
    return s.length > 160 ? `${s.slice(0, 157)}…` : s;
  } catch {
    return '';
  }
}

function changeFieldLabel(locale, field) {
  const key = `panel.audit.changeField.${field}`;
  const label = t(locale, key);
  return label === key ? field : label;
}

const TIME_CLOCK_OVERRIDE_LABEL_KEY = Object.freeze({
  null: 'panel.dp.timeClockFollow',
  true: 'panel.dp.timeClockForceOn',
  false: 'panel.dp.timeClockForceOff',
});

function changeValueLabel(locale, value, field) {
  if (field === 'timeClockOverride') return t(locale, TIME_CLOCK_OVERRIDE_LABEL_KEY[String(value ?? null)]);
  if (value == null || value === '') return '—';
  if (typeof value === 'boolean') return t(locale, value ? 'panel.common.yes' : 'panel.common.no');
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}

function AuditChangeList({ changes, locale }) {
  if (!Array.isArray(changes) || !changes.length) return null;
  return (
    <ul className="mt-1.5 mb-0 list-none space-y-0.5 p-0 text-2xs text-ink-muted" aria-label={t(locale, 'panel.audit.changesTitle')}>
      {changes.map((change, index) => (
        <li key={`${change.field}-${index}`} className="break-words">
          <span className="font-semibold text-ink">{changeFieldLabel(locale, change.field)}</span>
          {': '}
          {'from' in change || 'to' in change
            ? `${changeValueLabel(locale, change.from, change.field)} → ${changeValueLabel(locale, change.to, change.field)}`
            : t(locale, 'panel.audit.changedNoValue')}
        </li>
      ))}
    </ul>
  );
}

/**
 * Super admin: trilha de auditoria cross-tenant (append-only).
 */
export function AuditAdminTab({
  navigateDashboard,
  locale,
  companies = [],
  panelCompanyId = null,
  tenantOnly = false,
}) {
  const urlParams = useSearchParams();
  const spKey = urlParams.toString();
  const dateLocale = localeHtmlLang(locale);

  const filters = useMemo(() => {
    const actorKind = (urlParams.get('auditActorKind') || 'all').toLowerCase();
    const rawCompanyParam = urlParams.get('auditCompanyId');
    let companyId = 'all';
    if (rawCompanyParam == null || rawCompanyParam === '') {
      companyId = panelCompanyId ? String(panelCompanyId) : 'all';
    } else if (String(rawCompanyParam).trim() === 'all') {
      companyId = 'all';
    } else {
      companyId = String(rawCompanyParam).trim();
    }
    const targetId = (urlParams.get('auditTargetId') || '').trim();
    const action = (urlParams.get('auditAction') || '').trim();
    const q = (urlParams.get('auditQ') || '').trim();
    const pageRaw = parseInt(urlParams.get('auditPage') || '1', 10);
    const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? pageRaw : 1;
    const sizeRaw = parseInt(urlParams.get('auditPageSize') || '30', 10);
    const pageSize = [20, 30, 50, 100].includes(sizeRaw) ? sizeRaw : 30;
    return {
      targetId,
      actorKind: ['all', 'manager', 'employee', 'system', 'public'].includes(actorKind)
        ? actorKind
        : 'all',
      companyId: tenantOnly ? String(panelCompanyId || '') : companyId,
      action,
      q,
      page,
      pageSize,
    };
  }, [spKey, panelCompanyId, tenantOnly]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [expandedId, setExpandedId] = useState(null);
  const [qDraft, setQDraft] = useState(filters.q);
  const [actionDraft, setActionDraft] = useState(filters.action);
  const [targetDraft, setTargetDraft] = useState(filters.targetId);
  const [exporting, setExporting] = useState(false);
  const [exportNotice, setExportNotice] = useState('');

  useEffect(() => {
    setQDraft(filters.q);
    setActionDraft(filters.action);
    setTargetDraft(filters.targetId);
  }, [filters.q, filters.action, filters.targetId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const qs = new URLSearchParams({
          page: String(filters.page),
          pageSize: String(filters.pageSize),
          actorKind: filters.actorKind,
        });
        if (filters.companyId && filters.companyId !== 'all') qs.set('companyId', filters.companyId);
        if (filters.action) qs.set('action', filters.action);
        if (filters.q) qs.set('q', filters.q);
        if (filters.targetId) { qs.set('targetId', filters.targetId); qs.set('targetType', 'candidate'); }
        const res = await fetch(`/api/admin/audit-log?${qs.toString()}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || t(locale, 'panel.audit.loadFailed'));
        if (!cancelled) {
          setItems(Array.isArray(data.items) ? data.items : []);
          setTotal(typeof data.total === 'number' ? data.total : 0);
          setTotalPages(typeof data.totalPages === 'number' ? data.totalPages : 1);
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
  }, [filters, locale]);

  const pushFilters = (patch) => {
    navigateDashboard({
      tab: 'audit',
      auditActorKind: patch.actorKind !== undefined ? patch.actorKind : filters.actorKind,
      auditCompanyId: patch.companyId !== undefined ? patch.companyId || null : filters.companyId || null,
      auditTargetId: patch.targetId !== undefined ? patch.targetId || null : filters.targetId || null,
      auditAction: patch.action !== undefined ? patch.action || null : filters.action || null,
      auditQ: patch.q !== undefined ? patch.q || null : filters.q || null,
      auditPage: patch.page !== undefined ? patch.page : filters.page,
      auditPageSize: patch.pageSize !== undefined ? patch.pageSize : filters.pageSize,
    });
  };

  const exportCsv = async () => {
    setExporting(true);
    setError('');
    setExportNotice('');
    let objectUrl;
    try {
      const qs = new URLSearchParams({ format: 'csv', actorKind: filters.actorKind });
      if (filters.companyId !== 'all') qs.set('companyId', filters.companyId);
      if (filters.action) qs.set('action', filters.action);
      if (filters.q) qs.set('q', filters.q);
      if (filters.targetId) { qs.set('targetId', filters.targetId); qs.set('targetType', 'candidate'); }
      const response = await fetch(`/api/admin/audit-log?${qs}`);
      if (!response.ok) { const data = await response.json(); throw new Error(data.error || t(locale, 'panel.audit.loadFailed')); }
      objectUrl = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = objectUrl; anchor.download = 'audit.csv'; anchor.click();
      if (response.headers.get('X-Export-Truncated') === 'true') setExportNotice(t(locale, 'panel.audit.exportTruncated'));
    } catch (error) { setError(error.message || t(locale, 'panel.common.error')); }
    finally { if (objectUrl) setTimeout(() => URL.revokeObjectURL(objectUrl), 1000); setExporting(false); }
  };

  return (
    <div className="flex flex-col gap-4">
      <AdminPageHeader
        title={t(locale, 'panel.audit.title')}
        subtitle={t(locale, tenantOnly ? 'panel.audit.tenantIntro' : 'panel.audit.intro')}
        actions={<button type="button" className={S.btnGhost} disabled={exporting || loading} onClick={exportCsv}>{t(locale, exporting ? 'panel.common.loading' : 'panel.audit.exportCsv')}</button>}
      />

      <AdminListFilters
        aria-label={t(locale, 'panel.audit.title')}
        locale={locale}
        onClear={() => {
          setQDraft('');
          setActionDraft('');
          setTargetDraft('');
          pushFilters({ actorKind: 'all', companyId: 'all', action: '', q: '', targetId: '', page: 1 });
        }}
        clearEnabled={Boolean(
          filters.actorKind !== 'all' ||
            (filters.companyId && filters.companyId !== 'all') ||
            filters.action || filters.targetId || targetDraft ||
            filters.q ||
            String(qDraft || '').trim() ||
            String(actionDraft || '').trim()
        )}
      >
        <AdminListFilterSelect
          label={t(locale, 'panel.audit.filterActorKind')}
          value={filters.actorKind}
          onChange={(v) => pushFilters({ actorKind: v, page: 1 })}
        >
          <option value="all">{t(locale, 'panel.audit.actorKindAll')}</option>
          <option value="manager">{t(locale, 'panel.audit.actorKindManager')}</option>
          <option value="employee">{t(locale, 'panel.audit.actorKindEmployee')}</option>
          <option value="system">{t(locale, 'panel.audit.actorKindSystem')}</option>
          <option value="public">{t(locale, 'panel.audit.actorKindPublic')}</option>
        </AdminListFilterSelect>
        {!tenantOnly && (
        <AdminListFilterSelect
          label={t(locale, 'panel.audit.filterCompany')}
          value={filters.companyId === 'all' ? 'all' : String(filters.companyId)}
          onChange={(v) => pushFilters({ companyId: v || 'all', page: 1 })}
        >
          <option value="all">{t(locale, 'dashboard.allCompanies')}</option>
          {(companies || []).map((co) => (
            <option key={co.id} value={String(co.id)}>
              {co.name || `#${co.id}`}
            </option>
          ))}
        </AdminListFilterSelect>
        )}
        <AdminListSearch
          locale={locale}
          label={t(locale, 'panel.audit.filterPersonId')}
          value={targetDraft}
          onChange={setTargetDraft}
          onSubmit={(v) => pushFilters({ targetId: String(v ?? targetDraft).trim(), page: 1 })}
          className="min-w-[10rem] max-w-xs shrink-0 grow-0"
        />
        <AdminListSearch
          locale={locale}
          label={t(locale, 'panel.audit.filterAction')}
          value={actionDraft}
          onChange={setActionDraft}
          onSubmit={(v) => pushFilters({ action: String(v ?? actionDraft).trim(), page: 1 })}
          placeholder={t(locale, 'panel.audit.actionPh')}
          className="min-w-[11rem] max-w-xs shrink-0 grow-0"
        />
        <AdminListSearch
          locale={locale}
          label={t(locale, 'panel.audit.filterSearch')}
          value={qDraft}
          onChange={setQDraft}
          onSubmit={(v) => pushFilters({ q: String(v ?? qDraft).trim(), page: 1 })}
          placeholder={t(locale, 'panel.audit.searchPh')}
          className="min-w-[12rem] max-w-md shrink-0 grow"
        />
      </AdminListFilters>

      {exportNotice ? <p role="status" className={S.muted}>{exportNotice}</p> : null}
      {error ? <p className="m-0 font-mono text-xs text-danger">{error}</p> : null}
      {loading ? <AppLoading locale={locale} variant="panel" /> : null}

      {!loading && !items.length ? (
        <EmptyState
          title={t(locale, 'panel.audit.emptyTitle')}
          message={t(locale, 'panel.audit.emptyBody')}
        />
      ) : null}

      {!loading && items.length ? (
        <ContentEnter animKey={`${total}-${items.length}`}>
        <>
          <p className={cn(S.muted, 'm-0 text-xs')}>{t(locale, 'panel.audit.count', { n: total })}</p>
          <AdminTableShell locale={locale}
            minWidth="880px"
            animKey={`${filters.actorKind}|${filters.companyId}|${filters.action}|${filters.q}|${filters.page}|${filters.pageSize}`}
          >
              <thead>
                <tr className="border-b border-ink/10 bg-ink/[0.03]">
                  <AdminTh>{t(locale, 'panel.audit.colWhen')}</AdminTh>
                  <AdminTh>{t(locale, 'panel.audit.colActor')}</AdminTh>
                  <AdminTh>{t(locale, 'panel.audit.colAction')}</AdminTh>
                  <AdminTh>{t(locale, 'panel.audit.colTarget')}</AdminTh>
                  <AdminTh>{t(locale, 'panel.audit.colCompany')}</AdminTh>
                  <AdminTh>{t(locale, 'panel.audit.colWhere')}</AdminTh>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => {
                  const when = row.createdAt
                    ? new Date(row.createdAt).toLocaleString(dateLocale)
                    : '—';
                  const metaLine = metadataPreview(row.metadata);
                  const open = expandedId === row.id;
                  return (
                    <tr key={row.id} className="border-b border-ink/8 align-top hover:bg-ink/[0.02]">
                      <td className="whitespace-nowrap px-3 py-2.5 font-mono text-2xs text-ink-muted">
                        {when}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="mb-0.5 block font-mono text-2xs uppercase text-ink-faint">
                          {t(locale, `panel.audit.actorKind.${row.actorKind || 'manager'}`)}
                        </span>
                        {formatActor(row, locale)}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="font-mono text-xs">{row.action}</span>
                        <AuditChangeList changes={row.metadata?.changes} locale={locale} />
                      </td>
                      <td className="px-3 py-2.5 font-mono text-xs">{formatTarget(row)}</td>
                      <td className="px-3 py-2.5 text-ink-muted">
                        {row.companyName || (row.companyId ? `#${row.companyId}` : '—')}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="font-mono text-2xs text-ink-muted">{row.requestPath || '—'}</div>
                        {row.requestIp ? (
                          <div className="mt-0.5 font-mono text-2xs text-ink-faint">{row.requestIp}</div>
                        ) : null}
                        {metaLine ? (
                          <button
                            type="button"
                            className="mt-1 inline-flex cursor-pointer items-center border-none bg-transparent p-0 text-left"
                            onClick={() => setExpandedId(open ? null : row.id)}
                            aria-expanded={open}
                          >
                            <DisclosureToggle locale={locale} open={open} />
                          </button>
                        ) : null}
                        {open && row.metadata ? (
                          <pre className="mt-1 max-w-md overflow-x-auto rounded-control border border-ink/10 bg-ink/[0.03] p-2 font-code text-2xs text-ink-muted">
                            {JSON.stringify(row.metadata, null, 2)}
                          </pre>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
          </AdminTableShell>

          <AdminListPager
            locale={locale}
            page={filters.page}
            pageSize={filters.pageSize}
            total={total}
            pageSizeOptions={[20, 30, 50, 100]}
            onPageChange={(p) => pushFilters({ page: p })}
            onPageSizeChange={(ps) => pushFilters({ pageSize: ps, page: 1 })}
          />
        </>
        </ContentEnter>
      ) : null}
    </div>
  );
}
