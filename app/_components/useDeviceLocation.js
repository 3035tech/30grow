'use client';

import { useCallback, useEffect, useState } from 'react';
import { t } from '../../lib/i18n';

export const FRESH_FIX_MS = 60 * 1000;

/**
 * Browser geolocation for punch / check-in: `geo` = { state: idle|locating|ok|error, fix, error }.
 * `locate()` resolves a fix or rejects with `{ geo: true }` (message already in `geo.error`).
 * `freshFix()` reuses a fix younger than FRESH_FIX_MS. Auto-locates when permission is granted.
 */
export function useDeviceLocation(locale = 'pt-BR') {
  const [geo, setGeo] = useState({ state: 'idle', fix: null, error: '' });

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

  const freshFix = useCallback(
    () => (geo.fix && Date.now() - geo.fix.at < FRESH_FIX_MS ? Promise.resolve(geo.fix) : locate()),
    [geo.fix, locate]
  );

  return { geo, locate, freshFix };
}
