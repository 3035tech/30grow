'use client';

import { useCallback, useEffect, useState } from 'react';
import { t, contentLocale } from '../../lib/i18n';
import { cn } from '../../lib/cn';
import { S, AdminCreateButton, AdminDeleteButton, AdminEditButton } from '../dashboard/dashboard-shared';
import { AppLoading, ContentEnter } from './AppLoading';
import { useAppFeedback } from './AppFeedback';
import { CollapsibleBlock } from './CollapsibleBlock';
import { EmptyState } from './EmptyState';
import { StatusToneChip } from './StatusToneChip';
import { PRE_ONBOARDING_OWNER_ROLES } from '../../lib/people/pre-onboarding-constants.js';

const OWNER_TONE = Object.freeze({
  rh: 'brand',
  manager: 'info',
  it: 'neutral',
  security: 'warning',
  employee: 'success',
});

/**
 * Company D1 checklist template (P0).
 */
export function PreOnboardingTemplateBlock({ locale = 'pt-BR', companyId }) {
  const { toast, promptForm, confirm } = useAppFeedback();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!companyId) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(
        `/api/admin/pre-onboarding-template?companyId=${encodeURIComponent(companyId)}`
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'load');
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch (e) {
      toast(e?.message || t(locale, 'panel.preOnboardingTpl.loadError'), 'error');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [companyId, locale, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveItems = async (next) => {
    setBusy(true);
    try {
      const res = await fetch('/api/admin/pre-onboarding-template', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, items: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'save');
      setItems(Array.isArray(data.items) ? data.items : next);
      toast(t(locale, 'panel.preOnboardingTpl.saved'), 'ok');
    } catch (e) {
      toast(e?.message || t(locale, 'panel.preOnboardingTpl.saveError'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const addOrEdit = async (row = null) => {
    const fields = [
      {
        key: 'itemKey',
        label: t(locale, 'panel.preOnboardingTpl.keyLabel'),
        required: !row,
        initialValue: row?.itemKey || '',
        help: row
          ? t(locale, 'panel.preOnboardingTpl.keyLocked')
          : t(locale, 'panel.preOnboardingTpl.keyHelp'),
        disabled: Boolean(row),
      },
      {
        key: 'labelPt',
        label: t(locale, 'panel.preOnboardingTpl.labelPt'),
        required: true,
        initialValue: row?.labelPt || '',
      },
      {
        key: 'labelEn',
        label: t(locale, 'panel.preOnboardingTpl.labelEn'),
        required: true,
        initialValue: row?.labelEn || '',
      },
      {
        key: 'ownerRole',
        type: 'select',
        label: t(locale, 'panel.preOnboardingTpl.ownerLabel'),
        initialValue: row?.ownerRole || 'rh',
        options: PRE_ONBOARDING_OWNER_ROLES.map((v) => ({
          value: v,
          label: t(locale, `panel.preOnboardingTpl.owner.${v}`),
        })),
      },
      {
        key: 'dueOffsetDays',
        type: 'number',
        label: t(locale, 'panel.preOnboardingTpl.dueOffsetLabel'),
        initialValue: String(row?.dueOffsetDays ?? 0),
        help: t(locale, 'panel.preOnboardingTpl.dueOffsetHelp'),
      },
      {
        key: 'requireMeet',
        type: 'boolean',
        label: t(locale, 'panel.preOnboardingTpl.requireMeet'),
        help: t(locale, 'panel.preOnboardingTpl.requireMeetHelp'),
        initialValue: Boolean(row?.requireMeet),
      },
    ];
    const values = await promptForm({
      title: row
        ? t(locale, 'panel.preOnboardingTpl.editTitle')
        : t(locale, 'panel.preOnboardingTpl.addTitle'),
      confirmLabel: t(locale, 'panel.common.save'),
      fields,
    });
    if (!values) return;
    const key = row
      ? row.itemKey
      : String(values.itemKey || '')
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9_]/g, '_');
    if (!key) {
      toast(t(locale, 'panel.preOnboardingTpl.keyRequired'), 'error');
      return;
    }
    const dueOffsetDays = Math.min(90, Math.max(0, Number(values.dueOffsetDays) || 0));
    const nextRow = {
      itemKey: key,
      labelPt: values.labelPt,
      labelEn: values.labelEn,
      ownerRole: values.ownerRole || 'rh',
      dueOffsetDays,
      requireMeet: Boolean(values.requireMeet),
      sortOrder: row?.sortOrder ?? (items.length + 1) * 10,
      active: true,
    };
    const next = row
      ? items.map((x) => (x.itemKey === row.itemKey ? nextRow : { ...x, active: x.active !== false }))
      : [...items.filter((x) => x.active !== false), nextRow];
    await saveItems(next.map((x, i) => ({ ...x, sortOrder: (i + 1) * 10, active: true })));
  };

  const removeRow = async (row) => {
    const ok = await confirm({
      title: t(locale, 'panel.preOnboardingTpl.removeTitle'),
      message: t(locale, 'panel.preOnboardingTpl.removeConfirm', { key: row.itemKey }),
      tone: 'danger',
    });
    if (!ok) return;
    const next = items
      .filter((x) => x.itemKey !== row.itemKey)
      .map((x, i) => ({ ...x, sortOrder: (i + 1) * 10, active: true }));
    if (!next.length) {
      toast(t(locale, 'panel.preOnboardingTpl.minOne'), 'error');
      return;
    }
    await saveItems(next);
  };

  if (!companyId) return null;

  const active = items.filter((x) => x.active !== false);

  return (
    <CollapsibleBlock
      title={t(locale, 'panel.preOnboardingTpl.titleWithCount', { n: active.length })}
      defaultOpen={false}
      className="mt-3"
    >
      <p className={cn(S.muted, 'mb-3 mt-0 text-prose')}>
        {t(locale, 'panel.preOnboardingTpl.hint')}
      </p>
      {loading ? (
        <AppLoading variant="panel" label={t(locale, 'panel.common.loading')} />
      ) : (
        <ContentEnter animKey={`pre-onb-tpl|${active.length}`}>
          {active.length === 0 ? (
            <EmptyState
              title={t(locale, 'panel.preOnboardingTpl.empty')}
              message={t(locale, 'panel.preOnboardingTpl.emptyHint')}
            />
          ) : (
            <ul className="m-0 mb-3 flex list-none flex-col gap-1.5 p-0">
              {active.map((row) => (
                <li
                  key={row.itemKey}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-ink/10 bg-surface px-2.5 py-2"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5 font-ui text-sm text-ink">
                      <span>
                        {contentLocale(locale) === 'en' ? row.labelEn || row.labelPt : row.labelPt || row.labelEn}
                      </span>
                      <StatusToneChip tone={OWNER_TONE[row.ownerRole] || 'neutral'}>
                        {t(locale, `panel.preOnboardingTpl.owner.${row.ownerRole}`)}
                      </StatusToneChip>
                      <StatusToneChip tone="neutral">
                        {t(locale, 'panel.preOnboardingTpl.dueOffsetChip', {
                          days: row.dueOffsetDays ?? 0,
                        })}
                      </StatusToneChip>
                      {row.requireMeet ? (
                        <StatusToneChip tone="info">
                          {t(locale, 'panel.preOnboardingTpl.meetBadge')}
                        </StatusToneChip>
                      ) : null}
                    </div>
                    <div className="mt-0.5 font-mono text-2xs text-ink-muted">{row.itemKey}</div>
                  </div>
                  <div className="flex items-center gap-1">
                    <AdminEditButton
                      label={t(locale, 'panel.common.edit')}
                      disabled={busy}
                      onClick={() => void addOrEdit(row)}
                    />
                    <AdminDeleteButton
                      label={t(locale, 'panel.common.delete')}
                      disabled={busy}
                      onClick={() => void removeRow(row)}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
          <AdminCreateButton variant="secondary" label={t(locale, 'panel.preOnboardingTpl.addBtn')} onClick={() => void addOrEdit(null)} disabled={busy} />
        </ContentEnter>
      )}
    </CollapsibleBlock>
  );
}
