'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { t, localeHtmlLang } from '../../lib/i18n';
import { TIME_PUNCH_KIND } from '../../lib/domain-status.js';
import { cn } from '../../lib/cn';
import { formatDisplayDate, formatDisplayDateTime } from '../../lib/format-display-date';
import { S } from '../dashboard/dashboard-shared';
import { AppLoading, ContentEnter } from './AppLoading';
import { useAppFeedback } from './AppFeedback';
import { InlineCallout } from './InlineCallout';
import { StatusToneChip } from './StatusToneChip';
import { EmptyState } from './EmptyState';
import { CollapsibleBlock } from './CollapsibleBlock';
import { PunchLocationMap } from './PunchLocationMap';
import { useDeviceLocation } from './useDeviceLocation';
import { RepEmployeeTools } from './RepEmployeeTools';
import { DeviceLocationStatus } from './DeviceLocationStatus';

function formatTime(value, locale, timeZone) {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  try {
    return d.toLocaleTimeString(localeHtmlLang(locale), { hour: '2-digit', minute: '2-digit', timeZone: timeZone || undefined });
  } catch {
    return d.toLocaleTimeString(localeHtmlLang(locale), { hour: '2-digit', minute: '2-digit' });
  }
}

/**
 * Collaborator web time clock: location status (get / refresh before punching), last
 * punch location and the punch button. Location is supplementary and its failure does not prevent recording.
 */
