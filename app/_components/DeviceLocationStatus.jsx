'use client';

import { t, localeHtmlLang } from '../../lib/i18n';
import { cn } from '../../lib/cn';
import { S } from '../dashboard/dashboard-shared';
import { Icon } from './Icon';
import { StatusToneChip } from './StatusToneChip';
import { osmLink } from './PunchLocationMap';

const GEO_TONE = { idle: 'neutral', locating: 'info', ok: 'success', error: 'warning' };

function fixTime(at, locale) {
  try {
    return new Date(at).toLocaleTimeString(localeHtmlLang(locale), { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

/**
 * Location readiness row (state chip, last fix time/accuracy, map link, get/refresh button)
 * for flows that require a fresh device position: time clock punch and field check-in.
 * `geo` / `locate` come from `useDeviceLocation`.
 */
export function DeviceLocationStatus({ locale = 'pt-BR', geo, locate, disabled = false, id = 'device-geo', className }) {
  const text = {
    idle: t(locale, 'employeeHome.timeClock.locIdle'),
    locating: t(locale, 'employeeHome.timeClock.geoLocating'),
    ok: geo.fix
      ? t(locale, geo.fix.accuracy ? 'employeeHome.timeClock.locOk' : 'employeeHome.timeClock.locOkNoAccuracy', {
          time: fixTime(geo.fix.at, locale),
          accuracy: geo.fix.accuracy,
        })
      : '',
    error: geo.error,
  }[geo.state];

  return (
    <section aria-labelledby={id} className={cn('flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between', className)}>
      <div className="flex min-w-0 items-start gap-2">
        <span className={cn('mt-0.5 inline-flex', geo.state === 'ok' ? 'text-success' : geo.state === 'error' ? 'text-warning' : 'text-ink-faint')}>
          <Icon name="mapPin" className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span id={id} className={S.label}>{t(locale, 'employeeHome.timeClock.locTitle')}</span>
            <StatusToneChip tone={GEO_TONE[geo.state]}>{t(locale, `employeeHome.timeClock.locStatus.${geo.state}`)}</StatusToneChip>
          </div>
          <p className={cn('m-0 mt-1 text-prose', geo.state === 'error' ? 'text-ink' : 'text-ink-muted')} role={geo.state === 'error' ? 'alert' : undefined} aria-live="polite">
            {text}
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
        disabled={disabled || geo.state === 'locating'}
        onClick={() => void locate().catch(() => {})}
      >
        {t(locale, geo.state === 'idle' ? 'employeeHome.timeClock.locGet' : geo.state === 'error' ? 'employeeHome.timeClock.locRetry' : 'employeeHome.timeClock.locRefresh')}
      </button>
    </section>
  );
}
