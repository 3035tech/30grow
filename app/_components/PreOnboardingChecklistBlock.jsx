'use client';

import { useCallback, useEffect, useState } from 'react';
import { t } from '../../lib/i18n';
import { cn } from '../../lib/cn';
import { EMPLOYMENT_STATUS } from '../../lib/domain-status.js';
import { S } from '../dashboard/dashboard-shared';
import { EmptyState } from './EmptyState';
import { AppLoading, ContentEnter } from './AppLoading';
import { useAppFeedback } from './AppFeedback';
import { StatusToneChip } from './StatusToneChip';
import { CollapsibleBlock } from './CollapsibleBlock';
import { MeterBar } from './MeterBar';

const CALL_KEYS = new Set(['rh_onboarding_call', 'manager_onboarding']);

const OWNER_TONE = Object.freeze({
  rh: 'brand',
  manager: 'info',
  it: 'neutral',
  security: 'warning',
  employee: 'success',
});

function itemLabel(locale, row) {
  if (row?.label) return row.label;
  const k = `panel.preOnboarding.item.${row.itemKey}`;
  const translated = t(locale, k);
  return translated === k ? row.itemKey : translated;
}

function allowsMeet(row) {
  return Boolean(row?.allowMeet) || CALL_KEYS.has(row?.itemKey);
}

function ownerLabel(locale, role) {
  const k = `panel.preOnboardingTpl.owner.${role || 'rh'}`;
  const translated = t(locale, k);
  return translated === k ? role || 'rh' : translated;
}

/**
 * Pre-onboarding checklist (accesses / D1) — B-702.
 */
