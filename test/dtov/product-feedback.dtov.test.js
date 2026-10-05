/**
 * DTOV proof — product feedback create/list/update (super-admin inbox).
 */
import assert from 'node:assert/strict';
import { query, pool } from '../../lib/db.js';
import {
  PRODUCT_FEEDBACK_KIND,
  PRODUCT_FEEDBACK_SEVERITY,
  PRODUCT_FEEDBACK_STATUS,
} from '../../lib/domain-status.js';
import { COMPANY_MODULE } from '../../lib/company-modules.js';
import {
  createProductFeedback,
  listProductFeedback,
  parseProductFeedbackListParams,
  summarizeProductFeedback,
  updateProductFeedback,
} from '../../lib/product-feedback.js';

async function main() {
  const parsed = parseProductFeedbackListParams({
    page: '2',
    pageSize: '10',
    status: 'new',
    kind: 'idea',
    q: 'radar',
  });
  assert.equal(parsed.page, 2);
  assert.equal(parsed.pageSize, 10);
  assert.equal(parsed.status, 'new');
  assert.equal(parsed.kind, 'idea');
  assert.equal(parsed.q, 'radar');

  const hr = await query(
    `SELECT u.id AS "userId", u.company_id AS "companyId"
     FROM users u
     WHERE u.email = 'hr@todos-os-dados.demo' AND u.deleted = FALSE
     LIMIT 1`
  );
  assert.ok(hr.rowCount > 0, 'need demo HR user');
  const { userId, companyId } = hr.rows[0];

  const created = await createProductFeedback({ query }, {
    companyId,
    userId,
    kind: PRODUCT_FEEDBACK_KIND.IDEA,
    message: 'DTOV: gostaria de exportar o radar de turnover em CSV.',
    activeTab: 'overview',
    activeSection: null,
    contactOk: true,
  });
  assert.equal(created.ok, true, created.errorCode);
  assert.ok(created.id);

  const short = await createProductFeedback({ query }, {
    companyId,
    userId,
    kind: PRODUCT_FEEDBACK_KIND.BUG,
    message: 'curto',
  });
  assert.equal(short.ok, false);

  const listed = await listProductFeedback({ query }, {
    status: PRODUCT_FEEDBACK_STATUS.NEW,
    kind: PRODUCT_FEEDBACK_KIND.IDEA,
    q: 'DTOV',
    page: 1,
    pageSize: 20,
  });
  assert.ok(listed.total >= 1);
  assert.ok(listed.items.some((r) => r.id === created.id));

  const updated = await updateProductFeedback({ query }, {
    id: created.id,
    status: PRODUCT_FEEDBACK_STATUS.REVIEWING,
    adminNotes: 'Priorizar no próximo ciclo',
  });
  assert.equal(updated.ok, true);
  assert.equal(updated.item.status, PRODUCT_FEEDBACK_STATUS.REVIEWING);
  assert.ok(updated.item.firstResponseAt, 'triage stamps the first response');

  // MVP-11: severity, module from tab, SLA, duplicates, summary.
  const bug = await createProductFeedback({ query }, {
    companyId,
    userId,
    kind: PRODUCT_FEEDBACK_KIND.BUG,
    severity: PRODUCT_FEEDBACK_SEVERITY.HIGH,
    message: 'DTOV: o botão de publicar vaga não responde no celular.',
    activeTab: 'vacancies',
  });
  assert.equal(bug.ok, true, bug.errorCode);
  assert.ok(bug.responseDueAt);
  const again = await createProductFeedback({ query }, {
    companyId,
    userId,
    kind: PRODUCT_FEEDBACK_KIND.BUG,
    message: 'DTOV: mesmo problema ao publicar vaga pelo celular.',
    activeTab: 'vacancies',
  });
  assert.equal(again.ok, true);

  const badKind = await createProductFeedback({ query }, {
    companyId, userId, kind: 'complaint', message: 'DTOV: tipo inválido de mensagem.',
  });
  assert.equal(badKind.ok, false);

  const dup = await updateProductFeedback({ query }, { id: again.id, duplicateOfId: bug.id });
  assert.equal(dup.ok, true, dup.errorCode);
  assert.equal(Number(dup.item.duplicateOfId), Number(bug.id));
  const self = await updateProductFeedback({ query }, { id: bug.id, duplicateOfId: bug.id });
  assert.equal(self.ok, false);
  const badModule = await updateProductFeedback({ query }, { id: bug.id, moduleKey: 'nope' });
  assert.equal(badModule.ok, false);
  const badAssignee = await updateProductFeedback({ query }, { id: bug.id, assigneeUserId: userId });
  assert.equal(badAssignee.ok, false, 'company HR cannot own support items');

  const filtered = await listProductFeedback({ query }, {
    status: 'open',
    severity: PRODUCT_FEEDBACK_SEVERITY.HIGH,
    module: COMPANY_MODULE.RECRUITING,
    q: 'DTOV',
  });
  const bugRow = filtered.items.find((r) => Number(r.id) === Number(bug.id));
  assert.ok(bugRow, 'filter by severity + module finds the bug');
  assert.equal(bugRow.moduleKey, COMPANY_MODULE.RECRUITING);
  assert.equal(bugRow.duplicateCount, 1);
  assert.equal(bugRow.overdue, false);
  assert.ok(bugRow.dueAt);

  // Backdate one unanswered item past the SLA window.
  await query(`UPDATE product_feedback SET created_at = NOW() - INTERVAL '6 days' WHERE id = $1`, [bug.id]);
  const late = await listProductFeedback({ query }, { overdue: '1', q: 'DTOV' });
  assert.ok(late.items.some((r) => Number(r.id) === Number(bug.id) && r.overdue));

  const summary = await summarizeProductFeedback({ query });
  assert.ok(summary.overdue >= 1);
  assert.ok(summary.awaitingResponse >= 1);
  assert.ok(summary.openByKind.bug >= 1);
  assert.equal(summary.responseBusinessDays, 1);
  assert.ok(summary.topModules.some((m) => m.moduleKey === COMPANY_MODULE.RECRUITING));

  console.log('product-feedback.dtov.test.js OK');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => {});
  });
