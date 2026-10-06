import { queryRead } from '../../../../../lib/db.js';
import { apiError, ERR } from '../../../../../lib/api-error.js';
import {
  getSessionPayload,
  isAdminRole,
  CAP,
  requireAnyCapability,
} from '../../../../../lib/ae/require-admin.js';
import { getHrScore, recalculateCandidateHrScore } from '../../../../../lib/hr-score.js';
import { EMPLOYMENT_STATUS } from '../../../../../lib/domain-status.js';

/**
 * GET /api/admin/hr-score/[candidateId]
 *
 * Retorna HR Score de um candidato (calcula se não existir).
 * Tenant-scoped: admin vê todos, direction/hr só da própria empresa.
 */
export async function GET(request, props) {
  const params = await props.params;
  try {
    const payload = await getSessionPayload();
    if (!requireAnyCapability(payload, [CAP.OVERVIEW_VIEW, CAP.TEAM_VIEW])) {
      return apiError(request, ERR.UNAUTHORIZED, 401);
    }

    const candidateId = parseInt(params.candidateId, 10);
    if (!Number.isFinite(candidateId) || candidateId <= 0) {
      return apiError(request, ERR.INVALID_PARAMS, 400);
    }

    // Verificar tenant e existência do candidato
    const candidateRes = await queryRead(
      `SELECT id, company_id AS "companyId", full_name AS "fullName",
              employment_status = $2 AS employee
       FROM candidates
       WHERE id = $1
       LIMIT 1`,
      [candidateId, EMPLOYMENT_STATUS.EMPLOYEE]
    );

    if (candidateRes.rowCount === 0) {
      return apiError(request, ERR.NOT_FOUND, 404);
    }

    const candidate = candidateRes.rows[0];
    const isAdmin = isAdminRole(payload);

    // Tenant check
    if (!isAdmin && String(candidate.companyId) !== String(payload.companyId)) {
      return apiError(request, ERR.UNAUTHORIZED, 401);
    }

    // Buscar score existente
    let score = await getHrScore(candidateId);

    // Se não existe ou está desatualizado (> 7 dias), recalcular
    const needsRecalc = !score ||
      (Date.now() - new Date(score.calculatedAt).getTime()) > 7 * 24 * 60 * 60 * 1000;

    if (needsRecalc) {
      await recalculateCandidateHrScore({
        candidateId,
        companyId: candidate.companyId,
        candidateName: candidate.fullName,
      });
      score = await getHrScore(candidateId);
    }

    return Response.json({
      candidateId: candidate.id,
      candidateName: candidate.fullName,
      employee: candidate.employee,
      score: score.score,
      signals: score.signals,
      turnoverRisk: score.turnoverRisk,
      turnoverReasons: score.turnoverReasons,
      pdiGapAreas: score.pdiGapAreas,
      calculatedAt: score.calculatedAt,
    });
  } catch (err) {
    console.error('[hr-score] GET error:', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
