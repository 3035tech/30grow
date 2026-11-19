import { NextResponse } from 'next/server';
import { apiError, ERR } from '../../../../lib/api-error.js';
import { verifyRepClockAdjustmentRequest } from '../../../../lib/identity/cron-auth.js';
import { pool } from '../../../../lib/db.js';
import { validDocument } from '../../../../lib/rep/formats.js';
import { z } from '../../../../lib/validate.js';

const input = z
  .object({
    eventId: z.string().uuid(),
    beforeAt: z.string().datetime({ offset: true }),
    adjustedAt: z.string().datetime({ offset: true }),
    responsibleCpf: z.string().regex(/^\d{11}$/).refine(validDocument),
    source: z.string().regex(/^[A-Za-z0-9._:-]{1,100}$/),
  })
  .strict();

export async function POST(request) {
  if (!verifyRepClockAdjustmentRequest(request))
    return apiError(request, ERR.UNAUTHORIZED, 401);

  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError(request, ERR.INVALID_DATA, 400);
  const event = parsed.data;
  if (Date.parse(event.beforeAt) === Date.parse(event.adjustedAt))
    return apiError(request, ERR.INVALID_DATA, 400);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const inserted = await client.query(
      `INSERT INTO rep_clock_adjustment_events(
         event_id,before_at,adjusted_at,responsible_cpf,source
       ) VALUES($1,$2,$3,$4,$5)
       ON CONFLICT(event_id) DO NOTHING
       RETURNING event_id`,
      [
        event.eventId,
        event.beforeAt,
        event.adjustedAt,
        event.responsibleCpf,
        event.source,
      ],
    );

    if (!inserted.rowCount) {
      const prior = await client.query(
        `SELECT before_at AS "beforeAt",adjusted_at AS "adjustedAt",
                responsible_cpf AS "responsibleCpf",source
         FROM rep_clock_adjustment_events WHERE event_id=$1`,
        [event.eventId],
      );
      const saved = prior.rows[0];
      const same =
        saved &&
        Date.parse(saved.beforeAt) === Date.parse(event.beforeAt) &&
        Date.parse(saved.adjustedAt) === Date.parse(event.adjustedAt) &&
        saved.responsibleCpf === event.responsibleCpf &&
        saved.source === event.source;
      if (!same) {
        await client.query('ROLLBACK');
        return apiError(request, ERR.INVALID_DATA, 409);
      }
      const count = await client.query(
        'SELECT count(*)::int AS n FROM rep_original_records WHERE source_event_id=$1',
        [event.eventId],
      );
      await client.query('COMMIT');
      return NextResponse.json(
        { ok: true, duplicate: true, establishments: count.rows[0].n },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }

    const count = await client.query(
      'SELECT count(*)::int AS n FROM rep_original_records WHERE source_event_id=$1',
      [event.eventId],
    );
    await client.query('COMMIT');
    return NextResponse.json(
      { ok: true, duplicate: false, establishments: count.rows[0].n },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    await client.query('ROLLBACK');
    if (error?.message === 'REP_CLOCK_NO_ESTABLISHMENTS')
      return apiError(request, ERR.INVALID_DATA, 409);
    throw error;
  } finally {
    client.release();
  }
}
