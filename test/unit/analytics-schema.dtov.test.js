import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';

import { pool, query } from '../../lib/db.js';
import { getHiringEffectivenessMetrics } from '../../lib/analytics/analytics-metrics.js';
import { getAllTrends } from '../../lib/analytics/analytics-trends.js';
import { detectAllAlerts } from '../../lib/analytics/analytics-alerts.js';
import {
  compareAreas,
  comparePeriods,
  listAvailableAreas,
  listAvailableRubrics,
} from '../../lib/analytics/analytics-comparisons.js';

const dtov = process.env.DTOV === '1';

after(async () => {
  await pool.end();
});

describe('analytics uses the canonical people schema (DTOV)', { skip: !dtov }, () => {
  it('loads metrics, trends, alerts and comparisons without legacy columns', async () => {
    const company = await query(
      `SELECT id FROM companies WHERE slug = $1 AND deleted = FALSE LIMIT 1`,
      ['todos-os-dados-demo']
    );
    assert.equal(company.rowCount, 1);
    const companyId = Number(company.rows[0].id);

    const [metrics, trends, alerts, areas, rubrics, periods] = await Promise.all([
      getHiringEffectivenessMetrics(companyId),
      getAllTrends(companyId, { months: 12 }),
      detectAllAlerts(companyId),
      listAvailableAreas(companyId),
      listAvailableRubrics(companyId),
      comparePeriods(companyId, '2025-01-01', '2025-12-31', '2026-01-01', '2026-12-31'),
    ]);

    assert.ok(metrics.timeToHire);
    assert.ok(metrics.retention.sixMonths);
    assert.equal(metrics.fitComparison.poolCount >= 0, true);
    assert.equal(metrics.sampleSize.hires, metrics.timeToHire.count);
    assert.equal(metrics.sampleSize.poolFit, metrics.fitComparison.poolCount);
    assert.deepEqual(Object.keys(trends), ['hrScore', 'turnoverRisk', 'climate', 'pdiCompletion', 'hiresVsExits']);
    assert.ok(Array.isArray(alerts));
    assert.ok(areas.length >= 2);
    assert.ok(rubrics.length >= 1);
    assert.ok(periods.periodA);

    const areaComparison = await compareAreas(companyId, areas[0], areas[1]);
    assert.equal(areaComparison.areaA.name, areas[0]);
    assert.equal(areaComparison.areaB.name, areas[1]);
  });

  it('keeps canonical indexes available for analytics hot paths', async () => {
    const indexes = await query(
      `SELECT indexname
       FROM pg_indexes
       WHERE schemaname = 'public'
         AND indexname = ANY($1::text[])`,
      [[
        'idx_candidates_company_hired_at',
        'idx_candidates_company_hired_vacancy',
        'idx_hr_scores_company_calculated',
        'idx_assessments_company_created_vacancy',
      ]]
    );
    assert.deepEqual(
      indexes.rows.map((row) => row.indexname).sort(),
      [
        'idx_assessments_company_created_vacancy',
        'idx_candidates_company_hired_at',
        'idx_candidates_company_hired_vacancy',
        'idx_hr_scores_company_calculated',
      ]
    );
  });

  it('does not leak analytics across tenants', async () => {
    const missingTenantId = 99999999;
    const [metrics, areas] = await Promise.all([
      getHiringEffectivenessMetrics(missingTenantId),
      listAvailableAreas(missingTenantId),
    ]);
    assert.equal(metrics.timeToHire.count, 0);
    assert.equal(metrics.fitComparison.poolCount, 0);
    assert.deepEqual(areas, []);
  });
});
