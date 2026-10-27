import { NextResponse } from 'next/server';
import { apiError, ERR, httpStatusForError } from '../../../../lib/api-error';
import { lookupCep } from '../../../../lib/br-cep';
import { checkRateLimit } from '../../../../lib/identity/rate-limit.js';

export const dynamic = 'force-dynamic';

/**
 * GET /api/public/br-cep?cep=01310100 — address autocomplete (ViaCEP).
 */
export async function GET(request) {
  const cep = new URL(request.url).searchParams.get('cep') || '';
  const rl = await checkRateLimit(`br-cep:${request.headers.get('x-forwarded-for') || 'local'}`, 60, 60 * 1000);
  if (!rl.ok) return apiError(request, ERR.RATE_LIMIT, httpStatusForError(ERR.RATE_LIMIT));

  const result = await lookupCep(cep);
  if (!result.ok) {
    return apiError(request, result.errorCode, httpStatusForError(result.errorCode));
  }

  return NextResponse.json(
    {
      ok: true,
      cep: result.cep,
      street: result.street,
      neighborhood: result.neighborhood,
      city: result.city,
      state: result.state,
    },
    {
      headers: {
        'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
      },
    }
  );
}
