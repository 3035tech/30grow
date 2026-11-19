/**
 * Forward one host-confirmed clock adjustment to the REP-P application.
 * Read the event JSON from stdin so secrets and personal data stay out of argv/logs.
 * The host adjustment mechanism must call this only after a real adjustment succeeds.
 */
const base = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL;
const secret = process.env.REP_CLOCK_ADJUSTMENT_SECRET;
if (!base || !secret) {
  throw new Error('APP_URL and REP_CLOCK_ADJUSTMENT_SECRET are required');
}

const url = new URL('/api/cron/rep-clock-adjustment', base);
if (
  url.protocol !== 'https:' &&
  !['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname)
) {
  throw new Error('HTTPS required');
}

const chunks = [];
let size = 0;
for await (const chunk of process.stdin) {
  size += chunk.length;
  if (size > 16 * 1024) throw new Error('Clock adjustment event is too large');
  chunks.push(chunk);
}

let event;
try {
  event = JSON.parse(Buffer.concat(chunks).toString('utf8'));
} catch {
  throw new Error('A single JSON clock adjustment event is required on stdin');
}

const isoWithOffset =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
if (
  !event ||
  typeof event !== 'object' ||
  Array.isArray(event) ||
  Object.keys(event).sort().join(',') !==
    'adjustedAt,beforeAt,eventId,responsibleCpf,source' ||
  !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    event.eventId,
  ) ||
  !isoWithOffset.test(event.beforeAt) ||
  !isoWithOffset.test(event.adjustedAt) ||
  Number.isNaN(Date.parse(event.beforeAt)) ||
  Number.isNaN(Date.parse(event.adjustedAt)) ||
  Date.parse(event.beforeAt) === Date.parse(event.adjustedAt) ||
  !/^\d{11}$/.test(event.responsibleCpf) ||
  !/^[A-Za-z0-9._:-]{1,100}$/.test(event.source)
) {
  throw new Error('Clock adjustment event has an invalid shape');
}

const response = await fetch(url, {
  method: 'POST',
  headers: {
    'X-REP-Clock-Adjustment-Secret': secret,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(event),
  signal: AbortSignal.timeout(30000),
});
if (!response.ok) {
  throw new Error(`Clock adjustment report failed: HTTP ${response.status}`);
}

const result = await response.json();
if (
  result?.ok !== true ||
  typeof result.duplicate !== 'boolean' ||
  !Number.isSafeInteger(result.establishments) ||
  result.establishments < 1
) {
  throw new Error('Clock adjustment endpoint returned an invalid acknowledgement');
}
console.log(
  `Clock adjustment recorded (${result.duplicate ? 'duplicate' : 'new'}); establishments=${result.establishments}`,
);
