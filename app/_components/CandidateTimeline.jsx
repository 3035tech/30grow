'use client';

import { localeHtmlLang, t } from '../../lib/i18n';
import { C, PIPELINE_STAGE_COLORS } from '../../lib/theme';
import { cn } from '../../lib/cn';
import { PIPELINE_STAGE } from '../../lib/pipeline';
import { rejectionReasonLabel } from '../dashboard/pipeline-prompts';

/** Funil principal (ordem). Rejeitado/arquivado entram como desvio visual. */
const HAPPY_PATH = [
  PIPELINE_STAGE.NEW,
  PIPELINE_STAGE.INTERVIEW,
  PIPELINE_STAGE.TEST_COMPLETED,
  PIPELINE_STAGE.SCREENING,
  PIPELINE_STAGE.APPROVED,
  PIPELINE_STAGE.HIRED,
];

const STAGE_LABEL_KEY = {
  [PIPELINE_STAGE.NEW]: 'recruiting.pipelineNew',
  [PIPELINE_STAGE.INTERVIEW]: 'recruiting.pipelineInterview',
  [PIPELINE_STAGE.TEST_COMPLETED]: 'recruiting.pipelineTestCompleted',
  [PIPELINE_STAGE.SCREENING]: 'recruiting.pipelineScreening',
  [PIPELINE_STAGE.APPROVED]: 'recruiting.pipelineApproved',
  [PIPELINE_STAGE.HIRED]: 'recruiting.pipelineHired',
  [PIPELINE_STAGE.REJECTED]: 'recruiting.pipelineRejected',
  [PIPELINE_STAGE.ARCHIVED]: 'recruiting.pipelineArchived',
};

function pipelineLabel(locale, code) {
  return t(locale, STAGE_LABEL_KEY[code] || 'recruiting.pipelineNew');
}

function Icon({ children, size = 16 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

const STAGE_ICONS = {
  new: (
    <Icon>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M19 8v6M22 11h-6" />
    </Icon>
  ),
  interview: (
    <Icon>
      <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
    </Icon>
  ),
  test_completed: (
    <Icon>
      <rect x="8" y="2" width="8" height="4" rx="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <path d="M9 12h6M9 16h4" />
    </Icon>
  ),
  screening: (
    <Icon>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </Icon>
  ),
  approved: (
    <Icon>
      <path d="M20 6 9 17l-5-5" />
    </Icon>
  ),
  hired: (
    <Icon>
      <path d="M12 3v12" />
      <path d="m8 11 4 4 4-4" />
      <path d="M5 21h14" />
    </Icon>
  ),
  rejected: (
    <Icon>
      <circle cx="12" cy="12" r="9" />
      <path d="m15 9-6 6M9 9l6 6" />
    </Icon>
  ),
  archived: (
    <Icon>
      <rect x="2" y="4" width="20" height="5" rx="1" />
      <path d="M4 9v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9M10 13h4" />
    </Icon>
  ),
};

function resolveCurrentStage(currentStage, events = []) {
  if (currentStage && STAGE_LABEL_KEY[currentStage]) return currentStage;
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const ev = events[i];
    if (ev.type === 'pipeline.change' && ev.toStage && STAGE_LABEL_KEY[ev.toStage]) {
      return ev.toStage;
    }
    if (ev.type === 'candidate.hired') return PIPELINE_STAGE.HIRED;
    if (ev.type === 'assessment.completed') return PIPELINE_STAGE.TEST_COMPLETED;
  }
  return PIPELINE_STAGE.NEW;
}

function collectVisited(events = []) {
  const visited = new Set([PIPELINE_STAGE.NEW]);
  for (const ev of events) {
    if (ev.type === 'pipeline.change') {
      if (ev.fromStage) visited.add(ev.fromStage);
      if (ev.toStage) visited.add(ev.toStage);
    }
    if (ev.type === 'assessment.completed' || ev.type === 'invite.completed') {
      visited.add(PIPELINE_STAGE.TEST_COMPLETED);
    }
    if (ev.type === 'candidate.hired') visited.add(PIPELINE_STAGE.HIRED);
  }
  return visited;
}

/**
 * @returns {{ id: string, status: 'done'|'current'|'todo'|'skipped' }[]}
 */
function buildSteps(currentStage, events = []) {
  const stage = resolveCurrentStage(currentStage, events);
  const visited = collectVisited(events);
  visited.add(stage);

  if (stage === PIPELINE_STAGE.REJECTED || stage === PIPELINE_STAGE.ARCHIVED) {
    let peak = 0;
    for (const id of HAPPY_PATH) {
      if (id === PIPELINE_STAGE.HIRED) continue;
      if (visited.has(id)) peak = Math.max(peak, HAPPY_PATH.indexOf(id));
    }
    const branchEv = [...events].reverse().find(
      (ev) => ev.type === 'pipeline.change' && ev.toStage === stage
    );
    if (branchEv?.fromStage && HAPPY_PATH.includes(branchEv.fromStage)) {
      peak = Math.max(peak, HAPPY_PATH.indexOf(branchEv.fromStage));
    }

    const steps = HAPPY_PATH.map((id, i) => {
      if (i <= peak) return { id, status: 'done' };
      return { id, status: 'skipped' };
    });
    steps.push({ id: stage, status: 'current' });
    return steps;
  }

  const idx = Math.max(0, HAPPY_PATH.indexOf(stage));
  return HAPPY_PATH.map((id, i) => {
    if (i < idx) return { id, status: 'done' };
    if (i === idx) return { id, status: 'current' };
    return { id, status: 'todo' };
  });
}

function statusStyles(status, color) {
  if (status === 'done') {
    return {
      nodeBg: color,
      nodeColor: '#fff',
      nodeBorder: color,
      labelColor: C.text,
      labelWeight: 600,
      opacity: 1,
      ring: 'none',
    };
  }
  if (status === 'current') {
    return {
      nodeBg: C.surface || '#fff',
      nodeColor: color,
      nodeBorder: color,
      labelColor: color,
      labelWeight: 700,
      opacity: 1,
      ring: `0 0 0 4px ${color}33`,
    };
  }
  if (status === 'skipped') {
    return {
      nodeBg: C.surface || '#fff',
      nodeColor: C.faint,
      nodeBorder: C.border,
      labelColor: C.faint,
      labelWeight: 500,
      opacity: 0.5,
      ring: 'none',
    };
  }
  return {
    nodeBg: C.surface || '#fff',
    nodeColor: C.muted,
    nodeBorder: C.border,
    labelColor: C.muted,
    labelWeight: 500,
    opacity: 0.8,
    ring: 'none',
  };
}

function LegendDot({ color, label, hollow }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-2xs text-ink-muted">
      <span
        className="box-border h-2.5 w-2.5 rounded-full border-2"
        style={{
          background: hollow ? '#fff' : color,
          borderColor: color,
        }}
      />
      {label}
    </span>
  );
}

