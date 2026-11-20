'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { t } from '../../lib/i18n';
import { cn } from '../../lib/cn';
import { flattenOrgChart, orgChartLayout, orgDescendantIds, ORG_CARD_WIDTH, filterOrgPeople } from '../../lib/people/org-chart-layout';
import { S } from '../dashboard/dashboard-shared';
import { AppLoading } from './AppLoading';
import { EmptyState } from './EmptyState';
import { CollapsibleBlock } from './CollapsibleBlock';
import { InlineCallout } from './InlineCallout';
import { useAppFeedback } from './AppFeedback';
import { Icon } from './Icon';
import { IconActionTip } from './IconActionTip';

export function OrgChartBlock({ locale = 'pt-BR', companyId, navigateDashboard = null }) {
  const { toast } = useAppFeedback();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [draggedId, setDraggedId] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);
  const [saveError, setSaveError] = useState('');
  const [collapsed, setCollapsed] = useState(new Set());
  const [expandedDetails, setExpandedDetails] = useState(new Set());
  const [zoom, setZoom] = useState(1);
  const [search, setSearch] = useState('');
  const viewport = useRef(null);
  const requestVersion = useRef(0);
  const msg = (key, values) => t(locale, `panel.orgChart.${key}`, values);

  const load = useCallback(async () => {
    const version = ++requestVersion.current;
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/admin/org-chart?companyId=${encodeURIComponent(companyId)}`);
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || t(locale, 'panel.orgChart.loadError'));
      if (version === requestVersion.current) setData(json);
      return true;
    } catch (e) {
      if (version === requestVersion.current) { setError(e.message); setData(null); }
      return false;
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [companyId, locale]);
  useEffect(() => {
    setData(null); setSaveError('');
    setDraggedId(null); setDropTarget(null); setSelectedId(null); setCollapsed(new Set()); setExpandedDetails(new Set());
    if (companyId) void load(); else setLoading(false);
    return () => { requestVersion.current += 1; };
  }, [companyId, load]);

  const people = useMemo(() => flattenOrgChart(data?.roots || []), [data]);
  const layout = useMemo(() => orgChartLayout(data?.roots || [], collapsed, expandedDetails), [data, collapsed, expandedDetails]);

  const dragged = people.find((person) => person.id === draggedId);
  const forbiddenTargets = useMemo(() => orgDescendantIds(dragged), [dragged]);
  function canDrop(managerId) {
    return Boolean(dragged) && !savingRef.current && !forbiddenTargets.has(managerId)
      && (dragged.managerCandidateId ?? null) !== managerId;
  }
  function endDrag() { setDraggedId(null); setDropTarget(null); }
  function dragOver(event, managerId) {
    if (!dragged) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = canDrop(managerId) ? 'move' : 'none';
    setDropTarget(canDrop(managerId) ? (managerId ?? 'root') : null);
  }
  async function drop(event, managerId) {
    event.preventDefault();
    event.stopPropagation();
    const person = dragged;
    const allowed = canDrop(managerId);
    endDrag();
    if (!allowed) return;
    await saveManager(person, managerId);
  }

  const matches = useMemo(() => filterOrgPeople(people, search), [people, search]);

  function reveal(person) {
    setSelectedId(person.id);
    setCollapsed((previous) => {
      const next = new Set(previous);
      let current = person;
      const seen = new Set();
      while (current && !seen.has(current.id)) {
        seen.add(current.id); next.delete(current.id);
        current = people.find((item) => item.id === current.managerCandidateId);
      }
      return next;
    });
  }
  useEffect(() => {
    const canvas = viewport.current;
    const card = canvas?.querySelector(`[data-person-id="${selectedId}"]`);
    if (!card) return;
    const bounds = card.getBoundingClientRect();
    const visible = canvas.getBoundingClientRect();
    // Scroll only the canvas; selecting a person must not jump the dashboard.
    if (bounds.left < visible.left || bounds.right > visible.right) {
      canvas.scrollLeft += bounds.left - visible.left - (canvas.clientWidth - bounds.width) / 2;
    }
    if (bounds.top < visible.top || bounds.bottom > visible.bottom) {
      canvas.scrollTop += bounds.top - visible.top - (canvas.clientHeight - bounds.height) / 2;
    }
  }, [selectedId, collapsed, data]);

  async function saveManager(person, managerId) {
    if (savingRef.current) return;
    const version = requestVersion.current;
    savingRef.current = true;
    setSaving(true); setSaveError('');
    try {
      const response = await fetch('/api/admin/org-chart', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: Number(companyId), candidateId: person.id, managerCandidateId: managerId }),
      });
      const result = await response.json();
      if (version !== requestVersion.current) return;
      if (!response.ok) throw new Error(result.error || msg('managerError'));
      setSelectedId(person.id);
      setCollapsed(new Set());
      if (await load()) toast(msg('managerSaved'), 'ok');
    } catch (e) { if (version === requestVersion.current) setSaveError(e.message); }
    finally { savingRef.current = false; setSaving(false); }
  }

  if (!companyId) return null;
  return <CollapsibleBlock locale={locale} title={msg('title')} count={data?.total || null} defaultOpen variant="card" collapsedHint={msg('hint')}>
    {loading && !data ? <AppLoading locale={locale} variant="panel" /> : error ? <InlineCallout tone="danger" role="alert">{error}<button type="button" className={S.btnGhost} onClick={load}>{t(locale, 'panel.common.retry')}</button></InlineCallout> : !people.length ? <EmptyState title={msg('empty')} description={msg('emptyHint')} /> : <>
      <p className={cn(S.muted, 'mb-3')}>{msg('dragHint')}</p>
      {saveError ? <InlineCallout tone="danger" role="alert">{saveError}</InlineCallout> : null}
      {data.capped ? <InlineCallout tone="info">{msg('capped')}</InlineCallout> : null}
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <label className="flex min-w-0 flex-1 flex-col gap-1 font-ui text-sm sm:max-w-sm">
          {msg('findPerson')}
          <input type="search" className={S.input} value={search} disabled={saving} onChange={(event) => setSearch(event.target.value)} placeholder={msg('searchPlaceholder')} />
        </label>
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label={msg('viewControls')}>
          <button type="button" className={S.btnGhost} aria-label={msg('zoomOut')} disabled={zoom <= .1} onClick={() => setZoom((value) => Math.max(.1, Number((value - .2).toFixed(2))))}>−</button>
          <span className="w-12 text-center font-ui text-xs tabular-nums text-ink" aria-live="polite">{Math.round(zoom * 100)}%</span>
          <button type="button" className={S.btnGhost} aria-label={msg('zoomIn')} disabled={zoom >= 1.6} onClick={() => setZoom((value) => Math.min(1.6, Number((value + .2).toFixed(2))))}>+</button>
          <button type="button" className={S.btnGhost} onClick={() => { setZoom(Math.min(1, (viewport.current?.clientWidth || layout.width) / layout.width)); viewport.current?.scrollTo({ top: 0, left: 0 }); }}>{msg('fit')}</button>
          <button type="button" className={S.btnGhost} onClick={() => setCollapsed(new Set())}>{msg('expandAll')}</button>
          <button type="button" className={S.btnGhost} onClick={() => setCollapsed(new Set(people.filter((person) => person.children?.length).map((person) => person.id)))}>{msg('collapseAll')}</button>
        </div>
      </div>
      {search.trim() ? <div className="mb-3 flex max-h-40 flex-wrap gap-2 overflow-auto" aria-label={msg('searchResults')}>
        {matches.map((person) => <button key={person.id} type="button" disabled={saving} className={S.btnGhost} onClick={() => reveal(person)}>{person.name}</button>)}
        {!matches.length ? <p className={S.muted}>{msg('noResults')}</p> : null}
      </div> : null}
      <div data-org-root-drop onDragOver={(event) => dragOver(event, null)} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDropTarget(null); }} onDrop={(event) => drop(event, null)} className={cn('mb-3 rounded-control border border-dashed px-4 py-3 font-ui text-sm', dropTarget === 'root' ? 'border-brand-500 bg-brand-500/10 text-brand-700' : 'border-ink/20 text-ink-muted')}>
        {msg('rootDrop')}
      </div>
      <div role="status" className="sr-only">{dragged ? msg('dragging', { name: dragged.name }) : saving ? t(locale, 'panel.orgUnits.saving') : ''}</div>
      <div ref={viewport} aria-busy={saving || loading} onDragOver={(event) => {
          if (!dragged) return;
          const canvas = event.currentTarget;
          const bounds = canvas.getBoundingClientRect();
          const dx = event.clientX < bounds.left + 40 ? -20 : event.clientX > bounds.right - 40 ? 20 : 0;
          const dy = event.clientY < bounds.top + 40 ? -20 : event.clientY > bounds.bottom - 40 ? 20 : 0;
          if (dx || dy) canvas.scrollBy({ left: dx, top: dy, behavior: 'instant' });
        }} role="region" tabIndex={0} aria-label={msg('canvas')} className="relative max-h-[640px] min-h-72 min-w-0 overflow-auto overscroll-contain rounded-card border border-ink/15 bg-canvas focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500" style={{ backgroundImage: 'radial-gradient(rgb(var(--ink-faint) / 0.45) 0.6px, transparent 0.6px)', backgroundSize: '20px 20px' }}>
          <div style={{ width: layout.width * zoom, height: layout.height * zoom }}>
            <div className="relative origin-top-left" style={{ width: layout.width, height: layout.height, transform: `scale(${zoom})` }}>
              <svg className="pointer-events-none absolute inset-0 text-brand-500/50" width={layout.width} height={layout.height} aria-hidden="true">
                {layout.edges.map(({ from, to }) => {
                  const x1 = from.x + ORG_CARD_WIDTH / 2, y1 = from.y + from.height, x2 = to.x + ORG_CARD_WIDTH / 2, y2 = to.y;
                  return <path key={to.id} d={`M ${x1} ${y1} V ${(y1 + y2) / 2} H ${x2} V ${y2}`} fill="none" stroke="currentColor" strokeWidth="2" />;
                })}
              </svg>
              {layout.nodes.map((person) => <article key={person.id} data-person-id={person.id} onDragOver={(event) => dragOver(event, person.id)} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDropTarget(null); }} onDrop={(event) => drop(event, person.id)} className={cn('absolute flex flex-col overflow-hidden rounded-card border bg-surface shadow-sm', draggedId === person.id && 'opacity-50', dropTarget === person.id && 'ring-4 ring-brand-500/50', dragged && forbiddenTargets.has(person.id) && 'cursor-not-allowed', selectedId === person.id ? 'border-brand-500 ring-2 ring-brand-500/20' : 'border-ink/15')} style={{ left: person.x, top: person.y, width: ORG_CARD_WIDTH, height: person.height }}>
                <div className="relative flex min-h-0 flex-1">
                <button type="button" draggable={!saving} onDragStart={(event) => {
                  if (savingRef.current) { event.preventDefault(); return; }
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('text/plain', String(person.id));
                  setDraggedId(person.id); setSaveError('');
                }} onDragEnd={endDrag} title={msg('dragPerson', { name: person.name })} disabled={saving} aria-pressed={selectedId === person.id} aria-label={msg('selectPerson', { name: person.name })} className={cn('flex min-h-0 flex-1 cursor-grab active:cursor-grabbing items-start gap-2 border-0 bg-transparent py-2.5 pl-3 text-left hover:bg-brand-500/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500', navigateDashboard ? 'pr-9' : 'pr-3')} onClick={() => setSelectedId(person.id)}>
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-100 font-ui text-2xs font-semibold text-brand-700" aria-hidden="true">{person.name.split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join('')}</span>
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="line-clamp-3 break-words font-ui text-xs font-semibold leading-snug text-ink" title={person.name}>{person.name}</span>
                    <span className="line-clamp-2 break-words font-ui text-2xs text-ink-muted" title={person.jobRoleName || ''}>{person.jobRoleName || msg('noRole')}</span>
                  </span>
                </button>
                {navigateDashboard ? <IconActionTip label={msg('openPerson', { name: person.name })} className="absolute right-1 top-1.5">
                  <button type="button" disabled={saving} aria-label={msg('openPerson', { name: person.name })} onClick={() => navigateDashboard({ tab: 'team', candidate: String(person.id), roster: 'internal' })} className="flex h-7 w-7 items-center justify-center rounded-control border-0 bg-transparent text-ink-faint hover:bg-brand-500/10 hover:text-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500 disabled:opacity-55">
                    <Icon name="user" className="h-3.5 w-3.5" />
                  </button>
                </IconActionTip> : null}
                </div>
                {expandedDetails.has(person.id) ? <div id={`org-details-${person.id}`} className="flex h-[68px] shrink-0 flex-col justify-center gap-1 border-t border-ink/10 px-3 font-ui text-xs text-ink-muted">
                  <span>{msg('level', { n: person.depth + 1 })}</span>
                  <span className="truncate" title={person.orgUnitName || ''}>{person.orgUnitName || t(locale, 'panel.orgUnits.none')}</span>
                  <span>{msg('reportsCount', { n: person.children?.length || 0 })}</span>
                </div> : null}
                <div className="flex h-8 shrink-0 border-t border-ink/10 bg-brand-500/[0.04]">
                  <button type="button" disabled={saving} className="min-w-0 flex-1 border-0 bg-transparent px-2 font-ui text-2xs text-brand-700 hover:bg-brand-500/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500" aria-expanded={expandedDetails.has(person.id)} aria-controls={expandedDetails.has(person.id) ? `org-details-${person.id}` : undefined} aria-label={msg(expandedDetails.has(person.id) ? 'hidePersonDetails' : 'showPersonDetails', { name: person.name })} onClick={() => setExpandedDetails((previous) => { const next = new Set(previous); if (next.has(person.id)) next.delete(person.id); else next.add(person.id); return next; })}>{msg(expandedDetails.has(person.id) ? 'lessDetails' : 'moreDetails')}</button>
                  {person.children?.length ? <button type="button" disabled={saving} className="min-w-0 flex-1 border-0 border-l border-solid border-ink/10 bg-transparent px-2 font-ui text-2xs text-brand-700 hover:bg-brand-500/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500" aria-expanded={!collapsed.has(person.id)} aria-label={msg(collapsed.has(person.id) ? 'expandPerson' : 'collapsePerson', { name: person.name })} onClick={() => setCollapsed((previous) => { const next = new Set(previous); if (next.has(person.id)) next.delete(person.id); else next.add(person.id); return next; })}>{msg('teamCount', { n: person.children.length })} {collapsed.has(person.id) ? '+' : '−'}</button> : null}
                </div>
              </article>)}
            </div>
          </div>
      </div>
      <p className={cn(S.faint, 'mb-0 mt-3')} role="status">{msg('meta', { total: data.total, linked: data.withManager })}</p>
    </>}
  </CollapsibleBlock>;
}
