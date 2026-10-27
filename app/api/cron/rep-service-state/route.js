import { NextResponse } from 'next/server';
import { verifyCronRequest } from '../../../../lib/identity/cron-auth.js';
import { apiError, ERR } from '../../../../lib/api-error.js';
import { pool } from '../../../../lib/db.js';
import { z } from '../../../../lib/validate.js';
const input = z.object({ available: z.boolean() }).strict();
export async function POST(request) {
  if (!verifyCronRequest(request))
    return apiError(request, ERR.UNAUTHORIZED, 401);
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError(request, ERR.INVALID_DATA, 400);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const establishments = await client.query(
      'SELECT id FROM rep_establishments ORDER BY id FOR UPDATE',
    );
    let changed = 0;
    for (const e of establishments.rows) {
      const prior = await client.query(
        'SELECT available FROM rep_service_observations WHERE establishment_id=$1 ORDER BY id DESC LIMIT 1',
        [e.id],
      );
      if (prior.rows[0]?.available === parsed.data.available) continue;
      await client.query(
        'INSERT INTO rep_service_observations(establishment_id,available) VALUES($1,$2)',
        [e.id, parsed.data.available],
      );
      changed++;
    }
    await client.query('COMMIT');
    return NextResponse.json({ ok: true, changed });
  } catch {
    await client.query('ROLLBACK');
    return apiError(request, ERR.INTERNAL, 500);
  } finally {
    client.release();
  }
}
