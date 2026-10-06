'use client';

import { Fragment, useEffect, useState } from 'react';
import { cn } from '../../../lib/cn';
import { DisclosureToggle } from '../../_components/CollapsibleBlock';
import { t, contentLocale } from '../../../lib/i18n';
import { AppLoading, ContentEnter } from '../../_components/AppLoading';
import { EmptyState } from '../../_components/EmptyState';
import { useAppFeedback } from '../../_components/AppFeedback';
import { AdminTableShell, AdminTh, AdminActionsTh, AdminCreateButton, AdminDeleteButton, AdminEditButton, AdminIconButton, S } from '../dashboard-shared';
import { PipelineStagesEditor } from './PipelineStagesEditor';

export function PipelineTemplatesManager({ locale, companyId, templates, loading, onChanged }) {
  const { confirm, promptForm, toast } = useAppFeedback();
  const [busyId, setBusyId] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [lastArchived, setLastArchived] = useState(null);
  const [uxMetrics, setUxMetrics] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    if (companyId) params.set('companyId', String(companyId));
    fetch(`/api/admin/recruiting-ux-event?${params.toString()}`)
      .then(async (response) => ({ response, data: await response.json().catch(() => ({})) }))
      .then(({ response, data }) => {
        if (!cancelled && response.ok) setUxMetrics(data.metrics || null);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [companyId]);

  const createTemplate = async () => {
    const values = await promptForm({
      title: t(locale, 'panel.pipelineTemplates.createTitle'),
      message: t(locale, 'panel.pipelineTemplates.createHint'),
      confirmLabel: t(locale, 'panel.pipelineTemplates.createAction'),
      fields: [{
        name: 'name',
        label: t(locale, 'panel.pipelineTemplates.nameLabel'),
        required: true,
        maxLength: 80,
      }],
    });
    if (!values?.name?.trim()) return;
    setBusyId('create');
    try {
      const body = { name: values.name.trim() };
      if (companyId) body.companyId = Number(companyId);
      const res = await fetch('/api/admin/pipeline-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || t(locale, 'panel.pipelineTemplates.manageFailed'));
      toast(t(locale, 'panel.pipelineTemplates.created'), 'ok');
      await onChanged?.();
    } catch (error) {
      toast(error?.message || t(locale, 'panel.pipelineTemplates.manageFailed'), 'error');
    } finally {
      setBusyId(null);
    }
  };

  const restoreTemplate = async () => {
    if (!lastArchived?.id) return;
    setBusyId(lastArchived.id);
    try {
      const body = { restore: true };
      if (companyId) body.companyId = Number(companyId);
      const res = await fetch(`/api/admin/pipeline-templates/${lastArchived.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || t(locale, 'panel.pipelineTemplates.manageFailed'));
      setLastArchived(null);
      toast(t(locale, 'panel.pipelineTemplates.restored'), 'ok');
      await onChanged?.();
    } catch (error) {
      toast(error?.message || t(locale, 'panel.pipelineTemplates.manageFailed'), 'error');
    } finally {
      setBusyId(null);
    }
  };

  const mutate = async (template, action) => {
    if (!template?.id) return;
    let method = 'PATCH';
    let body = companyId ? { companyId: Number(companyId) } : {};
    if (action === 'rename') {
      const values = await promptForm({
        title: t(locale, 'panel.pipelineTemplates.renameTitle'),
        confirmLabel: t(locale, 'panel.common.save'),
        fields: [{
          name: 'name',
          label: t(locale, 'panel.pipelineTemplates.nameLabel'),
          initialValue: template.name,
          required: true,
          maxLength: 80,
        }],
      });
      if (!values) return;
      body.name = values.name;
    } else if (action === 'duplicate') {
      const values = await promptForm({
        title: t(locale, 'panel.pipelineTemplates.duplicateTitle'),
        confirmLabel: t(locale, 'panel.pipelineTemplates.duplicate'),
        fields: [{
          name: 'name',
          label: t(locale, 'panel.pipelineTemplates.nameLabel'),
          initialValue: t(locale, 'panel.pipelineTemplates.copyName', { name: template.name }),
          required: true,
          maxLength: 80,
        }],
      });
      if (!values) return;
      body.duplicateName = values.name;
    } else if (action === 'default') {
      body.isDefault = true;
    } else if (action === 'archive') {
      const ok = await confirm({
        title: t(locale, 'panel.pipelineTemplates.archiveTitle'),
        message: t(locale, 'panel.pipelineTemplates.archiveHint', { name: template.name }),
        confirmLabel: t(locale, 'panel.pipelineTemplates.archive'),
        danger: true,
      });
      if (!ok) return;
      method = 'DELETE';
      body = null;
    }
    setBusyId(template.id);
    try {
      const query = method === 'DELETE' && companyId
        ? `?companyId=${encodeURIComponent(companyId)}`
        : '';
      const res = await fetch(`/api/admin/pipeline-templates/${template.id}${query}`, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || t(locale, 'panel.pipelineTemplates.manageFailed'));
      if (action === 'archive') setLastArchived(template);
      toast(t(locale, 'panel.pipelineTemplates.managed'), 'ok');
      await onChanged?.();
    } catch (error) {
      toast(error?.message || t(locale, 'panel.pipelineTemplates.manageFailed'), 'error');
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return <AppLoading variant="panel" />;

  const templateWarnings = (template) => {
    const warnings = [];
    if (!template.isDefault && Number(template.vacancyCount || 0) === 0) warnings.push(t(locale, 'panel.pipelineTemplates.warningUnused'));
    const updatedAt = template.updatedAt ? new Date(template.updatedAt).getTime() : null;
    if (!template.isDefault && updatedAt && Date.now() - updatedAt > 180 * 86400000) warnings.push(t(locale, 'panel.pipelineTemplates.warningStale'));
    const labels = (template.stages || []).map((stage) => String(contentLocale(locale) === 'en' ? (stage.labelEn || stage.labelPt) : (stage.labelPt || stage.labelEn)).trim().toLocaleLowerCase(locale));
    if (new Set(labels).size !== labels.length) warnings.push(t(locale, 'panel.pipelineTemplates.warningDuplicateStages'));
    return warnings;
  };

  return (
    <ContentEnter animKey={(templates || []).map((item) => item.id).join('-')}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="m-0 max-w-[680px] text-xs leading-relaxed text-ink-muted">
          {t(locale, 'panel.pipelineTemplates.permissionManage')}
        </p>
        <AdminCreateButton
          label={t(locale, 'panel.pipelineTemplates.createAction')}
          disabled={busyId != null}
          onClick={createTemplate}
        />
      </div>
      {uxMetrics?.opened > 0 ? (
        <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-3" aria-label={t(locale, 'panel.pipelineTemplates.uxMetricsTitle')}>
          <div className="rounded-control border border-ink/10 bg-canvas px-3 py-2">
            <div className="font-mono text-lg text-ink">{Math.round((uxMetrics.completionRate || 0) * 100)}%</div>
            <div className="font-ui text-xs text-ink-muted">{t(locale, 'panel.pipelineTemplates.uxCompletion')}</div>
          </div>
          <div className="rounded-control border border-ink/10 bg-canvas px-3 py-2">
            <div className="font-mono text-lg text-ink">{uxMetrics.cancelled}</div>
            <div className="font-ui text-xs text-ink-muted">{t(locale, 'panel.pipelineTemplates.uxCancelled')}</div>
          </div>
          <div className="rounded-control border border-ink/10 bg-canvas px-3 py-2">
            <div className="font-mono text-lg text-ink">{uxMetrics.avgElapsedMs == null ? '–' : Math.max(1, Math.round(uxMetrics.avgElapsedMs / 60000))}</div>
            <div className="font-ui text-xs text-ink-muted">{t(locale, 'panel.pipelineTemplates.uxMinutes')}</div>
          </div>
        </div>
      ) : null}
      {lastArchived ? (
        <div role="status" className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-control border border-warning/25 bg-warning/[0.07] px-3 py-2">
          <span className="text-xs text-ink-muted">
            {t(locale, 'panel.pipelineTemplates.archivedName', { name: lastArchived.name })}
          </span>
          <button type="button" className="font-ui text-xs font-semibold text-brand-600 underline underline-offset-2" onClick={restoreTemplate} disabled={busyId != null}>
            {t(locale, 'panel.pipelineTemplates.undo')}
          </button>
        </div>
      ) : null}
      {!templates?.length ? (
        <EmptyState message={t(locale, 'panel.pipelineTemplates.empty')} actionLabel={t(locale, 'panel.pipelineTemplates.createAction')} onAction={createTemplate} />
      ) : (
      <AdminTableShell locale={locale} minWidth="720px">
        <thead><tr>
          <AdminTh>{t(locale, 'panel.common.listColumns.model')}</AdminTh>
          <AdminTh>{t(locale, 'panel.common.listColumns.usage')}</AdminTh>
          <AdminActionsTh>{t(locale, 'panel.admin.colActions')}</AdminActionsTh>
        </tr></thead>
        <tbody className="divide-y divide-ink/5">
        {templates.map((template) => {
          const busy = busyId === template.id;
          const warnings = templateWarnings(template);
          return (
            <Fragment key={template.id}>
            <tr className={cn('hover:bg-canvas-alt/50', template.isDefault && 'bg-brand-500/[0.025]')}>
              <td className="px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="m-0 break-words font-ui text-sm font-semibold text-ink">{template.name}</h4>
                    {template.isDefault ? (
                      <span className="rounded-full bg-brand-500/10 px-2 py-0.5 font-mono text-2xs text-brand-600">
                        {t(locale, 'panel.pipelineTemplates.defaultBadge')}
                      </span>
                    ) : null}
                  </div>
                  {warnings.length ? (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {warnings.map((warning) => <span key={warning} className="rounded-full bg-warning/10 px-2 py-0.5 font-ui text-[11px] text-warning">{warning}</span>)}
                    </div>
                  ) : null}
              </div>
              </td>
              <td className="whitespace-nowrap px-4 py-3">
                  <p className={cn(S.faint, 'mb-0 mt-0.5')}>
                    {t(locale, 'panel.pipelineTemplates.usage', {
                      stages: template.stageCount,
                      vacancies: template.vacancyCount,
                    })}
                  </p>
              </td>
              <td className="px-4 py-3 text-right"><div className="inline-flex items-center gap-1.5 whitespace-nowrap">
                <button
                  type="button"
                  className="inline-flex min-h-touch items-center gap-1.5 rounded-control px-2.5 font-ui text-xs text-ink-muted hover:bg-ink/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500"
                  aria-expanded={expandedId === template.id}
                  aria-controls={expandedId === template.id ? `pipeline-preview-${template.id}` : undefined}
                  onClick={() => setExpandedId((current) => current === template.id ? null : template.id)}
                >
                  {t(locale, 'panel.pipelineTemplates.preview')}
                  <DisclosureToggle locale={locale} open={expandedId === template.id} />
                </button>
                <AdminEditButton label={t(locale, 'panel.pipelineTemplates.rename')} disabled={busy} onClick={() => mutate(template, 'rename')} />
                <AdminIconButton icon="copy" label={t(locale, 'panel.pipelineTemplates.duplicate')} disabled={busy} onClick={() => mutate(template, 'duplicate')} />
                {!template.isDefault ? (
                  <AdminIconButton icon="check" label={t(locale, 'panel.pipelineTemplates.makeDefault')} disabled={busy} onClick={() => mutate(template, 'default')} />
                ) : null}
                <AdminDeleteButton label={t(locale, 'panel.pipelineTemplates.archive')} disabled={busy} onClick={() => mutate(template, 'archive')} />
              </div></td>
            </tr>
              {expandedId === template.id ? (
                <tr><td colSpan={3} className="px-4 py-3"><div id={`pipeline-preview-${template.id}`} aria-label={t(locale, 'panel.pipelineTemplates.previewLabel')}>
                  <PipelineStagesEditor locale={locale} companyId={companyId} templateId={template.id} />
                </div></td></tr>
              ) : null}
            </Fragment>
          );
        })}
        </tbody>
      </AdminTableShell>
      )}
    </ContentEnter>
  );
}
