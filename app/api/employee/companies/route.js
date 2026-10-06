import { consumeSecondFactorChallenge } from '../../../../lib/second-factor-challenge.js';
import { NextResponse } from 'next/server';
import { query } from '../../../../lib/db.js';
import { apiError, ERR, httpStatusForError } from '../../../../lib/api-error.js';
import { checkRateLimit, clientIpFromRequest } from '../../../../lib/rate-limit.js';
import { getEmployeeSessionPayload } from '../../../../lib/employee-session.js';
import {
  findEmployeesByEmail,
  loginEmployeeWithPassword,
} from '../../../../lib/employee-auth.js';
import {
  signEmployee2faChallenge,
  verifyEmployee2faChallenge,
  verifyEmployee2faLogin,
} from '../../../../lib/employee-2fa.js';
import { buildEmployeeLoginResponse } from '../../../../lib/employee-login-session.js';
import { contentLocale } from '../../../../lib/i18n.js';

export const dynamic = 'force-dynamic';

async function sessionCompanyChoices(session) {
  if (!session?.email) return [];
  return findEmployeesByEmail(query, { email: session.email });
}

/** GET /api/employee/companies: vínculos disponíveis para a sessão atual. */
export async function GET(request) {
  try {
    const session = await getEmployeeSessionPayload();
    if (!session) return apiError(request, ERR.UNAUTHORIZED, 401);

    const choices = await sessionCompanyChoices(session);
    return NextResponse.json({
      ok: true,
      items: choices.map((item) => ({
        companyId: Number(item.companyId),
        companyName: item.companyName || '',
        current: Number(item.companyId) === Number(session.companyId),
      })),
    });
  } catch (err) {
    if (err?.code === '42P01' || err?.code === '42703') {
      return apiError(request, ERR.SCHEMA_NOT_INITIALIZED, 503);
    }
    console.error('GET employee companies', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}

/** POST /api/employee/companies: autentica o vínculo de destino e troca o cookie. */
export async function POST(request) {
  try {
    const session = await getEmployeeSessionPayload();
    if (!session) return apiError(request, ERR.UNAUTHORIZED, 401);

    const ip = clientIpFromRequest(request);
    const rl = await checkRateLimit(
      `employee-company-switch:${session.candidateId}:${ip}`,
      10,
      15 * 60 * 1000
    );
    if (!rl.ok) {
      return apiError(request, ERR.RATE_LIMIT, httpStatusForError(ERR.RATE_LIMIT), {}, {
        headers: { 'Retry-After': String(rl.retryAfterSec) },
      });
    }

    const body = await request.json().catch(() => ({}));
    const locale = contentLocale(body.locale);
    const choices = await sessionCompanyChoices(session);

    if (body.challengeToken) {
      const challenge = await verifyEmployee2faChallenge(body.challengeToken);
      const allowed = challenge && choices.some(
        (item) =>
          Number(item.candidateId) === Number(challenge.candidateId) &&
          Number(item.companyId) === Number(challenge.companyId)
      );
      if (!allowed) {
        return apiError(
          request,
          ERR.TWO_FA_CHALLENGE_INVALID,
          httpStatusForError(ERR.TWO_FA_CHALLENGE_INVALID)
        );
      }
      const verified = await verifyEmployee2faLogin(
        challenge.candidateId,
        challenge.companyId,
        body.code
      );
      if (verified.code === 'RATE_LIMIT') {
        return apiError(request, ERR.RATE_LIMIT, 429, {}, {
          headers: { 'Cache-Control': 'no-store', 'Retry-After': String(verified.retryAfterSec) },
        });
      }
      if (!verified.ok) {
        const code = verified.code === 'TOTP_INVALID' ? ERR.TOTP_INVALID : ERR.TWO_FA_NOT_ENABLED;
        return apiError(request, code, httpStatusForError(code));
      }
      if (String(verified.person.email || '').trim().toLowerCase() !== String(session.email).trim().toLowerCase()) {
        return apiError(request, ERR.UNAUTHORIZED, 401);
      }
      const challengeVersion = await consumeSecondFactorChallenge(body.challengeToken);
      if (!challengeVersion) return apiError(request, ERR.TWO_FA_CHALLENGE_INVALID, 401);
      return buildEmployeeLoginResponse({
        sv: challengeVersion,
        candidateId: challenge.candidateId,
        companyId: challenge.companyId,
        email: verified.person.email,
        locale,
        fullName: verified.person.fullName,
        request,
        auditAction: 'auth.company_switch',
        auditMetadata: { fromCompanyId: Number(session.companyId) },
      });
    }

    const companyId = Number(body.companyId);
    if (!Number.isFinite(companyId) || !choices.some((item) => Number(item.companyId) === companyId)) {
      return apiError(request, ERR.INVALID_CREDENTIALS, httpStatusForError(ERR.INVALID_CREDENTIALS));
    }

    const result = await loginEmployeeWithPassword(query, {
      email: session.email,
      password: String(body.password || ''),
      companyId,
    });
    if (!result.ok) {
      return apiError(request, ERR.INVALID_CREDENTIALS, httpStatusForError(ERR.INVALID_CREDENTIALS));
    }
    if (result.requires2fa) {
      return NextResponse.json({
        ok: true,
        requires2fa: true,
        challengeToken: await signEmployee2faChallenge({
          candidateId: result.candidateId,
          companyId: result.companyId,
        }),
      });
    }

    return buildEmployeeLoginResponse({
      candidateId: result.candidateId,
      companyId: result.companyId,
      email: result.email,
      locale,
      fullName: result.fullName,
      request,
      auditAction: 'auth.company_switch',
      auditMetadata: { fromCompanyId: Number(session.companyId) },
    });
  } catch (err) {
    if (err?.code === '42P01' || err?.code === '42703') {
      return apiError(request, ERR.SCHEMA_NOT_INITIALIZED, 503);
    }
    console.error('POST employee companies', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
