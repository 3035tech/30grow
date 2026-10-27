/**
 * Unit: B-RH2-12 company-configurable pipeline stages.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { ERR } from '../../lib/api-error-codes.js';
import { t } from '../../lib/i18n.js';
import {
  PIPELINE_CANONICAL_KEYS,
  PIPELINE_STAGE_SEED,
  canonicalOfStageKey,
  canonicalStageExprSql,
  canonicalStageJoinSql,
  createCompanyPipelineStage,
  slugifyStageKey,
  updateCompanyPipelineStage,
} from '../../lib/company/company-pipeline-stages.js';

describe('B-RH2-12 company pipeline stages', () => {
  it('exposes PIPELINE_STAGE_* error codes', () => {
    assert.equal(ERR.PIPELINE_STAGE_NOT_FOUND, 'PIPELINE_STAGE_NOT_FOUND');
    assert.equal(ERR.PIPELINE_STAGE_IN_USE, 'PIPELINE_STAGE_IN_USE');
    assert.equal(ERR.PIPELINE_STAGE_REQUIRED, 'PIPELINE_STAGE_REQUIRED');
    assert.equal(ERR.PIPELINE_STAGE_KEY_EXISTS, 'PIPELINE_STAGE_KEY_EXISTS');
    assert.equal(ERR.PIPELINE_STAGE_LABEL_REQUIRED, 'PIPELINE_STAGE_LABEL_REQUIRED');
    assert.equal(ERR.PIPELINE_STAGE_INVALID_CANONICAL, 'PIPELINE_STAGE_INVALID_CANONICAL');
  });

  it('seed lists the 8 canonical stages in Kanban order', () => {
    assert.equal(PIPELINE_STAGE_SEED.length, 8);
    const keys = PIPELINE_STAGE_SEED.map((s) => s.key);
    assert.deepEqual(keys, [
      'new', 'interview', 'test_completed', 'screening',
      'approved', 'hired', 'rejected', 'archived',
    ]);
    const required = PIPELINE_STAGE_SEED.filter((s) => s.required).map((s) => s.key).sort();
    assert.deepEqual(required, ['archived', 'hired', 'new', 'rejected', 'test_completed']);
  });

  it('canonical set matches PIPELINE_CANONICAL_KEYS', () => {
    assert.equal(PIPELINE_CANONICAL_KEYS.length, 8);
    assert.ok(PIPELINE_CANONICAL_KEYS.includes('screening'));
    assert.ok(PIPELINE_CANONICAL_KEYS.includes('hired'));
  });

  it('slugifyStageKey normalizes label into c_<slug>', () => {
    assert.equal(slugifyStageKey('Análise da gestão'), 'c_analise_da_gestao');
    assert.equal(slugifyStageKey('  Extra !!  '), 'c_extra');
    assert.equal(slugifyStageKey(''), 'c_stage');
  });

  it('canonicalOfStageKey falls back to canonical when unknown/legacy', () => {
    const stages = [{ stageKey: 'c_x', canonicalKey: 'screening' }];
    assert.equal(canonicalOfStageKey(stages, 'c_x'), 'screening');
    assert.equal(canonicalOfStageKey(stages, 'interview'), 'interview');
    assert.equal(canonicalOfStageKey(stages, 'unknown_slug'), null);
  });

  it('SQL helpers reference the given alias', () => {
    assert.ok(canonicalStageJoinSql('ass').includes('cps_ass'));
    assert.ok(canonicalStageJoinSql('ass').includes('ass.company_id'));
    assert.ok(canonicalStageJoinSql('ass').includes('ass.pipeline_stage'));
    assert.equal(canonicalStageExprSql('vc'), 'COALESCE(cps_vc.canonical_key, vc.pipeline_stage)');
  });

  it('createCompanyPipelineStage rejects missing companyId without DB', async () => {
    const r = await createCompanyPipelineStage(
      { companyId: undefined, labelPt: 'X', canonicalKey: 'screening' },
      { query: async () => ({ rowCount: 0, rows: [] }) }
    );
    assert.equal(r.ok, false);
    assert.equal(r.errorCode, ERR.INVALID_COMPANY);
  });

  it('updateCompanyPipelineStage rejects missing id', async () => {
    const r = await updateCompanyPipelineStage(
      { companyId: 1, id: 0, labelPt: 'X' },
      { query: async () => ({ rowCount: 0, rows: [] }) }
    );
    assert.equal(r.ok, false);
    assert.equal(r.errorCode, ERR.PIPELINE_STAGE_NOT_FOUND);
  });

  it('editor i18n keys exist in pt-BR + en', () => {
    for (const loc of ['pt-BR', 'en']) {
      for (const key of [
        'panel.pipelineEditor.title',
        'panel.pipelineEditor.subtitle',
        'panel.pipelineEditor.addCta',
        'panel.pipelineEditor.canonicalLabel',
        'panel.pipelineEditor.dragHint',
        'panel.pipelineEditor.deleteBlockedInUse',
        'panel.pipelineTemplates.fieldLabel',
        'panel.pipelineTemplates.saveAction',
      ]) {
        const s = t(loc, key);
        assert.ok(s && s !== key, `missing ${key} for ${loc}`);
      }
    }
  });

  it('keeps pipeline templates inside the vacancies capability and tenant schema', async () => {
    const migration = await readFile(
      new URL('../../migrations/111_vacancy_pipeline_templates.sql', import.meta.url),
      'utf8'
    );
    const route = await readFile(
      new URL('../../app/api/admin/pipeline-templates/route.js', import.meta.url),
      'utf8'
    );

    assert.match(migration, /pipeline_templates[\s\S]*company_id/);
    assert.match(migration, /vacancy_pipeline_stages/);
    assert.match(route, /CAP\.VACANCIES_MANAGE/);
  });

  it('renders stages as a horizontal draggable board with creation at the end', async () => {
    const source = await readFile(
      new URL('../../app/dashboard/vacancies/PipelineStagesEditor.jsx', import.meta.url),
      'utf8'
    );

    assert.match(source, /kanban-scroll overflow-x-auto/);
    assert.match(source, /draggable=\{!editing\}/);
    assert.match(source, /commitReorder\(next\)/);
    assert.match(source, /<span className="text-xl leading-none" aria-hidden>\+<\/span>/);
    assert.doesNotMatch(source, /window\.confirm/);
  });

  it('error i18n messages exist in pt-BR + en', () => {
    for (const loc of ['pt-BR', 'en']) {
      for (const code of [
        'PIPELINE_STAGE_NOT_FOUND',
        'PIPELINE_STAGE_IN_USE',
        'PIPELINE_STAGE_REQUIRED',
        'PIPELINE_STAGE_LABEL_REQUIRED',
      ]) {
        const key = `errors.${code}`;
        const s = t(loc, key);
        assert.ok(s && s !== key, `missing ${key} for ${loc}`);
      }
    }
  });
});
