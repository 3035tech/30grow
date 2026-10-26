'use client';

import { useListUrlState } from '../hooks/useListUrlState';

/**
 * Succession Admin Tab — critical roles + successors + readiness (B-1005).
 */

import { Fragment, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAppFeedback } from '../../_components/AppFeedback';
import { EmptyState } from '../../_components/EmptyState';
import { AppLoading, ContentEnter } from '../../_components/AppLoading';
import { RichTextView } from '../../_components/RichTextView';
import { PAGE_SIZE_OPTIONS } from '../../../lib/assessment-filters';
import { htmlToPlainText } from '../../../lib/sanitize-html';
import { StatusToneChip } from '../../_components/StatusToneChip';
import { AdminListFilters, AdminListFilterSelect } from '../../_components/AdminListFilters';
import { ChartPanel, ChartLegend } from '../../_components/ChartPanel';
import { StackedSegmentBar } from '../../_components/StackedSegmentBar';
import { cn } from '../../../lib/cn';
import { successionCoverage } from '../../../lib/analytics/chart-aggregates';
import {
  AdminActionsCell,
  AdminActionsTh,
  AdminCreateButton,
  AdminDeleteButton,
  AdminEditButton,
  AdminIconButton,
  AdminListPager,
  AdminListSearch,
  AdminPageHeader,
  AdminTableShell,
  AdminViewButton,
  SortableTh,
  clientSortNextDir,
} from '../dashboard-shared';
import { t as i18nT, contentLocale } from '../../../lib/i18n';

