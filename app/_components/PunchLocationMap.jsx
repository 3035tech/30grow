'use client';

import { t } from '../../lib/i18n';
import { cn } from '../../lib/cn';
import { S } from '../dashboard/dashboard-shared';

const MAP_SPAN_DEG = 0.004;

/** OpenStreetMap embed of one punch location; mount only on demand (coordinates leave to OSM). */
export function PunchLocationMap({ latitude, longitude, locale = 'pt-BR' }) {
  const bbox = [longitude - MAP_SPAN_DEG, latitude - MAP_SPAN_DEG, longitude + MAP_SPAN_DEG, latitude + MAP_SPAN_DEG]
    .map((n) => n.toFixed(6))
    .join(',');
  const marker = `${latitude.toFixed(6)},${longitude.toFixed(6)}`;
  return (
    <div className="flex flex-col gap-1.5">
      <iframe
        title={t(locale, 'panel.timeClockMgr.punchMapTitle')}
        src={`https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${marker}`}
        className="h-48 w-full rounded-control border border-ink/10"
        loading="lazy"
        referrerPolicy="no-referrer"
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={cn(S.faint, 'font-mono tabular-nums')}>{marker}</span>
        <a
          href={osmLink(latitude, longitude)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-touch items-center text-prose text-brand-600 dark:text-brand-300"
        >
          {t(locale, 'panel.timeClockMgr.punchMapOpen')}
        </a>
      </div>
    </div>
  );
}

export function osmLink(latitude, longitude) {
  const lat = latitude.toFixed(6);
  const lon = longitude.toFixed(6);
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=17/${lat}/${lon}`;
}
