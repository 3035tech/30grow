import { NextResponse } from 'next/server';
import { verifyCronRequest } from '../../../../lib/identity/cron-auth.js';
import { apiError, ERR } from '../../../../lib/api-error.js';
import { processTimePush } from '../../../../lib/people/time-clock-delivery.js';
import { query } from '../../../../lib/db.js';
import { z } from '../../../../lib/validate.js';
const schema = z
  .object({
    clock: z
      .object({
        offsetMs: z.number().int().min(-86400000).max(86400000),
        observedAt: z.string().datetime(),
        source:z.string().regex(/^[a-zA-Z0-9.-]{1,253}$/).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export async function POST(request) {
  if (!verifyCronRequest(request))
    return apiError(request, ERR.UNAUTHORIZED, 401);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError(request, ERR.INVALID_DATA, 400);
  const clock = parsed.data.clock;
  if (clock) {
    if (Math.abs(Date.now() - Date.parse(clock.observedAt)) > 300000)
      return apiError(request, ERR.INVALID_DATE, 400);
    await query(
      "INSERT INTO time_clock_health_observations(kind,offset_ms,observed_at,source) VALUES('clock',$1,$2,$3)",
      [clock.offsetMs, clock.observedAt,clock.source || null],
    );
  }
  return NextResponse.json(
    { ok: true, deliveries: await processTimePush(null) },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
