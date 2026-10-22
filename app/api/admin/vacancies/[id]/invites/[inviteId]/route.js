import { NextResponse } from 'next/server';
import { verifySessionWithCapabilities } from '../../../../../../../lib/user-capabilities';
import { cookies } from 'next/headers';
import { COOKIE_NAME } from '../../../../../../../lib/auth';
import { query, queryRead, withTransaction } from '../../../../../../../lib/db';
import { audit } from '../../../../../../../lib/audit';
import { apiError, ERR } from '../../../../../../../lib/api-error';
import { CAP, isSuperAdminPayload, requireCapability } from '../../../../../../../lib/permissions';


export async function DELETE(request, props) {
  const params = await props.params;
  try {
    const cookieStore = await cookies();
    const session = cookieStore.get(COOKIE_NAME)?.value;
    const payload = await verifySessionWithCapabilities(session);
    if (!requireCapability(payload, CAP.VACANCIES_MANAGE)) return apiError(request, ERR.UNAUTHORIZED, 401);

    const isAdmin = isSuperAdminPayload(payload);
    const companyId = payload?.companyId ?? null;
    if (!isAdmin && !companyId) return apiError(request, ERR.UNAUTHORIZED, 401);

    const vacancyId = params?.id;
    const inviteId = params?.inviteId;
    if (!vacancyId || !inviteId) return apiError(request, ERR.INVALID_PARAMS, 400);

    const own = await queryRead(
      `SELECT v.id FROM vacancies v WHERE v.id = $1 AND v.deleted = FALSE ${!isAdmin ? 'AND v.company_id = $2' : ''} LIMIT 1`,
      !isAdmin ? [vacancyId, companyId] : [vacancyId]
    );
    if (own.rowCount === 0) return apiError(request, ERR.NOT_FOUND, 404);

    const inv = await queryRead(
      `SELECT ci.id, ci.status, ci.candidate_name AS "candidateName"
       FROM candidate_invites ci
       WHERE ci.id = $1 AND ci.vacancy_id = $2
       LIMIT 1`,
      [inviteId, vacancyId]
    );
    if (inv.rowCount === 0) return apiError(request, ERR.INVITE_NOT_FOUND, 404);

    const status = String(inv.rows[0].status || '');

    if (status === 'completed') {
      const assessments = await queryRead(
        `SELECT ass.id, ass.candidate_id AS "candidateId"
         FROM assessments ass
         WHERE ass.invite_id = $1 ${!isAdmin ? 'AND ass.company_id = $2' : ''}`,
        !isAdmin ? [inviteId, companyId] : [inviteId]
      );
      const assessmentIds = (assessments.rows || []).map((r) => r.id);
      const candidateIds = [...new Set((assessments.rows || []).map((r) => r.candidateId).filter(Boolean))];

      const orphanNames = await withTransaction(async (client) => {
        if (assessmentIds.length) {
          await client.query(`DELETE FROM assessments WHERE id = ANY($1::bigint[])`, [assessmentIds]);
        }
        await client.query(`DELETE FROM candidate_invites WHERE id = $1 AND vacancy_id = $2`, [inviteId, vacancyId]);
        if (!candidateIds.length) return [];
        // Same client: the replica could still see the assessments deleted above.
        const orphans = await client.query(
          `DELETE FROM candidates c
           WHERE c.id = ANY($1::bigint[])
             AND NOT EXISTS (SELECT 1 FROM assessments a WHERE a.candidate_id = c.id)
           RETURNING c.full_name AS "fullName"`,
          [candidateIds]
        );
        return orphans.rows.map((r) => r.fullName).filter(Boolean);
      });

      // `results` is a global legacy table keyed by name (no tenant): only touch it when this app writes it.
      if (process.env.LEGACY_RESULTS_WRITE === 'true' && orphanNames.length) {
        await query(`DELETE FROM results WHERE LOWER(name) = ANY($1::text[])`, [
          orphanNames.map((n) => String(n).toLowerCase()),
        ]).catch(() => {});
      }
    } else {
      await query(`DELETE FROM candidate_invites WHERE id = $1 AND vacancy_id = $2`, [inviteId, vacancyId]);
    }

    await audit({
      actorUserId: payload.userId || null,
      action: 'candidate_invite.delete',
      targetType: 'candidate_invite',
      targetId: String(inviteId),
      metadata: { vacancyId: String(vacancyId), priorStatus: status },
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(e);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
