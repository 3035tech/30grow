'use client';

import { t, localeHtmlLang } from '../../lib/i18n';
import { cn } from '../../lib/cn';
import {
  TIME_PUNCH_KIND,
  TIME_REQUEST_KIND,
  TIME_REQUEST_PUNCH_ACTION,
  TIME_REQUEST_STATUS,
} from '../../lib/domain-status.js';
import { formatMinutesClock, hmSpanMinutes } from '../../lib/time-clock-format.js';
import { S } from '../dashboard/dashboard-shared';
import { PrivateAttachment } from './PrivateAttachment';
import { StatusToneChip } from './StatusToneChip';

export const KR = 'panel.timeRequests';

export const TIME_REQUEST_TONE = Object.freeze({
  [TIME_REQUEST_STATUS.PENDING]: 'warning',
  [TIME_REQUEST_STATUS.APPROVED]: 'success',
  [TIME_REQUEST_STATUS.REJECTED]: 'danger',
  [TIME_REQUEST_STATUS.CANCELLED]: 'neutral',
});

export function punchKindLabel(locale, kind) {
  return t(locale, kind === TIME_PUNCH_KIND.IN ? 'panel.timeClock.kindIn' : 'panel.timeClock.kindOut');
}

export function timeRequestKindLabel(locale, kind) {
  return t(locale, `${KR}.kind.${kind}`);
}

export function excuseReasonLabel(locale, reason) {
  return t(locale, `panel.timeClockMgr.reason.${reason}`);
}

/** "Atestado médico · 09:00–12:00 (03:00)" or "Atestado médico · Dia inteiro". */
export function excuseSummary(locale, req) {
  const reason = excuseReasonLabel(locale, req.excuseReason || req.reason);
  const start = req.excuseStart ?? req.excusedStart;
  const end = req.excuseEnd ?? req.excusedEnd;
  if (!start || !end) return `${reason} · ${t(locale, `${KR}.wholeDay`)}`;
  return `${reason} · ${start}–${end} (${formatMinutesClock(hmSpanMinutes(start, end))})`;
}

export function TimeRequestStatusChip({ status, locale }) {
  return (
    <StatusToneChip tone={TIME_REQUEST_TONE[status] || 'neutral'}>
      {t(locale, `${KR}.status.${status}`)}
    </StatusToneChip>
  );
}

export function TimeRequestChanges({ changes = [], locale }) {
  if (!changes.length) return null;
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0">
      {changes.map((c, i) => {
        const removing = c.action === TIME_REQUEST_PUNCH_ACTION.VOID;
        return (
          <li key={`${c.action}-${c.punchId || c.time}-${i}`} className="flex flex-wrap items-center gap-2 text-prose">
            <StatusToneChip tone={removing ? 'neutral' : 'info'} bordered={false}>
              {t(locale, removing ? `${KR}.changeVoid` : `${KR}.changeAdd`)}
            </StatusToneChip>
            <span className={cn('font-mono tabular-nums', removing ? 'text-ink-faint line-through' : 'text-ink')}>
              {c.time}
            </span>
            <span className={S.faint}>{punchKindLabel(locale, c.kind)}</span>
          </li>
        );
      })}
    </ul>
  );
}

function dateTimeOf(value, locale) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(localeHtmlLang(locale), { dateStyle: 'short', timeStyle: 'short' });
}

/**
 * One request as a card: kind, status, proposed changes or excuse period, justification,
 * decision and proof. `actions` renders below (cancel / attach for the collaborator).
 */
export function TimeRequestCard({ request, locale, fileHref = null, actions = null, showDecider = true }) {
  const decided = request.status === TIME_REQUEST_STATUS.APPROVED || request.status === TIME_REQUEST_STATUS.REJECTED;
  return (
    <article className="flex flex-col gap-2 rounded-control border border-ink/10 bg-surface p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-ui text-sm font-semibold text-ink">{timeRequestKindLabel(locale, request.kind)}</span>
        <TimeRequestStatusChip status={request.status} locale={locale} />
        <span className={cn(S.faint, 'ml-auto')}>
          {t(locale, `${KR}.sentAt`, { at: dateTimeOf(request.createdAt, locale) })}
        </span>
      </div>
      {request.kind === TIME_REQUEST_KIND.ADJUSTMENT ? (
        <TimeRequestChanges changes={request.changes} locale={locale} />
      ) : (
        <p className="m-0 font-ui text-sm text-ink">{excuseSummary(locale, request)}</p>
      )}
      <p className={cn(S.muted, 'm-0 whitespace-pre-line text-prose')}>{request.justification}</p>
      {request.hasFile && fileHref ? (
        <PrivateAttachment href={fileHref} fileName={request.fileName} locale={locale} />
      ) : null}
      {decided ? (
        <p className={cn(S.faint, 'm-0')}>
          {showDecider && request.decidedByName
            ? t(locale, `${KR}.decidedBy`, { name: request.decidedByName, at: dateTimeOf(request.decidedAt, locale) })
            : t(locale, `${KR}.decidedAt`, { at: dateTimeOf(request.decidedAt, locale) })}
        </p>
      ) : null}
      {decided && request.decisionNote ? (
        <p className="m-0 rounded-control bg-ink/[0.03] px-3 py-2 text-prose text-ink">
          <span className={cn(S.label, 'mb-1 block')}>{t(locale, `${KR}.decisionNote`)}</span>
          {request.decisionNote}
        </p>
      ) : null}
      {actions ? <div className="flex flex-wrap items-center gap-2 pt-1">{actions}</div> : null}
    </article>
  );
}
