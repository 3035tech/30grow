/**
 * Company Benefits — catálogo de benefícios para contexto de retenção/oferta (B-1009, Epic B-1000).
 * Sem adesão, sem desconto em folha, sem "clube" — apenas lista informativa.
 * Categorias: cadastro por empresa (`benefit_categories`) vinculado via `category_id`.
 */

import { asDb } from '../ae/as-db.js';
import { ERR } from '../api-error-codes.js';
import { BENEFIT_TYPES } from '../domain-status.js';
import { htmlToPlainText, sanitizeRichTextHtml } from '../sanitize-html.js';
import { t as i18nT } from '../i18n.js';

const NAME_MAX = 200;
const DESC_MAX = 2000;
const CATEGORY_NAME_MAX = 100;
const LIST_CAP = 100;
const CATEGORY_LIST_CAP = 100;

const BENEFIT_TYPE_SET = new Set(BENEFIT_TYPES);
const BENEFIT_SELECT = `
  b.id, b.name, b.description,
  b.category_id AS "categoryId",
  COALESCE(c.name, b.category) AS category,
  b.benefit_type AS "benefitType",
  b.active,
  b.created_at AS "createdAt",
  b.updated_at AS "updatedAt"
`;

function normalizeType(raw, fallback = 'other') {
  const t = String(raw || '').trim().toLowerCase();
  return BENEFIT_TYPE_SET.has(t) ? t : fallback;
}

function isUniqueViolation(err) {
  return Boolean(err && (err.code === '23505' || /unique|duplicate/i.test(String(err.message || ''))));
}

/**
 * Resolve category_id no tenant; sincroniza nome legado em `category`.
 */
async function resolveCategoryForCompany(db, { companyId, categoryId, requireActive = true }) {
  if (categoryId === undefined) {
    return { ok: true, skipped: true };
  }
  if (categoryId === null || categoryId === '') {
    return { ok: true, categoryId: null, categoryName: null };
  }
  const id = Number(categoryId);
  if (!Number.isFinite(id) || id <= 0) {
    return { ok: false, errorCode: ERR.BENEFIT_CATEGORY_NOT_FOUND };
  }
  const activeClause = requireActive ? ' AND active = TRUE' : '';
  const res = await db.query(
    `SELECT id, name FROM benefit_categories
     WHERE id = $1 AND company_id = $2${activeClause}
     LIMIT 1`,
    [id, companyId]
  );
  if (res.rowCount === 0) {
    return { ok: false, errorCode: ERR.BENEFIT_CATEGORY_NOT_FOUND };
  }
  return { ok: true, categoryId: res.rows[0].id, categoryName: res.rows[0].name };
}

// ========================================
// BENEFIT CATEGORIES CRUD
// ========================================

/**
 * List benefit categories for a company.
 */
export async function listBenefitCategories(dbOrQuery, {
  companyId,
  includeInactive = false,
  limit = CATEGORY_LIST_CAP,
}) {
  const db = asDb(dbOrQuery);
  const cap = Math.min(Math.max(1, Number(limit) || CATEGORY_LIST_CAP), CATEGORY_LIST_CAP);

  let where = 'company_id = $1';
  if (!includeInactive) {
    where += ' AND active = TRUE';
  }

  const res = await db.query(
    `SELECT id, name, active,
            created_at AS "createdAt", updated_at AS "updatedAt"
     FROM benefit_categories
     WHERE ${where}
     ORDER BY active DESC, LOWER(name) ASC, id ASC
     LIMIT $2`,
    [companyId, cap]
  );
  return res.rows;
}

/**
 * Get a single category (tenant-scoped).
 */
export async function getBenefitCategory(dbOrQuery, { companyId, categoryId }) {
  const db = asDb(dbOrQuery);
  const res = await db.query(
    `SELECT id, name, active,
            created_by_user_id AS "createdByUserId",
            created_at AS "createdAt", updated_at AS "updatedAt"
     FROM benefit_categories
     WHERE id = $1 AND company_id = $2
     LIMIT 1`,
    [categoryId, companyId]
  );
  if (res.rowCount === 0) return null;
  return res.rows[0];
}

