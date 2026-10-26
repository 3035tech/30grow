/**
 * Unit proof — B-3020 chart aggregates (P1 + P2 + P3). No DB.
 */
import assert from 'node:assert/strict';
import {
  CHART_MIN_N,
  hrScoreAreaBars,
  nineBoxOccupancy,
  okrLevelRollup,
  salaryBandTotals,
  scoreHistogram,
  successionCoverage,
  topCategoryCounts,
  turnoverRiskDistribution,
  whistleStatusFunnel,
  vacationPoolTotals,
  vacationPoolByAreaBars,
} from '../../lib/analytics/chart-aggregates.js';

function main() {
  assert.equal(CHART_MIN_N, 3);

  const top = topCategoryCounts(
    [
      { exitReason: 'compensation', count: 2 },
      { exitReason: 'burnout', count: 5 },
      { exitReason: 'compensation', count: 1 },
      { exitReason: 'other', count: 1 },
    ],
    { key: 'exitReason', limit: 2 }
  );
  assert.deepEqual(top, [
    { id: 'burnout', value: 5 },
    { id: 'compensation', value: 3 },
  ]);

  const hist = scoreHistogram([10, 25, 50, 75, 90, null, 'x', 100]);
  assert.equal(hist.scored, 6);
  assert.equal(hist.bins.find((b) => b.id === '0-19').value, 1);
  assert.equal(hist.bins.find((b) => b.id === '80-100').value, 2);

  const box = nineBoxOccupancy([
    { nineBoxCell: 5 },
    { nineBoxCell: 5 },
    { nineBoxCell: 9 },
    { nineBoxCell: null },
  ]);
  assert.equal(box.placed, 3);
  assert.equal(box.cells[5], 2);
  assert.equal(box.cells[9], 1);

  const bands = salaryBandTotals([
    { below: 1, inBand: 2, above: 0, headcount: 3, payrollSum: 10.555 },
    { below: 0, inBand: 1, above: 1, headcount: 2, payrollSum: 5 },
  ]);
  assert.equal(bands.below, 1);
  assert.equal(bands.inBand, 3);
  assert.equal(bands.above, 1);
  assert.equal(bands.banded, 5);
  assert.equal(bands.payrollSum, 15.56);

  const cov = successionCoverage([
    { readyCount: 1, developingCount: 0, notReadyCount: 0, successorCount: 1 },
    { readyCount: 0, developingCount: 2, notReadyCount: 0, successorCount: 2 },
    { readyCount: 0, developingCount: 0, notReadyCount: 0, successorCount: 0 },
  ]);
  assert.equal(cov.hasReady, 1);
  assert.equal(cov.developingOnly, 1);
  assert.equal(cov.empty, 1);
  assert.equal(cov.roles, 3);

  const rollup = okrLevelRollup([
    {
      level: 'company',
      keyResults: [
        { currentValue: 50, targetValue: 100 },
        { currentValue: 100, targetValue: 100 },
      ],
    },
    { level: 'team', keyResults: [{ currentValue: 25, targetValue: 100 }] },
    { level: 'person', keyResults: [] },
  ]);
  assert.equal(rollup.length, 2);
  assert.equal(rollup.find((r) => r.id === 'company').avgPct, 75);
  assert.equal(rollup.find((r) => r.id === 'team').avgPct, 25);

  const areas = hrScoreAreaBars(
    [
      { area: 'Eng', avgScore: 60.4, count: 3 },
      { area: 'Sales', avgScore: 80, count: 2 },
      { area: '', avgScore: 90, count: 1 },
    ],
    { limit: 5 }
  );
  assert.equal(areas[0].id, 'Sales');
  assert.equal(areas[0].value, 80);
  assert.equal(areas.length, 2);

  const risk = turnoverRiskDistribution({ low: 10, medium: 3, high: 1 });
  assert.equal(risk.scanned, 14);
  assert.equal(risk.atRisk, 4);

  const funnel = whistleStatusFunnel([
    { status: 'new', count: 2 },
    { status: 'triaging', count: 1 },
    { status: 'closed', count: 4 },
  ]);
  assert.equal(funnel.total, 7);
  assert.equal(funnel.items.find((i) => i.id === 'new').value, 2);
  assert.equal(funnel.items.find((i) => i.id === 'responded').value, 0);

  const pool = vacationPoolTotals({
    entitlementDays: 30,
    adjustmentDays: 0,
    usedDays: 10,
    pendingDays: 5,
  });
  assert.equal(pool.availableDays, 15);
  assert.equal(pool.utilizedDays, 15);

  const roleBars = vacationPoolByAreaBars(
    [
      { id: 'a', label: 'Eng', usedDays: 5, pendingDays: 1, availableDays: 20, headcount: 3 },
      { id: 'b', label: 'Sales', usedDays: 2, pendingDays: 0, availableDays: 10, headcount: 2 },
    ],
    { limit: 5 }
  );
  assert.equal(roleBars[0].id, 'a');
  assert.equal(roleBars[0].value, 6);

  console.log('chart-aggregates.unit.test.js OK');
}

main();
