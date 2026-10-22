import { pool, query, queryRead } from './db.js';
import { ERR } from './api-error-codes.js';
import { createCompanyPipelineStage, listCompanyPipelineStages } from './company-pipeline-stages.js';

const DEFAULT_TEMPLATE_NAME = 'Funil padrão';

function positiveId(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function mapTemplate(row) {
  return {
    id: Number(row.id),
    companyId: Number(row.company_id),
    name: row.name,
    isDefault: Boolean(row.is_default),
    stageCount: Number(row.stage_count || 0),
    vacancyCount: Number(row.vacancy_count || 0),
    updatedAt: row.updated_at || null,
    stages: Array.isArray(row.stages) ? row.stages.map((stage) => ({
      id: Number(stage.id),
      stageKey: stage.stageKey,
      labelPt: stage.labelPt,
      labelEn: stage.labelEn,
      canonicalKey: stage.canonicalKey,
      sortOrder: Number(stage.sortOrder),
      required: Boolean(stage.required),
    })) : [],
  };
}

async function seedDefaultTemplate(companyId) {
  const stages = await listCompanyPipelineStages(companyId);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const inserted = await client.query(
      `INSERT INTO pipeline_templates (company_id, name, is_default)
       VALUES ($1, $2, TRUE)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [companyId, DEFAULT_TEMPLATE_NAME]
    );
    let templateId = inserted.rows[0]?.id;
    if (!templateId) {
      const existing = await client.query(
        `SELECT id FROM pipeline_templates
         WHERE company_id = $1 AND deleted_at IS NULL
         ORDER BY is_default DESC, id ASC LIMIT 1`,
        [companyId]
      );
      templateId = existing.rows[0]?.id;
    }
    if (templateId && stages.length) {
      const values = [];
      const params = [templateId];
      stages.forEach((stage, index) => {
        const p = params.length;
        params.push(stage.stageKey, stage.labelPt, stage.labelEn, stage.canonicalKey, index, stage.required);
        values.push(`($1, $${p + 1}, $${p + 2}, $${p + 3}, $${p + 4}, $${p + 5}, $${p + 6})`);
      });
      await client.query(
        `INSERT INTO pipeline_template_stages
           (template_id, stage_key, label_pt, label_en, canonical_key, sort_order, required)
         VALUES ${values.join(', ')} ON CONFLICT DO NOTHING`,
        params
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function listPipelineTemplates(companyId) {
  const cid = positiveId(companyId);
  if (!cid) return [];
  let result = await queryRead(
    `SELECT pt.id, pt.company_id, pt.name, pt.is_default, pt.updated_at,
            COUNT(DISTINCT pts.id)::int AS stage_count,
            COUNT(DISTINCT v.id)::int AS vacancy_count,
            COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                'id', s.id, 'stageKey', s.stage_key, 'labelPt', s.label_pt,
                'labelEn', s.label_en, 'canonicalKey', s.canonical_key,
                'sortOrder', s.sort_order, 'required', s.required
              ) ORDER BY s.sort_order, s.id)
              FROM pipeline_template_stages s WHERE s.template_id = pt.id
            ), '[]'::jsonb) AS stages
     FROM pipeline_templates pt
     LEFT JOIN pipeline_template_stages pts ON pts.template_id = pt.id
     LEFT JOIN vacancies v ON v.pipeline_template_id = pt.id AND v.deleted = FALSE
     WHERE pt.company_id = $1 AND pt.deleted_at IS NULL
     GROUP BY pt.id ORDER BY pt.is_default DESC, pt.name ASC`,
    [cid]
  );
  if (!result.rowCount) {
    await seedDefaultTemplate(cid);
    result = await query(
      `SELECT pt.id, pt.company_id, pt.name, pt.is_default, pt.updated_at,
              COUNT(DISTINCT pts.id)::int AS stage_count,
              COUNT(DISTINCT v.id)::int AS vacancy_count,
              COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                  'id', s.id, 'stageKey', s.stage_key, 'labelPt', s.label_pt,
                  'labelEn', s.label_en, 'canonicalKey', s.canonical_key,
                  'sortOrder', s.sort_order, 'required', s.required
                ) ORDER BY s.sort_order, s.id)
                FROM pipeline_template_stages s WHERE s.template_id = pt.id
              ), '[]'::jsonb) AS stages
       FROM pipeline_templates pt
       LEFT JOIN pipeline_template_stages pts ON pts.template_id = pt.id
       LEFT JOIN vacancies v ON v.pipeline_template_id = pt.id AND v.deleted = FALSE
       WHERE pt.company_id = $1 AND pt.deleted_at IS NULL
       GROUP BY pt.id ORDER BY pt.is_default DESC, pt.name ASC`,
      [cid]
    );
  }
  return result.rows.map(mapTemplate);
}

export async function createPipelineTemplate({ companyId, name, isDefault = false }) {
  const cid = positiveId(companyId);
  const cleanName = String(name || '').trim().slice(0, 80);
  if (!cid || !cleanName) return { ok: false, errorCode: ERR.INVALID_PARAMS };
  await listCompanyPipelineStages(cid);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (isDefault) {
      await client.query(
        `UPDATE pipeline_templates SET is_default = FALSE, updated_at = NOW()
         WHERE company_id = $1 AND deleted_at IS NULL AND is_default = TRUE`,
        [cid]
      );
    }
    const created = await client.query(
      `INSERT INTO pipeline_templates (company_id, name, is_default)
       VALUES ($1, $2, $3) RETURNING id`,
      [cid, cleanName, isDefault]
    );
    const templateId = created.rows[0].id;
    await client.query(
      `INSERT INTO pipeline_template_stages
         (template_id, stage_key, label_pt, label_en, canonical_key, sort_order, required)
       SELECT $1, stage_key, label_pt, label_en, canonical_key, sort_order, required
       FROM company_pipeline_stages
       WHERE company_id = $2 AND deleted_at IS NULL ORDER BY sort_order, id`,
      [templateId, cid]
    );
    await client.query('COMMIT');
    return { ok: true, templateId: Number(templateId) };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error?.code === '23505') return { ok: false, errorCode: ERR.PIPELINE_TEMPLATE_NAME_EXISTS };
    throw error;
  } finally {
    client.release();
  }
}

export async function listPipelineTemplateStages({ companyId, templateId }) {
  const result = await queryRead(
    `SELECT stage.id, stage.stage_key AS "stageKey", stage.label_pt AS "labelPt",
            stage.label_en AS "labelEn", stage.canonical_key AS "canonicalKey",
            stage.sort_order AS "sortOrder", stage.required
     FROM pipeline_template_stages stage
     JOIN pipeline_templates template ON template.id = stage.template_id
     WHERE template.company_id = $1 AND template.id = $2 AND template.deleted_at IS NULL
     ORDER BY stage.sort_order, stage.id`,
    [positiveId(companyId), positiveId(templateId)]
  );
  return result.rows.map((stage) => ({
    ...stage,
    id: Number(stage.id),
    sortOrder: Number(stage.sortOrder),
    required: Boolean(stage.required),
    count: 0,
  }));
}

export async function createPipelineTemplateStage({ companyId, templateId, labelPt, labelEn, canonicalKey }) {
  const cid = positiveId(companyId);
  const tid = positiveId(templateId);
  if (!cid || !tid) return { ok: false, errorCode: ERR.INVALID_PARAMS };
  const catalog = await createCompanyPipelineStage({ companyId: cid, labelPt, labelEn, canonicalKey });
  if (!catalog.ok) return catalog;
  const inserted = await query(
    `INSERT INTO pipeline_template_stages
       (template_id, stage_key, label_pt, label_en, canonical_key, sort_order, required)
     SELECT template.id, $3, $4, $5, $6,
            COALESCE((SELECT MAX(sort_order) + 1 FROM pipeline_template_stages WHERE template_id = template.id), 0),
            FALSE
     FROM pipeline_templates template
     WHERE template.id = $2 AND template.company_id = $1 AND template.deleted_at IS NULL
     RETURNING id`,
    [cid, tid, catalog.stage.stageKey, catalog.stage.labelPt, catalog.stage.labelEn, catalog.stage.canonicalKey]
  );
  return inserted.rowCount
    ? { ok: true, stage: { ...catalog.stage, id: Number(inserted.rows[0].id), count: 0 } }
    : { ok: false, errorCode: ERR.NOT_FOUND };
}

export async function updatePipelineTemplateStage({ companyId, templateId, id, labelPt, labelEn, canonicalKey }) {
  const result = await query(
    `UPDATE pipeline_template_stages AS stage
     SET label_pt = COALESCE($4, stage.label_pt),
         label_en = COALESCE($5, stage.label_en),
         canonical_key = CASE WHEN stage.required THEN stage.canonical_key ELSE COALESCE($6, stage.canonical_key) END
     FROM pipeline_templates template
     WHERE stage.id = $3 AND stage.template_id = template.id
       AND template.id = $2 AND template.company_id = $1 AND template.deleted_at IS NULL
     RETURNING stage.id`,
    [positiveId(companyId), positiveId(templateId), positiveId(id), labelPt || null, labelEn || null, canonicalKey || null]
  );
  return result.rowCount ? { ok: true } : { ok: false, errorCode: ERR.PIPELINE_STAGE_NOT_FOUND };
}

export async function deletePipelineTemplateStage({ companyId, templateId, id }) {
  const result = await query(
    `DELETE FROM pipeline_template_stages AS stage
     USING pipeline_templates template
     WHERE stage.id = $3 AND stage.template_id = template.id
       AND template.id = $2 AND template.company_id = $1
       AND template.deleted_at IS NULL AND stage.required = FALSE
     RETURNING stage.id`,
    [positiveId(companyId), positiveId(templateId), positiveId(id)]
  );
  return result.rowCount
    ? { ok: true, id: positiveId(id) }
    : { ok: false, errorCode: ERR.PIPELINE_STAGE_REQUIRED };
}

export async function reorderPipelineTemplateStages({ companyId, templateId, orderedIds }) {
  const cid = positiveId(companyId);
  const tid = positiveId(templateId);
  const ids = Array.isArray(orderedIds) ? orderedIds.map(positiveId).filter(Boolean) : [];
  if (!cid || !tid || !ids.length) return { ok: false, errorCode: ERR.INVALID_PARAMS };
  const result = await query(
    `UPDATE pipeline_template_stages AS stage
     SET sort_order = (ordered.position - 1)::int
     FROM unnest($3::bigint[]) WITH ORDINALITY AS ordered(id, position), pipeline_templates template
     WHERE stage.id = ordered.id AND stage.template_id = template.id
       AND template.id = $2 AND template.company_id = $1 AND template.deleted_at IS NULL
     RETURNING stage.id`,
    [cid, tid, ids]
  );
  if (result.rowCount !== ids.length) return { ok: false, errorCode: ERR.INVALID_PARAMS };
  return { ok: true, stages: await listPipelineTemplateStages({ companyId: cid, templateId: tid }) };
}

export async function updatePipelineTemplate({ companyId, templateId, name, isDefault }) {
  const cid = positiveId(companyId);
  const tid = positiveId(templateId);
  const cleanName = name == null ? null : String(name).trim().slice(0, 80);
  if (!cid || !tid || (name != null && !cleanName)) {
    return { ok: false, errorCode: ERR.INVALID_PARAMS };
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const owned = await client.query(
      `SELECT id FROM pipeline_templates
       WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL FOR UPDATE`,
      [tid, cid]
    );
    if (!owned.rowCount) {
      await client.query('ROLLBACK');
      return { ok: false, errorCode: ERR.NOT_FOUND };
    }
    if (isDefault === true) {
      await client.query(
        `UPDATE pipeline_templates SET is_default = FALSE, updated_at = NOW()
         WHERE company_id = $1 AND deleted_at IS NULL AND id <> $2 AND is_default = TRUE`,
        [cid, tid]
      );
    }
    await client.query(
      `UPDATE pipeline_templates
       SET name = COALESCE($3, name),
           is_default = CASE WHEN $4::boolean THEN TRUE ELSE is_default END,
           updated_at = NOW()
       WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL`,
      [tid, cid, cleanName, isDefault === true]
    );
    await client.query('COMMIT');
    return { ok: true, templateId: tid };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error?.code === '23505') return { ok: false, errorCode: ERR.PIPELINE_TEMPLATE_NAME_EXISTS };
    throw error;
  } finally {
    client.release();
  }
}

export async function duplicatePipelineTemplate({ companyId, templateId, name }) {
  const cid = positiveId(companyId);
  const tid = positiveId(templateId);
  const cleanName = String(name || '').trim().slice(0, 80);
  if (!cid || !tid || !cleanName) return { ok: false, errorCode: ERR.INVALID_PARAMS };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const created = await client.query(
      `INSERT INTO pipeline_templates (company_id, name, is_default)
       SELECT company_id, $3, FALSE FROM pipeline_templates
       WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL
       RETURNING id`,
      [tid, cid, cleanName]
    );
    if (!created.rowCount) {
      await client.query('ROLLBACK');
      return { ok: false, errorCode: ERR.NOT_FOUND };
    }
    const nextId = created.rows[0].id;
    await client.query(
      `INSERT INTO pipeline_template_stages
         (template_id, stage_key, label_pt, label_en, canonical_key, sort_order, required)
       SELECT $1, stage_key, label_pt, label_en, canonical_key, sort_order, required
       FROM pipeline_template_stages WHERE template_id = $2 ORDER BY sort_order ASC`,
      [nextId, tid]
    );
    await client.query('COMMIT');
    return { ok: true, templateId: Number(nextId) };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error?.code === '23505') return { ok: false, errorCode: ERR.PIPELINE_TEMPLATE_NAME_EXISTS };
    throw error;
  } finally {
    client.release();
  }
}

export async function archivePipelineTemplate({ companyId, templateId }) {
  const cid = positiveId(companyId);
  const tid = positiveId(templateId);
  if (!cid || !tid) return { ok: false, errorCode: ERR.INVALID_PARAMS };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const archived = await client.query(
      `UPDATE pipeline_templates SET deleted_at = NOW(), is_default = FALSE, updated_at = NOW()
       WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL
       RETURNING is_default`,
      [tid, cid]
    );
    if (!archived.rowCount) {
      await client.query('ROLLBACK');
      return { ok: false, errorCode: ERR.NOT_FOUND };
    }
    await client.query(
      `UPDATE pipeline_templates SET is_default = TRUE, updated_at = NOW()
       WHERE id = (
         SELECT id FROM pipeline_templates
         WHERE company_id = $1 AND deleted_at IS NULL
         ORDER BY created_at ASC, id ASC LIMIT 1
       ) AND NOT EXISTS (
         SELECT 1 FROM pipeline_templates
         WHERE company_id = $1 AND deleted_at IS NULL AND is_default = TRUE
       )`,
      [cid]
    );
    await client.query('COMMIT');
    return { ok: true, templateId: tid };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function restorePipelineTemplate({ companyId, templateId }) {
  const cid = positiveId(companyId);
  const tid = positiveId(templateId);
  if (!cid || !tid) return { ok: false, errorCode: ERR.INVALID_PARAMS };
  try {
    const restored = await query(
      `UPDATE pipeline_templates SET deleted_at = NULL, updated_at = NOW()
       WHERE id = $1 AND company_id = $2 AND deleted_at IS NOT NULL
       RETURNING id`,
      [tid, cid]
    );
    return restored.rowCount
      ? { ok: true, templateId: tid }
      : { ok: false, errorCode: ERR.NOT_FOUND };
  } catch (error) {
    if (error?.code === '23505') return { ok: false, errorCode: ERR.PIPELINE_TEMPLATE_NAME_EXISTS };
    throw error;
  }
}

export async function createPipelineTemplateFromVacancy({ companyId, vacancyId, name, isDefault = false }) {
  const cid = positiveId(companyId);
  const vid = positiveId(vacancyId);
  const cleanName = String(name || '').trim().slice(0, 80);
  if (!cid || !vid || !cleanName) return { ok: false, errorCode: ERR.INVALID_PARAMS };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const vacancy = await client.query(
      `SELECT id FROM vacancies WHERE id = $1 AND company_id = $2 AND deleted = FALSE FOR SHARE`,
      [vid, cid]
    );
    if (!vacancy.rowCount) {
      await client.query('ROLLBACK');
      return { ok: false, errorCode: ERR.NOT_FOUND };
    }
    if (isDefault) {
      await client.query(
        `UPDATE pipeline_templates SET is_default = FALSE, updated_at = NOW()
         WHERE company_id = $1 AND deleted_at IS NULL AND is_default = TRUE`,
        [cid]
      );
    }
    const created = await client.query(
      `INSERT INTO pipeline_templates (company_id, name, is_default)
       VALUES ($1, $2, $3) RETURNING id`,
      [cid, cleanName, isDefault]
    );
    const templateId = created.rows[0].id;
    const copied = await client.query(
      `INSERT INTO pipeline_template_stages
         (template_id, stage_key, label_pt, label_en, canonical_key, sort_order, required)
       SELECT $1, stage_key, label_pt, label_en, canonical_key, sort_order, required
       FROM vacancy_pipeline_stages WHERE vacancy_id = $2 ORDER BY sort_order ASC`,
      [templateId, vid]
    );
    if (!copied.rowCount) {
      await client.query(
        `INSERT INTO pipeline_template_stages
           (template_id, stage_key, label_pt, label_en, canonical_key, sort_order, required)
         SELECT $1, stage_key, label_pt, label_en, canonical_key, sort_order, required
         FROM company_pipeline_stages
         WHERE company_id = $2 AND deleted_at IS NULL ORDER BY sort_order ASC`,
        [templateId, cid]
      );
    }
    await client.query('COMMIT');
    return { ok: true, templateId: Number(templateId) };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error?.code === '23505') return { ok: false, errorCode: ERR.PIPELINE_TEMPLATE_NAME_EXISTS };
    throw error;
  } finally {
    client.release();
  }
}

export async function applyPipelineTemplateToVacancy({ companyId, vacancyId, templateId }, db = query) {
  const cid = positiveId(companyId);
  const vid = positiveId(vacancyId);
  let tid = positiveId(templateId);
  if (!cid || !vid) return { ok: false, errorCode: ERR.INVALID_PARAMS };
  if (!tid) {
    const templates = await listPipelineTemplates(cid);
    tid = templates.find((item) => item.isDefault)?.id || templates[0]?.id || null;
  }
  if (!tid) return { ok: false, errorCode: ERR.NOT_FOUND };
  const ownedTemplate = await query(
    `SELECT 1 FROM pipeline_templates
     WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL LIMIT 1`,
    [tid, cid]
  );
  if (!ownedTemplate.rowCount) return { ok: false, errorCode: ERR.NOT_FOUND };
  const result = await db(
    `INSERT INTO vacancy_pipeline_stages
       (vacancy_id, company_id, stage_key, label_pt, label_en, canonical_key, sort_order, required)
     SELECT $1, $2, pts.stage_key, pts.label_pt, pts.label_en,
            pts.canonical_key, pts.sort_order, pts.required
     FROM pipeline_template_stages pts
     JOIN pipeline_templates pt ON pt.id = pts.template_id
     WHERE pt.id = $3 AND pt.company_id = $2 AND pt.deleted_at IS NULL
     ON CONFLICT (vacancy_id, stage_key) DO NOTHING`,
    [vid, cid, tid]
  );
  if (!result.rowCount) {
    const existing = await queryRead(
      `SELECT 1 FROM vacancy_pipeline_stages
       WHERE vacancy_id = $1 AND company_id = $2 LIMIT 1`,
      [vid, cid]
    );
    if (!existing.rowCount) return { ok: false, errorCode: ERR.NOT_FOUND };
  }
  await db(
    `UPDATE vacancies SET pipeline_template_id = $3
     WHERE id = $1 AND company_id = $2 AND deleted = FALSE`,
    [vid, cid, tid]
  );
  return { ok: true, templateId: tid };
}

export async function listVacancyPipelineStages({ companyId, vacancyId }) {
  const cid = positiveId(companyId);
  const vid = positiveId(vacancyId);
  if (!cid || !vid) return [];
  let result = await queryRead(
    `SELECT id, company_id AS "companyId", stage_key AS "stageKey",
            label_pt AS "labelPt", label_en AS "labelEn", sort_order AS "sortOrder",
            canonical_key AS "canonicalKey", required
     FROM vacancy_pipeline_stages
     WHERE company_id = $1 AND vacancy_id = $2 ORDER BY sort_order ASC, id ASC`,
    [cid, vid]
  );
  if (!result.rowCount) {
    const vacancy = await query(
      `SELECT 1 FROM vacancies
       WHERE id = $1 AND company_id = $2 AND deleted = FALSE LIMIT 1`,
      [vid, cid]
    );
    if (!vacancy.rowCount) return [];
    await listCompanyPipelineStages(cid);
    await query(
      `INSERT INTO vacancy_pipeline_stages
         (vacancy_id, company_id, stage_key, label_pt, label_en, canonical_key, sort_order, required)
       SELECT $1, $2, stage_key, label_pt, label_en, canonical_key, sort_order, required
       FROM company_pipeline_stages
       WHERE company_id = $2 AND deleted_at IS NULL
       ON CONFLICT (vacancy_id, stage_key) DO NOTHING`,
      [vid, cid]
    );
    result = await query(
      `SELECT id, company_id AS "companyId", stage_key AS "stageKey",
              label_pt AS "labelPt", label_en AS "labelEn", sort_order AS "sortOrder",
              canonical_key AS "canonicalKey", required
       FROM vacancy_pipeline_stages
       WHERE company_id = $1 AND vacancy_id = $2 ORDER BY sort_order ASC, id ASC`,
      [cid, vid]
    );
  }
  const usage = await queryRead(
    `SELECT pipeline_stage AS stage_key, COUNT(*)::int AS n FROM (
       SELECT pipeline_stage FROM vacancy_candidates WHERE company_id = $1 AND vacancy_id = $2
       UNION ALL
       SELECT pipeline_stage FROM assessments WHERE company_id = $1 AND vacancy_id = $2
     ) rows GROUP BY pipeline_stage`,
    [cid, vid]
  );
  const counts = Object.fromEntries(usage.rows.map((row) => [row.stage_key, Number(row.n) || 0]));
  return result.rows.map((stage) => ({
    ...stage,
    id: Number(stage.id),
    companyId: Number(stage.companyId),
    sortOrder: Number(stage.sortOrder),
    required: Boolean(stage.required),
    count: counts[stage.stageKey] || 0,
  }));
}

/** Resolve against the vacancy snapshot, or the company catalog for unassigned assessments. */
export async function resolveRecruitingPipelineStage({ companyId, vacancyId, stageKey }) {
  if (!stageKey) return null;
  const stages = vacancyId
    ? await listVacancyPipelineStages({ companyId, vacancyId })
    : await listCompanyPipelineStages(companyId);
  return stages.find((stage) => stage.stageKey === stageKey) || null;
}

export async function createVacancyPipelineStage({ companyId, vacancyId, labelPt, labelEn, canonicalKey }) {
  const cid = positiveId(companyId);
  const vid = positiveId(vacancyId);
  if (!cid || !vid) return { ok: false, errorCode: ERR.INVALID_PARAMS };
  const vacancy = await queryRead(
    `SELECT 1 FROM vacancies WHERE id = $1 AND company_id = $2 AND deleted = FALSE LIMIT 1`,
    [vid, cid]
  );
  if (!vacancy.rowCount) return { ok: false, errorCode: ERR.NOT_FOUND };
  await listVacancyPipelineStages({ companyId: cid, vacancyId: vid });
  const catalog = await createCompanyPipelineStage({ companyId: cid, labelPt, labelEn, canonicalKey });
  if (!catalog.ok) return catalog;
  const inserted = await query(
    `INSERT INTO vacancy_pipeline_stages
       (vacancy_id, company_id, stage_key, label_pt, label_en, canonical_key, sort_order, required)
     SELECT $1, $2, $3, $4, $5, $6,
            COALESCE(MAX(sort_order), -1) + 1, FALSE
     FROM vacancy_pipeline_stages WHERE vacancy_id = $1
     RETURNING id`,
    [vid, cid, catalog.stage.stageKey, catalog.stage.labelPt, catalog.stage.labelEn, catalog.stage.canonicalKey]
  );
  return { ok: true, stage: { ...catalog.stage, id: Number(inserted.rows[0].id), count: 0 } };
}

export async function updateVacancyPipelineStage({ companyId, vacancyId, id, labelPt, labelEn, canonicalKey }) {
  const result = await query(
    `UPDATE vacancy_pipeline_stages
     SET label_pt = COALESCE($4, label_pt), label_en = COALESCE($5, label_en),
         canonical_key = CASE WHEN required THEN canonical_key ELSE COALESCE($6, canonical_key) END,
         updated_at = NOW()
     WHERE id = $3 AND vacancy_id = $2 AND company_id = $1
     RETURNING id`,
    [positiveId(companyId), positiveId(vacancyId), positiveId(id), labelPt || null, labelEn || null, canonicalKey || null]
  );
  return result.rowCount ? { ok: true } : { ok: false, errorCode: ERR.PIPELINE_STAGE_NOT_FOUND };
}

export async function deleteVacancyPipelineStage({ companyId, vacancyId, id }) {
  const stage = await queryRead(
    `SELECT stage_key, required FROM vacancy_pipeline_stages
     WHERE id = $3 AND vacancy_id = $2 AND company_id = $1`,
    [positiveId(companyId), positiveId(vacancyId), positiveId(id)]
  );
  if (!stage.rowCount) return { ok: false, errorCode: ERR.PIPELINE_STAGE_NOT_FOUND };
  if (stage.rows[0].required) return { ok: false, errorCode: ERR.PIPELINE_STAGE_REQUIRED };
  const usage = await queryRead(
    `SELECT (
       (SELECT COUNT(*) FROM vacancy_candidates WHERE company_id = $1 AND vacancy_id = $2 AND pipeline_stage = $3) +
       (SELECT COUNT(*) FROM assessments WHERE company_id = $1 AND vacancy_id = $2 AND pipeline_stage = $3)
     )::int AS n`,
    [positiveId(companyId), positiveId(vacancyId), stage.rows[0].stage_key]
  );
  if (Number(usage.rows[0]?.n) > 0) return { ok: false, errorCode: ERR.PIPELINE_STAGE_IN_USE, usage: Number(usage.rows[0].n) };
  await query(`DELETE FROM vacancy_pipeline_stages WHERE id = $1`, [positiveId(id)]);
  return { ok: true, id: positiveId(id) };
}

export async function reorderVacancyPipelineStages({ companyId, vacancyId, orderedIds }) {
  const cid = positiveId(companyId);
  const vid = positiveId(vacancyId);
  const ids = Array.isArray(orderedIds) ? orderedIds.map(positiveId).filter(Boolean) : [];
  if (!cid || !vid || !ids.length) return { ok: false, errorCode: ERR.INVALID_PARAMS };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const updated = await client.query(
      `UPDATE vacancy_pipeline_stages AS stage
       SET sort_order = (ordered.position - 1)::int, updated_at = NOW()
       FROM unnest($3::bigint[]) WITH ORDINALITY AS ordered(id, position)
       WHERE stage.company_id = $1 AND stage.vacancy_id = $2 AND stage.id = ordered.id
       RETURNING stage.id`,
      [cid, vid, ids]
    );
    if (updated.rowCount !== ids.length) {
      await client.query('ROLLBACK');
      return { ok: false, errorCode: ERR.INVALID_PARAMS };
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  return { ok: true, stages: await listVacancyPipelineStages({ companyId: cid, vacancyId: vid }) };
}