/**
 * Create a benefit category.
 */
export async function createBenefitCategory(dbOrQuery, {
  companyId,
  name,
  createdByUserId = null,
}) {
  const db = asDb(dbOrQuery);
  const safeName = String(name || '').trim().slice(0, CATEGORY_NAME_MAX);
  if (safeName.length === 0) {
    return { ok: false, errorCode: ERR.NAME_REQUIRED };
  }

  try {
    const res = await db.query(
      `INSERT INTO benefit_categories (company_id, name, created_by_user_id)
       VALUES ($1, $2, $3)
       RETURNING id, name, active,
                 created_at AS "createdAt", updated_at AS "updatedAt"`,
      [companyId, safeName, createdByUserId || null]
    );
    return { ok: true, category: res.rows[0] };
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { ok: false, errorCode: ERR.BENEFIT_CATEGORY_NAME_EXISTS };
    }
    throw err;
  }
}

/**
 * Update a benefit category; syncs legacy `company_benefits.category` text when name changes.
 */
export async function updateBenefitCategory(dbOrQuery, {
  companyId,
  categoryId,
  name,
  active,
}) {
  const db = asDb(dbOrQuery);
  const existing = await getBenefitCategory(db, { companyId, categoryId });
  if (!existing) return { ok: false, errorCode: ERR.BENEFIT_CATEGORY_NOT_FOUND };

  const nextName = name !== undefined
    ? String(name || '').trim().slice(0, CATEGORY_NAME_MAX)
    : existing.name;
  if (nextName.length === 0) {
    return { ok: false, errorCode: ERR.NAME_REQUIRED };
  }
  const nextActive = active !== undefined ? !!active : existing.active;

  try {
    const res = await db.query(
      `UPDATE benefit_categories
       SET name = $3, active = $4, updated_at = NOW()
       WHERE id = $1 AND company_id = $2
       RETURNING id, name, active,
                 created_at AS "createdAt", updated_at AS "updatedAt"`,
      [categoryId, companyId, nextName, nextActive]
    );
    if (res.rowCount === 0) {
      return { ok: false, errorCode: ERR.BENEFIT_CATEGORY_NOT_FOUND };
    }

    if (nextName !== existing.name) {
      await db.query(
        `UPDATE company_benefits
         SET category = $3, updated_at = NOW()
         WHERE company_id = $1 AND category_id = $2`,
        [companyId, categoryId, nextName]
      );
    }

    return { ok: true, category: res.rows[0] };
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { ok: false, errorCode: ERR.BENEFIT_CATEGORY_NAME_EXISTS };
    }
    throw err;
  }
}

/**
 * Soft-deactivate a benefit category (benefits keep category_id; ON DELETE SET NULL only on hard delete).
 */
export async function deactivateBenefitCategory(dbOrQuery, { companyId, categoryId }) {
  return updateBenefitCategory(dbOrQuery, {
    companyId,
    categoryId,
    active: false,
  });
}

/**
 * Active categories for filters / selects (id + name).
 */
export async function getCompanyBenefitCategories(dbOrQuery, { companyId }) {
  const rows = await listBenefitCategories(dbOrQuery, { companyId, includeInactive: false });
  return rows.map((r) => ({ id: r.id, name: r.name }));
}

// ========================================
// COMPANY BENEFITS CRUD
// ========================================

/**
 * List company benefits.
 */
export async function listCompanyBenefits(dbOrQuery, {
  companyId,
  includeInactive = false,
  categoryId = null,
  /** @deprecated use categoryId */
  category = null,
  limit = LIST_CAP,
}) {
  const db = asDb(dbOrQuery);
  const cap = Math.min(Math.max(1, Number(limit) || LIST_CAP), LIST_CAP);

  let where = 'b.company_id = $1';
  const params = [companyId];
  let paramIndex = 2;

  if (!includeInactive) {
    where += ' AND b.active = TRUE';
  }

  const catId = categoryId != null && categoryId !== ''
    ? Number(categoryId)
    : null;
  if (catId && Number.isFinite(catId) && catId > 0) {
    where += ` AND b.category_id = $${paramIndex}`;
    params.push(catId);
    paramIndex++;
  } else if (category) {
    // legado: filtro por texto
    where += ` AND COALESCE(c.name, b.category) = $${paramIndex}`;
    params.push(String(category).trim());
    paramIndex++;
  }

  const res = await db.query(
    `SELECT ${BENEFIT_SELECT}
     FROM company_benefits b
     LEFT JOIN benefit_categories c ON c.id = b.category_id
     WHERE ${where}
     ORDER BY b.active DESC, b.updated_at DESC, b.id DESC
     LIMIT $${paramIndex}`,
    [...params, cap]
  );

  return res.rows;
}