export function EmployeeTimeClockSection({ locale = 'pt-BR', onBadge = null, onPunched = null, compact = false }) {
  const { toast } = useAppFeedback();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const { geo, locate, freshFix } = useDeviceLocation(locale);
  const pendingPunch = useRef(null);
  const onBadgeRef = useRef(onBadge);
  onBadgeRef.current = onBadge;
  const onPunchedRef = useRef(onPunched);
  onPunchedRef.current = onPunched;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/employee/time-clock');
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || 'load');
      pendingPunch.current = null;
      setData(json);
      if (typeof onBadgeRef.current === 'function') {
        onBadgeRef.current(json.open ? 1 : 0);
      }
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const punch = async () => {
    if (!data?.nextKind || busy) return;
    const kind = data.nextKind;
    setBusy(true);
    try {
      const fix = await freshFix().catch(() => null);
      if (!pendingPunch.current || pendingPunch.current.kind !== kind) pendingPunch.current = {kind, key: crypto.randomUUID()};
      const res = await fetch('/api/employee/time-clock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          punchKind: kind,
          latitude: fix?.latitude ?? null,
          longitude: fix?.longitude ?? null,
          idempotencyKey: pendingPunch.current.key,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || 'punch');
      pendingPunch.current = null;
      setData(json);
      if (typeof onBadgeRef.current === 'function') onBadgeRef.current(json.open ? 1 : 0);
      if (typeof onPunchedRef.current === 'function') onPunchedRef.current();
      toast(
        kind === TIME_PUNCH_KIND.IN
          ? t(locale, 'employeeHome.timeClock.punchedIn')
          : t(locale, 'employeeHome.timeClock.punchedOut'),
        'ok'
      );
    } catch (e) {
      if (!e?.geo) toast(e?.message || t(locale, 'employeeHome.timeClock.punchError'), 'error');
    } finally {
      setBusy(false);
    }
  };

  if (loading && !data) {
    return compact
      ? <div className="h-full min-h-64 rounded-card border border-ink/12 bg-surface p-4 sm:p-5 motion-safe:animate-pulse" aria-label={t(locale, 'common.loading')} />
      : <AppLoading variant="panel" />;
  }
  if (!data) {
    if (compact) {
      return (
        <section className="rounded-card border border-ink/12 bg-surface p-4 sm:p-5" aria-labelledby="employee-time-clock-today-title">
          <h2 id="employee-time-clock-today-title" className="m-0 font-ui text-base font-semibold text-ink">
            {t(locale, 'employeeHome.timeClockTitle')}
          </h2>
          <p className="mb-0 mt-3 rounded-control border border-warning/25 bg-warning/[0.045] px-3 py-3 text-prose text-ink-muted" role="status">
            {t(locale, 'employeeHome.timeClock.loadError')}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={cn(S.btnGhost, 'min-h-touch')} onClick={() => void load()}>
              {t(locale, 'common.retry')}
            </button>
            <Link href="/employee/time-clock" className={cn(S.btnBrandSoft, 'no-underline')}>
              {t(locale, 'employeeHome.timeClockOpenPage')}
            </Link>
          </div>
        </section>
      );
    }
    return (
      <div>
        <EmptyState
          title={t(locale, 'employeeHome.timeClock.emptyTitle')}
          message={t(locale, 'employeeHome.timeClock.loadError')}
        />
        <button type="button" className={cn(S.btnGhost, 'min-h-touch')} onClick={() => void load()}>
          {t(locale, 'common.retry')}
        </button>
      </div>
    );
  }

  const kindLabel = (kind) =>
    t(locale, kind === TIME_PUNCH_KIND.IN ? 'employeeHome.timeClock.kindIn' : 'employeeHome.timeClock.kindOut');
  const nextLabel =
    data.nextKind === TIME_PUNCH_KIND.IN
      ? t(locale, 'employeeHome.timeClock.punchIn')
      : t(locale, 'employeeHome.timeClock.punchOut');
  const locating = geo.state === 'locating';
  const last = data.lastLocation;

  if (compact) {
    return (
      <ContentEnter animKey={`emp-clock-compact|${data.day}|${(data.punches || []).length}|${data.open ? 1 : 0}`}>
        <section className="flex h-full flex-col rounded-card border border-ink/12 bg-surface p-4 sm:p-5" aria-labelledby="employee-time-clock-today-title">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 id="employee-time-clock-today-title" className="m-0 font-ui text-base font-semibold text-ink">
                {t(locale, 'employeeHome.timeClockTitle')}
              </h2>
              <p className="mb-0 mt-1 text-prose text-ink-muted">{formatDisplayDate(data.day, locale)}</p>
            </div>
            <StatusToneChip tone={data.open ? 'success' : 'neutral'}>
              {t(locale, data.open ? 'employeeHome.timeClock.openShift' : 'employeeHome.timeClock.closedShift')}
            </StatusToneChip>
          </div>

          <div className="mt-4 rounded-control border border-brand-500/15 bg-brand-500/[0.045] px-3 py-3">
            <div className={cn(S.label, 'm-0 text-ink-muted')}>{t(locale, 'employeeHome.todaySchedule')}</div>
            <div className="mt-1 font-ui text-xl font-semibold tabular-nums text-ink">
              {data.schedule?.workdayStart || '—'} <span className="text-ink-muted">–</span> {data.schedule?.workdayEnd || '—'}
            </div>
          </div>

          {(data.punches || []).length ? (
            <ol aria-label={t(locale, 'employeeHome.timeClock.timelineLabel')} className="m-0 mt-3 flex list-none flex-wrap gap-2 p-0">
              {data.punches.slice(0, 4).map((punch) => (
                <li key={punch.id} className="rounded-control border border-ink/10 bg-canvas px-2.5 py-1.5 text-prose text-ink-muted">
                  <span className="font-medium text-ink">{kindLabel(punch.punchKind)}</span>
                  <time dateTime={punch.punchedAt} className="ml-2 tabular-nums">{formatTime(punch.punchedAt, locale, data.schedule?.timezone)}</time>
                </li>
              ))}
            </ol>
          ) : (
            <p className={cn(S.cardMuted, 'mb-0 mt-3')}>{t(locale, 'employeeHome.timeClock.noPunches')}</p>
          )}

          <div className="mt-auto pt-4">
            <button
              type="button"
              className={cn(S.btnPrimary, 'min-h-[3.25rem] w-full px-5 text-base')}
              onClick={() => void punch()}
              disabled={busy}
              aria-busy={busy}
            >
              {locating && busy
                ? t(locale, 'employeeHome.timeClock.geoLocating')
                : busy
                  ? t(locale, 'employeeHome.timeClock.punching')
                  : nextLabel}
            </button>
            <p className="mb-0 mt-2 text-center text-xs text-ink-muted">{t(locale, 'rep.locationOptional')}</p>
            <Link href="/employee/time-clock" className="mt-2 inline-flex min-h-touch items-center text-prose font-medium text-brand-600 underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 dark:text-brand-300">
              {t(locale, 'employeeHome.timeClockOpenPage')} <span className="ml-1" aria-hidden="true">→</span>
            </Link>
          </div>
        </section>
      </ContentEnter>
    );
  }

  return (
    <ContentEnter animKey={`emp-clock|${data.day}|${(data.punches || []).length}|${data.open ? 1 : 0}`}>
      <InlineCallout tone="info" className="mb-3">
        {t(locale, 'employeeHome.timeClock.hint', {
          start: data.schedule?.workdayStart || '09:00',
          end: data.schedule?.workdayEnd || '18:00',
        })}
      </InlineCallout>

      <div className="mb-4 flex flex-col gap-4 rounded-card border border-ink/10 bg-canvas p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="m-0 font-ui text-base font-semibold text-ink">{t(locale, 'employeeHome.timeClock.punchTitle')}</h3>
          {data.open ? (
            <StatusToneChip tone="success">{t(locale, 'employeeHome.timeClock.openShift')}</StatusToneChip>
          ) : (
            <StatusToneChip tone="neutral">{t(locale, 'employeeHome.timeClock.closedShift')}</StatusToneChip>
          )}
        </div>

        <RepEmployeeTools locale={locale} timezone={data.schedule?.timezone} revision={data.punches?.length} />
        <DeviceLocationStatus locale={locale} geo={geo} locate={locate} disabled={busy} id="emp-tc-geo" />

        <button
          type="button"
          className={cn(S.btnPrimary, 'min-h-[3.25rem] w-full px-5 text-base')}
          onClick={() => void punch()}
          disabled={busy}
          aria-busy={busy}
        >
          {locating && busy
            ? t(locale, 'employeeHome.timeClock.geoLocating')
            : busy
              ? t(locale, 'employeeHome.timeClock.punching')
              : nextLabel}
        </button>
        <p className="m-0 text-xs text-ink-muted">{t(locale, 'rep.locationOptional')}</p>

        <div className="border-t border-ink/8 pt-3">
          <p className={cn(S.label, 'm-0')}>{t(locale, 'employeeHome.timeClock.lastTitle')}</p>
          {last ? (
            <>
              <p className="m-0 mt-1 font-ui text-sm text-ink">
                {t(locale, 'employeeHome.timeClock.lastText', {
                  kind: kindLabel(last.punchKind),
                  when: formatDisplayDateTime(last.punchedAt, locale),
                })}
              </p>
              <CollapsibleBlock
                locale={locale}
                title={t(locale, 'employeeHome.timeClock.lastMap')}
                bordered={false}
                titleClassName="text-prose text-ink-muted"
              >
                <PunchLocationMap latitude={last.latitude} longitude={last.longitude} locale={locale} />
              </CollapsibleBlock>
            </>
          ) : (
            <p className={cn(S.muted, 'm-0 mt-1 text-prose')}>{t(locale, 'employeeHome.timeClock.lastNone')}</p>
          )}
        </div>
      </div>

      <p className="mb-2 mt-0 text-xs text-ink-muted">
        {t(locale, 'employeeHome.timeClock.dayLabel', { day: formatDisplayDate(data.day, locale) })}
      </p>
      {(data.punches || []).length === 0 ? (
        <p className={cn(S.muted, 'mb-0 text-prose')}>{t(locale, 'employeeHome.timeClock.noPunches')}</p>
      ) : (
        <ol aria-label={t(locale, 'employeeHome.timeClock.timelineLabel')} className="m-0 list-none p-0">
          {data.punches.map((p, index) => (
            <li
              key={p.id}
              className="grid grid-cols-[4rem_1rem_minmax(0,1fr)] gap-x-3"
            >
              <time dateTime={p.punchedAt} className="pt-3 text-right font-mono text-sm tabular-nums text-ink">{formatTime(p.punchedAt, locale, data.schedule?.timezone)}</time>
              <div className="relative flex justify-center" aria-hidden="true">
                {index < data.punches.length - 1 ? <span className="absolute -bottom-5 left-1/2 top-5 w-px -translate-x-1/2 bg-ink/15" /> : null}
                <span className={cn('relative mt-4 h-2.5 w-2.5 shrink-0 rounded-full ring-4 ring-canvas', p.punchKind === TIME_PUNCH_KIND.IN ? 'bg-success' : 'bg-info')} />
              </div>
              <div className={cn('min-w-0 pt-2', index < data.punches.length - 1 ? 'pb-6' : 'pb-2')}>
                <div className="flex min-h-8 flex-wrap items-center gap-2">
                  <StatusToneChip tone={p.punchKind === TIME_PUNCH_KIND.IN ? 'success' : 'info'}>
                    {kindLabel(p.punchKind)}
                  </StatusToneChip>
                  {p.flag ? (
                    <StatusToneChip tone="warning">
                      {t(locale, `employeeHome.timeClock.flag.${p.flag}`)}
                    </StatusToneChip>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </ContentEnter>
  );
}
