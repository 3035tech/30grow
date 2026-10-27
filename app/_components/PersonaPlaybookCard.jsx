'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { t } from '../../lib/i18n';
import { cn } from '../../lib/cn';
import { S } from '../dashboard/dashboard-shared';
import { PLAYBOOK_IDS } from '../../lib/development/persona-playbooks.js';
import { DisclosureToggle } from './CollapsibleBlock';
import { MeterBar } from './MeterBar';

const DISMISS_KEY = 'team30_playbook_dismissed';

function taskLabel(locale, playbookId, taskId) {
  return t(locale, `panel.playbook.${playbookId}.${taskId}.title`);
}

function taskDesc(locale, playbookId, taskId) {
  return t(locale, `panel.playbook.${playbookId}.${taskId}.desc`);
}

function playbookTitle(locale, playbookId) {
  return t(locale, `panel.playbook.${playbookId}.title`);
}

const TASK_ROUTES = {
  create_vacancy: '/dashboard?tab=vagas',
  send_invite: '/dashboard?tab=vagas',
  view_ranking: '/dashboard?tab=vagas',
  scorecard: '/dashboard?tab=vagas',
  hire: '/dashboard?tab=vagas',
  hire_kit: '/dashboard?tab=team',
  view_overview: '/dashboard?tab=overview',
  open_dossier: '/dashboard?tab=team',
  log_one_on_one: '/dashboard?tab=team',
  active_pdi: '/dashboard?tab=team',
  view_analytics: '/dashboard?tab=analytics',
  review_culture: '/dashboard?tab=overview',
  review_exits: '/dashboard?tab=exit-analysis',
  review_succession: '/dashboard?tab=succession',
};

/** Per-tab progress reused while switching tabs; progress only moves after real work. */
const PLAYBOOK_CACHE_MS = 60_000;
const playbookCache = new Map();

/**
 * Checklist contextual por aba + persona (B-2501 packaging).
 */
export function PersonaPlaybookCard({ tab, role, locale = 'pt-BR' }) {
  const router = useRouter();
  const [playbooks, setPlaybooks] = useState([]);
  const [collapsed, setCollapsed] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem(`${DISMISS_KEY}_${tab}`);
      if (raw === '1') setDismissed(true);
    } catch {
      /* ignore */
    }
  }, [tab]);

  useEffect(() => {
    let cancelled = false;
    const key = `${role || ''}|${tab || 'overview'}`;
    const cached = playbookCache.get(key);
    let isDismissed = false;
    try {
      isDismissed = localStorage.getItem(`${DISMISS_KEY}_${tab}`) === '1';
    } catch {
      /* ignore */
    }
    if (isDismissed) return undefined;
    if (cached && Date.now() - cached.at < PLAYBOOK_CACHE_MS) {
      setPlaybooks(cached.playbooks);
      return undefined;
    }
    (async () => {
      try {
        const res = await fetch(
          `/api/admin/playbook-progress?tab=${encodeURIComponent(tab || 'overview')}`
        );
        const data = await res.json().catch(() => ({}));
        if (!cancelled && res.ok) {
          const next = Array.isArray(data.playbooks) ? data.playbooks : [];
          playbookCache.set(key, { at: Date.now(), playbooks: next });
          setPlaybooks(next);
        }
      } catch {
        if (!cancelled) setPlaybooks([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab, role]);

  if (dismissed || !playbooks.length) return null;

  const allDone = playbooks.every((pb) => pb.progress >= 100);
  if (allDone) return null;

  const primary = playbooks[0];
  const completedCount = primary.completed || 0;
  const totalCount = primary.total || primary.tasks?.length || 0;

  return (
    <div className={cn(S.card, 'mb-4 border-l-4 border-l-brand-500')}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-500/10 font-mono text-sm font-semibold text-brand-600">
            {primary.progress}%
          </div>
          <div>
            <h3 className="m-0 font-display text-sm text-ink">
              {playbookTitle(locale, primary.playbookId)}
            </h3>
            <p className={cn(S.muted, 'm-0 mt-0.5 text-xs')}>
              {t(locale, 'panel.playbook.progress', { done: completedCount, total: totalCount })}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            className={cn(S.btnGhost, 'min-h-touch inline-flex items-center px-2')}
            onClick={() => setCollapsed(!collapsed)}
            aria-expanded={!collapsed}
          >
            <DisclosureToggle locale={locale} open={!collapsed} />
          </button>
          <button
            type="button"
            className={cn(S.btnGhost, 'min-h-touch px-2 text-ink-faint')}
            onClick={() => {
              setDismissed(true);
              try {
                localStorage.setItem(`${DISMISS_KEY}_${tab}`, '1');
              } catch {
                /* ignore */
              }
            }}
            aria-label={t(locale, 'panel.playbook.dismiss')}
          >
            ×
          </button>
        </div>
      </div>

      {!collapsed ? (
        <>
          <MeterBar
            percent={primary.progress}
            height={6}
            className="mt-3"
            toneClass="bg-brand-500"
            aria-label={t(locale, 'panel.playbook.progress', {
              done: completedCount,
              total: totalCount,
            })}
          />
          <ul className="mt-3 m-0 flex list-none flex-col gap-2 p-0">
            {(primary.tasks || []).map((task) => (
              <li key={task.id}>
                <button
                  type="button"
                  disabled={task.completed}
                  onClick={() => {
                    const href = TASK_ROUTES[task.id] || `/dashboard?tab=${task.tab || tab}`;
                    router.push(href);
                  }}
                  className={cn(
                    'flex w-full min-h-touch items-start gap-3 rounded-control border px-3 py-2.5 text-left transition-colors',
                    task.completed
                      ? 'border-success/25 bg-success/[0.04]'
                      : 'border-ink/12 bg-canvas/50 hover:border-brand-500/30'
                  )}
                >
                  <span className="mt-0.5 text-sm">{task.completed ? '✓' : '○'}</span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        'block text-sm',
                        task.completed ? 'text-ink-muted line-through' : 'text-ink'
                      )}
                    >
                      {taskLabel(locale, primary.playbookId, task.id)}
                    </span>
                    <span className={cn(S.faint, 'mt-0.5 block text-xs')}>
                      {taskDesc(locale, primary.playbookId, task.id)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {playbooks.length > 1 ? (
            <p className={cn(S.faint, 'm-0 mt-2 text-2xs')}>
              {t(locale, 'panel.playbook.morePlaybooks', { n: playbooks.length - 1 })}
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export { PLAYBOOK_IDS };
