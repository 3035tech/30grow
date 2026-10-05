'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { t, localeHtmlLang } from '../../lib/i18n';
import { cn } from '../../lib/cn';
import {
  TIME_DAY_JUSTIFICATION,
  TIME_DAY_JUSTIFICATIONS,
  TIME_DAY_OCCURRENCE,
  TIME_PUNCH_FLAG,
  TIME_PUNCH_KIND,
  TIME_PUNCH_REVIEW,
  TIME_PUNCH_SOURCE,
  TIME_REQUEST_STATUS,
  TIME_SCHEDULE_SOURCE,
} from '../../lib/domain-status.js';
import { formatMinutesClock, localIsoToday, timeClockPeriodFor as periodFor } from '../../lib/time-clock-format.js';
import { TIME_CLOCK_REASON } from '../../lib/people/time-clock-eligibility.js';
import {
  S,
  AdminActionsCell,
  AdminActionsTh,
  AdminIconButton,
  AdminTableShell,
  AdminTh,
} from '../dashboard/dashboard-shared';
import { AdminRichFormDrawer } from './AdminRichFormDrawer';
import { AppLoading, ContentEnter } from './AppLoading';
import { CollapsibleBlock } from './CollapsibleBlock';
import { useAppFeedback } from './AppFeedback';
import { DateField } from './DateField';
import { EmptyState } from './EmptyState';
import { FormField } from './FormField';
import { Icon } from './Icon';
import { IconActionTip } from './IconActionTip';
import { InlineCallout } from './InlineCallout';
import { PunchLocationMap } from './PunchLocationMap';
import { SegmentedControl } from './SegmentedControl';
import { StatMetricTile } from './StatMetricTile';
import { StatusToneChip } from './StatusToneChip';
import { TimeClockScheduleBlock } from './TimeClockScheduleBlock';
import { TimeRequestCard, TimeRequestStatusChip, excuseSummary } from './TimeRequestParts';

const K = 'panel.timeClockMgr';

const OCCURRENCE_TONE = {
  [TIME_DAY_OCCURRENCE.OK]: 'success',
  [TIME_DAY_OCCURRENCE.TODAY]: 'neutral',
  [TIME_DAY_OCCURRENCE.IN_PROGRESS]: 'info',
  [TIME_DAY_OCCURRENCE.ABSENCE]: 'danger',
  [TIME_DAY_OCCURRENCE.INCOMPLETE]: 'warning',
  [TIME_DAY_OCCURRENCE.REVIEW]: 'warning',
  [TIME_DAY_OCCURRENCE.MISSING]: 'warning',
  [TIME_DAY_OCCURRENCE.JUSTIFIED]: 'info',
  [TIME_DAY_OCCURRENCE.REST]: 'neutral',
  [TIME_DAY_OCCURRENCE.HOLIDAY]: 'info',
};

const HM_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;

function timeOf(value, locale) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(localeHtmlLang(locale), { hour: '2-digit', minute: '2-digit' });
}

