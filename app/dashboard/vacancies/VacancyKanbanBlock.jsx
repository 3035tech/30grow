'use client';

import { SelectField } from '../../_components/SelectField';

import { useEffect, useMemo, useState } from 'react';
import { cn } from '../../../lib/cn';
import { DisclosureToggle } from '../../_components/CollapsibleBlock';
import { t } from '../../../lib/i18n';
import { titleCasePersonName } from '../../../lib/person-name';
import { PIPELINE_STAGE } from '../../../lib/pipeline';
import { OFFER_STATUS } from '../../../lib/domain-status';
import { useDarkMode } from '../../_components/DarkModeProvider';
import { getKanbanStages } from '../dashboard-shared';
import { rejectionReasonLabel } from '../pipeline-prompts';
import { usePipelineExtras } from '../PipelineExtrasContext';
import { formatRelativeAgo, inviteStatusShort, daysInStage, stageAgingTone } from './vacancy-admin-shared';
import { VacancyOfferBlock } from './VacancyOfferBlock';
import { EmptyState } from '../../_components/EmptyState';
import { AppLoading } from '../../_components/AppLoading';
import { useAppFeedback } from '../../_components/AppFeedback';

const EMPTY_FILTERS = Object.freeze({ q: '', owner: 'all', aging: 'all', fit: 'all', notes: false });