/**
 * Get a single benefit.
 */
export async function getCompanyBenefit(dbOrQuery, { companyId, benefitId }) {
  const db = asDb(dbOrQuery);
  const res = await db.query(
    `SELECT ${BENEFIT_SELECT},
            b.created_by_user_id AS "createdByUserId"
     FROM company_benefits b
     LEFT JOIN benefit_categories c ON c.id = b.category_id
     WHERE b.id = $1 AND b.company_id = $2
     LIMIT 1`,
    [benefitId, companyId]
  );
  if (res.rowCount === 0) return null;
  return res.rows[0];
}

/**
 * Create a company benefit.
 */
export async function createCompanyBenefit(dbOrQuery, {
  companyId,
  name,
  description = '',
  categoryId = null,
  /** @deprecated prefer categoryId */
  category = null,
  benefitType = 'other',
  createdByUserId = null,
}) {
  const db = asDb(dbOrQuery);

  const safeName = String(name || '').trim().slice(0, NAME_MAX);
  if (safeName.length === 0) {
    return { ok: false, errorCode: ERR.NAME_REQUIRED };
  }

  const safeDesc = sanitizeRichTextHtml(description || '', DESC_MAX) || '';
  const safeType = normalizeType(benefitType, 'other');

  let resolvedId = null;
  let resolvedName = null;

  if (categoryId !== undefined && categoryId !== null && categoryId !== '') {
    const resolved = await resolveCategoryForCompany(db, { companyId, categoryId, requireActive: true });
    if (!resolved.ok) return resolved;
    resolvedId = resolved.categoryId;
    resolvedName = resolved.categoryName;
  } else if (category) {
    // legado: cria/reusa categoria pelo nome
    const text = String(category).trim().slice(0, CATEGORY_NAME_MAX);
    if (text) {
      const existing = await db.query(
        `SELECT id, name FROM benefit_categories
         WHERE company_id = $1 AND LOWER(btrim(name)) = LOWER(btrim($2))
         LIMIT 1`,
        [companyId, text]
      );
      if (existing.rowCount > 0) {
        resolvedId = existing.rows[0].id;
        resolvedName = existing.rows[0].name;
      } else {
        const created = await createBenefitCategory(db, {
          companyId,
          name: text,
          createdByUserId,
        });
        if (!created.ok) return created;
        resolvedId = created.category.id;
        resolvedName = created.category.name;
      }
    }
  }

  const res = await db.query(
    `INSERT INTO company_benefits (
       company_id, name, description, category, category_id, benefit_type, created_by_user_id
     ) VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [companyId, safeName, safeDesc, resolvedName, resolvedId, safeType, createdByUserId || null]
  );

  const benefit = await getCompanyBenefit(db, { companyId, benefitId: res.rows[0].id });
  return { ok: true, benefit };
}

/**
 * Update a company benefit.
 */
export async function updateCompanyBenefit(dbOrQuery, {
  companyId,
  benefitId,
  name,
  description,
  categoryId,
  /** @deprecated prefer categoryId */
  category,
  benefitType,
  active,
}) {
  const db = asDb(dbOrQuery);

  const existing = await getCompanyBenefit(db, { companyId, benefitId });
  if (!existing) return { ok: false, errorCode: ERR.NOT_FOUND };

  const nextName = name !== undefined ? String(name || '').trim().slice(0, NAME_MAX) : existing.name;
  if (nextName.length === 0) {
    return { ok: false, errorCode: ERR.NAME_REQUIRED };
  }

  const nextDesc = description !== undefined
    ? (sanitizeRichTextHtml(description || '', DESC_MAX) || '')
    : existing.description;
  const nextType = benefitType !== undefined
    ? normalizeType(benefitType, existing.benefitType)
    : existing.benefitType;
  const nextActive = active !== undefined ? !!active : existing.active;

  let nextCategoryId = existing.categoryId ?? null;
  let nextCategoryName = existing.category ?? null;

  if (categoryId !== undefined) {
    const resolved = await resolveCategoryForCompany(db, {
      companyId,
      categoryId,
      requireActive: categoryId != null && categoryId !== '',
    });
    if (!resolved.ok) return resolved;
    if (!resolved.skipped) {
      nextCategoryId = resolved.categoryId;
      nextCategoryName = resolved.categoryName;
    }
  } else if (category !== undefined) {
    if (!category) {
      nextCategoryId = null;
      nextCategoryName = null;
    } else {
      const text = String(category).trim().slice(0, CATEGORY_NAME_MAX);
      const found = await db.query(
        `SELECT id, name FROM benefit_categories
         WHERE company_id = $1 AND LOWER(btrim(name)) = LOWER(btrim($2))
         LIMIT 1`,
        [companyId, text]
      );
      if (found.rowCount > 0) {
        nextCategoryId = found.rows[0].id;
        nextCategoryName = found.rows[0].name;
      } else {
        const created = await createBenefitCategory(db, { companyId, name: text });
        if (!created.ok) return created;
        nextCategoryId = created.category.id;
        nextCategoryName = created.category.name;
      }
    }
  }

  await db.query(
    `UPDATE company_benefits
     SET name = $2, description = $3, category = $4, category_id = $5,
         benefit_type = $6, active = $7, updated_at = NOW()
     WHERE id = $1 AND company_id = $8`,
    [benefitId, nextName, nextDesc, nextCategoryName, nextCategoryId, nextType, nextActive, companyId]
  );

  const benefit = await getCompanyBenefit(db, { companyId, benefitId });
  return { ok: true, benefit };
}

/**
 * Deactivate (soft delete) a company benefit.
 */
export async function deactivateCompanyBenefit(dbOrQuery, { companyId, benefitId }) {
  const db = asDb(dbOrQuery);
  const existing = await getCompanyBenefit(db, { companyId, benefitId });
  if (!existing) return { ok: false, errorCode: ERR.NOT_FOUND };

  await db.query(
    `UPDATE company_benefits SET active = FALSE, updated_at = NOW()
     WHERE id = $1 AND company_id = $2`,
    [benefitId, companyId]
  );

  return { ok: true };
}

/**
 * Format benefits for onboarding kit/materials.
 */
export async function formatBenefitsForOnboarding(dbOrQuery, { companyId, format = 'text', locale = 'pt-BR' }) {
  const benefits = await listCompanyBenefits(dbOrQuery, { companyId, includeInactive: false });

  if (benefits.length === 0) {
    return format === 'html'
      ? '<p><em>Nenhum benefício cadastrado</em></p>'
      : 'Nenhum benefício cadastrado';
  }

  const title = i18nT(locale, 'ui.companyBenefits.companyBenefits');

  if (format === 'html') {
    let html = `<h3>${title}</h3><ul>`;
    for (const benefit of benefits) {
      html += `<li><strong>${benefit.name}</strong>`;
      const descHtml = sanitizeRichTextHtml(benefit.description || '', DESC_MAX);
      if (descHtml) {
        html += `: ${descHtml}`;
      }
      if (benefit.category) {
        html += ` <em>(${benefit.category})</em>`;
      }
      html += '</li>';
    }
    html += '</ul>';
    return html;
  }

  let text = `${title}\n\n`;
  for (const benefit of benefits) {
    text += `• ${benefit.name}`;
    const plain = htmlToPlainText(benefit.description || '').trim();
    if (plain) {
      text += `: ${plain}`;
    }
    if (benefit.category) {
      text += ` (${benefit.category})`;
    }
    text += '\n';
  }
  return text;
}

export const COMPANY_BENEFITS_CAPS = {
  LIST_CAP,
  CATEGORY_LIST_CAP,
  BENEFIT_TYPES,
};
