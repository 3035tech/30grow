/**
 * Offline unit: performance hot-path constants / return shapes (no DB).
 */
import assert from 'node:assert/strict';
import { COMPAT_PAIR_PAYLOAD_CAP, buildCompatBundles } from '../../lib/compat-bundles.js';
import { JOB_ROLES_LIST_CAP } from '../../lib/recruiting/job-roles.js';
import { LEADERSHIP_SCORES_SAMPLE_CAP, LEADERSHIP_POTENTIALS_SCAN_CAP } from '../../lib/analytics/leadership-analytics.js';
import {
  measureAsync,
  slowThresholdMs,
  resetMetrics,
  getMetricsSnapshot,
} from '../../lib/monitoring.js';

assert.ok(COMPAT_PAIR_PAYLOAD_CAP <= 150);
assert.equal(JOB_ROLES_LIST_CAP, 500);
assert.ok(LEADERSHIP_SCORES_SAMPLE_CAP <= 1000);
assert.ok(LEADERSHIP_POTENTIALS_SCAN_CAP <= 800);
assert.ok(slowThresholdMs() >= 50);

resetMetrics();
const timed = await measureAsync('test.perfHotpaths', async () => 42);
assert.equal(timed, 42);
const snap = getMetricsSnapshot();
assert.ok(snap.dbQueries['op:test.perfHotpaths'] >= 1);

const people = [];
for (let i = 1; i <= 30; i += 1) {
  people.push({
    assessmentId: i,
    candidateId: i,
    name: `P${i}`,
    topType: ((i - 1) % 9) + 1,
    areaLabel: 'Eng',
  });
}
const bundles = buildCompatBundles(people, 'pt-BR', { peopleCap: 30, includePairs: true });
assert.ok(Array.isArray(bundles.pairs));
assert.ok(bundles.pairs.length <= COMPAT_PAIR_PAYLOAD_CAP);
assert.ok(bundles.pairTotals);
assert.equal(typeof bundles.pairsPayloadCapped, 'boolean');

console.log('ok · perf-hotpaths');
