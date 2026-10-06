'use client';

import { SelectField } from '../../_components/SelectField';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '../../../lib/cn';
import { t, contentLocale } from '../../../lib/i18n';
import { PIPELINE_STAGE } from '../../../lib/pipeline';
import { AppLoading, ContentEnter } from '../../_components/AppLoading';
import { EmptyState } from '../../_components/EmptyState';
import { useAppFeedback } from '../../_components/AppFeedback';
import { S } from '../dashboard-shared';

const CANONICAL_OPTIONS_CUSTOM = [
  PIPELINE_STAGE.NEW,
  PIPELINE_STAGE.INTERVIEW,
  PIPELINE_STAGE.TEST_COMPLETED,
  PIPELINE_STAGE.SCREENING,
  PIPELINE_STAGE.APPROVED,
  PIPELINE_STAGE.HIRED,
  PIPELINE_STAGE.REJECTED,
  PIPELINE_STAGE.ARCHIVED,
];

const INPUT =
  'w-full rounded-control border border-ink/12 bg-surface px-2 py-1.5 font-ui text-xs text-ink outline-none focus:border-brand-500';

function apiErrorLabel(locale, code) {
  const key = `errors.${code}`;
  const label = t(locale, key);
  if (label && label !== key) return label;
  return t(locale, 'panel.common.error');
}

