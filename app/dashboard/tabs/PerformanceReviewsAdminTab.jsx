'use client';

/**
 * Performance Reviews Admin Tab — manage cycles, goals, and reviews → PDI (B-1004).
 * Segment: formal competency reviews (B-RH2-15).
 */

import { useEffect, useMemo, useState } from 'react';
import { t as i18nT, contentLocale } from '../../../lib/i18n';
import { cn } from '../../../lib/cn';
import { useAppFeedback } from '../../_components/AppFeedback';
import { EmptyState } from '../../_components/EmptyState';
import { AppLoading } from '../../_components/AppLoading';
import { PERFORMANCE_CYCLE_STATUS, PERFORMANCE_REVIEW_STATUS } from '../../../lib/domain-status.js';
import { AdminRecordViewDrawer, RECORD_FIELD_KIND } from '../../_components/AdminRecordViewDrawer';
import { PAGE_SIZE_OPTIONS } from '../../../lib/assessment-filters';
import { toDateOnlyIso } from '../../../lib/format-display-date.js';
import { AdminListFilters, AdminListFilterSelect } from '../../_components/AdminListFilters';
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
  AdminIconButton,
  PanelSubNav,
  S,
  SortableTh,
  clientSortNextDir,
} from '../dashboard-shared';
import { NineBoxBlock } from './NineBoxBlock';
import { InlineCallout } from '../../_components/InlineCallout';
import { CalibrationBlock } from '../../_components/CalibrationBlock';
import { StatusToneChip } from '../../_components/StatusToneChip';
import { htmlToPlainText } from '../../../lib/sanitize-html';
import { FormalCompetencyReviewsBlock } from '../../_components/FormalCompetencyReviewsBlock';
import { CompetencyCatalogBlock } from '../../_components/CompetencyCatalogBlock';

const CYCLE_VIEW_REVIEWS_LIMIT = 20;