export function PreOnboardingChecklistBlock({ locale, candidateId, employmentStatus }) {
  const { toast, promptForm } = useAppFeedback();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const allDone = items.length > 0 && items.every(item => item.status === 'done' || item.status === 'skipped');
  useEffect(() => { setExpanded(!allDone); }, [candidateId, allDone]);

  const load = useCallback(async () => {
    if (!candidateId || employmentStatus !== EMPLOYMENT_STATUS.EMPLOYEE) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(
        `/api/admin/candidates/${encodeURIComponent(candidateId)}/pre-onboarding`
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'load');
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch (e) {
      toast(e?.message || t(locale, 'panel.preOnboarding.loadError'), 'error');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [candidateId, employmentStatus, locale, toast]);

  useEffect(() => {
    load();
  }, [load]);

  if (employmentStatus !== EMPLOYMENT_STATUS.EMPLOYEE) return null;

  const completeFields = (row) => {
    const fields = [
      {
        key: 'notes',
        type: 'textarea',
        label: t(locale, 'panel.preOnboarding.notesLabel'),
        placeholder: t(locale, 'panel.preOnboarding.notesPh'),
      },
    ];
    if (allowsMeet(row)) {
      fields.unshift({
        key: 'meetUrl',
        type: 'url',
        label: t(locale, 'panel.preOnboarding.meetUrlLabel'),
        placeholder: t(locale, 'panel.preOnboarding.meetUrlPh'),
        initialValue: row.meetUrl || '',
      });
    }
    return fields;
  };

  const complete = async (row, status) => {
    const values = await promptForm({
      title: itemLabel(locale, row),
      confirmLabel: t(locale, 'panel.preOnboarding.completeConfirm'),
      fields: completeFields(row),
    });
    if (!values) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/admin/candidates/${encodeURIComponent(candidateId)}/pre-onboarding`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            itemId: row.id,
            status,
            notes: values.notes || '',
            meetUrl: values.meetUrl,
          }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'save');
      toast(t(locale, 'panel.preOnboarding.saved'), 'ok');
      await load();
    } catch (e) {
      toast(e?.message || t(locale, 'panel.preOnboarding.saveError'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const setMeetUrl = async (row) => {
    const values = await promptForm({
      title: t(locale, 'panel.preOnboarding.meetUrlTitle'),
      confirmLabel: t(locale, 'panel.preOnboarding.completeConfirm'),
      fields: [
        {
          key: 'meetUrl',
          type: 'url',
          label: t(locale, 'panel.preOnboarding.meetUrlLabel'),
          placeholder: t(locale, 'panel.preOnboarding.meetUrlPh'),
          initialValue: row.meetUrl || '',
        },
      ],
    });
    if (!values) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/admin/candidates/${encodeURIComponent(candidateId)}/pre-onboarding`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'setMeetUrl',
            itemId: row.id,
            meetUrl: values.meetUrl,
          }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'save');
      toast(t(locale, 'panel.preOnboarding.saved'), 'ok');
      await load();
    } catch (e) {
      toast(e?.message || t(locale, 'panel.preOnboarding.saveError'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const doneCount = items.filter((i) => i.status === 'done' || i.status === 'skipped').length;

  return (
    <section className={cn(S.cardTight, 'mt-3')} aria-label={t(locale, 'panel.preOnboarding.sectionAria')}>
      <CollapsibleBlock locale={locale} title={t(locale, 'panel.preOnboarding.title')} bordered={false} open={expanded} onOpenChange={setExpanded} titleClassName={S.cardSection} headerAside={items.length ? <StatusToneChip tone={allDone ? 'success' : 'neutral'}>{t(locale, 'panel.preOnboarding.progress', { done: doneCount, total: items.length })}</StatusToneChip> : null}>
      <p className={cn(S.muted, 'm-0 mt-1 text-prose')}>{t(locale, 'panel.preOnboarding.hint')}</p>
      {items.length > 0 ? (
        <div className="mt-2">
          <p className={cn(S.faint, 'm-0 mb-1.5 font-ui text-prose')}>
            {t(locale, 'panel.preOnboarding.progress', { done: doneCount, total: items.length })}
          </p>
          <MeterBar
            value={doneCount}
            max={items.length}
            height={6}
            aria-label={t(locale, 'panel.preOnboarding.progress', {
              done: doneCount,
              total: items.length,
            })}
          />
        </div>
      ) : null}

      {loading ? (
        <div className="mt-3">
          <AppLoading variant="panel" label={t(locale, 'panel.common.loading')} />
        </div>
      ) : items.length === 0 ? (
        <div className="mt-3">
          <EmptyState
            title={t(locale, 'panel.preOnboarding.emptyTitle')}
            message={t(locale, 'panel.preOnboarding.emptyHint')}
          />
        </div>
      ) : (
        <ContentEnter className="mt-3" animKey={`pre-onb|${items.length}|${doneCount}`}>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {items.map((row) => {
              const done = row.status === 'done' || row.status === 'skipped';
              const isCall = allowsMeet(row);
              const owner = row.ownerRole || 'rh';
              return (
                <li
                  key={row.id}
                  className={cn(
                    'flex flex-wrap items-center gap-2 rounded-control border px-2.5 py-2',
                    row.overdue
                      ? 'border-warning/30 bg-warning/[0.05]'
                      : 'border-ink/10 bg-surface'
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5 font-ui text-sm text-ink">
                      <span>{itemLabel(locale, row)}</span>
                      <StatusToneChip tone={OWNER_TONE[owner] || 'neutral'}>
                        {ownerLabel(locale, owner)}
                      </StatusToneChip>
                      {row.overdue ? (
                        <StatusToneChip tone="warning">
                          {t(locale, 'panel.preOnboarding.overdue')}
                        </StatusToneChip>
                      ) : null}
                      {done ? (
                        <StatusToneChip tone={row.status === 'skipped' ? 'neutral' : 'success'}>
                          {t(locale, `panel.preOnboarding.status.${row.status}`)}
                        </StatusToneChip>
                      ) : null}
                    </div>
                    <div className="mt-0.5 font-ui text-prose text-ink-muted">
                      {t(locale, 'panel.preOnboarding.due', { date: row.dueDate || '—' })}
                      {row.employeeAckAt ? (
                        <span className="text-success">
                          {' · '}
                          {t(locale, 'panel.preOnboarding.employeeAcked')}
                        </span>
                      ) : null}
                    </div>
                    {row.meetUrl ? (
                      <a
                        href={row.meetUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-flex min-h-touch items-center font-ui text-prose text-brand-600"
                      >
                        {t(locale, 'panel.preOnboarding.openMeet')}
                      </a>
                    ) : null}
                  </div>
                  {!done ? (
                    <div className="flex flex-wrap gap-1.5">
                      {isCall ? (
                        <button
                          type="button"
                          disabled={busy}
                          className={cn(S.btnGhost, 'min-h-touch')}
                          onClick={() => setMeetUrl(row)}
                        >
                          {t(locale, 'panel.preOnboarding.meetUrlBtn')}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        disabled={busy}
                        className={cn(S.btnBrandSoft, 'min-h-touch')}
                        onClick={() => complete(row, 'done')}
                      >
                        {t(locale, 'panel.preOnboarding.markDone')}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        className={cn(S.btnGhost, 'min-h-touch')}
                        onClick={() => complete(row, 'skipped')}
                      >
                        {t(locale, 'panel.preOnboarding.skip')}
                      </button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </ContentEnter>
      )}
      </CollapsibleBlock>
    </section>
  );
}
