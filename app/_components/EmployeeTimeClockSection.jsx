'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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
import { Icon } from './Icon';
import { PunchLocationMap, osmLink } from './PunchLocationMap';

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

const FRESH_FIX_MS = 60 * 1000;
const GEO_TONE = { idle: 'neutral', locating: 'info', ok: 'success', error: 'warning' };

/**
 * Collaborator web time clock: location status (get / refresh before punching), last
 * punch location and the punch button. Every punch carries a fresh device location.
 */
export function EmployeeTimeClockSection({ locale = 'pt-BR', onBadge = null, onPunched = null }) {
  const { toast } = useAppFeedback();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [geo, setGeo] = useState({ state: 'idle', fix: null, error: '' });
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
      setData(json);
      if (typeof onBadgeRef.current === 'function') {
        onBadgeRef.current(json.open ? 1 : 0);
      }
    } catch (e) {
      toast(e?.message || t(locale, 'employeeHome.timeClock.loadError'), 'error');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [locale, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const locate = useCallback(() => {
    setGeo((g) => ({ ...g, state: 'locating', error: '' }));
    return new Promise((resolve, reject) => {
      const fail = (key) => {
        const error = t(locale, key);
        setGeo((g) => ({ ...g, state: 'error', error }));
        reject(Object.assign(new Error(error), { geo: true }));
      };
      if (typeof navigator === 'undefined' || !navigator.geolocation) {
        fail('employeeHome.timeClock.geoUnsupported');
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const fix = {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: Math.round(Number(pos.coords.accuracy) || 0),
            at: Date.now(),
          };
          setGeo({ state: 'ok', fix, error: '' });
          resolve(fix);
        },
        (err) => fail(err?.code === (err?.PERMISSION_DENIED ?? 1) ? 'employeeHome.timeClock.geoDenied' : 'employeeHome.timeClock.geoUnavailable'),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
      );
    });
  }, [locale]);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.permissions?.query) return undefined;
    let alive = true;
    navigator.permissions
      .query({ name: 'geolocation' })
      .then((status) => {
        if (alive && status.state === 'granted') locate().catch(() => {});
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [locate]);

  const punch = async () => {
    if (!data?.nextKind) return;
    const kind = data.nextKind;
    setBusy(true);
    try {
      const fix = geo.fix && Date.now() - geo.fix.at < FRESH_FIX_MS ? geo.fix : await locate();
      const res = await fetch('/api/employee/time-clock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          punchKind: kind,
          latitude: fix.latitude,
          longitude: fix.longitude,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || 'punch');
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

  if (loading && !data) return <AppLoading variant="panel" />;
  if (!data) {
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
  const geoText = {
    idle: t(locale, 'employeeHome.timeClock.locIdle'),
    locating: t(locale, 'employeeHome.timeClock.geoLocating'),
    ok: geo.fix
      ? t(locale, geo.fix.accuracy ? 'employeeHome.timeClock.locOk' : 'employeeHome.timeClock.locOkNoAccuracy', {
          time: formatTime(new Date(geo.fix.at), locale),
          accuracy: geo.fix.accuracy,
        })
      : '',
    error: geo.error,
  }[geo.state];

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

        <section aria-labelledby="emp-tc-geo" className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-2">
            <span className={cn('mt-0.5 inline-flex', geo.state === 'ok' ? 'text-success' : geo.state === 'error' ? 'text-warning' : 'text-ink-faint')}>
              <Icon name="mapPin" className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span id="emp-tc-geo" className={S.label}>{t(locale, 'employeeHome.timeClock.locTitle')}</span>
                <StatusToneChip tone={GEO_TONE[geo.state]}>{t(locale, `employeeHome.timeClock.locStatus.${geo.state}`)}</StatusToneChip>
              </div>
              <p className={cn('m-0 mt-1 text-prose', geo.state === 'error' ? 'text-ink' : 'text-ink-muted')} role={geo.state === 'error' ? 'alert' : undefined} aria-live="polite">
                {geoText}
                {geo.state === 'ok' && geo.fix ? (
                  <>
                    {' · '}
                    <a
                      href={osmLink(geo.fix.latitude, geo.fix.longitude)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-brand-600 underline-offset-2 hover:underline dark:text-brand-300"
                    >
                      {t(locale, 'employeeHome.timeClock.locOpenMap')}
                    </a>
                  </>
                ) : null}
              </p>
            </div>
          </div>
          <button
            type="button"
            className={cn(S.btnGhost, 'min-h-touch shrink-0 text-sm')}
            disabled={busy || locating}
            onClick={() => void locate().catch(() => {})}
          >
            {t(locale, geo.state === 'idle' ? 'employeeHome.timeClock.locGet' : geo.state === 'error' ? 'employeeHome.timeClock.locRetry' : 'employeeHome.timeClock.locRefresh')}
          </button>
        </section>

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
        <p className="m-0 text-xs text-ink-muted">{t(locale, 'employeeHome.timeClock.geoNotice')}</p>

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
