import { probeNtp } from '../lib/rep/ntp-probe.mjs';
/** One-shot worker for an existing cron/scheduler; never logs the credential or payload. */
const base = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL;
const secret = process.env.CRON_SECRET;
if (!base || !secret) throw new Error('APP_URL and CRON_SECRET are required');
const url = new URL('/api/cron/time-clock-maintenance', base);
if (
  url.protocol !== 'https:' &&
  !['localhost', '127.0.0.1'].includes(url.hostname)
)
  throw new Error('HTTPS required');
let clock;
try {
  if (new Date().getUTCMinutes() % 5 === 0)
    clock = await probeNtp(process.env.TIME_CLOCK_NTP_SERVER || 'a.ntp.br');
} catch {
  console.warn(
    'Clock observation unavailable; no successful measurement recorded.',
  );
}
const response = await fetch(url, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${secret}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(clock ? { clock } : {}),
  signal: AbortSignal.timeout(45000),
});
if (!response.ok)
  throw new Error(`Time clock maintenance failed: ${response.status}`);
const result = await response.json();
console.log('Time clock maintenance complete', result.deliveries);
