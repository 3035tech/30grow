import { t, localeHtmlLang } from '../../../lib/i18n';
import { cn } from '../../../lib/cn';
import { formatSalaryBr, salaryAmountNumber } from '../../../lib/br-masks';
import { PIPELINE_STAGE } from '../../../lib/pipeline.js';
import { S } from '../dashboard-shared';

function formatSalaryCompact(locale, value, bare = false) {
  const n = salaryAmountNumber(value);
  if (n == null) return '';
  return n.toLocaleString(localeHtmlLang(locale), {
    ...(bare ? {} : { style: 'currency', currency: 'BRL' }),
    notation: 'compact',
    maximumFractionDigits: 1,
  });
}

/** `opts.compact` → "R$ 14 mil–22 mil" for dense tables (pair with the full value in `title`). */
export function formatVacancySalaryRange(locale, min, max, opts = {}) {
  const fmt = opts.compact ? (v) => formatSalaryCompact(locale, v) : formatSalaryBr;
  const a = min ? fmt(min) : '';
  const b = max ? (opts.compact && a ? formatSalaryCompact(locale, max, true) : fmt(max)) : '';
  if (a && b) return t(locale, 'recruiting.salaryRangeDisplay', { min: a, max: b });
  if (a) return t(locale, 'recruiting.salaryFromDisplay', { min: a });
  if (b) return t(locale, 'recruiting.salaryUpToDisplay', { max: b });
  return null;
}

/** Tailwind classes for description assist buttons (template / AI). */
export function descAssistBtnClass(opts = {}) {
  const base = opts.primary ? S.btnBrandSoft : S.btnGhost;
  if (opts.busy) return base.replace('cursor-pointer', 'cursor-wait');
  return opts.disabled ? cn(base.replace('cursor-pointer', 'cursor-default'), 'opacity-55') : base;
}

export function inviteStatusLabel(locale, status) {
  const s = String(status || '');
  if (s === 'opened') return t(locale, 'recruiting.inviteOpened');
  if (s === 'completed') return t(locale, 'recruiting.inviteCompleted');
  if (s === 'cancelled') return t(locale, 'recruiting.inviteCancelled');
  return t(locale, 'recruiting.inviteSent');
}

export function formatRelativeAgo(dateLike, locale = 'pt-BR') {
  if (!dateLike) return null;
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return null;
  const diffMs = Date.now() - d.getTime();
  if (diffMs < 0) return null;
  const sec = Math.floor(diffMs / 1000);
  const min = Math.floor(sec / 60);
  const hr = Math.floor(min / 60);
  const day = Math.floor(hr / 24);
  if (sec < 60) return t(locale, 'recruiting.timeJustNow');
  if (min < 60) return t(locale, 'recruiting.timeMinutesAgo', { min });
  if (hr < 48) return t(locale, 'recruiting.timeHoursAgo', { hr });
  if (day < 30) return t(locale, 'recruiting.timeDaysAgo', { day });
  return d.toLocaleDateString(localeHtmlLang(locale), { day: '2-digit', month: '2-digit' });
}

/** Days in current pipeline stage (B-406). */
export function daysInStage(dateLike) {
  if (!dateLike) return null;
  const t0 = new Date(dateLike).getTime();
  if (!Number.isFinite(t0)) return null;
  return Math.max(0, Math.floor((Date.now() - t0) / 86400000));
}

/** Aging tone for open stages: warn ≥7d, danger ≥14d. */
export function stageAgingTone(days, pipelineStage) {
  if (days == null) return null;
  const s = String(pipelineStage || '');
  if (
    s === PIPELINE_STAGE.HIRED ||
    s === PIPELINE_STAGE.REJECTED ||
    s === PIPELINE_STAGE.ARCHIVED
  ) {
    return null;
  }
  if (days >= 14) return 'danger';
  if (days >= 7) return 'warning';
  return null;
}

export function inviteStatusShort(locale, status) {
  const s = String(status || '');
  if (s === 'opened') return t(locale, 'recruiting.inviteOpened');
  if (s === 'completed') return t(locale, 'recruiting.inviteCompleted');
  if (s === 'sent') return t(locale, 'recruiting.inviteSent');
  if (s === 'cancelled') return t(locale, 'recruiting.inviteCancelled');
  return null;
}

export function fitBandLabel(locale, code) {
  if (code === 'high') return t(locale, 'recruiting.fitHigh');
  if (code === 'medium') return t(locale, 'recruiting.fitMedium');
  if (code === 'low') return t(locale, 'recruiting.fitLow');
  return null;
}

export function pipelineStageLabel(locale, code) {
  const map = {
    new: 'recruiting.pipelineNew',
    interview: 'recruiting.pipelineInterview',
    test_completed: 'recruiting.pipelineTestCompleted',
    screening: 'recruiting.pipelineScreening',
    approved: 'recruiting.pipelineApproved',
    hired: 'recruiting.pipelineHired',
    rejected: 'recruiting.pipelineRejected',
    archived: 'recruiting.pipelineArchived',
  };
  return t(locale, map[code] || 'recruiting.pipelineNew');
}

export function toDatetimeLocalValue(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  // datetime-local (horário local do navegador)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
