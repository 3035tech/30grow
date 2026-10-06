'use client';

import { useCallback, useEffect, useState } from 'react';
import { t, t as i18nT } from '../../lib/i18n';
import { AppLoading, ContentEnter } from './AppLoading';
import { FormField } from './FormField';
import { EntitySearchSelect } from './EntitySearchSelect';
import { useAppFeedback } from './AppFeedback';
import { CollapsibleBlock } from './CollapsibleBlock';
import { AdminCreateButton, S } from '../dashboard/dashboard-shared';

/**
 * B-3006: assign direct manager on Equipe person panel.
 */
export function OrgManagerBlock({
  locale = 'pt-BR',
  companyId,
  candidateId,
  onCreateManager,
}) {
  const { toast, confirm } = useAppFeedback();
  const [loading, setLoading] = useState(true);
  const [managerId, setManagerId] = useState('');
  const [managerName, setManagerName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [selectionKey, setSelectionKey] = useState(0);

  const load = useCallback(async () => {
    if (!companyId || !candidateId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({
        companyId: String(companyId),
        candidateId: String(candidateId),
      });
      const res = await fetch(`/api/admin/org-chart?${params}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'load');
      setManagerId(data.managerCandidateId ? String(data.managerCandidateId) : '');
      setManagerName(data.managerName || '');
    } catch (e) {
      setError(e?.message || t(locale, 'panel.orgChart.managerError'));
    } finally {
      setLoading(false);
    }
  }, [companyId, candidateId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (nextId, nextName) => {
    if (busy || error || String(nextId || '') === managerId) return;
    setBusy(true);
    try {
      const accepted = await confirm({
        title: t(locale, 'panel.orgChart.managerTitle'),
        message: t(locale, 'panel.orgChart.confirmChange', { name: nextName || t(locale, 'panel.orgChart.managerHintEmpty') }),
        confirmLabel: t(locale, 'panel.orgUnits.save'),
      });
      if (!accepted) return;
      const res = await fetch('/api/admin/org-chart', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: Number(companyId),
          candidateId: Number(candidateId),
          managerCandidateId: nextId || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'save');
      toast(t(locale, 'panel.orgChart.managerSaved'), 'ok');
      await load();
    } catch (e) {
      toast(e?.message || t(locale, 'panel.orgChart.managerError'), 'error');
    } finally {
      setBusy(false);
      setSelectionKey((n) => n + 1);
    }
  };

  if (!companyId || !candidateId) return null;

  return (
    <CollapsibleBlock
      locale={locale}
      title={t(locale, 'panel.orgChart.managerTitle')}
      defaultOpen={false}
      variant="card"
      collapsedHint={
        managerName
          ? t(locale, 'panel.orgChart.managerHintNamed', { name: managerName })
          : t(locale, 'panel.orgChart.managerHintEmpty')
      }
    >
      {loading ? (
        <AppLoading variant="panel" />
      ) : error ? (
        <div role="alert">{error} <button type="button" className={S.btnGhost} onClick={load}>{t(locale, 'panel.orgUnits.retry')}</button></div>
      ) : (
        <ContentEnter animKey={`mgr|${candidateId}|${managerId || 0}`}>
          <FormField
            label={t(locale, 'panel.orgChart.managerLabel')}
            hint={
              managerName
                ? t(locale, 'panel.orgChart.currentManager', { name: managerName })
                : t(locale, 'panel.orgChart.managerHintEmpty')
            }
          >
            <EntitySearchSelect
              key={selectionKey}
              locale={locale}
              value=""
              minChars={0}
              disabled={busy}
              searchUrl={`/api/admin/employees/search?companyId=${encodeURIComponent(companyId)}`}
              placeholder={t(locale, 'panel.orgChart.managerSearch')}
              aria-label={t(locale, 'panel.orgChart.managerLabel')}
              onChange={(id, item) => {
                if (id) void save(Number(id), item?.label);
              }}
            />
          </FormField>
          {managerId ? <button type="button" className={S.btnGhost} disabled={busy} onClick={() => void save(null)}>{t(locale, 'panel.orgChart.removeManager')}</button> : null}
          {onCreateManager ? <AdminCreateButton variant="secondary" label={i18nT(locale, 'ui.orgManagerBlock.createManager')} onClick={onCreateManager} disabled={busy} /> : null}
        </ContentEnter>
      )}
    </CollapsibleBlock>
  );
}
