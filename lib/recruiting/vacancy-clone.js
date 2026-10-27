/**
 * Clone vacancy (B-409): copy fields + rubric; public flags off; no candidates.
 */

import { asDb } from '../ae/as-db.js';
import { slugify } from '../slugify.js';
import { ERR } from '../api-error-codes.js';
import { t as i18nT } from '../i18n.js';

function copyTitle(title, locale = 'pt-BR') {
  const base = String(title || '').trim() || 'Vaga';
  const suffix = i18nT(locale, 'ui.vacancyClone.copy');
  return `${base}${suffix}`.slice(0, 200);
}

function uniqueSlug(baseSlug, vacancyId) {
  const root = slugify(baseSlug) || 'vaga';
  return `${root}-${vacancyId}`.slice(0, 180);
}

/**
 * @returns {Promise<{ ok: true, vacancy: object } | { ok: false, errorCode: string }>}
 */
export async function cloneVacancy(dbOrQuery, {
  sourceVacancyId,
  companyId,
  isAdmin = false,
  locale = 'pt-BR',
}) {
  const db = asDb(dbOrQuery);
  const vid = Number(sourceVacancyId);
  if (!Number.isFinite(vid) || vid <= 0) return { ok: false, errorCode: ERR.INVALID_VACANCY };

  const params = [vid];
  let companyClause = '';
  if (!isAdmin) {
    if (companyId == null) return { ok: false, errorCode: ERR.UNAUTHORIZED };
    companyClause = 'AND v.company_id = $2';
    params.push(companyId);
  }

  const src = await db.query(
    `SELECT v.id, v.company_id AS "companyId", v.title, v.slug, v.positions_count AS "positionsCount",
            v.target_date AS "targetDate", v.description, v.salary_min AS "salaryMin",
            v.salary_max AS "salaryMax", v.client_report_show_salary AS "clientReportShowSalary",
            v.employment_type AS "employmentType",
            v.workplace_modality AS "workplaceModality",
            v.workplace_city AS "workplaceCity",
            v.workplace_state AS "workplaceState",
            c.name AS "companyName"
     FROM vacancies v
     JOIN companies c ON c.id = v.company_id AND c.deleted = FALSE
     WHERE v.id = $1 AND v.deleted = FALSE ${companyClause}
     LIMIT 1`,
    params
  );
  if (!src.rowCount) return { ok: false, errorCode: ERR.NOT_FOUND };
  const s = src.rows[0];

  const title = copyTitle(s.title, locale);
  const tempSlug = `${slugify(title) || 'vaga'}-${Date.now().toString(36)}`.slice(0, 180);

  const ins = await db.query(
    `INSERT INTO vacancies (
       company_id, title, slug, status, positions_count, target_date,
       description, salary_min, salary_max, client_report_show_salary, employment_type,
       workplace_modality, workplace_city, workplace_state,
       public_page_enabled, public_allow_index, public_show_company_info, public_show_salary
     ) VALUES (
       $1, $2, $3, 'open', $4, $5,
       $6, $7, $8, $9, $10,
       $11, $12, $13,
       FALSE, TRUE, FALSE, FALSE
     )
     RETURNING id, company_id AS "companyId", title, slug, status,
               positions_count AS "positionsCount", target_date AS "targetDate",
               description, salary_min AS "salaryMin", salary_max AS "salaryMax",
               client_report_show_salary AS "clientReportShowSalary",
               employment_type AS "employmentType",
               workplace_modality AS "workplaceModality",
               workplace_city AS "workplaceCity",
               workplace_state AS "workplaceState",
               public_page_enabled AS "publicPageEnabled",
               public_allow_index AS "publicAllowIndex",
               public_show_company_info AS "publicShowCompanyInfo",
               public_show_salary AS "publicShowSalary",
               created_at AS "createdAt"`,
    [
      s.companyId,
      title,
      tempSlug,
      Math.max(1, Number(s.positionsCount) || 1),
      s.targetDate,
      s.description,
      s.salaryMin,
      s.salaryMax,
      s.clientReportShowSalary === true,
      s.employmentType,
      s.workplaceModality,
      s.workplaceCity,
      s.workplaceState,
    ]
  );

  const created = ins.rows[0];
  const finalSlug = uniqueSlug(slugify(title) || s.slug || 'vaga', created.id);
  if (finalSlug !== created.slug) {
    await db.query(`UPDATE vacancies SET slug = $2 WHERE id = $1`, [created.id, finalSlug]);
    created.slug = finalSlug;
  }

  const rub = await db.query(
    `SELECT desired_type_weights AS weights, notes
     FROM vacancy_rubrics WHERE vacancy_id = $1 LIMIT 1`,
    [vid]
  );
  if (rub.rowCount) {
    await db.query(
      `INSERT INTO vacancy_rubrics (vacancy_id, desired_type_weights, notes, updated_at)
       VALUES ($1, $2::jsonb, $3, NOW())
       ON CONFLICT (vacancy_id) DO UPDATE SET
         desired_type_weights = EXCLUDED.desired_type_weights,
         notes = EXCLUDED.notes,
         updated_at = NOW()`,
      [created.id, JSON.stringify(rub.rows[0].weights || {}), rub.rows[0].notes]
    );
  }

  return {
    ok: true,
    vacancy: { ...created, companyName: s.companyName },
  };
}
