'use client';

import { useCallback, useState } from 'react';
import { t } from '../../lib/i18n';
import { cn } from '../../lib/cn';
import { formatDisplayDate } from '../../lib/format-display-date';
import { S } from '../dashboard/dashboard-shared';
import { useAppFeedback } from './AppFeedback';
import { ContentEnter } from './AppLoading';
import { Icon } from './Icon';
import { MeterBar } from './MeterBar';
import { StatusToneChip } from './StatusToneChip';
import { ONBOARDING_ACK_KIND } from '../../lib/domain-status';

function itemTitle(locale, item) {
  if (item.kind === ONBOARDING_ACK_KIND.CHECKIN) {
    return t(locale, 'employeeHome.journeyCheckin', { days: item.milestoneDays });
  }
  return t(locale, `employeeHome.journeyItem.${item.itemKey}`);
}

function itemIcon(item) {
  if (item.kind === ONBOARDING_ACK_KIND.CHECKIN) return 'clipboard';
  switch (item.itemKey) {
    case 'welcome_kit':
      return 'gift';
    case 'access_sheet':
      return 'list';
    case 'rh_onboarding_call':
    case 'manager_onboarding':
      return 'users';
    default:
      return 'clipboard';
  }
}

/** Employee-facing completion: HR done + ack when the item asks for it. */
function isFullyDone(item) {
  if (!item.hrDone) return false;
  if (!item.canAck) return true;
  return Boolean(item.employeeAckAt);
}

function needsYourAck(item) {
  return Boolean(item.canAck && !item.employeeAckAt);
}

function itemStatus(locale, item) {
  if (isFullyDone(item)) {
    return { tone: 'success', label: t(locale, 'employeeHome.journeyFullyDone') };
  }
  if (needsYourAck(item) && item.hrDone) {
    return { tone: 'brand', label: t(locale, 'employeeHome.journeyAwaitingYou') };
  }
  if (item.overdue) {
    return { tone: 'warning', label: t(locale, 'employeeHome.journeyOverdue') };
  }
  if (item.hrDone) {
    return { tone: 'success', label: t(locale, 'employeeHome.journeyHrDone') };
  }
  return { tone: 'neutral', label: t(locale, 'employeeHome.journeyPending') };
}

function itemOwnerLabel(locale, item) {
  const role = item.ownerRole === 'manager_or_rh' ? 'managerOrHr' : item.ownerRole || 'rh';
  if (item.ownerName && item.ownerRole === 'manager') {
    return t(locale, 'employeeHome.journeyOwner.managerNamed', { name: item.ownerName });
  }
  if (item.ownerName && item.ownerRole === 'manager_or_rh') {
    return t(locale, 'employeeHome.journeyOwner.managerOrHrNamed', { name: item.ownerName });
  }
  return t(locale, `employeeHome.journeyOwner.${role}`);
}

/**
 * Minha chegada: timeline D1 + check-ins com progresso, fases e CTAs claros.
 */
