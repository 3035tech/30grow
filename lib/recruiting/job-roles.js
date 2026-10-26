/**
 * Job Roles — Engenharia de Cargos Leve (B-1003) + faixa de mercado opcional (B-2711).
 *
 * Cargos/papéis da empresa com competências T1–T9 (rubrica).
 * Vagas e colaboradores podem vincular o cargo; faixa min/max é manual (não pesquisa live).
 *
 * Fora do escopo: job architecture enterprise, career paths, marketplace salarial.
 */

import { normalizeRubric } from './job-role-rubric.js';
export { normalizeRubric } from './job-role-rubric.js';

import { query, queryRead, withTransaction } from '../db.js';
import { lockPositionCompany } from '../people/org-positions.js';
import { ERR } from '../api-error-codes.js';
import { asDb } from '../ae/as-db.js';
import { stripSalary } from '../br-masks.js';
import { isRichTextEmpty, sanitizeRichTextHtml } from '../sanitize-html.js';

const DESCRIPTION_MAX = 8000;

function safeJobRoleDescription(raw) {
  const html = sanitizeRichTextHtml(raw || '', DESCRIPTION_MAX) || '';
  return isRichTextEmpty(html) ? null : html;
}

function normalizeMarketSalary(raw) {
  if (raw == null || raw === '') return null;
  return stripSalary(raw);
}

function assertMarketBandOrder(min, max) {
  if (!min || !max) return;
  const a = Number(min);
  const b = Number(max);
  if (Number.isFinite(a) && Number.isFinite(b) && a > b) {
    throw new Error('INVALID_MARKET_BAND');
  }
}

/**
 * Valida rubrica (pesos T1–T9)
 * @returns {boolean}
 */
export function isValidRubric(rubric) {
  if (!rubric || typeof rubric !== 'object') return false;
  
  const validKeys = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9'];
  const keys = Object.keys(rubric);
  
  // Permitir rubrica vazia ou parcial
  if (keys.length === 0) return true;
  
  // Todos os keys devem ser T1–T9
  if (!keys.every(k => validKeys.includes(k))) return false;
  
  // Valores devem ser numéricos >= 0
  return keys.every(k => {
    const val = rubric[k];
    return typeof val === 'number' && val >= 0 && val <= 100;
  });
}

/**
 * Lista cargos da empresa (ativos por padrão). Cap para selects/listagens quentes.
 */
export const JOB_ROLES_LIST_CAP = 500;

export async function listCompanyJobRoles(companyId, { includeInactive = false, limit = JOB_ROLES_LIST_CAP } = {}) {
  const db = asDb(queryRead);
  const cap = Math.min(Math.max(1, Number(limit) || JOB_ROLES_LIST_CAP), JOB_ROLES_LIST_CAP);

  const whereClause = includeInactive
    ? 'company_id = $1'
    : 'company_id = $1 AND active = TRUE';

  const res = await db.query(
    `SELECT 
       id,
       name,
       description,
       rubric,
       market_salary_min AS "marketSalaryMin",
       market_salary_max AS "marketSalaryMax",
       active,
       created_at AS "createdAt",
       updated_at AS "updatedAt"
     FROM job_roles
    WHERE ${whereClause}
     ORDER BY name ASC
     LIMIT $2`,
    [companyId, cap]
  );

  return {
    roles: res.rows.map(role => ({ ...role, rubric: normalizeRubric(role.rubric) })),
    truncated: res.rowCount >= cap,
    scanCap: cap,
  };
}

/**
 * Busca cargo por ID
 */
export async function getJobRole(id) {
  const db = asDb(queryRead);
  
  const res = await db.query(
    `SELECT 
       id,
       company_id AS "companyId",
       name,
       description,
       rubric,
       market_salary_min AS "marketSalaryMin",
       market_salary_max AS "marketSalaryMax",
       active,
       created_at AS "createdAt",
       updated_at AS "updatedAt"
     FROM job_roles
     WHERE id = $1
     LIMIT 1`,
    [id]
  );
  
  if (res.rowCount === 0) return null;
  return { ...res.rows[0], rubric: normalizeRubric(res.rows[0].rubric) };
}

/**
 * Cria novo cargo
 */
export async function createJobRole({
  companyId,
  name,
  description = null,
  rubric = {},
  marketSalaryMin = null,
  marketSalaryMax = null,
}) {
  if (!companyId || !name) {
    throw new Error('COMPANY_ID_AND_NAME_REQUIRED');
  }
  
  const normalizedRubric = normalizeRubric(rubric);
  if (!isValidRubric(normalizedRubric)) {
    throw new Error('INVALID_RUBRIC');
  }

  const min = normalizeMarketSalary(marketSalaryMin);
  const max = normalizeMarketSalary(marketSalaryMax);
  assertMarketBandOrder(min, max);
  
  const res = await query(
    `INSERT INTO job_roles (
       company_id, name, description, rubric,
       market_salary_min, market_salary_max, created_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     RETURNING 
       id,
       company_id AS "companyId",
       name,
       description,
       rubric,
       market_salary_min AS "marketSalaryMin",
       market_salary_max AS "marketSalaryMax",
       active,
       created_at AS "createdAt"`,
    [
      companyId,
      name.trim(),
      safeJobRoleDescription(description),
      JSON.stringify(normalizedRubric),
      min,
      max,
    ]
  );
  
  return { ...res.rows[0], rubric: normalizeRubric(res.rows[0].rubric) };
}

