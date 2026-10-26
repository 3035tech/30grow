import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { pool, query } from '../../lib/db.js';
import {
  applyPipelineTemplateToVacancy,
  archivePipelineTemplate,
  createPipelineTemplate,
  createPipelineTemplateStage,
  createPipelineTemplateFromVacancy,
  duplicatePipelineTemplate,
  listPipelineTemplates,
  listPipelineTemplateStages,
  listVacancyPipelineStages,
  reorderPipelineTemplateStages,
  restorePipelineTemplate,
  updatePipelineTemplate,
} from '../../lib/recruiting/pipeline-templates.js';

const dtov = process.env.DTOV === '1';

after(async () => {
  await pool.end();
});

describe('vacancy pipeline templates (DTOV)', { skip: !dtov }, () => {
  it('seeds a tenant default, snapshots it to a vacancy and saves a reusable model', async () => {
    const vacancyResult = await query(
      `SELECT id, company_id FROM vacancies WHERE deleted = FALSE ORDER BY id ASC LIMIT 1`
    );
    assert.equal(vacancyResult.rowCount, 1);
    const vacancyId = Number(vacancyResult.rows[0].id);
    const companyId = Number(vacancyResult.rows[0].company_id);

    const templates = await listPipelineTemplates(companyId);
    assert.ok(templates.length >= 1);
    assert.equal(templates.filter((item) => item.isDefault).length, 1);

    await query(`DELETE FROM vacancy_pipeline_stages WHERE vacancy_id = $1`, [vacancyId]);
    const legacyFallbackStages = await listVacancyPipelineStages({ companyId, vacancyId });
    assert.ok(legacyFallbackStages.length >= 5, 'legacy vacancy should receive a lazy snapshot');

    const applied = await applyPipelineTemplateToVacancy({
      companyId,
      vacancyId,
      templateId: templates[0].id,
    });
    assert.equal(applied.ok, true);

    const stages = await listVacancyPipelineStages({ companyId, vacancyId });
    assert.ok(stages.length >= 5);
    assert.equal(stages[0].companyId, companyId);

    const saved = await createPipelineTemplateFromVacancy({
      companyId,
      vacancyId,
      name: `Tecnologia DTOV ${vacancyId}-${Date.now()}`,
      isDefault: false,
    });
    assert.equal(saved.ok, true);

    const renamed = await updatePipelineTemplate({
      companyId,
      templateId: saved.templateId,
      name: `Tecnologia principal ${vacancyId}-${Date.now()}`,
      isDefault: true,
    });
    assert.equal(renamed.ok, true);

    const duplicated = await duplicatePipelineTemplate({
      companyId,
      templateId: saved.templateId,
      name: `Cópia DTOV ${vacancyId}-${Date.now()}`,
    });
    assert.equal(duplicated.ok, true);
    const afterDuplicate = await listPipelineTemplates(companyId);
    assert.ok(afterDuplicate.some((item) => item.id === duplicated.templateId));
    assert.ok(afterDuplicate.find((item) => item.id === duplicated.templateId)?.stages?.length >= 5);

    const blank = await createPipelineTemplate({
      companyId,
      name: `Funil editável DTOV ${vacancyId}-${Date.now()}`,
    });
    assert.equal(blank.ok, true);
    const baseStages = await listPipelineTemplateStages({ companyId, templateId: blank.templateId });
    assert.ok(baseStages.length >= 5);
    const addedStage = await createPipelineTemplateStage({
      companyId,
      templateId: blank.templateId,
      labelPt: `Painel DTOV ${Date.now()}`,
      labelEn: 'DTOV panel',
      canonicalKey: 'screening',
    });
    assert.equal(addedStage.ok, true);
    const reordered = await reorderPipelineTemplateStages({
      companyId,
      templateId: blank.templateId,
      orderedIds: [...baseStages.map((stage) => stage.id), addedStage.stage.id].reverse(),
    });
    assert.equal(reordered.ok, true);
    assert.equal(reordered.stages[0].id, addedStage.stage.id);

    const crossTenantArchive = await archivePipelineTemplate({
      companyId: companyId + 99999,
      templateId: duplicated.templateId,
    });
    assert.equal(crossTenantArchive.ok, false);
    const archived = await archivePipelineTemplate({ companyId, templateId: duplicated.templateId });
    assert.equal(archived.ok, true);
    const restored = await restorePipelineTemplate({ companyId, templateId: duplicated.templateId });
    assert.equal(restored.ok, true);

    const otherTenantStages = await listVacancyPipelineStages({ companyId: companyId + 99999, vacancyId });
    assert.deepEqual(otherTenantStages, []);
  });
});