export function PipelineStagesEditor({ locale, onChange, vacancyId = null, templateId = null, companyId = null }) {
  const { confirm } = useAppFeedback();
  const [stages, setStages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [labelDraft, setLabelDraft] = useState({ pt: '', en: '' });
  const [canonicalDraft, setCanonicalDraft] = useState(PIPELINE_STAGE.SCREENING);
  const [addingLabelPt, setAddingLabelPt] = useState('');
  const [addingLabelEn, setAddingLabelEn] = useState('');
  const [addingCanonical, setAddingCanonical] = useState(PIPELINE_STAGE.SCREENING);
  const [showAdd, setShowAdd] = useState(false);
  const [draggingId, setDraggingId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);
  const orderPending = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const params = new URLSearchParams({ includeCounts: '1' });
      if (vacancyId) params.set('vacancyId', String(vacancyId));
      if (templateId) params.set('templateId', String(templateId));
      if (companyId) params.set('companyId', String(companyId));
      const res = await fetch(`/api/admin/pipeline-stages?${params.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ? apiErrorLabel(locale, data.error) : t(locale, 'panel.common.error'));
      const list = Array.isArray(data.stages) ? data.stages : [];
      setStages(list);
      if (typeof onChange === 'function') onChange(list);
    } catch (e) {
      setErr(e?.message || t(locale, 'panel.common.error'));
    } finally {
      setLoading(false);
    }
  }, [locale, onChange, vacancyId, templateId, companyId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!editingId && !showAdd) return () => {};
    const preventAccidentalLeave = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', preventAccidentalLeave);
    return () => window.removeEventListener('beforeunload', preventAccidentalLeave);
  }, [editingId, showAdd]);

  const beginEdit = (s) => {
    setEditingId(s.id);
    setLabelDraft({ pt: s.labelPt || '', en: s.labelEn || '' });
    setCanonicalDraft(s.canonicalKey || PIPELINE_STAGE.SCREENING);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setLabelDraft({ pt: '', en: '' });
  };

  const saveEdit = async (s) => {
    if (!labelDraft.pt.trim()) return;
    setSaving(true);
    setErr('');
    try {
      const body = { labelPt: labelDraft.pt.trim(), labelEn: labelDraft.en.trim() || labelDraft.pt.trim() };
      if (vacancyId) body.vacancyId = vacancyId;
      if (templateId) body.templateId = templateId;
      if (companyId) body.companyId = companyId;
      if (!s.required) body.canonicalKey = canonicalDraft;
      const res = await fetch(`/api/admin/pipeline-stages/${s.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(apiErrorLabel(locale, data?.error));
      cancelEdit();
      await load();
    } catch (e) {
      setErr(e?.message || t(locale, 'panel.common.error'));
    } finally {
      setSaving(false);
    }
  };

  const addStage = async () => {
    const pt = addingLabelPt.trim();
    if (!pt) return;
    setSaving(true);
    setErr('');
    try {
      const res = await fetch('/api/admin/pipeline-stages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          labelPt: pt,
          labelEn: addingLabelEn.trim() || pt,
          canonicalKey: addingCanonical,
          ...(vacancyId ? { vacancyId } : {}),
          ...(templateId ? { templateId } : {}),
          ...(companyId ? { companyId } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(apiErrorLabel(locale, data?.error));
      setAddingLabelPt('');
      setAddingLabelEn('');
      setAddingCanonical(PIPELINE_STAGE.SCREENING);
      setShowAdd(false);
      await load();
    } catch (e) {
      setErr(e?.message || t(locale, 'panel.common.error'));
    } finally {
      setSaving(false);
    }
  };

  const removeStage = async (s) => {
    if (s.required) return;
    if (s.count > 0) {
      setErr(t(locale, 'panel.pipelineEditor.deleteBlockedInUse', { n: s.count }));
      return;
    }
    const confirmed = await confirm({
      title: t(locale, 'panel.pipelineEditor.delete'),
      message: t(locale, 'panel.pipelineEditor.deleteConfirm', { name: s.labelPt }),
      confirmLabel: t(locale, 'panel.pipelineEditor.delete'),
      danger: true,
    });
    if (!confirmed) return;
    setSaving(true);
    setErr('');
    try {
      const params = new URLSearchParams();
      if (vacancyId) params.set('vacancyId', String(vacancyId));
      if (templateId) params.set('templateId', String(templateId));
      if (companyId) params.set('companyId', String(companyId));
      const qs = params.size ? `?${params.toString()}` : '';
      const res = await fetch(`/api/admin/pipeline-stages/${s.id}${qs}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data?.error === 'PIPELINE_STAGE_IN_USE') {
          throw new Error(t(locale, 'panel.pipelineEditor.deleteBlockedInUse', { n: data.usage || 0 }));
        }
        throw new Error(apiErrorLabel(locale, data?.error));
      }
      await load();
    } catch (e) {
      setErr(e?.message || t(locale, 'panel.common.error'));
    } finally {
      setSaving(false);
    }
  };

  const commitReorder = async (nextOrder) => {
    if (orderPending.current) return;
    orderPending.current = true;
    setStages(nextOrder);
    try {
      const res = await fetch('/api/admin/pipeline-stages/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderedIds: nextOrder.map((s) => s.id),
          ...(vacancyId ? { vacancyId } : {}),
          ...(templateId ? { templateId } : {}),
          ...(companyId ? { companyId } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(apiErrorLabel(locale, data?.error));
      if (Array.isArray(data.stages)) {
        const usageMap = Object.fromEntries(stages.map((s) => [s.id, s.count || 0]));
        setStages(data.stages.map((s) => ({ ...s, count: usageMap[s.id] || 0 })));
        if (typeof onChange === 'function') onChange(data.stages);
      }
    } catch (e) {
      setErr(e?.message || t(locale, 'panel.common.error'));
      await load();
    } finally {
      orderPending.current = false;
    }
  };

  const onDrop = (targetId) => {
    if (!draggingId || draggingId === targetId) {
      setDraggingId(null); setDragOverId(null); return;
    }
    const from = stages.findIndex((s) => s.id === draggingId);
    const to = stages.findIndex((s) => s.id === targetId);
    if (from < 0 || to < 0) {
      setDraggingId(null); setDragOverId(null); return;
    }
    const next = [...stages];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setDraggingId(null); setDragOverId(null);
    commitReorder(next);
  };

  const moveStageBy = (stageId, delta) => {
    const from = stages.findIndex((stage) => stage.id === stageId);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= stages.length || saving || orderPending.current) return;
    const next = [...stages];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    void commitReorder(next);
  };

  const canonicalOptions = useMemo(() =>
    CANONICAL_OPTIONS_CUSTOM.map((c) => ({
      value: c,
      label: t(locale, `recruiting.pipeline${c.replace(/(^|_)([a-z])/g, (_, __, ch) => ch.toUpperCase())}`),
    })),
  [locale]);

  if (loading) {
    return <AppLoading variant="panel" />;
  }

  return (
    <ContentEnter animKey="pipeline-editor">
      <div className="space-y-3">
        {err ? (
          <p className="mb-1 mt-0 font-mono text-xs text-danger">{err}</p>
        ) : null}
        {stages.length === 0 ? (
          <EmptyState title={t(locale, 'panel.pipelineEditor.emptyTitle')} className="py-4" />
        ) : null}

        <div className="kanban-scroll overflow-x-auto pb-2 [-webkit-overflow-scrolling:touch]">
          <ul className="flex min-w-max items-stretch gap-2.5 pl-0" aria-label={t(locale, 'panel.pipelineEditor.title')}>
            {stages.map((s) => {
              const editing = editingId === s.id;
              const dragOver = dragOverId === s.id;
              return (
                <li
                  key={s.id}
                  className={cn(
                    'flex w-[260px] shrink-0 flex-col rounded-xl border border-ink/12 bg-surface/90 p-3 transition-[border-color,background-color,transform] duration-150',
                    draggingId === s.id && 'opacity-55',
                    dragOver && 'translate-y-[-2px] border-brand-500/60 bg-brand-500/[0.06]'
                  )}
                  draggable={!editing}
                  title={!editing ? t(locale, 'panel.pipelineEditor.dragHint') : undefined}
                  onDragStart={(e) => {
                    if (editing) return;
                    setDraggingId(s.id);
                    e.dataTransfer.setData('text/plain', String(s.id));
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragOver={(e) => { e.preventDefault(); if (draggingId && draggingId !== s.id) setDragOverId(s.id); }}
                  onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOverId((cur) => (cur === s.id ? null : cur)); }}
                  onDrop={(e) => { e.preventDefault(); onDrop(s.id); }}
                  onDragEnd={() => { setDraggingId(null); setDragOverId(null); }}
                >
                  {editing ? (
                    <div className="flex h-full flex-col gap-2">
                      <input
                        value={labelDraft.pt}
                        onChange={(e) => setLabelDraft((d) => ({ ...d, pt: e.target.value }))}
                        maxLength={60}
                        className={INPUT}
                        placeholder={t(locale, 'panel.pipelineEditor.labelPtPlaceholder')}
                        autoFocus
                      />
                      <input
                        value={labelDraft.en}
                        onChange={(e) => setLabelDraft((d) => ({ ...d, en: e.target.value }))}
                        maxLength={60}
                        className={INPUT}
                        placeholder={t(locale, 'panel.pipelineEditor.labelEnPlaceholder')}
                      />
                      {!s.required ? (
                        <SelectField
                          value={canonicalDraft}
                          onChange={(e) => setCanonicalDraft(e.target.value)}
                          className={INPUT}
                          aria-label={t(locale, 'panel.pipelineEditor.canonicalLabel')}
                        >
                          {canonicalOptions.map((c) => (
                            <option key={c.value} value={c.value}>{c.label}</option>
                          ))}
                        </SelectField>
                      ) : null}
                      <div className="mt-auto flex gap-2 pt-1">
                        <button type="button" className={cn(S.btnPrimary, 'flex-1')} onClick={() => saveEdit(s)} disabled={saving}>
                          {t(locale, 'panel.pipelineEditor.save')}
                        </button>
                        <button type="button" className={S.btnGhost} onClick={cancelEdit} disabled={saving}>
                          {t(locale, 'panel.pipelineEditor.cancel')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex cursor-grab items-start gap-2 active:cursor-grabbing">
                        <span className="mt-0.5 select-none font-mono text-sm leading-none text-ink-faint" aria-hidden>⠿</span>
                        <span className="min-w-0 flex-1 font-ui text-sm font-semibold text-ink">
                          {contentLocale(locale) === 'en' ? (s.labelEn || s.labelPt) : (s.labelPt || s.labelEn)}
                        </span>
                        <span className="rounded-full bg-ink/[0.07] px-2 py-0.5 font-mono text-2xs text-ink-muted">
                          {s.count || 0}
                        </span>
                      </div>

                      <div className="mt-3 space-y-1.5 border-t border-ink/8 pt-2.5">
                        <div className="font-mono text-2xs text-ink-faint">
                          {t(locale, `recruiting.pipeline${s.canonicalKey.replace(/(^|_)([a-z])/g, (_, __, ch) => ch.toUpperCase())}`)}
                        </div>
                        <div className="flex min-h-[20px] flex-wrap items-center gap-1.5">
                          {s.required ? (
                            <span className="rounded-full bg-ink/[0.07] px-2 py-0.5 font-mono text-2xs text-ink-muted">
                              {t(locale, 'panel.pipelineEditor.required')}
                            </span>
                          ) : null}
                          <span className="font-mono text-2xs text-ink-faint">
                            {t(locale, 'panel.pipelineEditor.usageCount', { n: s.count || 0 })}
                          </span>
                        </div>
                      </div>

                      <div className="mt-auto flex flex-wrap gap-1.5 pt-3">
                        <button
                          type="button"
                          className={cn(S.btnGhost, 'px-2')}
                          onClick={() => moveStageBy(s.id, -1)}
                          disabled={saving || stages[0]?.id === s.id}
                          aria-label={t(locale, 'panel.pipelineEditor.moveLeft', { name: s.labelPt })}
                          title={t(locale, 'panel.pipelineEditor.moveLeft', { name: s.labelPt })}
                        >
                          ←
                        </button>
                        <button
                          type="button"
                          className={cn(S.btnGhost, 'px-2')}
                          onClick={() => moveStageBy(s.id, 1)}
                          disabled={saving || stages[stages.length - 1]?.id === s.id}
                          aria-label={t(locale, 'panel.pipelineEditor.moveRight', { name: s.labelPt })}
                          title={t(locale, 'panel.pipelineEditor.moveRight', { name: s.labelPt })}
                        >
                          →
                        </button>
                        <button type="button" className={cn(S.btnGhost, 'flex-1')} onClick={() => beginEdit(s)} disabled={saving}>
                          {t(locale, 'panel.pipelineEditor.edit')}
                        </button>
                        {!s.required ? (
                          <button
                            type="button"
                            className={S.btnDanger}
                            onClick={() => removeStage(s)}
                            disabled={saving}
                            title={s.count > 0 ? t(locale, 'panel.pipelineEditor.deleteBlockedInUse', { n: s.count }) : undefined}
                          >
                            {t(locale, 'panel.pipelineEditor.delete')}
                          </button>
                        ) : null}
                      </div>
                    </>
                  )}
                </li>
              );
            })}

          {showAdd ? (
            <li className="flex w-[280px] shrink-0 flex-col gap-2 rounded-xl border border-brand-500/40 bg-brand-500/[0.05] p-3">
              <span className="font-ui text-sm font-semibold text-ink">{t(locale, 'panel.pipelineEditor.addCta')}</span>
              <input
                value={addingLabelPt}
                onChange={(e) => setAddingLabelPt(e.target.value)}
                maxLength={60}
                className={INPUT}
                placeholder={t(locale, 'panel.pipelineEditor.labelPtPlaceholder')}
                autoFocus
              />
              <input
                value={addingLabelEn}
                onChange={(e) => setAddingLabelEn(e.target.value)}
                maxLength={60}
                className={INPUT}
                placeholder={t(locale, 'panel.pipelineEditor.labelEnPlaceholder')}
              />
              <SelectField
                value={addingCanonical}
                onChange={(e) => setAddingCanonical(e.target.value)}
                className={INPUT}
                aria-label={t(locale, 'panel.pipelineEditor.canonicalLabel')}
              >
                {canonicalOptions.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </SelectField>
              <div className="mt-auto flex gap-2 pt-1">
                <button type="button" className={cn(S.btnPrimary, 'flex-1')} onClick={addStage} disabled={saving || !addingLabelPt.trim()}>
                  {t(locale, 'panel.pipelineEditor.addSubmit')}
                </button>
                <button type="button" className={S.btnGhost} onClick={() => { setShowAdd(false); setAddingLabelPt(''); setAddingLabelEn(''); }} disabled={saving}>
                  {t(locale, 'panel.pipelineEditor.cancel')}
                </button>
              </div>
            </li>
          ) : (
            <li className="w-[220px] shrink-0">
              <button
                type="button"
                className="flex min-h-[148px] w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-brand-500/40 bg-brand-500/[0.035] px-4 font-ui text-sm font-semibold text-brand-600 transition-colors hover:bg-brand-500/[0.07] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:opacity-60"
                onClick={() => setShowAdd(true)}
                disabled={saving}
              >
                <span className="text-xl leading-none" aria-hidden>+</span>
                {t(locale, 'panel.pipelineEditor.addCta')}
              </button>
            </li>
          )}
          </ul>
        </div>
      </div>
    </ContentEnter>
  );
}
