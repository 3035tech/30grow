import { NextResponse } from 'next/server';
import { withTransaction } from '../../../../lib/db';
import { drawMotivatorsQuestions } from '../../../../lib/ae/draw-questions';
import { upsertCandidate, normalizeEmail } from '../../../../lib/ae/candidate-upsert';
import { titleCasePersonName } from '../../../../lib/person-name';
import { toPublicQuestions } from '../../../../lib/ae/to-public-questions';
import { checkRateLimit, clientIpFromRequest } from '../../../../lib/rate-limit';
import { apiError, ERR } from '../../../../lib/api-error';
import { contentLocale } from '../../../../lib/i18n.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * POST /api/ae/start
 * Inicia sessão: valida convite, sorteia perguntas, cria ae_attempts in_progress.
 */
export async function POST(request) {
  try {
    const ip = clientIpFromRequest(request);
    const rl = await checkRateLimit(`ae-start:${ip}`, 30, 10 * 60 * 1000);
    if (!rl.ok) {
      return apiError(request, ERR.RATE_LIMIT_SHORT, 429);
    }

    const body = await request.json().catch(() => ({}));
    const inviteToken = String(body.inviteToken || '').trim();
    const name = titleCasePersonName(body.name);
    const email = normalizeEmail(body.email);
    const areaKey = String(body.areaKey || '').trim();
    const consent = body.consent === true;
    const locale = contentLocale(body.locale);

    if (!inviteToken || !name || name.length > 200 || consent !== true) {
      return apiError(request, ERR.INVALID_DATA, 400);
    }
    if (!email || !EMAIL_RE.test(email)) {
      return apiError(request, ERR.VALID_EMAIL_REQUIRED, 400);
    }

    return await withTransaction(async (client) => {
    const query = (text, values) => client.query(text, values);
    const inv = await query(
      `SELECT i.id, i.candidate_id AS "candidateId", LOWER(TRIM(person.email)) AS "currentEmail", i.company_id AS "companyId", i.definition_id AS "definitionId",
              i.candidate_name AS "inviteName", LOWER(TRIM(i.candidate_email)) AS "inviteEmail",
              i.status, i.expires_at AS "expiresAt", d.slug AS "definitionSlug", d.version
       FROM ae_invites i
       LEFT JOIN candidates person ON person.id=i.candidate_id AND person.company_id=i.company_id
       JOIN ae_definitions d ON d.id = i.definition_id
       JOIN companies c ON c.id = i.company_id
       WHERE i.token = $1 AND c.deleted = FALSE AND d.active = TRUE
       LIMIT 1 FOR UPDATE OF i`,
      [inviteToken]
    );
    if (inv.rowCount === 0) {
      return apiError(request, ERR.INVITE_INVALID, 403);
    }
    const invite = inv.rows[0];
    if (new Date(invite.expiresAt) < new Date()) {
      return apiError(request, ERR.INVITE_EXPIRED, 403);
    }
    if (invite.status === 'cancelled' || invite.status === 'completed') {
      return apiError(request, ERR.INVITE_NOT_AVAILABLE, 403);
    }
    if (invite.inviteEmail !== email && invite.currentEmail !== email) {
      return apiError(request, ERR.INVITE_EMAIL_MISMATCH, 400);
    }

    let areaId = null;
    if (areaKey) {
      const ar = await query(`SELECT id FROM areas WHERE key = $1 LIMIT 1`, [areaKey]);
      if (ar.rowCount > 0) areaId = ar.rows[0].id;
    }

    const cand = await upsertCandidate({
      companyId: invite.companyId,
      candidateId: invite.candidateId ?? null,
      fullName: name || invite.inviteName,
      email,
    });
    if (!cand.ok) {
      return apiError(request, cand.errorCode || 'INTERNAL', 400);
    }

    const drawn = await drawMotivatorsQuestions(query, invite.definitionSlug);
    if (!drawn.ok) {
      return apiError(request, drawn.errorCode || 'INTERNAL', 500);
    }

    const questionIds = drawn.questions.map((q) => q.id);
    const attempt = await query(
      `INSERT INTO ae_attempts (
         invite_id, definition_id, company_id, candidate_id, area_id,
         status, question_ids, algorithm_version
       ) VALUES ($1, $2, $3, $4, $5, 'in_progress', $6, $7)
       RETURNING id, started_at AS "startedAt"`,
      [
        invite.id,
        invite.definitionId,
        invite.companyId,
        cand.candidateId,
        areaId,
        questionIds,
        String(invite.version || '1'),
      ]
    );
    if (attempt.rowCount === 0) {
      return apiError(request, ERR.INTERNAL, 500);
    }
    const attemptRow = attempt.rows[0];

    await query(
      `UPDATE ae_invites SET candidate_id = $2, status = 'opened', opened_at = COALESCE(opened_at, NOW())
       WHERE id = $1`,
      [invite.id, cand.candidateId]
    );

    return NextResponse.json({
      ok: true,
      attemptId: attemptRow.id,
      startedAt: attemptRow.startedAt,
      definition: drawn.definition,
      questions: toPublicQuestions(drawn.questions, locale),
      meta: drawn.meta,
    });
    });
  } catch (err) {
    console.error('POST /api/ae/start', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
