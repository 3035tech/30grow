/**
 * B-2714 — NR-1 riscos psicossociais (leve): regras puras + espelho da migration.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PSYCHOSOCIAL_RISK_LEVEL,
  PSYCHOSOCIAL_SIGNAL,
  psychosocialRiskLevel,
  psychosocialSignal,
  psychosocialSurveyPrompts,
  summarizePsychosocialFactors,
} from '../../lib/people/psychosocial-risks.js';
import { normalizePsychosocialFactor } from '../../lib/people/climate-surveys.js';
import {
  CLIMATE_QUESTION_KIND,
  PSYCHOSOCIAL_FACTOR,
  PSYCHOSOCIAL_FACTORS,
  PSYCHOSOCIAL_RISK_STATUSES,
} from '../../lib/domain-status.js';
import { buildPsychosocialReportHtml } from '../../lib/psychosocial-report-print.js';

const migration = readFileSync(new URL('../../migrations/152_psychosocial_risks.sql', import.meta.url), 'utf8');

describe('psychosocial-risks', () => {
  it('migration CHECKs mirror the domain constants', () => {
    for (const f of PSYCHOSOCIAL_FACTORS) assert.match(migration, new RegExp(`'${f}'`));
    for (const s of PSYCHOSOCIAL_RISK_STATUSES) assert.match(migration, new RegExp(`'${s}'`));
    assert.match(migration, /INSERT INTO schema_migrations[^;]*'152_psychosocial_risks\.sql'/);
  });

  it('risk level from probability × severity', () => {
    assert.equal(psychosocialRiskLevel(1), PSYCHOSOCIAL_RISK_LEVEL.LOW);
    assert.equal(psychosocialRiskLevel(2), PSYCHOSOCIAL_RISK_LEVEL.LOW);
    assert.equal(psychosocialRiskLevel(3), PSYCHOSOCIAL_RISK_LEVEL.MODERATE);
    assert.equal(psychosocialRiskLevel(4), PSYCHOSOCIAL_RISK_LEVEL.MODERATE);
    assert.equal(psychosocialRiskLevel(6), PSYCHOSOCIAL_RISK_LEVEL.HIGH);
    assert.equal(psychosocialRiskLevel(9), PSYCHOSOCIAL_RISK_LEVEL.HIGH);
  });

  it('signal thresholds', () => {
    assert.equal(psychosocialSignal(null), null);
    assert.equal(psychosocialSignal(80), PSYCHOSOCIAL_SIGNAL.FAVORABLE);
    assert.equal(psychosocialSignal(70), PSYCHOSOCIAL_SIGNAL.FAVORABLE);
    assert.equal(psychosocialSignal(55), PSYCHOSOCIAL_SIGNAL.ATTENTION);
    assert.equal(psychosocialSignal(49), PSYCHOSOCIAL_SIGNAL.CRITICAL);
  });

  it('normalizePsychosocialFactor keeps only the fixed domain', () => {
    assert.equal(normalizePsychosocialFactor('workload'), 'workload');
    assert.equal(normalizePsychosocialFactor(' support '), 'support');
    assert.equal(normalizePsychosocialFactor('burnout'), null);
    assert.equal(normalizePsychosocialFactor(null), null);
  });

  it('survey template: 2 Likert per factor + 1 open text, no em dash', () => {
    for (const locale of ['pt-BR', 'en-US', 'fr-FR']) {
      const prompts = psychosocialSurveyPrompts(locale);
      const likert = prompts.filter((p) => p.kind === CLIMATE_QUESTION_KIND.LIKERT);
      assert.equal(likert.length, 16);
      for (const f of PSYCHOSOCIAL_FACTORS) assert.equal(likert.filter((p) => p.factor === f).length, 2);
      assert.equal(prompts.filter((p) => p.kind === CLIMATE_QUESTION_KIND.TEXT).length, 1);
      assert.ok(prompts.length <= 20);
      for (const p of prompts) assert.doesNotMatch(p.prompt, / — /);
    }
    assert.match(psychosocialSurveyPrompts('en-US')[0].prompt, /workload/i);
  });

  it('summarizes favorability per factor (0–100) in domain order', () => {
    const questions = [
      { id: 1, psychosocialFactor: PSYCHOSOCIAL_FACTOR.SUPPORT },
      { id: 2, psychosocialFactor: PSYCHOSOCIAL_FACTOR.WORKLOAD },
      { id: 3, psychosocialFactor: PSYCHOSOCIAL_FACTOR.WORKLOAD },
      { id: 4, psychosocialFactor: null },
    ];
    const byQuestion = [
      { questionId: 1, mean: 4.6, scaleMin: 1, scaleMax: 5 },
      { questionId: 2, mean: 2, scaleMin: 1, scaleMax: 5 },
      { questionId: 3, mean: 3, scaleMin: 1, scaleMax: 5 },
      { questionId: 4, mean: 5, scaleMin: 1, scaleMax: 5 },
      { questionId: 9, mean: 1, scaleMin: 1, scaleMax: 5 },
    ];
    const out = summarizePsychosocialFactors(questions, byQuestion);
    assert.deepEqual(out.map((f) => f.factor), [PSYCHOSOCIAL_FACTOR.WORKLOAD, PSYCHOSOCIAL_FACTOR.SUPPORT]);
    assert.equal(out[0].favorability, 38);
    assert.equal(out[0].signal, PSYCHOSOCIAL_SIGNAL.CRITICAL);
    assert.equal(out[0].questions, 2);
    assert.equal(out[1].favorability, 90);
    assert.equal(out[1].signal, PSYCHOSOCIAL_SIGNAL.FAVORABLE);
  });

  it('report HTML escapes content and carries the disclaimer', () => {
    const html = buildPsychosocialReportHtml({
      locale: 'pt-BR',
      data: {
        companyName: 'Acme <b>',
        risks: [{ factor: 'workload', hazard: '<script>x</script>', probability: 3, severity: 2, riskScore: 6, level: 'high', status: 'identified' }],
        summary: { survey: null },
      },
      labels: { title: 'T', disclaimer: 'Não substitui o SESMT', noSurvey: 'sem pesquisa' },
      factorLabel: (f) => f,
      levelLabel: (l) => l,
      statusLabel: (s) => s,
      signalLabel: (s) => s,
    });
    assert.doesNotMatch(html, /<script>x/);
    assert.match(html, /&lt;script&gt;/);
    assert.match(html, /Acme &lt;b&gt;/);
    assert.match(html, /Não substitui o SESMT/);
    assert.match(html, /3×2 = 6/);
  });
});
