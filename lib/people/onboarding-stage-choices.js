import { asDb } from '../ae/as-db.js';
import { ONBOARDING_STAGES, normalizeOnboardingStages } from '../onboarding-stage-selection.js';
import { ERR } from '../api-error-codes.js';

export async function saveOnboardingStageChoices(dbOrQuery, { companyId, candidateId, stages, actorId = null }) {
  const selected = normalizeOnboardingStages(stages);
  if (selected === undefined) return;
  if (selected === null) throw Object.assign(new Error('Invalid onboarding stages'), { code: ERR.INVALID_PARAMS });
  const db = asDb(dbOrQuery);
  for (const stage of ONBOARDING_STAGES) {
    await db.query(`INSERT INTO employee_onboarding_stage_choices
      (company_id,candidate_id,stage_key,enabled,decided_by_user_id)
      VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(company_id,candidate_id,stage_key) DO UPDATE SET
      enabled=EXCLUDED.enabled,decided_by_user_id=EXCLUDED.decided_by_user_id,decided_at=now()`,
    [companyId, candidateId, stage, selected.includes(stage), actorId]);
  }
}

export async function getOnboardingStageChoice(dbOrQuery, { companyId, candidateId, stage }) {
  try {
    const result = await asDb(dbOrQuery).query(`SELECT enabled,decided_by_user_id AS "actorId",decided_at AS "decidedAt"
      FROM employee_onboarding_stage_choices WHERE company_id=$1 AND candidate_id=$2 AND stage_key=$3`, [companyId,candidateId,stage]);
    return result.rows[0] || { enabled: true };
  } catch (error) {
    // Old releases/clients retain the existing journey until migration 172.
    // Explicit decisions are written transactionally and never silently dropped.
    if (error.code === '42P01') return { enabled: true };
    throw error;
  }
}
