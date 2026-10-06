/**
 * DTOV: B-2804.4 — HR Score recalculation in batch. Trend detection, turnover radar and
 * predictions match the per-person path; query count does not grow with the number of
 * employees; worsening risk still notifies after the single upsert.
 */
import assert from 'node:assert/strict';
import { query } from '../../lib/db.js';
import { recalculateCandidateHrScore, recalculateCompanyScores, saveHrScore } from '../../lib/hr-score.js';
import { calculateAllPredictions, loadRecentOneOnOneNotes, predictionsFromSignals } from '../../lib/hr-predictions.js';
import {
  calculateTurnoverRadar,
  detectTrendChange,
  detectTrendChanges,
  getCompanyTurnoverRisks,
  loadTurnoverRadars,
} from '../../lib/turnover-radar.js';
import { EMPLOYMENT_STATUS } from '../../lib/domain-status.js';
import { NOTIF } from '../../lib/manager-notification-catalog.js';

function countingDb() {
  const db = { count: 0, query: (sql, params) => { db.count += 1; return query(sql, params); } };
  return db;
}

async function main() {
  const co = await query(`SELECT id FROM companies WHERE deleted = FALSE AND slug = 'todos-os-dados-demo' LIMIT 1`);
  assert.ok(co.rowCount, 'demo company missing — run dtov:reset');
  const companyId = Number(co.rows[0].id);
  const emps = await query(
    `SELECT id FROM candidates WHERE company_id = $1 AND employment_status = $2 ORDER BY id LIMIT 40`,
    [companyId, EMPLOYMENT_STATUS.EMPLOYEE]
  );
  assert.ok(emps.rowCount >= 3, 'need employees');
  const ids = emps.rows.map((r) => Number(r.id));
  const startedAt = new Date();
  let noteId = null;

  try {
    const note = await query(
      `INSERT INTO one_on_ones (company_id, candidate_id, notes) VALUES ($1, $2, 'Falar sobre comunicação com o time') RETURNING id`,
      [companyId, ids[0]]
    );
    noteId = note.rows[0].id;

    const first = await recalculateCompanyScores(companyId, { limit: 200 });
    assert.ok(first.results.every((r) => r.ok), JSON.stringify(first.results.filter((r) => !r.ok)));
    const resultIds = first.results.map((r) => Number(r.candidateId));
    assert.deepEqual(resultIds, [...resultIds].sort((a, b) => a - b), 'results keep candidate id order');

    const saved = await query(
      `SELECT candidate_id AS "candidateId", score, signals, turnover_risk AS "turnoverRisk",
              turnover_reasons AS "turnoverReasons", pdi_gap_areas AS "pdiGapAreas"
       FROM hr_scores WHERE candidate_id = ANY($1::bigint[])`,
      [resultIds]
    );
    const savedById = new Map(saved.rows.map((r) => [Number(r.candidateId), r]));
    for (const r of first.results) {
      const row = savedById.get(Number(r.candidateId));
      assert.ok(row, `saved ${r.candidateId}`);
      assert.equal(row.score, r.score, 'single upsert stored the computed score');
      assert.equal(row.turnoverRisk, r.turnoverRisk);
    }

    // Predictions: batch (no queries) = per-person calculateAllPredictions.
    const notes = await loadRecentOneOnOneNotes({ query }, ids);
    assert.ok(notes.get(ids[0])?.some((n) => n.includes('comunicação')), 'notes loaded');
    for (const id of ids) {
      const { signals } = savedById.get(id);
      const single = await calculateAllPredictions(id, signals);
      const batch = predictionsFromSignals(signals, notes.get(id));
      assert.deepEqual(batch, {
        turnover_risk: single.turnover_risk,
        turnover_reasons: single.turnover_reasons,
        turnover_score: single.turnover_score,
        pdi_gap_areas: single.pdi_gap_areas,
      }, `predictions ${id}`);
      assert.deepEqual(savedById.get(id).pdiGapAreas, batch.pdi_gap_areas, `saved gaps ${id}`);
    }
    assert.ok(savedById.get(ids[0]).pdiGapAreas.some((g) => g.area === 'communication'), '1:1 theme reaches saved gaps');

    // Radar + trend: batch = per-person.
    const radars = await loadTurnoverRadars({ query }, companyId, ids);
    const changes = await detectTrendChanges({ query }, companyId, ids);
    for (const id of ids) {
      assert.deepEqual(radars.get(id), await calculateTurnoverRadar(id, companyId), `radar ${id}`);
      assert.deepEqual(changes.get(id), await detectTrendChange(id), `trend ${id}`);
    }
    const list = await getCompanyTurnoverRisks(companyId, { limit: 500, minRisk: 'low' });
    for (const r of list.risks.filter((x) => ids.includes(x.candidateId))) {
      const radar = radars.get(r.candidateId);
      assert.deepEqual([r.riskScore, r.risk, r.signals, r.actions], [radar.riskScore, radar.risk, radar.signals, radar.actions], `company list ${r.candidateId}`);
    }

    // Fixed query count: 3 people cost the same as all of them.
    const few = countingDb();
    await detectTrendChanges(few, companyId, ids.slice(0, 3));
    await loadRecentOneOnOneNotes(few, ids.slice(0, 3));
    const many = countingDb();
    await detectTrendChanges(many, companyId, ids);
    await loadRecentOneOnOneNotes(many, ids);
    assert.equal(many.count, few.count, `queries ${few.count} (3 people) vs ${many.count} (${ids.length})`);
    assert.ok(many.count <= 7, `bounded queries: ${many.count}`);

    // New employee (no saved score) is "new" without a radar, like the per-person path.
    await query(`DELETE FROM hr_scores WHERE candidate_id = $1`, [ids[1]]);
    assert.deepEqual((await detectTrendChanges({ query }, companyId, [ids[1]])).get(ids[1]), await detectTrendChange(ids[1]));
    assert.equal((await detectTrendChanges({ query }, companyId, [ids[1]])).get(ids[1]).trend, 'new');

    // Worsening still notifies after the batch upsert.
    const risky = ids.find((id) => radars.get(id).risk !== 'low');
    if (risky) {
      await query(`UPDATE hr_scores SET turnover_risk = 'low' WHERE candidate_id = $1`, [risky]);
      const second = await recalculateCompanyScores(companyId, { limit: 200 });
      assert.ok(second.turnoverNotified >= 1, 'worsening notified');
      const notif = await query(
        `SELECT 1 FROM manager_notifications WHERE type = $1 AND entity_id = $2 AND dedupe_key LIKE $3 LIMIT 1`,
        [NOTIF.TURNOVER_RISK_CHANGE, risky, `turnover_risk_change:${risky}:low:%`]
      );
      assert.equal(notif.rowCount, 1, 'notification row');

      // Single-person recalculation (both hr-score routes) keeps the same rule.
      await query(`DELETE FROM manager_notifications WHERE type = $1 AND entity_id = $2`, [NOTIF.TURNOVER_RISK_CHANGE, risky]);
      await query(`UPDATE hr_scores SET turnover_risk = 'low' WHERE candidate_id = $1`, [risky]);
      const one = await recalculateCandidateHrScore({ candidateId: risky, companyId });
      assert.equal(typeof one.scoreData.score, 'number');
      const notifOne = await query(
        `SELECT 1 FROM manager_notifications WHERE type = $1 AND entity_id = $2 AND dedupe_key LIKE $3 LIMIT 1`,
        [NOTIF.TURNOVER_RISK_CHANGE, risky, `turnover_risk_change:${risky}:low:%`]
      );
      assert.equal(notifOne.rowCount, 1, 'single recalculation notifies worsening');
    } else {
      console.log('hr-score-batch: no medium/high radar in demo, worsening path skipped');
    }

    // Single-person save still works through the batch upsert.
    const before = savedById.get(ids[2]);
    await saveHrScore(ids[2], companyId, { score: 42, signals: { probe: { score: 42 } } }, { turnover_risk: 'medium', turnover_reasons: ['x'], pdi_gap_areas: [] });
    const after = await query(`SELECT score, turnover_risk AS "turnoverRisk", turnover_reasons AS "turnoverReasons" FROM hr_scores WHERE candidate_id = $1`, [ids[2]]);
    assert.deepEqual(after.rows[0], { score: 42, turnoverRisk: 'medium', turnoverReasons: ['x'] });
    assert.ok(before, 'had a previous row');
  } finally {
    if (noteId) await query(`DELETE FROM one_on_ones WHERE id = $1`, [noteId]);
    await recalculateCompanyScores(companyId, { limit: 200 });
    await query(
      `DELETE FROM manager_notifications WHERE type = $1 AND company_id = $2 AND created_at >= $3`,
      [NOTIF.TURNOVER_RISK_CHANGE, companyId, startedAt]
    );
  }

  console.log('hr-score-batch.dtov.test.js OK');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