/**
 * Atualiza cargo existente
 */
export async function updateJobRole(id, {
  name,
  description,
  rubric,
  active,
  marketSalaryMin,
  marketSalaryMax,
}) {
  const updates = [];
  const values = [];
  let paramIndex = 1;
  
  if (name !== undefined) {
    updates.push(`name = $${paramIndex++}`);
    values.push(name.trim());
  }
  
  if (description !== undefined) {
    updates.push(`description = $${paramIndex++}`);
    values.push(safeJobRoleDescription(description));
  }
  
  if (rubric !== undefined) {
    const normalizedRubric = normalizeRubric(rubric);
    if (!isValidRubric(normalizedRubric)) {
      throw new Error('INVALID_RUBRIC');
    }
    updates.push(`rubric = $${paramIndex++}`);
    values.push(JSON.stringify(normalizedRubric));
  }

  if (marketSalaryMin !== undefined) {
    updates.push(`market_salary_min = $${paramIndex++}`);
    values.push(normalizeMarketSalary(marketSalaryMin));
  }

  if (marketSalaryMax !== undefined) {
    updates.push(`market_salary_max = $${paramIndex++}`);
    values.push(normalizeMarketSalary(marketSalaryMax));
  }

  if (marketSalaryMin !== undefined || marketSalaryMax !== undefined) {
    const existing = await getJobRole(id);
    const nextMin =
      marketSalaryMin !== undefined
        ? normalizeMarketSalary(marketSalaryMin)
        : existing?.marketSalaryMin || null;
    const nextMax =
      marketSalaryMax !== undefined
        ? normalizeMarketSalary(marketSalaryMax)
        : existing?.marketSalaryMax || null;
    assertMarketBandOrder(nextMin, nextMax);
  }
  
  if (active !== undefined) {
    updates.push(`active = $${paramIndex++}`);
    values.push(Boolean(active));
  }
  
  if (updates.length === 0) {
    throw new Error('NO_UPDATES_PROVIDED');
  }
  
  updates.push(`updated_at = NOW()`);
  values.push(id);
  
  const res = await withTransaction(async db => {
    const scope=await db.query('SELECT company_id AS "companyId" FROM job_roles WHERE id=$1',[id]);
    if(!scope.rowCount)throw new Error('JOB_ROLE_NOT_FOUND');
    await lockPositionCompany(db,scope.rows[0].companyId);
    if(active===false){
      const used=await db.query("SELECT 1 FROM org_positions WHERE company_id=$1 AND job_role_id=$2 AND status<>'closed' LIMIT 1",[scope.rows[0].companyId,id]);
      if(used.rowCount){const error=new Error(ERR.POSITION_IN_USE);error.code=ERR.POSITION_IN_USE;throw error;}
    }
    return db.query(
    `UPDATE job_roles
     SET ${updates.join(', ')}
     WHERE id = $${paramIndex}
     RETURNING 
       id,
       company_id AS "companyId",
       name,
       description,
       rubric,
       market_salary_min AS "marketSalaryMin",
       market_salary_max AS "marketSalaryMax",
       active,
       updated_at AS "updatedAt"`,
    values
  );
  });
  
  if (res.rowCount === 0) {
    throw new Error('JOB_ROLE_NOT_FOUND');
  }
  
  return { ...res.rows[0], rubric: normalizeRubric(res.rows[0].rubric) };
}

/**
 * Desativa cargo (soft delete)
 */
export async function deactivateJobRole(id) {
  return updateJobRole(id, { active: false });
}

/**
 * Resolve rubrica final de uma vaga (herdada do cargo ou específica)
 */
export async function getRubricForVacancy(vacancy) {
  // Se a vaga tem rubrica própria, usa ela
  if (vacancy.rubric && Object.keys(vacancy.rubric).length > 0) {
    return vacancy.rubric;
  }
  
  // Se tem job_role_id, busca rubrica do cargo
  if (vacancy.jobRoleId || vacancy.job_role_id) {
    const jobRoleId = vacancy.jobRoleId || vacancy.job_role_id;
    const jobRole = await getJobRole(jobRoleId);
    
    if (jobRole && jobRole.rubric) {
      return jobRole.rubric;
    }
  }
  
  // Fallback: rubrica vazia
  return {};
}

/**
 * Conta quantas vagas usam este cargo
 */
export async function countVacanciesUsingJobRole(jobRoleId) {
  const db = asDb(queryRead);
  
  const res = await db.query(
    `SELECT COUNT(*) as count
     FROM vacancies
     WHERE job_role_id = $1
       AND deleted = FALSE`,
    [jobRoleId]
  );
  
  return parseInt(res.rows[0].count) || 0;
}