function formatAt(at, locale) {
  if (!at) return null;
  return new Date(at).toLocaleString(localeHtmlLang(locale), {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Timeline horizontal do funil: etapas passadas / atual / faltando.
 */
export function CandidateTimeline({
  locale = 'pt-BR',
  events = [],
  currentStage = null,
  loading = false,
}) {
  if (loading) {
    return <p className="m-0 text-xs text-ink-muted">…</p>;
  }

  const stage = resolveCurrentStage(currentStage, events);
  const steps = buildSteps(stage, events);
  const rejectionEv = [...events].reverse().find(
    (ev) => ev.type === 'pipeline.change' && ev.toStage === PIPELINE_STAGE.REJECTED && ev.reason
  );

  return (
    <div className="flex flex-col items-center">
      <div className="mb-3.5 flex flex-wrap justify-center gap-x-4 gap-y-3">
        <LegendDot color={C.success} label={t(locale, 'recruiting.timelineLegendDone')} />
        <LegendDot
          color={PIPELINE_STAGE_COLORS[stage] || C.purple}
          label={t(locale, 'recruiting.timelineLegendCurrent')}
          hollow
        />
        <LegendDot color={C.border} label={t(locale, 'recruiting.timelineLegendTodo')} />
        {(stage === PIPELINE_STAGE.REJECTED || stage === PIPELINE_STAGE.ARCHIVED) && (
          <LegendDot color={C.faint} label={t(locale, 'recruiting.timelineLegendSkipped')} />
        )}
      </div>

      <div className="flex w-full justify-center overflow-x-auto px-1 pb-1 pt-2.5">
        <ol className="m-0 flex w-full min-w-min max-w-[920px] list-none items-start justify-center p-0 pt-1">
          {steps.map((step, i) => {
            const color = PIPELINE_STAGE_COLORS[step.id] || C.muted;
            const styles = statusStyles(step.status, color);
            const isFirst = i === 0;
            const isLast = i === steps.length - 1;
            const prev = steps[i - 1];
            const next = steps[i + 1];

            const segmentDone = (from, to) =>
              from
              && (from.status === 'done' || from.status === 'current')
              && to
              && (to.status === 'done' || to.status === 'current');

            const leftLineColor = segmentDone(prev, step)
              ? (PIPELINE_STAGE_COLORS[prev.id] || C.border)
              : C.border;
            const rightLineColor = segmentDone(step, next)
              ? color
              : C.border;

            return (
              <li
                key={`${step.id}-${i}`}
                className="flex min-w-24 max-w-[140px] flex-1 flex-col items-stretch"
                style={{ opacity: styles.opacity }}
              >
                <div className="mb-2 flex h-10 w-full items-center">
                  <div
                    aria-hidden
                    className="h-[3px] flex-1 rounded-sm"
                    style={{ background: isFirst ? 'transparent' : leftLineColor }}
                  />
                  <div
                    title={
                      step.status === 'current'
                        ? t(locale, 'recruiting.timelineLegendCurrent')
                        : step.status === 'done'
                          ? t(locale, 'recruiting.timelineLegendDone')
                          : step.status === 'skipped'
                            ? t(locale, 'recruiting.timelineLegendSkipped')
                            : t(locale, 'recruiting.timelineLegendTodo')
                    }
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-[2.5px]"
                    style={{
                      background: styles.nodeBg,
                      color: styles.nodeColor,
                      borderColor: styles.nodeBorder,
                      boxShadow: styles.ring,
                    }}
                  >
                    {step.status === 'done' ? (
                      <Icon size={15}>
                        <path d="M20 6 9 17l-5-5" />
                      </Icon>
                    ) : (
                      STAGE_ICONS[step.id]
                    )}
                  </div>
                  <div
                    aria-hidden
                    className="h-[3px] flex-1 rounded-sm"
                    style={{ background: isLast ? 'transparent' : rightLineColor }}
                  />
                </div>
                <div
                  className="px-1 text-center font-mono text-2xs leading-tight"
                  style={{
                    fontWeight: styles.labelWeight,
                    color: styles.labelColor,
                  }}
                >
                  {pipelineLabel(locale, step.id)}
                </div>
                {step.status === 'current' ? (
                  <div
                    className="mt-1.5 text-center font-mono text-2xs font-bold uppercase tracking-wider"
                    style={{ color }}
                  >
                    {t(locale, 'recruiting.timelineNow')}
                  </div>
                ) : (
                  <div className="h-[18px]" aria-hidden />
                )}
              </li>
            );
          })}
        </ol>
      </div>

      {stage === PIPELINE_STAGE.REJECTED && rejectionEv?.reason ? (
        <p className="mt-3 mb-0 w-full text-center text-xs text-danger">
          {t(locale, 'recruiting.rejectionReasonsLabel')}: {rejectionReasonLabel(locale, rejectionEv.reasons?.length ? rejectionEv.reasons : rejectionEv.reason)}
        </p>
      ) : null}

      {events.length > 0 ? (
        <details className="mt-3.5 w-full max-w-[520px]">
          <summary className="cursor-pointer select-none text-center font-mono text-2xs tracking-wide text-ink-muted [list-style-position:inside]">
            {t(locale, 'recruiting.timelineHistory', { n: events.length })}
          </summary>
          <ul className="mb-0 mt-2.5 list-none p-0 text-left">
            {[...events]
              .reverse()
              .slice(0, 12)
              .map((ev, i) => {
                let text = t(locale, ev.labelKey || 'recruiting.timelinePipelineChange');
                if (ev.type === 'pipeline.change') {
                  text = t(locale, 'recruiting.timelinePipelineChange', {
                    from: pipelineLabel(locale, ev.fromStage || '—'),
                    to: pipelineLabel(locale, ev.toStage || '—'),
                  });
                }
                const bits = [text];
                if (ev.type === 'pipeline.change' && ev.reason) bits.push(rejectionReasonLabel(locale, ev.reasons?.length ? ev.reasons : ev.reason));
                if (ev.vacancyTitle) bits.push(ev.vacancyTitle);
                if (ev.topType != null) bits.push(`T${ev.topType}`);
                return (
                  <li
                    key={`${ev.type}-${ev.at}-${i}`}
                    className={cn(
                      'py-1 text-xs leading-[1.45] text-ink-muted',
                      i < Math.min(events.length, 12) - 1 && 'border-b border-ink/12'
                    )}
                  >
                    <span className="font-mono text-ink-faint">
                      {formatAt(ev.at, locale) || '—'}
                    </span>
                    {' · '}
                    <span className="text-ink">{bits.join(' · ')}</span>
                  </li>
                );
              })}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
