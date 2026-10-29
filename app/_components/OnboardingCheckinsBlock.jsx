'use client';

import { useCallback, useEffect, useState } from 'react';
import { t } from '../../lib/i18n';
import { cn } from '../../lib/cn';
import { S } from '../dashboard/dashboard-shared';
import { EmptyState } from './EmptyState';
import { AppLoading, ContentEnter } from './AppLoading';
import { useAppFeedback } from './AppFeedback';
import { RichTextView } from './RichTextView';
import { isRichTextEmpty } from '../../lib/sanitize-html';
import { EMPLOYMENT_STATUS } from '../../lib/domain-status.js';
import { StatusToneChip } from './StatusToneChip';
import { CollapsibleBlock } from './CollapsibleBlock';
import { MeterBar } from './MeterBar';

const OUTCOME_TONE = Object.freeze({
  pass: 'success',
  continue: 'info',
  develop: 'brand',
  concern: 'warning',
  extend: 'warning',
  fail: 'danger',
  terminate: 'danger',
});

/**
 * Post-hire check-ins D30/D60/D90 — B-701 (light, not AVD).
 */
export function OnboardingCheckinsBlock({
  locale,
  candidateId,
  employmentStatus,
  onPdiChanged,
}) {
  const { toast, promptForm, confirm } = useAppFeedback();
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
        `/api/admin/candidates/${encodeURIComponent(candidateId)}/onboarding-checkins`
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'load');
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch (e) {
      toast(e?.message || t(locale, 'panel.onboarding.loadError'), 'error');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [candidateId, employmentStatus, locale, toast]);

  useEffect(() => {
    load();
  }, [load]);

  if (employmentStatus !== EMPLOYMENT_STATUS.EMPLOYEE) return null;

  const complete = async (row, status) => {
    const fields = [
      {
        key: 'meetUrl',
        type: 'url',
        label: t(locale, 'panel.onboarding.meetUrlLabel'),
        placeholder: t(locale, 'panel.onboarding.meetUrlPh'),
        initialValue: row.meetUrl || '',
      },
      {
        key: 'outcome',
        type: 'select',
        label: t(locale, 'panel.onboarding.outcomeLabel'),
        required: status === 'done',
        help: t(locale, 'panel.onboarding.outcomeHelp'),
        options: [
          { value: 'pass', label: t(locale, 'panel.onboarding.outcome.pass') },
          { value: 'continue', label: t(locale, 'panel.onboarding.outcome.continue') },
          { value: 'develop', label: t(locale, 'panel.onboarding.outcome.develop') },
          { value: 'concern', label: t(locale, 'panel.onboarding.outcome.concern') },
          { value: 'extend', label: t(locale, 'panel.onboarding.outcome.extend') },
          { value: 'fail', label: t(locale, 'panel.onboarding.outcome.fail') },
          { value: 'terminate', label: t(locale, 'panel.onboarding.outcome.terminate') },
        ],
      },
      {
        key: 'extendDays',
        type: 'number',
        label: t(locale, 'panel.onboarding.extendDaysLabel'),
        help: t(locale, 'panel.onboarding.extendDaysHelp'),
        initialValue: '30',
        showWhen: (vals) => vals.outcome === 'extend',
      },
      {
        key: 'notes',
        type: 'richText',
        label: t(locale, 'panel.onboarding.notesLabel'),
        placeholder: t(locale, 'panel.onboarding.notesPh'),
        minHeight: 110,
      },
    ];
    const values = await promptForm({
      title: t(locale, 'panel.onboarding.completeTitle', { days: row.milestoneDays }),
      confirmLabel: t(locale, 'panel.onboarding.completeConfirm'),
      fields,
    });
    if (!values) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/admin/candidates/${encodeURIComponent(candidateId)}/onboarding-checkins`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            checkinId: row.id,
            status,
            outcome: values.outcome || '',
            notes: values.notes || '',
            meetUrl: values.meetUrl,
            extendDays: values.extendDays,
            locale,
            seedPdi:
              values.outcome === 'develop' ||
              values.outcome === 'concern' ||
              values.outcome === 'fail' ||
              values.outcome === 'extend' ||
              values.outcome === 'terminate',
            seedRetention:
              values.outcome === 'concern' ||
              values.outcome === 'fail' ||
              values.outcome === 'extend' ||
              values.outcome === 'terminate',
          }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'save');
      toast(
        data.suggestExit
          ? t(locale, 'panel.onboarding.savedTerminate')
          : data.extendedMilestones
            ? t(locale, 'panel.onboarding.savedExtend', { n: data.extendedMilestones })
            : data.pdiItem || data.retentionFollowUp
              ? t(locale, 'panel.onboarding.savedWithPdi')
              : t(locale, 'panel.onboarding.saved'),
        data.suggestExit ? 'warning' : 'ok'
      );
      await load();
      if (data.pdiItem && typeof onPdiChanged === 'function') onPdiChanged();
    } catch (e) {
      toast(e?.message || t(locale, 'panel.onboarding.saveError'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const setMeetUrl = async (row) => {
    const values = await promptForm({
      title: t(locale, 'panel.onboarding.meetUrlTitle'),
      confirmLabel: t(locale, 'panel.onboarding.completeConfirm'),
      fields: [
        {
          key: 'meetUrl',
          type: 'url',
          label: t(locale, 'panel.onboarding.meetUrlLabel'),
          placeholder: t(locale, 'panel.onboarding.meetUrlPh'),
          initialValue: row.meetUrl || '',
        },
      ],
    });
    if (!values) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/admin/candidates/${encodeURIComponent(candidateId)}/onboarding-checkins`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'setMeetUrl',
            checkinId: row.id,
            meetUrl: values.meetUrl,
          }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'save');
      toast(t(locale, 'panel.onboarding.saved'), 'ok');
      await load();
    } catch (e) {
      toast(e?.message || t(locale, 'panel.onboarding.saveError'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const reopen = async (row) => {
    const ok = await confirm({
      title: t(locale, 'panel.onboarding.reopenTitle', { days: row.milestoneDays }),
      message: t(locale, 'panel.onboarding.reopenConfirm'),
      confirmLabel: t(locale, 'panel.onboarding.reopen'),
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/admin/candidates/${encodeURIComponent(candidateId)}/onboarding-checkins`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'reopen', checkinId: row.id }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || t(locale, 'panel.onboarding.saveError'));
      toast(t(locale, 'panel.onboarding.reopened'), 'ok');
      await load();
    } catch (e) {
      toast(e?.message || t(locale, 'panel.onboarding.saveError'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const doneCount = items.filter((i) => i.status === 'done' || i.status === 'skipped').length;

  return (
    <section className={cn(S.cardTight, 'mt-3')} aria-label={t(locale, 'panel.onboarding.sectionAria')}>
      <CollapsibleBlock locale={locale} title={t(locale, 'panel.onboarding.title')} bordered={false} open={expanded} onOpenChange={setExpanded} titleClassName={S.cardSection} headerAside={items.length ? <StatusToneChip tone={allDone ? 'success' : 'neutral'}>{t(locale, 'panel.onboarding.progress', { done: doneCount, total: items.length })}</StatusToneChip> : null}>
      <p className={cn(S.muted, 'm-0 mt-1 text-prose')}>{t(locale, 'panel.onboarding.hint')}</p>
      {items.length > 0 ? (
        <div className="mt-2">
          <p className={cn(S.cardMuted, 'm-0 mb-1.5')}>
            {t(locale, 'panel.onboarding.progress', { done: doneCount, total: items.length })}
          </p>
          <MeterBar
            value={doneCount}
            max={items.length}
            height={6}
            aria-label={t(locale, 'panel.onboarding.progress', {
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
            title={t(locale, 'panel.onboarding.emptyTitle')}
            message={t(locale, 'panel.onboarding.emptyHint')}
          />
        </div>
      ) : (
        <ContentEnter className="mt-3" animKey={`onb-chk|${items.length}|${doneCount}`}>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {items.map((row) => {
              const done = row.status === 'done' || row.status === 'skipped';
              const outcomeTone = OUTCOME_TONE[row.outcome] || 'neutral';
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
                      <span>
                        {t(locale, 'panel.onboarding.milestone', { days: row.milestoneDays })}
                      </span>
                      {row.overdue ? (
                        <StatusToneChip tone="warning">
                          {t(locale, 'panel.onboarding.overdue')}
                        </StatusToneChip>
                      ) : null}
                      {done && row.outcome ? (
                        <StatusToneChip
                          tone={outcomeTone}
                          title={t(locale, `panel.onboarding.outcome.${row.outcome}`)}
                        >
                          {t(locale, `panel.onboarding.outcomeChip.${row.outcome}`)}
                        </StatusToneChip>
                      ) : null}
                      {done ? (
                        <StatusToneChip tone={row.status === 'skipped' ? 'neutral' : 'success'}>
                          {t(locale, `panel.onboarding.status.${row.status}`)}
                        </StatusToneChip>
                      ) : null}
                    </div>
                    <div className="mt-0.5 text-prose text-ink-muted">
                      {t(locale, 'panel.onboarding.due', { date: row.dueDate || '—' })}
                      {done && row.outcome === 'extend' && row.extendDays != null ? (
                        <span>
                          {' · '}
                          {t(locale, 'panel.onboarding.extendedBy', { days: row.extendDays })}
                        </span>
                      ) : null}
                      {row.employeeAckAt ? (
                        <span className="text-success">
                          {' · '}
                          {t(locale, 'panel.onboarding.employeeAcked')}
                        </span>
                      ) : null}
                      {done && row.completedByName ? (
                        <span>
                          {' · '}
                          {t(locale, 'panel.onboarding.completedBy', { name: row.completedByName })}
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
                        {t(locale, 'panel.onboarding.openMeet')}
                      </a>
                    ) : null}
                    {done && !isRichTextEmpty(row.notes) ? (
                      <div className="mt-1.5 text-prose text-ink-muted">
                        <RichTextView
                          html={row.notes}
                          className="text-prose leading-snug text-ink-muted"
                        />
                      </div>
                    ) : null}
                  </div>
                  {!done ? (
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        disabled={busy}
                        className={cn(S.btnGhost, 'min-h-touch')}
                        onClick={() => setMeetUrl(row)}
                      >
                        {t(locale, 'panel.onboarding.meetUrlBtn')}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        className={cn(S.btnBrandSoft, 'min-h-touch')}
                        onClick={() => complete(row, 'done')}
                      >
                        {t(locale, 'panel.onboarding.markDone')}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        className={cn(S.btnGhost, 'min-h-touch')}
                        onClick={() => complete(row, 'skipped')}
                      >
                        {t(locale, 'panel.onboarding.skip')}
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      className={cn(S.btnGhost, 'min-h-touch')}
                      onClick={() => reopen(row)}
                    >
                      {t(locale, 'panel.onboarding.reopen')}
                    </button>
                  )}
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
