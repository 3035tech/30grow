import { NextResponse } from 'next/server';
import { apiError, apiErrorFromResult, ERR, HTTP_STATUS } from './api-error.js';
import { z } from 'zod';
import { COMPANY_MODULE, companyHasModule } from './company/company-modules.js';
import { checkRateLimit } from './identity/rate-limit.js';
import { KUDO_REACTION_EMOJIS, KUDO_QUICK_REACTION_EMOJIS, supportsExpandedKudoReactions } from './kudo-reaction-options.js';
import { listKudoReactors, setKudoReaction } from './company/company-kudo-reactions.js';

const idSchema = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const bodySchema = z.object({ emoji: z.enum(KUDO_REACTION_EMOJIS) }).strict();
const offsetSchema = z.coerce.number().int().min(0).max(1000000);

/** Shared transport contract; cookie and bearer routes own authentication. */
export async function kudoReactionResponse(request, params, session, modules, { mobile = false } = {}) {
  if (!session) return apiError(request, ERR.UNAUTHORIZED, HTTP_STATUS.UNAUTHORIZED);
  if (!companyHasModule(modules, COMPANY_MODULE.COMPANY_FEED)) return apiError(request, ERR.FORBIDDEN, HTTP_STATUS.FORBIDDEN);
  const parsedId = idSchema.safeParse((await params).id);
  if (!parsedId.success) return apiError(request, ERR.INVALID_ID, HTTP_STATUS.BAD_REQUEST);
  const limit = await checkRateLimit(`kudo-reaction:${session.companyId}:${session.candidateId}`, 120, 60000);
  if (!limit.ok) return apiError(request, ERR.RATE_LIMIT, HTTP_STATUS.TOO_MANY_REQUESTS, {}, { headers: { 'Retry-After': String(limit.retryAfterSec) } });
  const expanded = !mobile || supportsExpandedKudoReactions(request);
  const allowedEmojis = expanded ? KUDO_REACTION_EMOJIS : KUDO_QUICK_REACTION_EMOJIS;
  const scope = { companyId: session.companyId, kudoId: parsedId.data, candidateId: session.candidateId };
  let result;
  if (request.method === 'GET') {
    const offset = offsetSchema.safeParse(new URL(request.url).searchParams.get('offset') || 0);
    if (!offset.success) return apiError(request, ERR.INVALID_DATA, HTTP_STATUS.BAD_REQUEST);
    result = await listKudoReactors({ ...scope, offset: offset.data, allowedEmojis });
  } else {
    let emoji = null;
    if (request.method === 'PUT') {
      const body = bodySchema.safeParse(await request.json().catch(() => null));
      if (!body.success || !allowedEmojis.includes(body.data.emoji)) return apiError(request, ERR.INVALID_DATA, HTTP_STATUS.BAD_REQUEST);
      emoji = body.data.emoji;
    }
    result = await setKudoReaction({ ...scope, emoji });
  }
  if (!result.ok) return apiErrorFromResult(request, result);
  if (result.reactions) result = { ...result, reactions: result.reactions.filter(row => allowedEmojis.includes(row.emoji)) };
  return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
}
