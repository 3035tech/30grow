/**
 * DTOV: B-2804.2/3 set-based formal cycle publish and questionnaire swap. The batch publish
 * writes exactly what the per-review path (openFormalReview) writes, for 90/180/360 with
 * self, in a fixed number of queries; failures roll back; the respondent matrix covers the
 * whole cycle; swapping the questionnaire rewrites draft items in order.
 */
import assert from 'node:assert/strict';
import { query, withTransaction } from '../../lib/db.js';
import { EMPLOYMENT_STATUS, FORMAL_REVIEW_MODEL } from '../../lib/domain-status.js';
import { ERR } from '../../lib/api-error-codes.js';
import {
  createCompanyCompetency,
  createFormalReview,
  createFormalReviewCycle,
  listFormalCycleRespondents,
  openFormalReview,
  publishFormalReviewCycle,
  updateFormalReviewCycle,
} from '../../lib/people/formal-competency-reviews.js';

const isoDay = (offset) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

/** Wraps a pg client to count queries. */
function counting(client) {
  const wrapped = { count: 0, query: (...args) => { wrapped.count += 1; return client.query(...args); } };
  return wrapped;
}

async function main() {
  const co = await query(`SELECT id FROM companies WHERE deleted = FALSE AND slug = 'todos-os-dados-demo' LIMIT 1`);
  assert.ok(co.rowCount, 'demo company missing: run dtov:reset');
  const companyId = co.rows[0].id;
  const people = await query(
    `SELECT id, manager_candidate_id AS "managerId" FROM candidates
     WHERE company_id = $1 AND employment_status = '${EMPLOYMENT_STATUS.EMPLOYEE}' ORDER BY id LIMIT 5`,
    [companyId]
  );
  assert.ok(people.rowCount >= 5, 'need 5 employees in the demo company');
  const [manager, s1, s2, s3, orphan] = people.rows.map((p) => Number(p.id));
  const subjects = [s1, s2, s3];
  const originalManagers = people.rows.map((p) => [Number(p.id), p.managerId]);
  const stamp = Date.now();
  const cycleIds = [];
  const competencyIds = [];
  let managerUserId = null;

  const cleanup = async () => {
    if (managerUserId) await query(`DELETE FROM users WHERE id = $1`, [managerUserId]);
    if (cycleIds.length) await query(`DELETE FROM formal_review_cycles WHERE company_id = $1 AND id = ANY($2::bigint[])`, [companyId, cycleIds]);
    if (competencyIds.length) await query(`DELETE FROM company_competencies WHERE company_id = $1 AND id = ANY($2::bigint[])`, [companyId, competencyIds]);
    for (const [id, managerId] of originalManagers) {
      await query(`UPDATE candidates SET manager_candidate_id = $3 WHERE company_id = $1 AND id = $2`, [companyId, id, managerId]);
    }
  };

  try {
    await query(`UPDATE candidates SET manager_candidate_id = $2 WHERE company_id = $1 AND id = ANY($3::bigint[])`, [companyId, manager, subjects]);
    await query(`UPDATE candidates SET manager_candidate_id = NULL WHERE company_id = $1 AND id = $2`, [companyId, orphan]);
    // The manager has an active panel user: the manager rater and review must carry its id.
    const managerUser = await query(
      `INSERT INTO users (company_id, email, password_hash, role, active)
       SELECT company_id, upper(email), 'test', 'hr', TRUE FROM candidates WHERE id = $1
       RETURNING id`,
      [manager]
    );
    managerUserId = Number(managerUser.rows[0].id);
    for (const name of ['Comunicação', 'Entrega']) {
      const r = await createCompanyCompetency({ query }, { companyId, name: `${name} batch ${stamp}`, description: `${name} desc`, selfDescription: `${name} self` });
      assert.equal(r.ok, true, r.errorCode);
      competencyIds.push(Number(r.competency.id));
    }

    const makeCycle = async (model, label, people = subjects) => {
      const c = await createFormalReviewCycle({ query }, {
        companyId, title: `Batch ${label} ${stamp}`, model, includeSelf: true,
        periodStart: isoDay(0), periodEnd: isoDay(30), competencyIds, openQuestions: ['Q1', 'Q2'],
      });
      assert.equal(c.ok, true, c.errorCode);
      cycleIds.push(Number(c.cycle.id));
      for (const sid of people) {
        const r = await createFormalReview({ query }, {
          companyId, cycleId: c.cycle.id, subjectCandidateId: sid,
          externalName: model === FORMAL_REVIEW_MODEL.THREE_SIXTY ? `Externo ${sid}` : '',
          externalEmail: model === FORMAL_REVIEW_MODEL.THREE_SIXTY ? `ext${sid}@example.com` : '',
          externalTitle: model === FORMAL_REVIEW_MODEL.THREE_SIXTY ? 'Cliente' : '',
        });
        assert.equal(r.ok, true, r.errorCode);
      }
      return Number(c.cycle.id);
    };

    const snapshot = async (cycleId) => {
      const cycle = await query(`SELECT status FROM formal_review_cycles WHERE id = $1`, [cycleId]);
      const rows = await query(
        `SELECT r.subject_candidate_id AS subject, r.status, r.manager_user_id AS "managerUserId",
                COALESCE(json_agg(json_build_object(
                  'role', rr.role, 'userId', rr.user_id, 'candidateId', rr.candidate_id,
                  'name', rr.external_name, 'email', rr.external_email, 'title', rr.external_title,
                  'hasToken', rr.token IS NOT NULL, 'expires', rr.token_expires_at, 'status', rr.status
                ) ORDER BY rr.role) FILTER (WHERE rr.id IS NOT NULL), '[]') AS raters
         FROM formal_reviews r LEFT JOIN formal_review_raters rr ON rr.review_id = r.id
         WHERE r.cycle_id = $1 GROUP BY r.id ORDER BY r.subject_candidate_id`,
        [cycleId]
      );
      return { status: cycle.rows[0].status, reviews: rows.rows.map((r) => ({ ...r, managerUserId: r.managerUserId ? Number(r.managerUserId) : null })) };
    };

    for (const model of [FORMAL_REVIEW_MODEL.NINETY, FORMAL_REVIEW_MODEL.ONE_EIGHTY, FORMAL_REVIEW_MODEL.THREE_SIXTY]) {
      const legacyId = await makeCycle(model, `legacy-${model}`);
      const batchId = await makeCycle(model, `batch-${model}`);

      await withTransaction(async (db) => {
        const ids = (await db.query(`SELECT id FROM formal_reviews WHERE cycle_id = $1 ORDER BY id`, [legacyId])).rows;
        for (const { id } of ids) {
          const r = await openFormalReview(db, { companyId, reviewId: id, managerUserId: null });
          assert.equal(r.ok, true, r.errorCode);
        }
      });

      const matrix = await listFormalCycleRespondents(query, { companyId, cycleId: batchId });
      assert.equal(matrix.ok, true);
      assert.equal(matrix.total, subjects.length);
      assert.equal(matrix.model, model);
      assert.equal(matrix.items.length, subjects.length);
      if (model === FORMAL_REVIEW_MODEL.THREE_SIXTY) assert.ok(matrix.items.every((i) => i.externalName?.startsWith('Externo')));

      let queries = 0;
      const published = await withTransaction(async (client) => {
        const db = counting(client);
        const r = await publishFormalReviewCycle(db, { companyId, cycleId: batchId });
        queries = db.count;
        return r;
      });
      assert.equal(published.ok, true, published.errorCode);
      assert.equal(published.count, subjects.length);
      assert.equal(queries, 6, `${model}: fixed query count regardless of people`);

      const legacy = await snapshot(legacyId);
      const batch = await snapshot(batchId);
      assert.equal(batch.status, 'open');
      assert.deepEqual(batch, legacy, `${model}: batch publish = per-review publish`);
      const expectedRoles = { [FORMAL_REVIEW_MODEL.NINETY]: 2, [FORMAL_REVIEW_MODEL.ONE_EIGHTY]: 3, [FORMAL_REVIEW_MODEL.THREE_SIXTY]: 4 }[model];
      assert.ok(batch.reviews.every((r) => r.raters.length === expectedRoles && r.status === 'collecting'));
      assert.ok(batch.reviews.every((r) => r.managerUserId === managerUserId), 'manager user resolved by e-mail');

      const again = await withTransaction((db) => publishFormalReviewCycle(db, { companyId, cycleId: batchId }));
      assert.equal(again.errorCode, ERR.INVALID_STATUS, 'published cycle cannot publish twice');
    }

    // A review without manager fails the whole publish and nothing is written.
    const badId = await makeCycle(FORMAL_REVIEW_MODEL.NINETY, 'bad', [s1, orphan]);
    const bad = await withTransaction(async (db) => {
      const r = await publishFormalReviewCycle(db, { companyId, cycleId: badId });
      if (!r.ok) {
        const e = new Error('rollback');
        e.result = r;
        throw e;
      }
      return r;
    }).catch((e) => e.result);
    assert.equal(bad?.errorCode, ERR.INVALID_DATA);
    const untouched = await snapshot(badId);
    assert.equal(untouched.status, 'draft');
    assert.ok(untouched.reviews.every((r) => r.status === 'draft' && r.raters.length === 0), 'rolled back');

    // Questionnaire swap rewrites every draft review in the new order, in one insert.
    const draftId = await makeCycle(FORMAL_REVIEW_MODEL.NINETY, 'swap');
    const reversed = [...competencyIds].reverse().map((id) => ({ competencyId: id }));
    const swapped = await withTransaction((db) => updateFormalReviewCycle(db, {
      companyId, cycleId: draftId, questionnaire: reversed, openQuestions: ['B', 'A', 'C'],
    }));
    assert.equal(swapped.ok, true, swapped.errorCode);
    assert.deepEqual(swapped.cycle.openQuestions.map((q) => q.prompt), ['B', 'A', 'C']);
    assert.deepEqual(swapped.cycle.questionnaire.map((q) => Number(q.competencyId)), [...competencyIds].reverse());
    const items = await query(
      `SELECT r.subject_candidate_id AS subject, array_agg(i.competency_id ORDER BY i.sort_order) AS comps,
              array_agg(i.sort_order ORDER BY i.sort_order) AS orders
       FROM formal_reviews r JOIN formal_review_items i ON i.review_id = r.id
       WHERE r.cycle_id = $1 GROUP BY r.subject_candidate_id`,
      [draftId]
    );
    assert.equal(items.rowCount, subjects.length);
    for (const row of items.rows) {
      assert.deepEqual(row.comps.map(Number), [...competencyIds].reverse());
      assert.deepEqual(row.orders, [0, 1]);
    }
    const qc = await query(`SELECT competency_id, sort_order FROM formal_cycle_competencies WHERE cycle_id = $1 ORDER BY sort_order`, [draftId]);
    assert.deepEqual(qc.rows.map((r) => Number(r.competency_id)), [...competencyIds].reverse());
  } finally {
    await cleanup();
  }
  console.log('formal-cycle-publish-batch.dtov.test.js OK');
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