export function PerformanceReviewsAdminTab({ locale = 'pt-BR', companyId }) {
  const [mode, setMode] = useState('formal');
  const [cycles, setCycles] = useState([]);
  const [loading, setLoading] = useState(() => Boolean(companyId));
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [sort, setSort] = useState('periodStart');
  const [sortDir, setSortDir] = useState('desc');
  const [nameQ, setNameQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedCycle, setSelectedCycle] = useState(null);
  const [viewingCycle, setViewingCycle] = useState(null);
  const [cycleReviews, setCycleReviews] = useState({ cycleId: null, loading: false, error: false, rows: [] });
  const { confirm, notice, promptForm, toast } = useAppFeedback();

  function companyQs(prefix = '?') {
    if (!companyId) return '';
    return `${prefix}companyId=${companyId}`;
  }

  function withCompanyBody(payload) {
    return companyId ? { ...payload, companyId } : payload;
  }

  function t(key, values = {}) {
    const path = `adminModules.performanceReviews.${key}`;
    const out = i18nT(locale, path, values);
    return out === path ? key : out;
  }

  useEffect(() => {
    loadCycles();
  }, [companyId]);

  async function loadCycles() {
    if (!companyId) {
      setCycles([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/performance-cycles?limit=40${companyQs('&')}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setCycles(data.cycles || []);
    } catch (err) {
      console.error('Load cycles error:', err);
      toast(t('loadError'), 'error');
    } finally {
      setLoading(false);
    }
  }

  function cycleFormFields(cycle) {
    return [
      {
        name: 'title',
        label: t('cycleTitle'),
        placeholder: t('cycleTitlePlaceholder'),
        required: true,
        value: cycle?.title || '',
      },
      {
        name: 'description',
        label: t('cycleDescription'),
        type: 'richText',
        minHeight: 100,
        value: cycle?.description || '',
      },
      {
        name: 'periodStart',
        label: t('periodStart'),
        type: 'date',
        row: 'period',
        value: toDateOnlyIso(cycle?.periodStart) || '',
      },
      {
        name: 'periodEnd',
        label: t('periodEnd'),
        type: 'date',
        row: 'period',
        value: toDateOnlyIso(cycle?.periodEnd) || '',
      },
      {
        name: 'allowSelfReview',
        label: t('allowSelfReview'),
        type: 'boolean',
        value: Boolean(cycle?.allowSelfReview),
      },
      {
        name: 'allowPeerReview',
        label: t('allowPeerReview'),
        type: 'boolean',
        value: Boolean(cycle?.allowPeerReview),
      },
      ...(cycle
        ? [
            {
              name: 'status',
              label: t('status'),
              type: 'select',
              value: cycle.status || PERFORMANCE_CYCLE_STATUS.DRAFT,
              options: [
                { value: PERFORMANCE_CYCLE_STATUS.DRAFT, label: t('statusDraft') },
                { value: PERFORMANCE_CYCLE_STATUS.ACTIVE, label: t('statusActive') },
                { value: PERFORMANCE_CYCLE_STATUS.CLOSED, label: t('statusClosed') },
              ],
            },
          ]
        : []),
    ];
  }

  async function handleCreateCycle() {
    const result = await promptForm({
      title: t('createCycleButton'),
      fields: cycleFormFields(null),
    });
    if (!result) return;

    if (!result.title || String(result.title).trim().length === 0) {
      toast(t('errorCycleTitleRequired'), 'error');
      return;
    }

    try {
      const res = await fetch('/api/admin/performance-cycles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(withCompanyBody(result)),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast(t('createCycleSuccess'), 'ok');
      loadCycles();
    } catch (err) {
      console.error('Create cycle error:', err);
      toast(t('saveError'), 'error');
    }
  }

  async function handleEditCycle(cycle) {
    const result = await promptForm({
      title: t('editCycleTitle'),
      fields: cycleFormFields(cycle),
    });
    if (!result) return;

    if (!result.title || String(result.title).trim().length === 0) {
      toast(t('errorCycleTitleRequired'), 'error');
      return;
    }

    try {
      const res = await fetch(`/api/admin/performance-cycles/${cycle.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          withCompanyBody({
            title: result.title,
            description: result.description,
            periodStart: result.periodStart || null,
            periodEnd: result.periodEnd || null,
            status: result.status,
            allowSelfReview: Boolean(result.allowSelfReview),
            allowPeerReview: Boolean(result.allowPeerReview),
          })
        ),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast(t('updateCycleSuccess'), 'ok');
      loadCycles();
    } catch (err) {
      console.error('Edit cycle error:', err);
      toast(t('saveError'), 'error');
    }
  }

  async function handleViewCycle(cycle) {
    setSelectedCycle(cycle);
    setViewingCycle(cycle);
    setCycleReviews({ cycleId: cycle.id, loading: true, error: false, rows: [] });
    let rows = [];
    let error = false;
    try {
      const res = await fetch(
        `/api/admin/performance-cycles/${cycle.id}/reviews?limit=${CYCLE_VIEW_REVIEWS_LIMIT}${
          companyId ? `&companyId=${companyId}` : ''
        }`
      );
      if (res.ok) {
        const data = await res.json();
        rows = data.reviews || [];
      } else {
        error = true;
      }
    } catch {
      error = true;
    }
    setCycleReviews((cur) => (cur.cycleId === cycle.id ? { cycleId: cycle.id, loading: false, error, rows } : cur));
  }

  function cycleViewSections(cycle) {
    const total = Number(cycle.reviewCount || 0);
    let reviewsContent;
    if (cycleReviews.loading) reviewsContent = <AppLoading locale={locale} />;
    else if (cycleReviews.error) {
      reviewsContent = <p className={cn(S.muted, 'm-0')}>{i18nT(locale, 'panel.recordView.reviewsLoadError')}</p>;
    } else if (!cycleReviews.rows.length) {
      reviewsContent = <p className={cn(S.muted, 'm-0')}>{i18nT(locale, 'panel.recordView.reviewsEmpty')}</p>;
    } else {
      reviewsContent = (
        <>
          <ul className="m-0 flex list-none flex-col divide-y divide-ink/5 p-0">
            {cycleReviews.rows.map((r) => {
              const submitted = r.status === PERFORMANCE_REVIEW_STATUS.SUBMITTED;
              return (
                <li key={r.id ?? r.candidateId} className="flex items-center justify-between gap-3 py-2">
                  <span className="min-w-0 break-words text-sm text-ink">
                    {r.candidateName || r.candidateEmail || `#${r.candidateId}`}
                  </span>
                  <StatusToneChip tone={submitted ? 'success' : 'warning'} className="shrink-0">
                    {i18nT(locale, submitted ? 'performanceReviews.reviewSubmitted' : 'performanceReviews.reviewDraft')}
                  </StatusToneChip>
                </li>
              );
            })}
          </ul>
          {total > cycleReviews.rows.length ? (
            <p className={cn(S.muted, 'm-0 mt-2')}>
              {i18nT(locale, 'panel.recordView.reviewsMore', { shown: cycleReviews.rows.length, total })}
            </p>
          ) : null}
        </>
      );
    }
    return [
      {
        key: 'meta',
        fields: [
          { key: 'periodStart', label: t('periodStart'), value: cycle.periodStart ? formatDate(cycle.periodStart) : '' },
          { key: 'periodEnd', label: t('periodEnd'), value: cycle.periodEnd ? formatDate(cycle.periodEnd) : '' },
          {
            key: 'reviews',
            label: t('reviewsCount'),
            value:
              cycle.submittedCount != null
                ? `${total} (${cycle.submittedCount} ${t('submittedCount')})`
                : String(total),
          },
          {
            key: 'description',
            label: t('cycleDescription'),
            value: htmlToPlainText(cycle.description || '') ? cycle.description : '',
            kind: RECORD_FIELD_KIND.HTML,
          },
        ],
      },
      {
        key: 'reviews',
        title: i18nT(locale, 'panel.recordView.sectionReviews'),
        content: reviewsContent,
      },
    ];
  }

  async function handleSideReviewInvite(cycle) {
    if (!cycle.allowSelfReview && !cycle.allowPeerReview) {
      toast(t('sideReviewDisabled'), 'error');
      return;
    }
    const roleOptions = [];
    if (cycle.allowSelfReview) {
      roleOptions.push({ value: 'self', label: t('sideReviewRoleSelf') });
    }
    if (cycle.allowPeerReview) {
      roleOptions.push({ value: 'peer', label: t('sideReviewRolePeer') });
    }
    const result = await promptForm({
      title: t('sideReviewTitle'),
      fields: [
        {
          key: 'candidateId',
          type: 'entitySearch',
          label: t('sideReviewCandidate'),
          searchUrl: companyId
            ? `/api/admin/employees/search?companyId=${encodeURIComponent(companyId)}`
            : '/api/admin/employees/search',
          minChars: 2,
          required: true,
        },
        {
          key: 'role',
          type: 'select',
          label: t('sideReviewRole'),
          required: true,
          options: roleOptions,
          initialValue: roleOptions[0]?.value || 'self',
        },
        {
          key: 'reviewerLabel',
          type: 'text',
          label: t('sideReviewLabel'),
          initialValue: '',
        },
      ],
    });
    if (!result?.candidateId) return;

    try {
      const res = await fetch(`/api/admin/performance-cycles/${cycle.id}/side-reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          candidateId: Number(result.candidateId),
          role: result.role,
          reviewerLabel: result.reviewerLabel,
          companyId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data?.errorCode === 'ITEMS_CAP') {
          toast(t('sideReviewCapError'), 'error');
          return;
        }
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      toast(t('sideReviewCreated'), 'ok');
      await notice({
        title: t('sideReviewCreated'),
        message: data.publicUrl
          ? `${i18nT(locale, 'performanceReviews.sideReview.linkLabel')}:\n${data.publicUrl}`
          : i18nT(locale, 'performanceReviews.sideReview.createdHint'),
        tone: 'ok',
      });
    } catch (err) {
      console.error('Side review invite error:', err);
      toast(t('saveError'), 'error');
    }
  }

  async function handleDeleteCycle(cycle) {
    const ok = await confirm({
      message: t('confirmDelete'),
      danger: true,
      confirmLabel: t('delete'),
    });
    if (!ok) return;
    try {
      const res = await fetch(
        `/api/admin/performance-cycles/${cycle.id}${companyId ? `?companyId=${companyId}` : ''}`,
        { method: 'DELETE' }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json().catch(() => ({}));
      toast(data.mode === 'closed' ? t('closeSuccess') : t('deleteSuccess'), 'ok');
      loadCycles();
    } catch (err) {
      console.error('Delete cycle error:', err);
      toast(t('saveError'), 'error');
    }
  }

  function getStatusTone(status) {
    if (status === PERFORMANCE_CYCLE_STATUS.ACTIVE) return 'success';
    if (status === PERFORMANCE_CYCLE_STATUS.CLOSED) return 'neutral';
    return 'warning';
  }

  function getStatusLabel(status) {
    if (status === PERFORMANCE_CYCLE_STATUS.ACTIVE) return t('statusActive');
    if (status === PERFORMANCE_CYCLE_STATUS.CLOSED) return t('statusClosed');
    return t('statusDraft');
  }

  function formatDate(dateStr) {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString(locale);
  }

  const sortedCycles = useMemo(() => {
    const dirMul = sortDir === 'asc' ? 1 : -1;
    const collator = contentLocale(locale);
    const q = String(nameQ || '').trim().toLowerCase();
    const rows = [...cycles].filter((row) => {
      if (statusFilter && row.status !== statusFilter) return false;
      if (!q) return true;
      return String(row.title || '').toLowerCase().includes(q);
    });
    rows.sort((a, b) => {
      if (sort === 'reviewCount') {
        return ((Number(a.reviewCount) || 0) - (Number(b.reviewCount) || 0)) * dirMul;
      }
      if (sort === 'periodStart') {
        const as = toDateOnlyIso(a.periodStart) || '';
        const bs = toDateOnlyIso(b.periodStart) || '';
        return as.localeCompare(bs) * dirMul;
      }
      if (sort === 'status') {
        return String(a.status || '').localeCompare(String(b.status || ''), collator) * dirMul;
      }
      return String(a.title || '').localeCompare(String(b.title || ''), collator) * dirMul;
    });
    return rows;
  }, [cycles, sort, sortDir, locale, nameQ, statusFilter]);

  const total = sortedCycles.length;
  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  const safePage = Math.min(page, totalPages);
  const pageRows = sortedCycles.slice((safePage - 1) * pageSize, safePage * pageSize);

  const toggleSort = (columnKey) => {
    const nextDir = clientSortNextDir(columnKey, sort, sortDir);
    setSort(columnKey);
    setSortDir(nextDir);
    setPage(1);
  };

  if (!companyId) {
    return <EmptyState title={t('needCompanyTitle')} message={t('needCompanyHint')} />;
  }

  if (loading && mode === 'goals') return <AppLoading variant="panel" />;

  return (
    <div className="flex flex-col gap-6">
      <PanelSubNav
        ariaLabel={t('title')}
        active={mode === 'goals' ? 'formal' : mode}
        onChange={setMode}
        scrollable
        tabs={[
          { id: 'formal', label: i18nT(locale, 'ui.performanceReviewsAdminTab.reviews') },
          { id: 'catalog', label: i18nT(locale, 'ui.performanceReviewsAdminTab.competencies') },
          { id: 'nine-box', label: '9-Box' },
        ]}
      />

      {mode === 'nine-box' ? <NineBoxBlock locale={locale} companyId={companyId} /> : mode === 'catalog' ? <CompetencyCatalogBlock locale={locale} companyId={companyId} /> : mode === 'formal' ? (
        <FormalCompetencyReviewsBlock locale={locale} companyId={companyId} onOpenCatalog={() => setMode('catalog')} />
      ) : (
      <>
      <AdminPageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={<AdminCreateButton label={t('createCycleButton')} onClick={handleCreateCycle} />}
      />
      <InlineCallout tone="info" className="text-prose text-ink-muted">
        {t('autoPdiNote')}
      </InlineCallout>
      <InlineCallout tone="brand" className="text-prose text-ink-muted">
        {t('continuousFeedbackNote')}{' '}
        <a href="/dashboard?tab=team" className="font-medium text-brand-600 hover:underline">
          {t('continuousFeedbackCta')}
        </a>
      </InlineCallout>

      <AdminListFilters
        aria-label={t('title')}
        locale={locale}
        onClear={() => {
          setNameQ('');
          setStatusFilter('');
          setPage(1);
        }}
        clearEnabled={Boolean(String(nameQ || '').trim() || statusFilter)}
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
          label={t('status')}
          value={statusFilter}
          onChange={(v) => {
            setStatusFilter(v);
            setPage(1);
          }}
        >
          <option value="">{t('filterAll')}</option>
          <option value={PERFORMANCE_CYCLE_STATUS.DRAFT}>{t('statusDraft')}</option>
          <option value={PERFORMANCE_CYCLE_STATUS.ACTIVE}>{t('statusActive')}</option>
          <option value={PERFORMANCE_CYCLE_STATUS.CLOSED}>{t('statusClosed')}</option>
        </AdminListFilterSelect>
      </AdminListFilters>

      {cycles.length === 0 ? (
        <EmptyState
          title={t('listEmpty')}
          message={t('listEmptyDesc')}
          actionLabel={t('createCycleButton')}
          onAction={handleCreateCycle}
        />
      ) : (
        <>
        <AdminTableShell locale={locale} minWidth="640px" animKey={`${nameQ}|${statusFilter}|${safePage}|${pageSize}`}>
            <thead className="border-b border-ink/10 bg-canvas-alt">
              <tr>
                <SortableTh columnKey="title" sortKey={sort} dir={sortDir} onSort={toggleSort}>
                  {t('titleCol')}
                </SortableTh>
                <SortableTh columnKey="status" sortKey={sort} dir={sortDir} onSort={toggleSort}>
                  {t('status')}
                </SortableTh>
                <SortableTh columnKey="periodStart" sortKey={sort} dir={sortDir} onSort={toggleSort}>
                  {t('periodStart')}
                </SortableTh>
                <SortableTh columnKey="reviewCount" sortKey={sort} dir={sortDir} onSort={toggleSort}>
                  {t('reviewsCount')}
                </SortableTh>
                <AdminActionsTh>{t('actions')}</AdminActionsTh>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/5">
              {pageRows.map((cycle) => (
                <tr
                  key={cycle.id}
                  className={cn(
                    'hover:bg-canvas-alt/50',
                    selectedCycle?.id === cycle.id && 'bg-brand-500/[0.06]'
                  )}
                >
                  <td className="px-4 py-3">
                    <p className="text-sm font-medium text-ink">{cycle.title}</p>
                    {cycle.description ? (
                      <p className="mt-0.5 text-prose text-ink-muted line-clamp-2">
                        {htmlToPlainText(cycle.description)}
                      </p>
                    ) : null}
                    {cycle.allowSelfReview || cycle.allowPeerReview ? (
                      <p className="mt-1 font-ui text-prose text-ink-muted">
                        {cycle.allowSelfReview ? t('allowSelfReview') : ''}
                        {cycle.allowSelfReview && cycle.allowPeerReview ? ' · ' : ''}
                        {cycle.allowPeerReview ? t('allowPeerReview') : ''}
                      </p>
                    ) : null}
                    {cycle.periodEnd ? (
                      <p className="mt-1 text-prose text-ink/75">
                        {t('periodEnd')}: {formatDate(cycle.periodEnd)}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <StatusToneChip tone={getStatusTone(cycle.status)}>
                      {getStatusLabel(cycle.status)}
                    </StatusToneChip>
                  </td>
                  <td className="px-4 py-3 text-sm text-ink-muted">{formatDate(cycle.periodStart)}</td>
                  <td className="px-4 py-3 text-sm text-ink-muted">
                    {cycle.reviewCount || 0}
                    {cycle.submittedCount != null
                      ? ` (${cycle.submittedCount} ${t('submittedCount')})`
                      : ''}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <AdminActionsCell>
                      <AdminViewButton label={t('view')} onClick={() => handleViewCycle(cycle)} />
                      <AdminEditButton label={t('edit')} onClick={() => handleEditCycle(cycle)} />
                      {cycle.status !== PERFORMANCE_CYCLE_STATUS.CLOSED &&
                      (cycle.allowSelfReview || cycle.allowPeerReview) ? (
                        <AdminIconButton
                          icon="link"
                          label={t('sideReviewButton')}
                          onClick={() => handleSideReviewInvite(cycle)}
                        />
                      ) : null}
                      {cycle.status !== PERFORMANCE_CYCLE_STATUS.CLOSED ? (
                        <AdminDeleteButton
                          label={t('delete')}
                          onClick={() => handleDeleteCycle(cycle)}
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
      {selectedCycle ? (
        <CalibrationBlock
          locale={locale}
          companyId={companyId}
          cycleId={selectedCycle.id}
          cycleTitle={selectedCycle.title || ''}
        />
      ) : null}
      </>
      )}
      <AdminRecordViewDrawer
        open={Boolean(viewingCycle)}
        title={viewingCycle?.title || ''}
        locale={locale}
        onClose={() => setViewingCycle(null)}
        onEdit={viewingCycle ? () => handleEditCycle(viewingCycle) : null}
        editLabel={t('edit')}
        headerMeta={
          viewingCycle ? (
            <StatusToneChip tone={getStatusTone(viewingCycle.status)}>{getStatusLabel(viewingCycle.status)}</StatusToneChip>
          ) : null
        }
        sections={viewingCycle ? cycleViewSections(viewingCycle) : []}
      />
    </div>
  );
}
