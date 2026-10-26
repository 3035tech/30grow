import { NextResponse } from 'next/server';
import { queryRead } from '../../../../lib/db';
import { drawMotivatorsQuestions } from '../../../../lib/ae/draw-questions';
import { toPublicQuestions } from '../../../../lib/ae/to-public-questions';
import { apiError, localeFromRequest, ERR } from '../../../../lib/api-error';
import { checkRateLimit, clientIpFromRequest } from '../../../../lib/identity/rate-limit';

/**
 * GET /api/ae/questions?definition=motivators
 *
 * Retorna subconjunto aleatório de perguntas do banco (padrão: 30 de ~68).
 * Peso/dimensões das opções não são expostos ao cliente (evita gaming do scoring).
 * Rate-limited — scraping do banco completo via draws repetidos.
 */
export async function GET(request) {
  try {
    const ip = clientIpFromRequest(request);
    const rl = await checkRateLimit(`ae-questions:${ip}`, 60, 10 * 60 * 1000);
    if (!rl.ok) {
      return apiError(request, ERR.RATE_LIMIT, 429, {}, { headers: { 'Retry-After': String(rl.retryAfterSec) } });
    }

    const { searchParams } = new URL(request.url);
    const definition = (searchParams.get('definition') || 'motivators').trim();

    const result = await drawMotivatorsQuestions(queryRead, definition);
    if (!result.ok) {
      return apiError(request, result.errorCode || ERR.INTERNAL, 404);
    }

    return NextResponse.json({
      definition: result.definition,
      questions: toPublicQuestions(result.questions, localeFromRequest(request)),
      meta: result.meta,
    });
  } catch (err) {
    console.error('GET /api/ae/questions', err);
    return apiError(request, ERR.QUESTIONS_LOAD_FAILED, 500);
  }
}