export function SuccessionAdminTab({ locale = 'pt-BR', companyId }) {
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(() => Boolean(companyId));
  const [expandedRoles, setExpandedRoles] = useState(new Set());
  const [successorsByRole, setSuccessorsByRole] = useState({});
  const [page, setPage] = useListUrlState('succession', 'page', 1);
  const [pageSize, setPageSize] = useListUrlState('succession', 'pageSize', 20);
  const [sort, setSort] = useListUrlState('succession', 'sort', 'title');
  const [sortDir, setSortDir] = useListUrlState('succession', 'sortDir', 'asc');
  const [nameQ, setNameQ] = useListUrlState('succession', 'nameQ', '');
  const [impactFilter, setImpactFilter] = useListUrlState('succession', 'impactFilter', '');
  const { confirm, promptForm, toast } = useAppFeedback();

  function t(key, values = {}) {
    const path = `adminModules.succession.${key}`;
    const out = i18nT(locale, path, values);
    return out === path ? key : out;
  }

  function companyQs(prefix = '?') {
    if (!companyId) return '';
    return `${prefix}companyId=${companyId}`;
  }

  function employeesSearchUrl() {
    return companyId
      ? `/api/admin/employees/search?companyId=${companyId}`
      : '/api/admin/employees/search';
  }

  useEffect(() => {
    setSuccessorsByRole({});
    setExpandedRoles(new Set());
    loadRoles();
  }, [companyId]);

  async function loadRoles() {
    if (!companyId) {
      setRoles([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/succession/critical-roles?limit=40${companyQs('&')}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRoles(data.roles || []);
    } catch (err) {
      console.error('Load roles error:', err);
      toast(t('loadError'), 'error');
    } finally {
      setLoading(false);
    }
  }

  async function loadSuccessors(roleId, { force = false } = {}) {
    if (!force && successorsByRole[roleId]) return successorsByRole[roleId];
    try {
      const res = await fetch(
        `/api/admin/succession/critical-roles/${roleId}/successors?limit=20${companyQs('&')}`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list = data.successors || [];
      setSuccessorsByRole((prev) => ({ ...prev, [roleId]: list }));
      return list;
    } catch (err) {
      console.error('Load successors error:', err);
      toast(t('loadError'), 'error');
      return [];
    }
  }

  function roleFormFields(role) {
    return [
      {
        name: 'title',
        label: t('roleTitle'),
        placeholder: t('roleTitlePlaceholder'),
        required: true,
        value: role?.title || '',
      },
      {
        name: 'description',
        label: t('roleDescription'),
        type: 'richText',
        minHeight: 100,
        value: role?.description || '',
      },
      {
        name: 'impactLevel',
        label: t('impactLevel'),
        type: 'select',
        options: [
          { value: 'high', label: t('impactHigh') },
          { value: 'critical', label: t('impactCritical') },
        ],
        value: role?.impactLevel || 'high',
        defaultValue: role?.impactLevel || 'high',
      },
    ];
  }

  async function handleCreateRole() {
    const result = await promptForm({
      title: t('createRoleButton'),
      fields: roleFormFields(null),
    });
    if (!result) return;

    if (!result.title || String(result.title).trim().length === 0) {
      toast(t('errorRoleTitleRequired'), 'error');
      return;
    }

    try {
      const res = await fetch('/api/admin/succession/critical-roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...result,
          ...(companyId ? { companyId } : {}),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast(t('createRoleSuccess'), 'ok');
      loadRoles();
    } catch (err) {
      console.error('Create role error:', err);
      toast(t('saveError'), 'error');
    }
  }

  async function handleEditRole(role) {
    const result = await promptForm({
      title: t('editRoleTitle'),
      fields: roleFormFields(role),
    });
    if (!result) return;

    if (!result.title || String(result.title).trim().length === 0) {
      toast(t('errorRoleTitleRequired'), 'error');
      return;
    }

    try {
      const res = await fetch(`/api/admin/succession/critical-roles/${role.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: result.title,
          description: result.description,
          impactLevel: result.impactLevel,
          ...(companyId ? { companyId } : {}),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast(t('updateRoleSuccess'), 'ok');
      loadRoles();
    } catch (err) {
      console.error('Edit role error:', err);
      toast(t('saveError'), 'error');
    }
  }

  async function handleDeactivateRole(role) {
    const ok = await confirm(t('confirmDeactivate'));
    if (!ok) return;

    try {
      const res = await fetch(
        `/api/admin/succession/critical-roles/${role.id}${companyQs('?')}`,
        { method: 'DELETE' }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast(t('deactivateRoleSuccess'), 'ok');
      loadRoles();
    } catch (err) {
      console.error('Deactivate role error:', err);
      toast(t('saveError'), 'error');
    }
  }

  function readinessOptions() {
    return [
      { value: 'not_ready', label: t('readinessNotReady') },
      { value: 'developing', label: t('readinessDeveloping') },
      { value: 'ready', label: t('readinessReady') },
      { value: 'now', label: t('readinessNow') },
    ];
  }

  async function handleAssignSuccessor(role) {
    const result = await promptForm({
      title: t('assignSuccessor'),
      fields: [
        {
          name: 'successorId',
          label: t('successorCandidate'),
          type: 'entitySearch',
          required: true,
          searchUrl: employeesSearchUrl(),
          placeholder: t('successorCandidatePh'),
          help: t('successorCandidateHelp'),
          minChars: 1,
        },
        {
          name: 'readiness',
          label: t('readiness'),
          type: 'select',
          required: true,
          defaultValue: 'developing',
          options: readinessOptions(),
        },
        {
          name: 'targetDate',
          label: t('targetDate'),
          type: 'date',
          required: false,
        },
        {
          name: 'notes',
          label: t('notes'),
          type: 'richText',
          required: false,
          minHeight: 100,
        },
      ],
    });
    if (!result) return;

    const successorId = Number(result.successorId);
    if (!Number.isFinite(successorId) || successorId <= 0) {
      toast(t('pickEmployee'), 'warning');
      return;
    }

    try {
      const res = await fetch('/api/admin/succession/plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roleId: role.id,
          successorId,
          readiness: result.readiness,
          notes: result.notes,
          targetDate: result.targetDate || null,
          ...(companyId ? { companyId } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) {
        toast(t('alreadyAssigned'), 'warning');
        return;
      }
      if (!res.ok) {
        toast(data.error || t('saveError'), 'error');
        return;
      }
      toast(t('createPlanSuccess'), 'ok');
      await loadSuccessors(role.id, { force: true });
      loadRoles();
    } catch (err) {
      console.error('Assign successor error:', err);
      toast(t('saveError'), 'error');
    }
  }

  async function handleEditSuccessor(role, successor) {
    const result = await promptForm({
      title: t('editReadiness'),
      fields: [
        {
          name: 'readiness',
          label: t('readiness'),
          type: 'select',
          required: true,
          defaultValue: successor.readiness || 'developing',
          options: readinessOptions(),
        },
        {
          name: 'targetDate',
          label: t('targetDate'),
          type: 'date',
          required: false,
          defaultValue: successor.targetDate
            ? String(successor.targetDate).slice(0, 10)
            : '',
        },
        {
          name: 'notes',
          label: t('notes'),
          type: 'richText',
          required: false,
          minHeight: 100,
          defaultValue: successor.notes || '',
        },
      ],
    });
    if (!result) return;

    try {
      const res = await fetch(`/api/admin/succession/plans/${successor.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          readiness: result.readiness,
          notes: result.notes,
          targetDate: result.targetDate || null,
          ...(companyId ? { companyId } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data.error || t('saveError'), 'error');
        return;
      }
      toast(t('updatePlanSuccess'), 'ok');
      await loadSuccessors(role.id, { force: true });
    } catch (err) {
      console.error('Edit successor error:', err);
      toast(t('saveError'), 'error');
    }
  }

  async function handleRemoveSuccessor(role, successor) {
    const ok = await confirm({
      message: t('confirmRemoveSuccessor'),
      danger: true,
      confirmLabel: t('removeSuccessor'),
    });
    if (!ok) return;

    try {
      const res = await fetch(
        `/api/admin/succession/plans/${successor.id}${companyQs('?')}`,
        { method: 'DELETE' }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast(t('deletePlanSuccess'), 'ok');
      await loadSuccessors(role.id, { force: true });
      loadRoles();
    } catch (err) {
      console.error('Remove successor error:', err);
      toast(t('saveError'), 'error');
    }
  }

  function getImpactColor(level) {
    return level === 'critical' ? 'text-danger' : 'text-warning';
  }

  function getImpactLabel(level) {
    if (level === 'critical') return t('impactCritical');
    return t('impactHigh');
  }

  function readinessTone(readiness) {
    switch (readiness) {
      case 'now':
        return 'success';
      case 'ready':
        return 'info';
      case 'developing':
        return 'warning';
      case 'not_ready':
        return 'danger';
      default:
        return 'neutral';
    }
  }

  function getReadinessLabel(readiness) {
    const map = {
      now: 'readinessNow',
      ready: 'readinessReady',
      developing: 'readinessDeveloping',
      not_ready: 'readinessNotReady',
    };
    return map[readiness] ? t(map[readiness]) : readiness;
  }

  async function toggleRole(roleId) {
    const newExpanded = new Set(expandedRoles);
    if (expandedRoles.has(roleId)) {
      newExpanded.delete(roleId);
    } else {
      newExpanded.add(roleId);
      await loadSuccessors(roleId);
    }
    setExpandedRoles(newExpanded);
  }

  const sortedRoles = useMemo(() => {
    const dirMul = sortDir === 'asc' ? 1 : -1;
    const collator = contentLocale(locale);
    const q = String(nameQ || '').trim().toLowerCase();
    const rows = [...roles].filter((row) => {
      if (impactFilter && row.impactLevel !== impactFilter) return false;
      if (!q) return true;
      return String(row.title || '').toLowerCase().includes(q);
    });
    rows.sort((a, b) => {
      if (sort === 'successorCount') {
        return ((Number(a.successorCount) || 0) - (Number(b.successorCount) || 0)) * dirMul;
      }
      if (sort === 'impactLevel') {
        const rank = (v) => (v === 'critical' ? 2 : 1);
        return (rank(a.impactLevel) - rank(b.impactLevel)) * dirMul;
      }
      return String(a.title || '').localeCompare(String(b.title || ''), collator) * dirMul;
    });
    return rows;
  }, [roles, sort, sortDir, locale, nameQ, impactFilter]);

  /** Coverage chart uses unfiltered company roles (pattern, not list filters). */
  const coverage = useMemo(() => successionCoverage(roles), [roles]);
  const coverageRows = useMemo(() => {
    return [...roles]
      .sort((a, b) => {
        const gapA = (Number(a.successorCount) || 0) === 0 ? 0 : 1;
        const gapB = (Number(b.successorCount) || 0) === 0 ? 0 : 1;
        if (gapA !== gapB) return gapA - gapB;
        return (Number(b.successorCount) || 0) - (Number(a.successorCount) || 0);
      })
      .slice(0, 12);
  }, [roles]);

  const roleSegments = (role) => [
    {
      id: 'ready',
      value: Number(role.readyCount) || 0,
      toneClass: 'bg-success',
      label: t('readinessReady'),
    },
    {
      id: 'developing',
      value: Number(role.developingCount) || 0,
      toneClass: 'bg-warning',
      label: t('readinessDeveloping'),
    },
    {
      id: 'notReady',
      value: Number(role.notReadyCount) || 0,
      toneClass: 'bg-danger/70',
      label: t('readinessNotReady'),
    },
  ];

  const total = sortedRoles.length;
  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  const safePage = Math.min(page, totalPages);
  const pageRows = sortedRoles.slice((safePage - 1) * pageSize, safePage * pageSize);

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
        actions={<AdminCreateButton label={t('createRoleButton')} onClick={handleCreateRole} />}
      />

      {roles.length > 0 ? (
        <ChartPanel
          title={t('coverageTitle')}
          hint={
            coverage.empty > 0
              ? t('coverageGapHint').replace('{n}', String(coverage.empty))
              : t('coverageHint')
          }
        >
          <StackedSegmentBar
            segments={[
              {
                id: 'hasReady',
                value: coverage.hasReady,
                toneClass: 'bg-success',
                label: t('coverageReady'),
              },
              {
                id: 'developingOnly',
                value: coverage.developingOnly,
                toneClass: 'bg-warning',
                label: t('coverageDeveloping'),
              },
              {
                id: 'empty',
                value: coverage.empty,
                toneClass: 'bg-danger/70',
                label: t('coverageEmpty'),
              },
            ]}
            height={12}
            className="mb-2"
            aria-label={`${t('coverageReady')}: ${coverage.hasReady}; ${t('coverageDeveloping')}: ${coverage.developingOnly}; ${t('coverageEmpty')}: ${coverage.empty}`}
          />
          <ChartLegend
            className="mb-3"
            total={coverage.roles}
            items={[
              {
                id: 'r',
                toneClass: 'bg-success',
                label: t('coverageReady'),
                value: coverage.hasReady,
              },
              {
                id: 'd',
                toneClass: 'bg-warning',
                label: t('coverageDeveloping'),
                value: coverage.developingOnly,
              },
              {
                id: 'e',
                toneClass: 'bg-danger/70',
                label: t('coverageEmpty'),
                value: coverage.empty,
              },
            ]}
          />
          {coverageRows.length > 0 ? (
            <>
              <div className="mb-1.5 flex items-center gap-3 font-mono text-2xs text-ink-faint">
                <span className="w-[7.5rem] shrink-0 sm:w-[9.5rem]">{t('roleTitle')}</span>
                <span className="min-w-0 flex-1">{t('coverageMix')}</span>
                <span className="w-8 shrink-0 text-right">{t('coverageCountShort')}</span>
              </div>
              <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                {coverageRows.map((role) => {
                  const segs = roleSegments(role);
                  const hasAny = segs.some((s) => s.value > 0);
                  const empty = !hasAny;
                  return (
                    <li
                      key={`cov-${role.id}`}
                      className={cn(
                        'flex items-center gap-3 rounded-control px-1 py-0.5',
                        empty && 'bg-danger/[0.05]'
                      )}
                    >
                      <div
                        className={cn(
                          'w-[7.5rem] shrink-0 truncate text-prose sm:w-[9.5rem]',
                          empty ? 'font-medium text-danger' : 'text-ink'
                        )}
                        title={role.title}
                      >
                        {role.title}
                      </div>
                      {hasAny ? (
                        <StackedSegmentBar
                          segments={segs}
                          height={8}
                          className="min-w-0 flex-1"
                          aria-label={t('coverageRowAria')
                            .replace('{title}', role.title || '')
                            .replace('{ready}', String(role.readyCount || 0))
                            .replace('{developing}', String(role.developingCount || 0))
                            .replace('{notReady}', String(role.notReadyCount || 0))}
                        />
                      ) : (
                        <div className="min-w-0 flex-1">
                          <span className="font-mono text-2xs text-danger">
                            {t('coverageEmpty')}
                          </span>
                        </div>
                      )}
                      <span className="w-8 shrink-0 text-right font-mono text-2xs tabular-nums text-ink-muted">
                        {role.successorCount || 0}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : null}
          {roles.length > coverageRows.length ? (
            <p className="mb-0 mt-2.5 font-mono text-2xs text-ink-faint">
              {t('coverageCap')
                .replace('{shown}', String(coverageRows.length))
                .replace('{total}', String(roles.length))}
            </p>
          ) : null}
        </ChartPanel>
      ) : null}

      {roles.length > 0 ? (
        <AdminListFilters
          aria-label={t('title')}
          locale={locale}
          onClear={() => {
            setNameQ('');
            setImpactFilter('');
            setPage(1);
          }}
          clearEnabled={Boolean(String(nameQ || '').trim() || impactFilter)}
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
            label={t('impactLevel')}
            value={impactFilter}
            onChange={(v) => {
              setImpactFilter(v);
              setPage(1);
            }}
          >
            <option value="">{t('filterAll')}</option>
            <option value="high">{t('impactHigh')}</option>
            <option value="critical">{t('impactCritical')}</option>
          </AdminListFilterSelect>
        </AdminListFilters>
      ) : null}

      {roles.length === 0 ? (
        <div className="flex flex-col gap-3">
          <EmptyState
            title={t('listEmpty')}
            message={t('listEmptyDesc')}
            actionLabel={t('createRoleButton')}
            onAction={handleCreateRole}
          />
          <div className="flex flex-wrap gap-3 px-1">
            <Link href="/dashboard?tab=team" className="font-mono text-xs text-brand-600 hover:underline">
              {t('ctaTeam')} →
            </Link>
            <Link href="/dashboard?tab=help" className="font-mono text-xs text-brand-600 hover:underline">
              {t('ctaHelp')} →
            </Link>
          </div>
        </div>
      ) : (
        <>
        <AdminTableShell locale={locale} minWidth="640px" animKey={`${nameQ}|${impactFilter}|${safePage}|${pageSize}`}>
            <thead className="border-b border-ink/10 bg-canvas-alt">
              <tr>
                <SortableTh columnKey="title" sortKey={sort} dir={sortDir} onSort={toggleSort}>
                  {t('roleTitle')}
                </SortableTh>
                <SortableTh columnKey="impactLevel" sortKey={sort} dir={sortDir} onSort={toggleSort}>
                  {t('impactLevel')}
                </SortableTh>
                <SortableTh columnKey="successorCount" sortKey={sort} dir={sortDir} onSort={toggleSort}>
                  {t('successorsCount')}
                </SortableTh>
                <AdminActionsTh>{t('actions')}</AdminActionsTh>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/5">
              {pageRows.map((role) => {
                const isExpanded = expandedRoles.has(role.id);
                const successors = successorsByRole[role.id] || [];
                return (
                  <Fragment key={role.id}>
                    <tr className="hover:bg-canvas-alt/50">
                      <td className="px-4 py-3">
                        <p className="text-sm font-medium text-ink">{role.title}</p>
                        {role.description ? (
                          <p className="mt-0.5 text-xs text-ink-muted line-clamp-2">
                            {htmlToPlainText(role.description)}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-medium ${getImpactColor(role.impactLevel)}`}>
                          {getImpactLabel(role.impactLevel)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-ink-muted">
                        {role.successorCount || 0}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <AdminActionsCell>
                          <AdminViewButton
                            label={isExpanded ? t('collapse') : t('expand')}
                            icon={isExpanded ? 'chevronDown' : 'expand'}
                            onClick={() => toggleRole(role.id)}
                          />
                          <AdminEditButton label={t('edit')} onClick={() => handleEditRole(role)} />
                          <AdminDeleteButton
                            label={t('deactivate')}
                            onClick={() => handleDeactivateRole(role)}
                          />
                        </AdminActionsCell>
                      </td>
                    </tr>
                    {isExpanded ? (
                      <tr>
                        <td colSpan={4} className="bg-canvas-alt/40 px-4 py-3">
                          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                            <AdminCreateButton
                              variant="secondary"
                              label={t('assignSuccessor')}
                              onClick={() => handleAssignSuccessor(role)}
                            />
                          </div>
                          {successors.length === 0 ? (
                            <div className="rounded-lg border border-dashed border-ink/15 bg-surface/60 px-3 py-4 text-center">
                              <p className="text-xs font-medium text-ink-muted">{t('noSuccessors')}</p>
                              <p className="mt-1 text-2xs text-ink-faint">{t('noSuccessorsHint')}</p>
                            </div>
                          ) : (
                            <ul className="flex flex-col gap-2">
                              {successors.map((successor) => {
                                const personId = successor.successorId || successor.candidateId;
                                return (
                                  <li
                                    key={successor.id}
                                    className="flex items-center justify-between gap-2 rounded-lg border border-ink/8 bg-surface px-3 py-2"
                                  >
                                    <div className="min-w-0 flex-1">
                                      <span className="text-sm text-ink">
                                        {successor.successorName ||
                                          successor.candidateName ||
                                          t('unknownPerson')}
                                      </span>
                                      {personId ? (
                                        <div className="mt-1 flex flex-wrap items-center gap-1">
                                          <AdminIconButton
                                            href={`/dashboard?tab=team&candidate=${personId}`}
                                            label={t('openOnTeam')}
                                            icon="team"
                                          />
                                          {(successor.readiness === 'developing' ||
                                            successor.readiness === 'not_ready') && (
                                            <AdminIconButton
                                              href={`/dashboard?tab=pdi${companyId ? `&company=${encodeURIComponent(companyId)}` : ''}&pdiSearch=${encodeURIComponent(successor.successorName || successor.candidateName || '')}`}
                                              label={t('openPdi')}
                                              icon="clipboard"
                                              tint="info"
                                            />
                                          )}
                                        </div>
                                      ) : null}
                                      {htmlToPlainText(successor.notes || '').trim() ? (
                                        <div className="mt-2">
                                          <RichTextView
                                            html={successor.notes}
                                            className="rounded-control border border-ink/8 bg-canvas px-2 py-1.5 text-xs"
                                          />
                                        </div>
                                      ) : null}
                                    </div>
                                    <div className="flex shrink-0 items-center gap-1">
                                      <StatusToneChip tone={readinessTone(successor.readiness)}>
                                        {getReadinessLabel(successor.readiness)}
                                      </StatusToneChip>
                                      <AdminEditButton
                                        label={t('editReadiness')}
                                        onClick={() => handleEditSuccessor(role, successor)}
                                      />
                                      <AdminDeleteButton
                                        label={t('removeSuccessor')}
                                        onClick={() => handleRemoveSuccessor(role, successor)}
                                      />
                                    </div>
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
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
    </div>
    </ContentEnter>
  );
}