export function EmployeeOnboardingJourneySection({ locale, journey, onChanged }) {
  const { toast } = useAppFeedback();
  const [busyId, setBusyId] = useState(null);

  const ack = useCallback(
    async (item) => {
      if (item.employeeAckAt || !item.canAck) return;
      setBusyId(`${item.kind}-${item.id}`);
      try {
        const res = await fetch('/api/employee/onboarding', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind: item.kind, itemId: item.id }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || 'ack');
        toast(t(locale, 'employeeHome.journeyAckOk'), 'ok');
        if (typeof onChanged === 'function') await onChanged(data.journey);
      } catch (e) {
        toast(e?.message || t(locale, 'employeeHome.journeyAckError'), 'error');
      } finally {
        setBusyId(null);
      }
    },
    [locale, onChanged, toast]
  );

  const timeline = [
    ...(journey?.preItems || []).map((item) => ({ ...item, phase: 'd1' })),
    ...(journey?.checkins || []).map((item) => ({ ...item, phase: 'post' })),
  ];

  if (!timeline.length) return null;

  const doneCount = timeline.filter(isFullyDone).length;
  const totalCount = timeline.length;
  const progressPct = totalCount ? Math.round((doneCount / totalCount) * 100) : 0;
  const nextItem = timeline.find((item) => !isFullyDone(item));
  const nextKey = nextItem ? `${nextItem.kind}-${nextItem.id}` : null;

  const phases = [
    { id: 'd1', label: t(locale, 'employeeHome.journeyPhaseD1'), items: timeline.filter((i) => i.phase === 'd1') },
    {
      id: 'post',
      label: t(locale, 'employeeHome.journeyPhasePost'),
      items: timeline.filter((i) => i.phase === 'post'),
    },
  ].filter((p) => p.items.length > 0);

  return (
    <ContentEnter animKey={`journey-${doneCount}-${totalCount}`}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          {journey.startDate ? (
            <p className={cn(S.muted, 'm-0')}>
              {t(locale, 'employeeHome.journeyStart', {
                date: formatDisplayDate(journey.startDate, locale),
              })}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className={cn(S.faint, 'm-0')}>
              {t(locale, 'employeeHome.journeyProgress', { done: doneCount, total: totalCount })}
            </p>
            {progressPct === 100 ? (
              <StatusToneChip tone="success">{t(locale, 'employeeHome.journeyAllDone')}</StatusToneChip>
            ) : null}
          </div>
          <MeterBar
            percent={progressPct}
            height={6}
            toneClass={progressPct === 100 ? 'bg-success' : 'bg-brand-500'}
            aria-label={t(locale, 'employeeHome.journeyProgress', {
              done: doneCount,
              total: totalCount,
            })}
          />
        </div>

        <div className="flex flex-col gap-5">
          {phases.map((phase) => (
            <div key={phase.id} className="flex flex-col gap-2">
              <div className={cn(S.label, 'text-ink-label')}>{phase.label}</div>
              <ol className="relative m-0 list-none space-y-0 p-0">
                {phase.items.map((item, idxInPhase) => {
                  const key = `${item.kind}-${item.id}`;
                  const stepNum = timeline.findIndex((x) => `${x.kind}-${x.id}` === key) + 1;
                  const status = itemStatus(locale, item);
                  const fullyDone = isFullyDone(item);
                  const awaiting = needsYourAck(item);
                  const isNext = key === nextKey;
                  const lastInPhase = idxInPhase === phase.items.length - 1;
                  const ackLabel =
                    item.ackType === 'received'
                      ? t(locale, 'employeeHome.journeyAckReceived')
                      : t(locale, 'employeeHome.journeyAckCall');
                  const busy = busyId === key;

                  return (
                    <li key={key} className="relative flex gap-3 pb-3 last:pb-0">
                      <div className="relative flex w-5 flex-shrink-0 flex-col items-center">
                        <span
                          className={cn(
                            'z-[1] mt-1 flex h-5 w-5 items-center justify-center rounded-full border-2',
                            fullyDone
                              ? 'border-success bg-success text-white'
                              : isNext || awaiting
                                ? 'border-brand-500 bg-brand-500/15 text-brand-600'
                                : item.overdue
                                  ? 'border-warning bg-warning/25 text-amber-800 dark:text-warning'
                                  : 'border-ink/25 bg-canvas text-ink/75'
                          )}
                          aria-hidden
                        >
                          {fullyDone ? (
                            <Icon name="check" className="h-3 w-3" />
                          ) : (
                            <span className="font-ui text-prose leading-none">{stepNum}</span>
                          )}
                        </span>
                        {!lastInPhase ? (
                          <span
                            className={cn(
                              'absolute top-6 bottom-[-6px] w-px',
                              fullyDone ? 'bg-success/35' : 'bg-ink/15'
                            )}
                            aria-hidden
                          />
                        ) : null}
                      </div>

                      <div
                        className={cn(
                          'min-w-0 flex-1 rounded-control border px-3 py-2.5 transition-colors',
                          isNext && !fullyDone
                            ? 'border-brand-500/35 bg-brand-500/[0.04] shadow-sm shadow-brand-500/5'
                            : item.overdue && !fullyDone
                              ? 'border-warning/30 bg-warning/[0.05]'
                              : fullyDone
                                ? 'border-ink/10 bg-canvas/40'
                                : 'border-ink/12 bg-canvas/50'
                        )}
                      >
                        <div className="flex items-start gap-2.5">
                          <span
                            className={cn(
                              'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-control',
                              fullyDone ? 'bg-success/10 text-success' : 'bg-ink/[0.05] text-ink-muted'
                            )}
                            aria-hidden
                          >
                            <Icon name={itemIcon(item)} className="h-4 w-4" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <div className={cn(S.cardBody, 'font-medium')}>{itemTitle(locale, item)}</div>
                              {isNext && !fullyDone ? (
                                <StatusToneChip tone="brand" bordered={false}>
                                  {t(locale, 'employeeHome.journeyNext')}
                                </StatusToneChip>
                              ) : null}
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-1.5">
                              <span className={S.cardMuted}>
                                {t(locale, 'employeeHome.journeyResponsible', { name: itemOwnerLabel(locale, item) })}
                              </span>
                              {item.dueDate ? (
                                <span className={S.cardMuted}>
                                  {t(locale, 'employeeHome.dueBy', {
                                    date: formatDisplayDate(item.dueDate, locale),
                                  })}
                                </span>
                              ) : null}
                              <StatusToneChip tone={status.tone}>{status.label}</StatusToneChip>
                              {item.employeeAckAt && !fullyDone ? (
                                <StatusToneChip tone="success" bordered={false}>
                                  {t(locale, 'employeeHome.journeyAcked')}
                                </StatusToneChip>
                              ) : null}
                            </div>

                            {(item.meetUrl || (awaiting && item.canAck)) && (
                              <div className="mt-2.5 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                                {awaiting && item.canAck ? (
                                  <button
                                    type="button"
                                    disabled={busy}
                                    className={cn(
                                      isNext ? S.btnPrimary : S.btnBrandSoft,
                                      'min-h-touch w-full text-prose sm:w-auto'
                                    )}
                                    onClick={() => ack(item)}
                                  >
                                    {busy ? t(locale, 'employeeHome.journeyAckBusy') : ackLabel}
                                  </button>
                                ) : null}
                                {item.meetUrl ? (
                                  <a
                                    href={item.meetUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className={cn(
                                      awaiting ? S.btnGhost : S.btnBrandSoft,
                                      'inline-flex min-h-touch w-full items-center justify-center gap-1.5 text-prose no-underline sm:w-auto'
                                    )}
                                  >
                                    <Icon name="externalLink" className="h-3.5 w-3.5 shrink-0" />
                                    {t(locale, 'employeeHome.journeyOpenMeet')}
                                  </a>
                                ) : null}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
          ))}
        </div>
      </div>
    </ContentEnter>
  );
}
