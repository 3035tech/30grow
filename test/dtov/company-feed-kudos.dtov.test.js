/**
 * DTOV — company feed posts + peer kudos (B-2712 / B-2716).
 */
import assert from 'node:assert/strict';
import { query } from '../../lib/db.js';
import { createCompanyPost, listCompanyPosts, softDeleteCompanyPost, updateCompanyPost } from '../../lib/company/company-posts.js';
import {
  createCompanyKudo,
  listCompanyKudos,
  searchEmployeeColleagues,
  countRecentCompanyKudos,
} from '../../lib/company/company-kudos.js';
import { EMPLOYMENT_STATUS } from '../../lib/domain-status.js';

async function main() {
  const co = await query(
    `SELECT c.company_id AS id, COUNT(*)::int AS n
     FROM candidates c
     JOIN companies co ON co.id = c.company_id AND co.deleted = FALSE
     WHERE c.employment_status = '${EMPLOYMENT_STATUS.EMPLOYEE}'
     GROUP BY c.company_id
     HAVING COUNT(*) >= 2
     ORDER BY n DESC
     LIMIT 1`
  );
  assert.ok(co.rowCount > 0, 'need company with 2+ employees');
  const companyId = co.rows[0].id;

  const emps = await query(
    `SELECT id FROM candidates
     WHERE company_id = $1 AND employment_status = '${EMPLOYMENT_STATUS.EMPLOYEE}'
     ORDER BY id ASC LIMIT 2`,
    [companyId]
  );
  assert.ok(emps.rowCount >= 2, 'need 2 employees');
  const [a, b] = emps.rows.map((r) => r.id);

  const post = await createCompanyPost(null, {
    companyId,
    title: 'DTOV mural',
    bodyHtml: '<p>Olá time</p>',
    createdByUserId: null,
  });
  assert.equal(post.ok, true, post.errorCode);
  const listed = await listCompanyPosts(null, { companyId, page: 1, pageSize: 10 });
  assert.ok(listed.posts.some((p) => p.id === post.post.id));
  const searched = await listCompanyPosts(null, { companyId, page: 1, pageSize: 10, q: 'DTOV mural' });
  assert.ok(searched.posts.some((p) => p.id === post.post.id));
  const miss = await listCompanyPosts(null, { companyId, page: 1, pageSize: 10, q: 'zzz-no-match-xyz' });
  assert.ok(!miss.posts.some((p) => p.id === post.post.id));

  const peers = await searchEmployeeColleagues(null, {
    companyId,
    excludeCandidateId: a,
    q: '',
  });
  assert.equal(peers.ok, true);
  assert.ok(peers.people.some((p) => p.id === b));

  const kudo = await createCompanyKudo(null, {
    companyId,
    fromCandidateId: a,
    toCandidateId: b,
    message: 'Ótimo trabalho no DTOV',
  });
  assert.equal(kudo.ok, true, kudo.errorCode);
  const self = await createCompanyKudo(null, {
    companyId,
    fromCandidateId: a,
    toCandidateId: a,
    message: 'self',
  });
  assert.equal(self.ok, false);

  const kudos = await listCompanyKudos(null, { companyId, page: 1, pageSize: 20 });
  assert.ok(kudos.kudos.some((k) => k.id === kudo.kudo.id));
  const n = await countRecentCompanyKudos(null, { companyId, days: 7 });
  assert.ok(n >= 1);

  for (const bodyHtml of [undefined, null, '', '<p></p>']) {
    const titleOnly = await createCompanyPost(null, { companyId, title: 'DTOV só título', bodyHtml, createdByUserId: null });
    assert.equal(titleOnly.ok, true, `create with bodyHtml=${JSON.stringify(bodyHtml)}`);
    assert.equal(typeof titleOnly.post.bodyHtml, 'string');
    await softDeleteCompanyPost(null, { companyId, postId: titleOnly.post.id });
  }
  const cleared = await updateCompanyPost(null, { companyId, postId: post.post.id, title: 'DTOV mural', bodyHtml: null });
  assert.equal(cleared.ok, true, cleared.errorCode);
  assert.equal(cleared.post.bodyHtml, '');

  const del = await softDeleteCompanyPost(null, { companyId, postId: post.post.id });
  assert.equal(del.ok, true);

  console.log('company-feed-kudos.dtov.test.js: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