function dateTimeOf(value, locale) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(localeHtmlLang(locale), {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function dayLabel(iso, locale) {
  const d = new Date(`${iso}T12:00:00Z`);
  const lang = localeHtmlLang(locale);
  const wd = d.toLocaleDateString(lang, { weekday: 'short', timeZone: 'UTC' });
  const dm = d.toLocaleDateString(lang, { day: '2-digit', month: '2-digit', timeZone: 'UTC' });
  const w = wd.replace(/\.$/, '');
  return `${w.charAt(0).toLocaleUpperCase(lang)}${w.slice(1)} ${dm}`;
}

function activePunches(day) {
  return (day.punches || []).filter((p) => !p.voidedAt);
}

async function postJson(url, body, method = 'POST') {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || String(res.status));
  return data;
}

function PunchTimes({ day, locale }) {
  const active = activePunches(day);
  if (active.length === 0) {
    return <span className={cn(S.faint, 'whitespace-nowrap')}>{t(locale, `${K}.noPunch`)}</span>;
  }
  const pairs = [];
  for (const p of active) {
    const last = pairs[pairs.length - 1];
    if (last && p.punchKind === TIME_PUNCH_KIND.OUT && last.length === 1) last.push(p);
    else pairs.push([p]);
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono tabular-nums text-ink">
      {pairs.map((pair) => (
        <span key={pair[0].id} className="inline-flex items-center gap-1 whitespace-nowrap">
          {pair.map((p, i) => {
            const manual = p.source === TIME_PUNCH_SOURCE.MANAGER;
            return (
              <span key={p.id} className="inline-flex items-center gap-1">
                {i > 0 ? <span className="text-ink-faint" aria-hidden>–</span> : null}
                <span
                  className={cn(manual && 'underline decoration-dotted underline-offset-2')}
                  title={manual ? t(locale, `${K}.manualPunchTip`) : undefined}
                >
                  {timeOf(p.punchedAt, locale)}
                </span>
              </span>
            );
          })}
        </span>
      ))}
    </span>
  );
}

function MinutesCell({ value, tone }) {
  const n = Number(value) || 0;
  return (
    <span
      className={cn(
        'font-mono tabular-nums',
        n === 0 && 'text-ink-faint',
        n !== 0 && tone === 'success' && 'text-green-800 dark:text-success',
        n !== 0 && tone === 'danger' && 'text-red-800 dark:text-danger'
      )}
    >
      {formatMinutesClock(n)}
    </span>
  );
}

function DayDetail({ day, locale, onMarkOk, busy, companyId }) {
  const punches = [...(day.punches || [])].sort(
    (a, b) => new Date(a.punchedAt).getTime() - new Date(b.punchedAt).getTime()
  );
  const events = [];
  for (const p of punches) {
    events.push({
      at: p.createdAt,
      key: `c${p.id}`,
      text: t(locale, p.source === TIME_PUNCH_SOURCE.MANAGER ? `${K}.histManual` : `${K}.histPunch`, {
        time: timeOf(p.punchedAt, locale),
        kind: t(locale, p.punchKind === TIME_PUNCH_KIND.IN ? 'panel.timeClock.kindIn' : 'panel.timeClock.kindOut'),
        name: p.createdByName || '',
      }),
      note: p.source === TIME_PUNCH_SOURCE.MANAGER ? p.notes : '',
    });
    if (p.voidedAt) {
      events.push({
        at: p.voidedAt,
        key: `v${p.id}`,
        text: t(locale, `${K}.histVoided`, { time: timeOf(p.punchedAt, locale), name: p.voidedByName || '' }),
        note: p.voidReason,
      });
    } else if (p.reviewedAt && p.reviewStatus === TIME_PUNCH_REVIEW.OK) {
      events.push({
        at: p.reviewedAt,
        key: `r${p.id}`,
        text: t(locale, `${K}.histReviewed`, { time: timeOf(p.punchedAt, locale), name: p.reviewedByName || '' }),
      });
    }
  }
  if (day.justification) {
    events.push({
      at: day.justification.updatedAt || day.justification.createdAt,
      key: 'j',
      text: t(locale, `${K}.histJustified`, {
        reason: t(locale, `${K}.reason.${day.justification.reason}`),
        name: day.justification.updatedByName || '',
      }),
      note: day.justification.note,
    });
  }
  events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatMetricTile value={formatMinutesClock(day.workedMinutes)} label={t(locale, `${K}.colWorked`)} />
        <StatMetricTile value={formatMinutesClock(day.expectedMinutes)} label={t(locale, `${K}.expected`)} />
        <StatMetricTile value={formatMinutesClock(day.extraMinutes)} label={t(locale, `${K}.colExtra`)} />
        <StatMetricTile value={formatMinutesClock(day.missingMinutes)} label={t(locale, `${K}.colMissing`)} />
      </div>

      {day.holiday ? (
        <InlineCallout tone="info">{t(locale, `${K}.holidayHint`, { name: day.holiday.name })}</InlineCallout>
      ) : null}
      {day.daySchedule && day.isWorkday && !day.holiday ? (
        <p className={cn(S.muted, 'm-0 text-prose')}>
          {t(locale, day.daySchedule.breakStart ? `${K}.dayScheduleBreak` : `${K}.daySchedule`, {
            start: day.daySchedule.workdayStart,
            end: day.daySchedule.workdayEnd,
            breakStart: day.daySchedule.breakStart,
            breakEnd: day.daySchedule.breakEnd,
            break: day.daySchedule.breakMinutes,
          })}
          {' · '}
          {t(locale, `panel.timeClockSchedule.${day.daySchedule.source === TIME_SCHEDULE_SOURCE.EMPLOYEE ? 'sourceEmployee' : 'sourceCompany'}`)}
        </p>
      ) : null}

      {day.locked ? <InlineCallout tone="info">{t(locale, `${K}.lockedHint`)}</InlineCallout> : null}

      {day.justification ? (
        <section>
          <h3 className={cn(S.label, 'mb-2')}>{t(locale, `${K}.justificationTitle`)}</h3>
          <p className="m-0 font-ui text-sm text-ink">{excuseSummary(locale, day.justification)}</p>
          {day.justification.note ? (
            <p className={cn(S.muted, 'm-0 mt-1 text-prose')}>{day.justification.note}</p>
          ) : null}
        </section>
      ) : null}

      <section>
        <h3 className={cn(S.label, 'mb-2')}>{t(locale, `${K}.punchesTitle`)}</h3>
        {punches.length === 0 ? (
          <p className={cn(S.muted, 'm-0 text-prose')}>{t(locale, `${K}.noPunch`)}</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {punches.map((p) => (
              <li
                key={p.id}
                className={cn(
                  'flex flex-wrap items-center gap-2 rounded-control border px-3 py-2',
                  p.voidedAt ? 'border-ink/8 bg-ink/[0.02]' : 'border-ink/10 bg-surface'
                )}
              >
                <span
                  className={cn(
                    'font-mono text-sm tabular-nums',
                    p.voidedAt ? 'text-ink-faint line-through' : 'text-ink'
                  )}
                >
                  {timeOf(p.punchedAt, locale)}
                </span>
                <StatusToneChip tone={p.punchKind === TIME_PUNCH_KIND.IN ? 'success' : 'info'}>
                  {t(locale, p.punchKind === TIME_PUNCH_KIND.IN ? 'panel.timeClock.kindIn' : 'panel.timeClock.kindOut')}
                </StatusToneChip>
                <span className={S.faint}>
                  {t(locale, p.source === TIME_PUNCH_SOURCE.MANAGER ? `${K}.sourceManager` : `${K}.sourceEmployee`)}
                </span>
                {p.voidedAt ? (
                  <StatusToneChip tone="neutral">{t(locale, `${K}.voided`)}</StatusToneChip>
                ) : null}
                {!p.voidedAt && p.flag && p.flag !== TIME_PUNCH_FLAG.MANUAL ? (
                  <StatusToneChip tone="warning">{t(locale, `panel.timeClock.flag.${p.flag}`)}</StatusToneChip>
                ) : null}
                {!p.voidedAt && p.reviewStatus === TIME_PUNCH_REVIEW.OK ? (
                  <StatusToneChip tone="success">{t(locale, 'panel.timeClock.reviewOk')}</StatusToneChip>
                ) : null}
                {!p.voidedAt && p.reviewStatus === TIME_PUNCH_REVIEW.FLAGGED && !day.locked ? (
                  <button
                    type="button"
                    className={cn(S.btnGhost, 'ml-auto min-h-touch text-sm')}
                    disabled={busy}
                    onClick={() => onMarkOk(p)}
                  >
                    {t(locale, 'panel.timeClock.markOk')}
                  </button>
                ) : null}
                {p.source !== TIME_PUNCH_SOURCE.MANAGER ? (
                  <div className="basis-full">
                    {p.latitude != null && p.longitude != null ? (
                      <CollapsibleBlock locale={locale} title={t(locale, `${K}.punchLocation`)} bordered={false} titleClassName="text-prose text-ink-muted">
                        <PunchLocationMap latitude={p.latitude} longitude={p.longitude} locale={locale} />
                      </CollapsibleBlock>
                    ) : (
                      <span className={S.faint}>{t(locale, `${K}.punchNoLocation`)}</span>
                    )}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {(day.requests || []).length ? (
        <section>
          <h3 className={cn(S.label, 'mb-2')}>{t(locale, 'panel.timeRequests.requestsTitle')}</h3>
          <div className="flex flex-col gap-2">
            {day.requests.map((req) => (
              <TimeRequestCard
                key={req.id}
                request={req}
                locale={locale}
                fileHref={`/api/admin/time-clock/requests/${req.id}/file?companyId=${encodeURIComponent(companyId)}`}
              />
            ))}
          </div>
        </section>
      ) : null}

      <section>
        <h3 className={cn(S.label, 'mb-2')}>{t(locale, `${K}.historyTitle`)}</h3>
        {events.length === 0 ? (
          <p className={cn(S.muted, 'm-0 text-prose')}>{t(locale, `${K}.historyEmpty`)}</p>
        ) : (
          <ol className="m-0 flex list-none flex-col gap-3 border-l border-ink/10 p-0 pl-4">
            {events.map((ev) => (
              <li key={ev.key} className="relative">
                <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-ink/25" aria-hidden />
                <p className="m-0 font-ui text-sm text-ink">{ev.text}</p>
                <p className={cn(S.faint, 'm-0')}>{dateTimeOf(ev.at, locale)}</p>
                {ev.note ? <p className={cn(S.muted, 'm-0 mt-0.5 text-prose')}>{ev.note}</p> : null}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

/**
 * Per-person time mirror for a period: daily occurrence, punches, extra / missing hours,
 * hour-bank balance and day actions (adjust, justify, details + history).
 */
export function TimeClockMirror({ locale = 'pt-BR', companyId, candidateId, onBack, onChanged }) {
  const { toast, promptForm } = useAppFeedback();
  const [preset, setPreset] = useState('30');
  const [range, setRange] = useState(() => periodFor('30'));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [detailIso, setDetailIso] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        companyId: String(companyId),
        candidateId: String(candidateId),
        from: range.from,
        to: range.to,
      });
      const res = await fetch(`/api/admin/time-clock/mirror?${params}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || String(res.status));
      setData(json);
    } catch (e) {
      toast(e?.message || t(locale, `${K}.loadError`), 'error');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [companyId, candidateId, range.from, range.to, locale, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const changePreset = (id) => {
    setPreset(id);
    if (id !== 'custom') setRange(periodFor(id));
  };

  const days = useMemo(() => [...(data?.days || [])].reverse(), [data]);
  const lockedDays = useMemo(() => days.filter((d) => d.locked).length, [days]);
  const detailDay = detailIso ? (data?.days || []).find((d) => d.day === detailIso) || null : null;

  const afterChange = async (msgKey) => {
    toast(t(locale, msgKey), 'ok');
    await load();
    onChanged?.();
  };

  const adjust = async (day) => {
    const active = activePunches(day);
    const nextKind = active.length % 2 === 0 ? TIME_PUNCH_KIND.IN : TIME_PUNCH_KIND.OUT;
    const otherKind = nextKind === TIME_PUNCH_KIND.IN ? TIME_PUNCH_KIND.OUT : TIME_PUNCH_KIND.IN;
    const kindOptions = [
      { value: TIME_PUNCH_KIND.IN, label: t(locale, 'panel.timeClock.kindIn') },
      { value: TIME_PUNCH_KIND.OUT, label: t(locale, 'panel.timeClock.kindOut') },
    ];
    const timeField = (key, row) => ({
      key,
      row,
      rowWeight: 2,
      type: 'text',
      label: t(locale, `${K}.addTime`),
      placeholder: 'HH:MM',
      validate: (v) => (!v || HM_RE.test(String(v).trim()) ? null : t(locale, `${K}.timeInvalid`)),
    });
    await promptForm({
      title: t(locale, `${K}.adjustTitle`, { day: dayLabel(day.day, locale) }),
      message: t(locale, `${K}.adjustMessage`),
      confirmLabel: t(locale, `${K}.adjustConfirm`),
      fields: [
        ...(active.length
          ? [{
              key: 'voidIds',
              type: 'checkboxGroup',
              label: t(locale, `${K}.voidLabel`),
              options: active.map((p) => ({
                value: String(p.id),
                label: `${timeOf(p.punchedAt, locale)} · ${t(locale, p.punchKind === TIME_PUNCH_KIND.IN ? 'panel.timeClock.kindIn' : 'panel.timeClock.kindOut')}`,
              })),
            }]
          : []),
        { ...timeField('add1Time', 'a1'), section: t(locale, `${K}.addSection`) },
        { key: 'add1Kind', row: 'a1', type: 'select', label: t(locale, `${K}.addKind`), defaultValue: nextKind, options: kindOptions },
        timeField('add2Time', 'a2'),
        { key: 'add2Kind', row: 'a2', type: 'select', label: t(locale, `${K}.addKind`), defaultValue: otherKind, options: kindOptions },
        {
          key: 'reason',
          type: 'textarea',
          label: t(locale, `${K}.reasonLabel`),
          required: true,
          validate: (v) => (String(v || '').trim().length >= 3 ? null : t(locale, `${K}.reasonShort`)),
        },
      ],
      submit: async (values) => {
        const add = [
          [values.add1Time, values.add1Kind],
          [values.add2Time, values.add2Kind],
        ]
          .filter(([time]) => String(time || '').trim())
          .map(([time, kind]) => ({ time: String(time).trim(), kind }));
        const voidPunchIds = (values.voidIds || []).map(Number);
        if (add.length === 0 && voidPunchIds.length === 0) {
          throw new Error(t(locale, `${K}.adjustNothing`));
        }
        await postJson('/api/admin/time-clock/mirror', {
          companyId,
          action: 'adjust',
          candidateId,
          day: day.day,
          voidPunchIds,
          add,
          reason: String(values.reason || '').trim(),
        });
        await afterChange(`${K}.adjusted`);
      },
    });
  };

  const justify = async (day) => {
    const current = day.justification;
    await promptForm({
      title: t(locale, `${K}.justifyTitle`, { day: dayLabel(day.day, locale) }),
      message: t(locale, `${K}.justifyMessage`),
      confirmLabel: t(locale, `${K}.justifyConfirm`),
      fields: [
        {
          key: 'justification',
          type: 'select',
          label: t(locale, `${K}.justifyReason`),
          required: true,
          defaultValue: current?.reason || TIME_DAY_JUSTIFICATION.MEDICAL_CERTIFICATE,
          options: TIME_DAY_JUSTIFICATIONS.map((r) => ({ value: r, label: t(locale, `${K}.reason.${r}`) })),
          disabledWhen: (v) => Boolean(v.remove),
        },
        {
          key: 'note',
          type: 'textarea',
          label: t(locale, `${K}.justifyNote`),
          defaultValue: current?.note || '',
          disabledWhen: (v) => Boolean(v.remove),
        },
        ...(current
          ? [{ key: 'remove', type: 'boolean', label: t(locale, `${K}.justifyRemove`), defaultValue: false }]
          : []),
      ],
      submit: async (values) => {
        if (values.remove) {
          await postJson('/api/admin/time-clock/mirror', {
            companyId,
            action: 'unjustify',
            candidateId,
            day: day.day,
          });
          await afterChange(`${K}.unjustified`);
          return;
        }
        await postJson('/api/admin/time-clock/mirror', {
          companyId,
          action: 'justify',
          candidateId,
          day: day.day,
          justification: values.justification,
          note: values.note || '',
        });
        await afterChange(`${K}.justified`);
      },
    });
  };

  const markOk = async (punch) => {
    setBusy(true);
    try {
      await postJson(
        '/api/admin/time-clock',
        { companyId, action: 'review', punchId: punch.id, reviewStatus: TIME_PUNCH_REVIEW.OK },
        'PATCH'
      );
      await afterChange('panel.timeClock.reviewed');
    } catch (e) {
      toast(e?.message || t(locale, 'panel.timeClock.saveError'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const person = data?.person;
  const totals = data?.totals;
  const schedule = data?.days?.[data.days.length - 1]?.daySchedule || data?.schedule;
  const occurrences = totals ? totals.absences + totals.incomplete + totals.review : 0;
  const meta = person
    ? [
        person.jobRoleName,
        person.orgUnitPath,
        schedule
          ? t(locale, `${K}.shiftMeta`, {
              start: schedule.workdayStart,
              end: schedule.workdayEnd,
              break: schedule.breakMinutes,
            })
          : null,
      ].filter(Boolean)
    : [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <button type="button" className={cn(S.btnGhost, 'min-h-touch w-fit text-sm')} onClick={onBack}>
          {t(locale, `${K}.backToPeople`)}
        </button>
        {person ? (
          <div className="mt-1">
            <h3 className={cn(S.sectionTitle, 'm-0')}>{person.fullName}</h3>
            {meta.length ? <p className={cn(S.muted, 'm-0 mt-1 text-prose')}>{meta.join(' · ')}</p> : null}
          </div>
        ) : null}
        {person?.timeClockEnabled === false ? (
          <InlineCallout tone="info" className="mt-2">
            {t(locale, person.timeClockReason === TIME_CLOCK_REASON.OVERRIDE ? `${K}.noTimeClockMirrorOverride` : `${K}.noTimeClockMirrorWorkFormat`)}
          </InlineCallout>
        ) : null}
      </div>

      <TimeClockScheduleBlock
        locale={locale}
        companyId={companyId}
        candidateId={candidateId}
        onChanged={() => {
          void load();
          onChanged?.();
        }}
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <FormField label={t(locale, `${K}.periodLabel`)}>
          <SegmentedControl
            aria-label={t(locale, `${K}.periodLabel`)}
            value={preset}
            onChange={changePreset}
            options={[
              { id: '7', label: t(locale, `${K}.period7`) },
              { id: '30', label: t(locale, `${K}.period30`) },
              { id: 'month', label: t(locale, `${K}.periodMonth`) },
              { id: 'prevMonth', label: t(locale, `${K}.periodPrevMonth`) },
              { id: 'custom', label: t(locale, `${K}.periodCustom`) },
            ]}
          />
        </FormField>
        {preset === 'custom' ? (
          <div className={cn(S.fieldRow, 'items-start')}>
            <FormField label={t(locale, `${K}.from`)} className="min-w-[10rem]">
              <DateField
                value={range.from}
                max={range.to}
                onChange={(e) => e.target.value && setRange((r) => ({ ...r, from: e.target.value }))}
                aria-label={t(locale, `${K}.from`)}
              />
            </FormField>
            <FormField label={t(locale, `${K}.to`)} className="min-w-[10rem]">
              <DateField
                value={range.to}
                min={range.from}
                max={localIsoToday()}
                onChange={(e) => e.target.value && setRange((r) => ({ ...r, to: e.target.value }))}
                aria-label={t(locale, `${K}.to`)}
              />
            </FormField>
          </div>
        ) : null}
      </div>

      {loading && !data ? (
        <AppLoading variant="panel" />
      ) : !data ? (
        <EmptyState title={t(locale, `${K}.loadError`)} message={t(locale, `${K}.loadErrorHint`)} />
      ) : (
        <ContentEnter animKey={`mirror|${candidateId}|${data.from}|${data.to}|${loading ? 1 : 0}`}>
          {preset === 'custom' && (data.from !== range.from || data.to !== range.to) ? (
            <InlineCallout tone="info" className="mb-3">
              {t(locale, `${K}.periodClamped`, { from: data.from, to: data.to, max: data.maxDays })}
            </InlineCallout>
          ) : null}
          {totals.pendingRequests > 0 ? (
            <InlineCallout tone="warning" className="mb-3">
              {t(locale, 'panel.timeRequests.mirrorPendingHint', { n: totals.pendingRequests })}
            </InlineCallout>
          ) : null}
          {lockedDays > 0 ? (
            <InlineCallout tone="info" className="mb-3">
              {t(locale, `${K}.lockedDaysHint`, { n: lockedDays })}
            </InlineCallout>
          ) : null}
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
            <StatMetricTile value={formatMinutesClock(totals.workedMinutes)} label={t(locale, `${K}.totalWorked`)} />
            <StatMetricTile value={formatMinutesClock(totals.extraMinutes)} label={t(locale, `${K}.colExtra`)} />
            <StatMetricTile value={formatMinutesClock(totals.missingMinutes)} label={t(locale, `${K}.colMissing`)} />
            <StatMetricTile value={formatMinutesClock(totals.bankBalanceMinutes)} label={t(locale, `${K}.colBank`)} />
            <StatMetricTile
              value={occurrences}
              label={t(locale, `${K}.totalOccurrences`)}
              hint={t(locale, `${K}.totalOccurrencesHint`, {
                absences: totals.absences,
                incomplete: totals.incomplete,
                review: totals.review,
              })}
            />
          </div>

          <AdminTableShell locale={locale} minWidth="880px" ariaLabel={t(locale, `${K}.mirrorAria`)}>
            <thead>
              <tr>
                <AdminTh>{t(locale, `${K}.colOccurrence`)}</AdminTh>
                <AdminTh>{t(locale, `${K}.colDate`)}</AdminTh>
                <AdminTh>{t(locale, `${K}.colPunches`)}</AdminTh>
                <AdminTh align="right">{t(locale, `${K}.colWorked`)}</AdminTh>
                <AdminTh align="right">{t(locale, `${K}.colExtra`)}</AdminTh>
                <AdminTh align="right">{t(locale, `${K}.colMissing`)}</AdminTh>
                <AdminTh align="right">{t(locale, `${K}.colBank`)}</AdminTh>
                <AdminActionsTh>{t(locale, `${K}.colActions`)}</AdminActionsTh>
              </tr>
            </thead>
            <tbody>
              {days.map((day) => {
                const voided = (day.punches || []).length - activePunches(day).length;
                return (
                  <tr key={day.day} className={cn('border-b border-ink/8 last:border-b-0', !day.isWorkday && 'bg-ink/[0.015]')}>
                    <td className="px-4 py-2.5 align-middle">
                      <StatusToneChip tone={OCCURRENCE_TONE[day.occurrence] || 'neutral'}>
                        {t(locale, `${K}.occ.${day.occurrence}`)}
                      </StatusToneChip>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 align-middle">
                      <span className="font-ui text-sm capitalize text-ink">{dayLabel(day.day, locale)}</span>
                      {day.locked ? (
                        <IconActionTip label={t(locale, `${K}.lockedTip`)} className="ml-1.5 align-middle">
                          <span className="inline-flex text-ink-faint">
                            <Icon name="lock" className="h-3.5 w-3.5" />
                            <span className="sr-only">{t(locale, `${K}.lockedChip`)}</span>
                          </span>
                        </IconActionTip>
                      ) : null}
                      {day.holiday ? <p className={cn(S.faint, 'm-0 mt-0.5')}>{day.holiday.name}</p> : null}
                    </td>
                    <td className="px-4 py-2.5 align-middle">
                      <PunchTimes day={day} locale={locale} />
                      {day.justification ? (
                        <p className={cn(S.faint, 'm-0 mt-0.5')}>{excuseSummary(locale, day.justification)}</p>
                      ) : null}
                      {(day.requests || []).some((r) => r.status === TIME_REQUEST_STATUS.PENDING) ? (
                        <span className="mt-1 inline-flex">
                          <TimeRequestStatusChip status={TIME_REQUEST_STATUS.PENDING} locale={locale} />
                        </span>
                      ) : null}
                      {voided > 0 ? (
                        <p className={cn(S.faint, 'm-0 mt-0.5')}>{t(locale, `${K}.voidedCount`, { n: voided })}</p>
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5 text-right align-middle">
                      <MinutesCell value={day.workedMinutes} />
                    </td>
                    <td className="px-4 py-2.5 text-right align-middle">
                      <MinutesCell value={day.extraMinutes} tone="success" />
                    </td>
                    <td className="px-4 py-2.5 text-right align-middle">
                      <MinutesCell value={day.missingMinutes} tone="danger" />
                    </td>
                    <td className="px-4 py-2.5 text-right align-middle">
                      <MinutesCell value={day.bankBalanceMinutes} tone={day.bankBalanceMinutes < 0 ? 'danger' : 'success'} />
                      {day.bankPendingCount > 0 ? (
                        <p className={cn(S.faint, 'm-0 mt-0.5')}>
                          {t(locale, 'panel.hourBank.pendingChip', { n: day.bankPendingCount })}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5 text-right align-middle">
                      <AdminActionsCell>
                        <AdminIconButton
                          icon="pencil"
                          label={day.locked ? t(locale, `${K}.lockedTip`) : t(locale, `${K}.actionAdjust`)}
                          disabled={day.locked || busy}
                          onClick={() => void adjust(day)}
                        />
                        <AdminIconButton
                          icon="clipboard"
                          tint="info"
                          label={day.locked ? t(locale, `${K}.lockedTip`) : t(locale, `${K}.actionJustify`)}
                          disabled={day.locked || busy}
                          onClick={() => void justify(day)}
                        />
                        <AdminIconButton
                          icon="eye"
                          tint="muted"
                          label={t(locale, `${K}.actionDetails`)}
                          onClick={() => setDetailIso(day.day)}
                        />
                      </AdminActionsCell>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </AdminTableShell>
          <p className={cn(S.faint, 'm-0 mt-2')}>{t(locale, `${K}.mirrorFootnote`)}</p>
        </ContentEnter>
      )}

      <AdminRichFormDrawer
        open={Boolean(detailDay)}
        locale={locale}
        title={detailDay ? t(locale, `${K}.detailTitle`, { day: dayLabel(detailDay.day, locale) }) : ''}
        eyebrow={person?.fullName || null}
        onClose={() => setDetailIso(null)}
        maxWidth="640px"
      >
        {detailDay ? <DayDetail day={detailDay} locale={locale} onMarkOk={markOk} busy={busy} companyId={companyId} /> : null}
      </AdminRichFormDrawer>
    </div>
  );
}