export function VacancyKanbanBlock({ vacancyId, locale, refreshKey = 0, onPersonClick = null, companyStages = null, companyId = null }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [moving, setMoving] = useState(null);
  const [draggingId, setDraggingId] = useState(null);
  const [dragOverStage, setDragOverStage] = useState(null);
  const [fetchedStages, setFetchedStages] = useState(null);
  const [compact, setCompact] = useState(false);
  const [hideEmpty, setHideEmpty] = useState(false);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [workspace, setWorkspace] = useState({ recruiters: [], views: [], currentUserId: null, vacancyOwnerUserId: null });
  const [workspaceLoading, setWorkspaceLoading] = useState(true);
  const [collapsedStages, setCollapsedStages] = useState([]);
  const { promptForm, toast, confirm } = useAppFeedback();
  const { isDark } = useDarkMode();
  const effectiveCompanyStages = companyStages ?? fetchedStages;
  const stages = useMemo(
    () => getKanbanStages(locale, { isDark, companyStages: effectiveCompanyStages }),
    [locale, isDark, effectiveCompanyStages]
  );
  const stageById = useMemo(() => Object.fromEntries(stages.map((s) => [s.id, s])), [stages]);
  const { requestPipelineExtras } = usePipelineExtras();

  const loadWorkspace = async () => {
    setWorkspaceLoading(true);
    try {
      const params = new URLSearchParams({ vacancyId: String(vacancyId) });
      if (companyId) params.set('companyId', String(companyId));
      const response = await fetch(`/api/admin/recruiting-workspace?${params.toString()}`);
      const data = await response.json().catch(() => ({}));
      if (response.ok) {
        setWorkspace({
          recruiters: Array.isArray(data.recruiters) ? data.recruiters : [],
          views: Array.isArray(data.views) ? data.views : [],
          currentUserId: data.currentUserId || null,
          vacancyOwnerUserId: data.vacancyOwnerUserId || null,
        });
      }
    } finally {
      setWorkspaceLoading(false);
    }
  };

  useEffect(() => { void loadWorkspace(); }, [vacancyId, companyId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (companyStages) return () => {};
    let cancelled = false;
    (async () => {
      try {
        const params = new URLSearchParams({ vacancyId: String(vacancyId) });
        if (companyId) params.set('companyId', String(companyId));
        const res = await fetch(`/api/admin/pipeline-stages?${params.toString()}`);
        const data = await res.json().catch(() => ({}));
        if (!cancelled && res.ok && Array.isArray(data.stages)) {
          setFetchedStages(data.stages);
        }
      } catch (_e) {
        // fallback: use hard-coded canonical stages
      }
    })();
    return () => { cancelled = true; };
  }, [companyStages, vacancyId, companyId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr('');
      try {
        const res = await fetch(`/api/admin/vacancies/${encodeURIComponent(vacancyId)}/ranking`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || t(locale, 'panel.common.error'));
        if (!cancelled) setRows(Array.isArray(data.ranking) ? data.ranking : []);
      } catch (e) {
        if (!cancelled) setErr(e?.message || t(locale, 'panel.common.error'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [vacancyId, refreshKey, locale]);

  const cardKey = (r) =>
    r.assessmentId != null ? `a:${r.assessmentId}` : `vc:${r.vacancyCandidateId}`;

  const moveTo = async (row, stage) => {
    const stageObj = stageById[stage] || { id: stage, canonicalKey: stage };
    const extras = await requestPipelineExtras(locale, stageObj);
    if (extras == null) return;
    const key = cardKey(row);
    setMoving(key);
    // Optimistic column move; restored from `row` if the PATCH fails.
    setRows((prev) => prev.map((r) => (cardKey(r) === key ? { ...r, pipelineStage: stage } : r)));
    try {
      if (row.pendingTest || !row.assessmentId) {
        const res = await fetch(
          `/api/admin/vacancies/${encodeURIComponent(vacancyId)}/candidates/${encodeURIComponent(row.candidateId)}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pipelineStage: stage, ...extras }),
          }
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || t(locale, 'panel.common.error'));
        setRows((prev) =>
          prev.map((r) => (cardKey(r) === key ? {
            ...r,
            pipelineStage: stage,
            rejectionReason: data.rejectionReason ?? extras.rejectionReason ?? r.rejectionReason,
            startDate: data.startDate ?? extras.startDate ?? r.startDate,
          } : r))
        );
      } else {
        const res = await fetch(`/api/admin/assessments/${encodeURIComponent(row.assessmentId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pipelineStage: stage, ...extras }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || t(locale, 'panel.common.error'));
        setRows((prev) =>
          prev.map((r) => (cardKey(r) === key ? {
            ...r,
            pipelineStage: stage,
            rejectionReason: data.rejectionReason ?? extras.rejectionReason ?? r.rejectionReason,
            startDate: data.startDate ?? extras.startDate ?? r.startDate,
          } : r))
        );
      }
    } catch (e) {
      setRows((prev) => prev.map((r) => (cardKey(r) === key ? { ...r, pipelineStage: row.pipelineStage } : r)));
      setErr(e?.message || t(locale, 'recruiting.moveCandidateError'));
    } finally {
      setMoving(null);
    }
  };

  const filteredRows = useMemo(() => rows.filter((row) => {
    const needle = filters.q.trim().toLocaleLowerCase(locale);
    if (needle && !`${row.name || ''} ${row.email || ''}`.toLocaleLowerCase(locale).includes(needle)) return false;
    if (filters.owner === 'mine' && Number(row.ownerUserId) !== Number(workspace.currentUserId)) return false;
    if (filters.owner === 'unassigned' && row.ownerUserId) return false;
    if (/^user:\d+$/.test(filters.owner) && Number(row.ownerUserId) !== Number(filters.owner.slice(5))) return false;
    const days = daysInStage(row.stageEnteredAt || row.createdAt);
    if (filters.aging === 'stalled' && !stageAgingTone(days, stageById[row.pipelineStage || 'new']?.canonicalKey || row.pipelineStage || 'new')) return false;
    if (filters.fit === 'high' && !(Number(row.vacancyFitScore010) >= 7)) return false;
    if (filters.notes && !row.hasNotes) return false;
    return true;
  }), [filters, locale, rows, stageById, workspace.currentUserId]);

  const grouped = useMemo(() => {
    const out = Object.fromEntries(stages.map((s) => [s.id, []]));
    filteredRows.forEach((r) => {
      const stage = r.pipelineStage || 'new';
      if (out[stage]) out[stage].push(r);
      else out['new'].push(r);
    });
    return out;
  }, [stages, filteredRows]);

  const hasAny = rows.length > 0;
  const hasFiltered = filteredRows.length > 0;
  const visibleStages = hideEmpty && !draggingId
    ? stages.filter((stage) => (grouped[stage.id] || []).length > 0)
    : stages;
  const fitTone = (s) => (s >= 7 ? 'text-success' : s >= 4 ? 'text-warning' : 'text-danger');

  const updateVacancyOwner = async (raw) => {
    const ownerUserId = raw ? Number(raw) : null;
    const response = await fetch(`/api/admin/vacancies/${encodeURIComponent(vacancyId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerUserId }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return toast(data?.error || t(locale, 'panel.common.error'), 'error');
    setWorkspace((current) => ({ ...current, vacancyOwnerUserId: ownerUserId }));
    toast(t(locale, 'recruiting.ownerUpdated'), 'ok');
  };

  const assignCandidate = async (row, raw) => {
    const ownerUserId = raw ? Number(raw) : null;
    const body = { action: 'assign_candidate', vacancyId: Number(vacancyId), candidateId: Number(row.candidateId), ownerUserId };
    if (companyId) body.companyId = Number(companyId);
    const response = await fetch('/api/admin/recruiting-workspace', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return toast(data?.error || t(locale, 'panel.common.error'), 'error');
    const owner = workspace.recruiters.find((item) => Number(item.id) === Number(ownerUserId));
    setRows((current) => current.map((item) => cardKey(item) === cardKey(row)
      ? { ...item, ownerUserId, ownerName: owner?.name || null }
      : item));
    toast(t(locale, 'recruiting.candidateOwnerUpdated'), 'ok');
  };

  const saveView = async () => {
    const values = await promptForm({
      title: t(locale, 'recruiting.savedViewTitle'),
      confirmLabel: t(locale, 'recruiting.savedViewSave'),
      fields: [{ name: 'name', label: t(locale, 'recruiting.savedViewName'), required: true, maxLength: 60 }],
    });
    if (!values?.name?.trim()) return;
    const body = { action: 'save_view', vacancyId: Number(vacancyId), name: values.name.trim(), filters: { ...filters, hideEmpty, compact } };
    if (companyId) body.companyId = Number(companyId);
    const response = await fetch('/api/admin/recruiting-workspace', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return toast(data?.error || t(locale, 'panel.common.error'), 'error');
    toast(t(locale, 'recruiting.savedViewSaved'), 'ok');
    await loadWorkspace();
  };

  const removeView = async (view) => {
    const accepted = await confirm({
      title: t(locale, 'recruiting.savedViewDelete'),
      message: t(locale, 'recruiting.savedViewDeleteHint', { name: view.name }),
      confirmLabel: t(locale, 'recruiting.savedViewDelete'), danger: true,
    });
    if (!accepted) return;
    const params = new URLSearchParams({ vacancyId: String(vacancyId), viewId: String(view.id) });
    if (companyId) params.set('companyId', String(companyId));
    const response = await fetch(`/api/admin/recruiting-workspace?${params.toString()}`, { method: 'DELETE' });
    if (!response.ok) return toast(t(locale, 'panel.common.error'), 'error');
    await loadWorkspace();
  };

  const applyView = (view) => {
    setFilters({ ...EMPTY_FILTERS, ...(view.filters || {}) });
    setHideEmpty(view.filters?.hideEmpty === true);
    setCompact(view.filters?.compact === true);
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <span className="font-mono text-xs uppercase tracking-[1.5px] text-ink-muted">
          {t(locale, 'recruiting.pipelineTitle')}
        </span>
        {loading ? <AppLoading variant="inline" /> : null}
        {!loading && hasAny && (
          <span className="font-mono text-2xs text-ink-faint">
            {t(locale, 'recruiting.candidatesCount', { n: rows.length })}
          </span>
        )}
        {hasAny ? (
          <div className="ml-auto flex flex-wrap items-center gap-1.5" aria-label={t(locale, 'recruiting.pipelineViewOptions')}>
            <button
              type="button"
              className={cn('min-h-touch rounded-control border px-2.5 font-ui text-xs', compact ? 'border-brand-500/35 bg-brand-500/[0.08] text-brand-600' : 'border-ink/12 text-ink-muted')}
              aria-pressed={compact}
              onClick={() => setCompact((value) => !value)}
            >
              {t(locale, 'recruiting.pipelineCompact')}
            </button>
            <button
              type="button"
              className={cn('min-h-touch rounded-control border px-2.5 font-ui text-xs', hideEmpty ? 'border-brand-500/35 bg-brand-500/[0.08] text-brand-600' : 'border-ink/12 text-ink-muted')}
              aria-pressed={hideEmpty}
              onClick={() => setHideEmpty((value) => !value)}
            >
              {hideEmpty ? t(locale, 'recruiting.pipelineShowEmpty') : t(locale, 'recruiting.pipelineHideEmpty')}
            </button>
          </div>
        ) : null}
      </div>

      {hasAny ? (
        <div className="mb-3 rounded-xl border border-ink/10 bg-canvas/70 p-3">
          <div className="grid gap-2 md:grid-cols-[minmax(180px,1.2fr)_minmax(150px,0.8fr)_minmax(130px,0.7fr)_minmax(130px,0.7fr)_auto]">
            <input
              value={filters.q}
              onChange={(event) => setFilters((current) => ({ ...current, q: event.target.value }))}
              placeholder={t(locale, 'recruiting.pipelineSearch')}
              aria-label={t(locale, 'recruiting.pipelineSearch')}
              className="min-h-touch rounded-control border border-ink/12 bg-surface px-3 font-ui text-sm text-ink outline-none focus:border-brand-500"
            />
            <SelectField
              value={filters.owner}
              onChange={(event) => setFilters((current) => ({ ...current, owner: event.target.value }))}
              className="ui-select min-h-touch rounded-control border border-ink/12 bg-surface px-2 font-ui text-xs text-ink"
              aria-label={t(locale, 'recruiting.filterOwner')}
            >
              <option value="all">{t(locale, 'recruiting.filterAllOwners')}</option>
              <option value="mine">{t(locale, 'recruiting.filterMine')}</option>
              <option value="unassigned">{t(locale, 'recruiting.filterUnassigned')}</option>
              {workspace.recruiters.map((recruiter) => <option key={recruiter.id} value={`user:${recruiter.id}`}>{recruiter.name}</option>)}
            </SelectField>
            <SelectField
              value={filters.aging}
              onChange={(event) => setFilters((current) => ({ ...current, aging: event.target.value }))}
              className="ui-select min-h-touch rounded-control border border-ink/12 bg-surface px-2 font-ui text-xs text-ink"
              aria-label={t(locale, 'recruiting.filterAging')}
            >
              <option value="all">{t(locale, 'recruiting.filterAnyTime')}</option>
              <option value="stalled">{t(locale, 'recruiting.filterStalled')}</option>
            </SelectField>
            <SelectField
              value={filters.fit}
              onChange={(event) => setFilters((current) => ({ ...current, fit: event.target.value }))}
              className="ui-select min-h-touch rounded-control border border-ink/12 bg-surface px-2 font-ui text-xs text-ink"
              aria-label={t(locale, 'recruiting.filterFit')}
            >
              <option value="all">{t(locale, 'recruiting.filterAnyFit')}</option>
              <option value="high">{t(locale, 'recruiting.filterHighFit')}</option>
            </SelectField>
            <label className="flex min-h-touch items-center gap-2 rounded-control border border-ink/12 bg-surface px-2.5 font-ui text-xs text-ink-muted">
              <input type="checkbox" checked={filters.notes} onChange={(event) => setFilters((current) => ({ ...current, notes: event.target.checked }))} className="accent-brand-500" />
              {t(locale, 'recruiting.filterWithNotes')}
            </label>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-ink/8 pt-2">
            <label className="flex items-center gap-2 font-ui text-xs text-ink-muted">
              {t(locale, 'recruiting.vacancyOwner')}
              <SelectField
                value={workspace.vacancyOwnerUserId || ''}
                onChange={(event) => void updateVacancyOwner(event.target.value)}
                disabled={workspaceLoading}
                className="ui-select min-h-touch rounded-control border border-ink/12 bg-surface px-2 text-xs text-ink"
              >
                <option value="">{t(locale, 'recruiting.filterUnassigned')}</option>
                {workspace.recruiters.map((recruiter) => <option key={recruiter.id} value={recruiter.id}>{recruiter.name}</option>)}
              </SelectField>
            </label>
            {!workspace.vacancyOwnerUserId ? <span className="rounded-full bg-warning/10 px-2 py-1 font-ui text-xs text-amber-800 dark:text-warning">{t(locale, 'recruiting.ownerMissing')}</span> : null}
            <button type="button" className="ml-auto min-h-touch rounded-control border border-brand-500/30 bg-brand-500/[0.07] px-3 font-ui text-xs font-semibold text-brand-600" onClick={saveView}>
              {t(locale, 'recruiting.savedViewSave')}
            </button>
            {(workspace.views || []).map((view) => (
              <span key={view.id} className="inline-flex overflow-hidden rounded-control border border-ink/10 bg-surface">
                <button type="button" className="min-h-touch px-2.5 font-ui text-xs text-ink-muted hover:text-ink" onClick={() => applyView(view)}>{view.name}</button>
                <button type="button" className="min-h-touch border-l border-ink/10 px-2 text-danger" aria-label={t(locale, 'recruiting.savedViewDelete')} onClick={() => void removeView(view)}>×</button>
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {err ? <p className="mb-2.5 mt-0 font-mono text-xs text-danger">{err}</p> : null}

      {!loading && !hasAny ? (
        <EmptyState
          title={t(locale, 'recruiting.pipelineEmpty')}
          className="py-4"
        />
      ) : null}

      {!loading && hasAny && !hasFiltered ? (
        <EmptyState title={t(locale, 'recruiting.pipelineNoFilterResults')} className="py-4" />
      ) : null}

      {hasAny && hasFiltered && (
        <div className="kanban-scroll relative overflow-x-visible pb-2 md:overflow-x-auto md:[-webkit-overflow-scrolling:touch]">
          <div className="flex w-full flex-col items-stretch gap-2.5 md:min-w-max md:flex-row md:items-start">
            {visibleStages.map((stage) => {
              const cards = grouped[stage.id] || [];
              const isDropTarget = dragOverStage === stage.id;
              const ages = cards.map((card) => daysInStage(card.stageEnteredAt || card.createdAt)).filter((value) => value != null);
              const avgDays = ages.length ? Math.round(ages.reduce((sum, value) => sum + value, 0) / ages.length) : null;
              const stalled = cards.filter((card) => stageAgingTone(daysInStage(card.stageEnteredAt || card.createdAt), stage.canonicalKey || stage.id)).length;
              return (
                <div
                  key={stage.id}
                  onDragOver={(e) => { e.preventDefault(); setDragOverStage(stage.id); }}
                  onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOverStage(null); }}
                  onDrop={async (e) => {
                    e.preventDefault();
                    const id = e.dataTransfer.getData('text/plain');
                    setDragOverStage(null);
                    setDraggingId(null);
                    if (!id) return;
                    const r = rows.find((row) => cardKey(row) === id);
                    if (!r || (r.pipelineStage || 'new') === stage.id) return;
                    await moveTo(r, stage.id);
                  }}
                  className={cn(
                    'shrink-0 rounded-xl outline outline-2 outline-offset-[3px] transition-[width,outline-color] duration-100',
                    compact ? 'w-full md:w-[184px]' : 'w-full md:w-[220px]'
                  )}
                  style={{
                    outlineColor: isDropTarget ? stage.color : 'transparent',
                  }}
                >
                  <div
                    className="sticky top-0 z-[1] mb-2 flex flex-wrap items-center gap-1.5 rounded-t-[10px] px-2.5 py-2 backdrop-blur-sm transition-colors duration-100"
                    style={{
                      background: isDropTarget ? `${stage.color}22` : `${stage.color}12`,
                      borderTop: `3px solid ${stage.color}`,
                      border: `1px solid ${stage.color}30`,
                      borderTopWidth: 3,
                      borderTopStyle: 'solid',
                      borderTopColor: stage.color,
                    }}
                  >
                    <button
                      type="button"
                      className="-m-1 flex min-h-touch w-full items-center gap-1.5 p-1 text-left md:pointer-events-none md:min-h-0"
                      aria-expanded={!collapsedStages.includes(stage.id)}
                      onClick={() => setCollapsedStages((current) => current.includes(stage.id) ? current.filter((id) => id !== stage.id) : [...current, stage.id])}
                    >
                    <span
                      className="inline-block h-[7px] w-[7px] shrink-0 rounded-full"
                      style={{ background: stage.color }}
                    />
                    <span className="flex-1 font-mono text-2xs font-bold uppercase tracking-[0.8px] text-ink">
                      {stage.label}
                    </span>
                    <span
                      className="rounded-lg px-[7px] py-px font-mono text-2xs font-bold text-ink"
                      style={{ background: `${stage.color}25` }}
                    >
                      {cards.length}
                    </span>
                    {(avgDays != null || stalled > 0) ? (
                      <span className="basis-full pl-[13px] font-mono text-2xs text-ink-muted">
                        {avgDays != null ? t(locale, 'recruiting.pipelineAvgDays', { n: avgDays }) : null}
                        {avgDays != null && stalled > 0 ? ' · ' : null}
                        {stalled > 0 ? t(locale, 'recruiting.pipelineStalled', { n: stalled }) : null}
                      </span>
                    ) : null}
                    <DisclosureToggle
                      locale={locale}
                      open={!collapsedStages.includes(stage.id)}
                      className="ml-auto md:hidden"
                    />
                    </button>
                  </div>
                  <div
                    onDragOver={(e) => e.preventDefault()}
                    className={cn(
                      'flex flex-col gap-[7px] transition-[min-height] duration-100',
                      collapsedStages.includes(stage.id) && 'hidden md:flex',
                      isDropTarget ? 'min-h-[60px]' : 'min-h-[30px]'
                    )}
                  >
                    {cards.map((r) => {
                      const rid = cardKey(r);
                      const isDragging = draggingId === rid;
                      const isBusy = moving === rid;
                      const inviteLabel = inviteStatusShort(locale, r.inviteStatus);
                      const ago = formatRelativeAgo(r.inviteSentAt, locale);
                      const days = daysInStage(r.stageEnteredAt || r.createdAt);
                      const rowStage = stageById[r.pipelineStage || 'new'];
                      const aging = stageAgingTone(days, rowStage?.canonicalKey || r.pipelineStage || 'new');
                      return (
                        <div
                          key={rid}
                          draggable
                          onDragStart={(e) => {
                            setDraggingId(rid);
                            e.dataTransfer.setData('text/plain', rid);
                            e.dataTransfer.effectAllowed = 'move';
                          }}
                          onDragEnd={() => { setDraggingId(null); setDragOverStage(null); }}
                          className={cn(
                            'cursor-grab select-none rounded-lg border border-ink/12 bg-surface/[0.88] transition-opacity duration-150',
                            compact ? 'px-2 py-1.5' : 'px-2.5 py-[9px]',
                            isDragging && 'opacity-40',
                            isBusy && !isDragging && 'opacity-65',
                            draggingId && !isDragging && 'pointer-events-none'
                          )}
                        >
                          <div className="mb-[3px] flex items-start justify-between gap-1">
                            {r.candidateId && typeof onPersonClick === 'function' ? (
                              <button
                                type="button"
                                className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap border-none bg-transparent p-0 text-left font-ui text-prose text-ink underline-offset-2 hover:underline"
                                title={t(locale, 'recruiting.openPersonProfile', {
                                  name: titleCasePersonName(r.name),
                                })}
                                aria-label={t(locale, 'recruiting.openPersonProfile', {
                                  name: titleCasePersonName(r.name),
                                })}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onPersonClick(r.candidateId);
                                }}
                              >
                                {titleCasePersonName(r.name)}
                              </button>
                            ) : (
                              <div className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-ui text-prose text-ink">
                                {titleCasePersonName(r.name)}
                              </div>
                            )}
                            {days != null && aging ? (
                              <span
                                className={cn(
                                  'shrink-0 rounded-full border px-1.5 py-0.5 font-mono text-2xs',
                                  aging === 'danger'
                                    ? 'border-danger/30 bg-danger/[0.09] text-danger'
                                    : 'border-warning/30 bg-warning/[0.1] text-warning'
                                )}
                                title={t(locale, 'recruiting.stageAgingTitle', { n: days })}
                              >
                                {t(locale, 'recruiting.stageAgingDays', { n: days })}
                              </span>
                            ) : days != null && days > 0 ? (
                              <span
                                className="shrink-0 font-mono text-2xs text-ink-faint"
                                title={t(locale, 'recruiting.stageAgingTitle', { n: days })}
                              >
                                {t(locale, 'recruiting.stageAgingDays', { n: days })}
                              </span>
                            ) : null}
                          </div>
                          {r.email ? (
                            <div
                              className="mb-[5px] overflow-hidden text-ellipsis whitespace-nowrap font-mono text-2xs text-ink-faint"
                              title={r.email}
                            >
                              {r.email}
                            </div>
                          ) : null}
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            {r.pendingTest || r.topType == null ? null : (
                              <span className="rounded-full border border-brand-500/20 bg-brand-500/[0.06] px-1.5 py-0.5 font-mono text-2xs text-brand-600">
                                T{r.topType}
                              </span>
                            )}
                            {r.vacancyFitScore010 != null && (
                              <span
                                className={cn(
                                  'rounded-full border px-1.5 py-0.5 font-mono text-2xs',
                                  fitTone(r.vacancyFitScore010)
                                )}
                                title={t(locale, 'recruiting.fitScoreLabel')}
                              >
                                {t(locale, 'recruiting.fitLabel', { score: r.vacancyFitScore010 })}
                              </span>
                            )}
                          </div>
                          {r.rejectionReason ? (
                            <div className="mt-1 font-mono text-2xs text-danger">
                              {rejectionReasonLabel(locale, r.rejectionReason)}
                            </div>
                          ) : null}
                          {r.startDate && (r.pipelineStage === PIPELINE_STAGE.HIRED) ? (
                            <div className="mt-1 font-mono text-2xs text-success">
                              {t(locale, 'recruiting.startDateLabel')}: {r.startDate}
                            </div>
                          ) : null}
                          {r.candidateId ? (
                            <VacancyOfferBlock
                              vacancyId={vacancyId}
                              candidateId={r.candidateId}
                              assessmentId={r.assessmentId}
                              locale={locale}
                              compact
                              initialOffer={{
                                offerSalary: r.offerSalary,
                                offerStartDate: r.offerStartDate,
                                offerStatus: r.offerStatus || OFFER_STATUS.NONE,
                                offerNotes: r.offerNotes,
                              }}
                              onSaved={(next) => {
                                setRows((prev) =>
                                  prev.map((x) =>
                                    cardKey(x) === rid
                                      ? {
                                          ...x,
                                          offerSalary: next.offerSalary,
                                          offerStartDate: next.offerStartDate,
                                          offerStatus: next.offerStatus,
                                          offerNotes: next.offerNotes,
                                        }
                                      : x
                                  )
                                );
                              }}
                            />
                          ) : null}
                          {(inviteLabel || ago) ? (
                            <div className="mt-[5px] font-mono text-2xs leading-[1.35] text-ink-muted">
                              {inviteLabel ? t(locale, 'recruiting.inviteLine', { status: inviteLabel }) : null}
                              {inviteLabel && ago ? ' · ' : null}
                              {ago || null}
                            </div>
                          ) : r.pendingTest ? (
                            <div className="mt-[5px] font-mono text-2xs text-ink-faint">
                              {t(locale, 'recruiting.waitingTest')}
                            </div>
                          ) : null}
                          {r.hasNotes ? (
                            <div className="mt-1 font-mono text-2xs text-brand-600">
                              {t(locale, 'recruiting.withNotes')}
                            </div>
                          ) : null}
                          <label className="mt-2 block">
                            <span className="sr-only">{t(locale, 'recruiting.candidateOwner')}</span>
                            <SelectField
                              value={r.ownerUserId || ''}
                              onChange={(event) => void assignCandidate(r, event.target.value)}
                              onClick={(event) => event.stopPropagation()}
                              className="ui-select min-h-touch w-full rounded-control border border-ink/10 bg-canvas px-2 font-ui text-[11px] text-ink-muted"
                              aria-label={t(locale, 'recruiting.candidateOwner')}
                            >
                              <option value="">{t(locale, 'recruiting.filterUnassigned')}</option>
                              {workspace.recruiters.map((recruiter) => <option key={recruiter.id} value={recruiter.id}>{recruiter.name}</option>)}
                            </SelectField>
                          </label>
                          <label className="mt-2 block">
                            <span className="sr-only">{t(locale, 'recruiting.moveToStage')}</span>
                            <SelectField
                              className="ui-select w-full min-h-touch rounded-control border border-ink/12 bg-canvas px-2 py-1.5 font-mono text-2xs text-ink"
                              value={r.pipelineStage || 'new'}
                              disabled={isBusy}
                              aria-label={t(locale, 'recruiting.moveToStageHint')}
                              title={t(locale, 'recruiting.moveToStageHint')}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => {
                                const next = e.target.value;
                                if (!next || next === (r.pipelineStage || 'new')) return;
                                void moveTo(r, next);
                              }}
                            >
                              {stages.map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.label}
                                </option>
                              ))}
                            </SelectField>
                          </label>
                        </div>
                      );
                    })}
                    {cards.length === 0 && (
                      <div
                        className={cn(
                          'rounded-lg px-2.5 py-3.5 text-center font-mono text-2xs italic transition-all duration-100',
                          isDropTarget ? 'border-2 border-dashed' : 'border-2 border-dashed border-transparent text-ink-faint'
                        )}
                        style={
                          isDropTarget
                            ? { color: stage.color, borderColor: `${stage.color}55` }
                            : undefined
                        }
                      >
                        {isDropTarget ? '↓' : '—'}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
