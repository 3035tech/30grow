'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { cn } from '../../../lib/cn';
import { t, localeHtmlLang } from '../../../lib/i18n';
import { PAGE_SIZE_OPTIONS } from '../../../lib/assessment/assessment-filters';
import { S, AdminListPager, AdminListSearch, AdminPageHeader, AdminTableShell, AdminTh } from '../dashboard-shared';
import { EmptyState } from '../../_components/EmptyState';
import { AppLoading, ContentEnter } from '../../_components/AppLoading';
import { AdminListFilters, AdminListFilterSelect } from '../../_components/AdminListFilters';
import { StatusToneChip } from '../../_components/StatusToneChip';
import { isSignupJobTitle, SIGNUP_JOB_TITLE } from '../../../lib/marketing/signup-job-titles';

function leadStatusTone(status) {
  if (status === 'pending') return 'warning';
  if (status === 'active') return 'success';
  return 'neutral';
}

/**
 * Admin: early-access / self-service leads (lista + status + metadata).
 * Visível só para super admin (admin sem company_id).
 */
export function LeadsAdminTab({ navigateDashboard, locale }) {
  const urlParams = useSearchParams();
  const spKey = urlParams.toString();
  const dateLocale = localeHtmlLang(locale);

  const filters = useMemo(() => {
    const status = (urlParams.get('leadsStatus') || 'all').toLowerCase();
    const q = (urlParams.get('leadsQ') || '').trim();
    const pageRaw = parseInt(urlParams.get('leadsPage') || '1', 10);
    const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? pageRaw : 1;
    const sizeRaw = parseInt(urlParams.get('leadsPageSize') || '20', 10);
    const pageSize = PAGE_SIZE_OPTIONS.includes(sizeRaw) ? sizeRaw : 20;
    return {
      status: ['all', 'pending', 'active', 'inactive'].includes(status) ? status : 'all',
      q,
      page,
      pageSize,
    };
  }, [spKey]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [qDraft, setQDraft] = useState(filters.q);

  useEffect(() => {
    setQDraft(filters.q);
  }, [filters.q]);

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
        });
        if (filters.q) qs.set('q', filters.q);
        const res = await fetch(`/api/admin/leads?${qs.toString()}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || t(locale, 'panel.leads.loadFailed'));
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
  }, [filters.page, filters.pageSize, filters.status, filters.q, locale]);

  const pushFilters = (patch) => {
    if (!navigateDashboard) return;
    navigateDashboard({
      tab: 'leads',
      leadsStatus: patch.status !== undefined ? patch.status : filters.status,
      leadsQ: patch.q !== undefined ? patch.q || null : filters.q || null,
      leadsPage: patch.page !== undefined ? patch.page : filters.page,
      leadsPageSize: patch.pageSize !== undefined ? patch.pageSize : filters.pageSize,
    });
  };

  const formatDate = (iso) => {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString(dateLocale, {
        dateStyle: 'short',
        timeStyle: 'short',
      });
    } catch {
      return '—';
    }
  };

  return (
    <div className={S.stack}>
      <AdminPageHeader
        title={t(locale, 'panel.leads.title')}
        subtitle={t(locale, 'panel.leads.intro')}
      />

      <AdminListFilters
        aria-label={t(locale, 'panel.leads.title')}
        locale={locale}
        onClear={() => {
          setQDraft('');
          pushFilters({ q: '', status: 'all', page: 1 });
        }}
        clearEnabled={Boolean(filters.q || filters.status !== 'all' || String(qDraft || '').trim())}
      >
        <AdminListSearch
          locale={locale}
          value={qDraft}
          onChange={setQDraft}
          onSubmit={(v) => pushFilters({ q: String(v || '').trim(), page: 1 })}
          placeholder={t(locale, 'panel.leads.searchPh')}
          className="min-w-[200px] flex-1"
          inputClassName="w-full max-w-none"
        />
        <AdminListFilterSelect
          label={t(locale, 'panel.leads.filterStatus')}
          value={filters.status}
          onChange={(v) => pushFilters({ status: v, page: 1 })}
        >
          <option value="all">{t(locale, 'panel.leads.statusAll')}</option>
          <option value="pending">{t(locale, 'panel.leads.statusPending')}</option>
          <option value="active">{t(locale, 'panel.leads.statusActive')}</option>
          <option value="inactive">{t(locale, 'panel.leads.statusInactive')}</option>
        </AdminListFilterSelect>
      </AdminListFilters>

      {error ? <p className="m-0 text-sm text-danger">{error}</p> : null}
      {loading ? <AppLoading locale={locale} variant="panel" /> : null}

      {!loading && !error && items.length === 0 ? (
        <EmptyState
          title={t(locale, 'panel.leads.emptyTitle')}
          message={t(locale, 'panel.leads.emptyBody')}
        />
      ) : null}

      {!loading && items.length > 0 ? (
        <ContentEnter animKey={`${filters.status}-${filters.page}-${items.length}`}>
        <>
          <p className={cn(S.faint, 'm-0')}>
            {t(locale, 'panel.leads.count', { n: total })}
          </p>
          <AdminTableShell locale={locale} minWidth="56rem" animKey={`${filters.q}|${filters.status}|${filters.page}|${filters.pageSize}`}>
              <thead>
                <tr className="border-b border-ink/10 bg-canvas/80">
                  <AdminTh>{t(locale, 'panel.leads.colWhen')}</AdminTh>
                  <AdminTh>{t(locale, 'panel.leads.colLead')}</AdminTh>
                  <AdminTh>{t(locale, 'panel.leads.colOrigin')}</AdminTh>
                  <AdminTh>{t(locale, 'panel.leads.colCompany')}</AdminTh>
                  <AdminTh>{t(locale, 'panel.leads.colStatus')}</AdminTh>
                  <AdminTh>{t(locale, 'panel.leads.colMeta')}</AdminTh>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr key={row.id} className="border-b border-ink/6 align-top last:border-0">
                    <td className="px-3 py-3 text-xs text-ink-muted whitespace-nowrap">
                      {formatDate(row.createdAt)}
                    </td>
                    <td className="px-3 py-3">
                      <div className="font-medium text-ink">{row.fullName || '—'}</div>
                      <div className="text-xs text-ink-muted">{row.email}</div>
                      <div className="mt-0.5 font-mono text-2xs text-ink-faint">
                        #{row.id} · {row.role}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <StatusToneChip tone="info">
                        {t(locale, `panel.leads.origin.${row.origin || 'self_service'}`)}
                      </StatusToneChip>
                    </td>
                    <td className="px-3 py-3 text-sm text-ink">
                      {row.companyName || '—'}
                      {row.companyId != null ? (
                        <div className="font-mono text-2xs text-ink-faint">#{row.companyId}</div>
                      ) : null}
                      {row.companySignupAutoCreated ? (
                        <div className="mt-0.5 text-2xs text-ink-faint">
                          {t(locale, 'panel.leads.autoCompany')}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-3">
                      <StatusToneChip tone={leadStatusTone(row.status)} className="uppercase">
                        {t(locale, `panel.leads.status.${row.status}`)}
                      </StatusToneChip>
                      {row.passwordSetupPending ? (
                        <div className="mt-1 text-2xs text-warning">
                          {t(locale, 'panel.leads.setupPending')}
                        </div>
                      ) : null}
                      {row.onboardingCompleted ? (
                        <div className="mt-1 text-2xs text-ink-faint">
                          {t(locale, 'panel.leads.wizardDone')}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-3 text-xs text-ink-muted">
                      {row.jobTitle ? (
                        <div>
                          <span className="text-ink-faint">{t(locale, 'panel.leads.metaJob')}: </span>
                          {isSignupJobTitle(row.jobTitle)
                            ? t(locale, `signup.jobTitleOptions.${row.jobTitle}`)
                            : row.jobTitle}
                          {row.jobTitle === SIGNUP_JOB_TITLE.OTHER && row.jobTitleOther
                            ? `: ${row.jobTitleOther}`
                            : ''}
                        </div>
                      ) : null}
                      {row.teamSize ? (
                        <div>
                          <span className="text-ink-faint">{t(locale, 'panel.leads.metaTeam')}: </span>
                          {row.teamSize}
                        </div>
                      ) : null}
                      {row.painPoints ? (
                        <div className="mt-1 max-w-xs leading-snug">
                          <span className="text-ink-faint">{t(locale, 'panel.leads.metaPain')}: </span>
                          {row.painPoints}
                        </div>
                      ) : null}
                      {!row.jobTitle && !row.teamSize && !row.painPoints ? '—' : null}
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
