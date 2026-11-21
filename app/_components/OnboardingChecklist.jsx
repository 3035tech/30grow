'use client';

/**
 * Onboarding checklist — persistent Overview card (first-week activation).
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '../../lib/cn';
import { t } from '../../lib/i18n';
import { CollapsibleBlock } from './CollapsibleBlock';
import { S } from '../dashboard/dashboard-shared';

const TASK_TABS = Object.freeze({
  create_vacancy: 'vacancies',
  send_assessment: 'vacancies',
  view_result: 'team',
  move_pipeline: 'vacancies',
  create_climate: 'climate',
  view_analytics: 'analytics',
  invite_manager: 'users',
  setup_job_role: 'job-roles',
  setup_lms_course: 'lms',
  setup_benefits: 'company-benefits',
  setup_performance: 'performance-reviews',
  setup_succession: 'succession',
  setup_company_feed: 'company-feed',
  setup_whistleblowing: 'whistleblowing',
});

function dismissedStorageKey(companyId) {
  return `team30_onboarding_dismissed:${companyId || 'default'}`;
}

function readDismissed(companyId) {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(dismissedStorageKey(companyId)) === 'true';
  } catch {
    return false;
  }
}

export function OnboardingChecklist({ locale = 'pt-BR', companyId = null, initialProgress, initialTasks, canOpenTab = null }) {
  const [dismissed, setDismissed] = useState(() => {
    return readDismissed(companyId);
  });
  const router = useRouter();

  const allTasks = initialProgress?.tasks || initialTasks || [];
  // Tasks pointing at tabs this manager cannot open (module off / no capability) are not actionable.
  const tasks = typeof canOpenTab === 'function'
    ? allTasks.filter((task) => !TASK_TABS[task.id] || canOpenTab(TASK_TABS[task.id]))
    : allTasks;
  const totalWeight = tasks.reduce((sum, task) => sum + (task.weight || 0), 0);
  const doneWeight = tasks.reduce((sum, task) => sum + (task.completed ? task.weight || 0 : 0), 0);
  const progress = totalWeight > 0 ? Math.round((doneWeight / totalWeight) * 100) : 100;

  if (progress >= 100 || dismissed) {
    return null;
  }

  const completedCount = tasks.filter((task) => task.completed).length;
  const totalCount = tasks.length;
  const taskGroups = tasks.reduce((groups, task) => {
    const moduleId = task.moduleId || 'core';
    const group = groups.get(moduleId) || [];
    group.push(task);
    groups.set(moduleId, group);
    return groups;
  }, new Map());

  const handleTaskClick = (taskId) => {
    const tab = TASK_TABS[taskId];
    if (!tab) return;
    const params = new URLSearchParams({ tab });
    if (companyId) params.set('company', String(companyId));
    if (taskId === 'create_vacancy') params.set('create', '1');
    router.push(`/dashboard?${params.toString()}`);
  };

  const handleDismiss = () => {
    setDismissed(true);
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(dismissedStorageKey(companyId), 'true');
      } catch {
        /* checklist can still be dismissed for this visit */
      }
    }
  };

  const taskTitle = (task) => {
    const key = `panel.firstSteps.task.${task.id}.title`;
    const label = t(locale, key);
    return label === key ? task.title : label;
  };

  const taskDesc = (task) => {
    const key = `panel.firstSteps.task.${task.id}.desc`;
    const label = t(locale, key);
    return label === key ? task.description : label;
  };

  return (
    <div className={cn(S.card, 'overflow-hidden border-brand-500/20 bg-brand-500/[0.04]')}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-action font-mono text-sm font-semibold text-action-ink"
            aria-hidden
          >
            {progress}%
          </div>
          <div className="min-w-0">
            <h3 className={cn(S.cardTitle, 'm-0')}>{t(locale, 'panel.firstSteps.title')}</h3>
            <p className={cn(S.cardMuted, 'm-0')}>
              {t(locale, 'panel.firstSteps.progress', { done: completedCount, total: totalCount })}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          className={cn(S.btnGhost, 'min-h-touch shrink-0 px-2 text-xs')}
          aria-label={t(locale, 'panel.firstSteps.dismiss')}
        >
          {t(locale, 'panel.firstSteps.dismiss')}
        </button>
      </div>

      <div className="mb-3 h-2 overflow-hidden rounded-full bg-ink/[0.08]" aria-hidden>
        <div
          className="h-full rounded-full bg-brand-500 transition-[width] duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>

      <CollapsibleBlock
        locale={locale}
        title={t(locale, 'panel.firstSteps.tasksHeading')}
        defaultOpen
        variant="plain"
      >
        <div className="flex flex-col gap-4">
          {[...taskGroups.entries()].map(([moduleId, moduleTasks]) => {
            const nextTaskId = moduleTasks.find((task) => !task.completed)?.id;
            return (
              <section key={moduleId} aria-label={t(locale, `onboarding.modules.item.${moduleId}.title`)}>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <h4 className={cn(S.cardSection, 'm-0')}>{t(locale, `onboarding.modules.item.${moduleId}.title`)}</h4>
                  <span className={S.cardFaint}>
                    {t(locale, 'panel.firstSteps.progress', {
                      done: moduleTasks.filter((task) => task.completed).length,
                      total: moduleTasks.length,
                    })}
                  </span>
                </div>
                <ul className="m-0 flex list-none flex-col gap-2 p-0">
                  {moduleTasks.map((task) => (
                    <li key={task.id}>
                      <button
                        type="button"
                        onClick={() => !task.completed && handleTaskClick(task.id)}
                        disabled={task.completed}
                        className={cn(
                          'flex w-full min-h-touch items-start gap-3 rounded-control border px-3 py-2.5 text-left transition-colors',
                          task.completed
                            ? 'cursor-default border-success/25 bg-success/[0.06]'
                            : 'cursor-pointer border-ink/12 bg-surface hover:border-brand-500/35'
                        )}
                      >
                        <span
                          className={cn(
                            'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2',
                            task.completed
                              ? 'border-success bg-success text-white'
                              : 'border-ink/25 bg-transparent'
                          )}
                          aria-hidden
                        >
                          {task.completed ? '✓' : null}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span
                            className={cn(
                              'block font-ui text-sm',
                              task.completed ? 'text-ink-muted line-through' : 'font-medium text-ink'
                            )}
                          >
                            {taskTitle(task)}
                          </span>
                          <span className={cn(S.cardMuted, 'mt-0.5 block')}>{taskDesc(task)}</span>
                        </span>
                        {!task.completed ? (
                          <span className="shrink-0 self-center font-ui text-xs font-semibold text-brand-600">
                            {t(locale, task.id === nextTaskId ? 'panel.firstSteps.nextAction' : 'panel.firstSteps.openNextAction')}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
        {progress < 100 ? (
          <p className={cn(S.cardFaint, 'mb-0 mt-3 text-center')}>
            {t(locale, 'panel.firstSteps.footerHint')}
          </p>
        ) : null}
      </CollapsibleBlock>
    </div>
  );
}
