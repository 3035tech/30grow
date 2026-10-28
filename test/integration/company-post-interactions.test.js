/** Explicit local DTOV only. Verifies migration 175 and tenant-safe feed interactions. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dtovEnv, assertDtovTarget } from '../dtov/harness.js';

assert.equal(process.env.POST_INTERACTIONS_TEST, '1', 'Explicit local test opt-in required');
const env = dtovEnv();
assertDtovTarget(env);
Object.assign(process.env, env);

const { pool } = await import('../../lib/db.js');
const { createCompanyPost, listCompanyPosts } = await import('../../lib/company/company-posts.js');
const {
  createPostComment,
  deleteOwnPostComment,
  listPostComments,
  setPostReaction,
} = await import('../../lib/company/company-post-interactions.js');
const { ERR } = await import('../../lib/api-error-codes.js');
const migration = await readFile(new URL('../../migrations/175_company_post_interactions.sql', import.meta.url), 'utf8');

let postId;
try {
  const people = await pool.query(
    `SELECT company_id AS "companyId", array_agg(id ORDER BY id) AS ids
     FROM candidates WHERE employment_status='employee'
     GROUP BY company_id HAVING count(*) >= 2 ORDER BY company_id LIMIT 2`
  );
  assert.equal(people.rowCount, 2, 'DTOV seed needs two companies with employees');
  const [own, foreign] = people.rows;
  const [authorId, otherId] = own.ids;
  const foreignId = foreign.ids[0];
  const created = await createCompanyPost(null, { companyId: own.companyId, title: 'DTOV interactions', bodyHtml: '<p>Original notice</p>' });
  assert.equal(created.ok, true);
  postId = created.post.id;

  const first = await setPostReaction({ companyId: own.companyId, postId, candidateId: authorId, emoji: '👍' });
  assert.equal(first.ok, true);
  assert.equal(first.reactions[0].count, 1);
  const retry = await setPostReaction({ companyId: own.companyId, postId, candidateId: authorId, emoji: '👍' });
  assert.equal(retry.reactions[0].count, 1, 'retry remains one reaction');
  const second = await setPostReaction({ companyId: own.companyId, postId, candidateId: otherId, emoji: '❤️' });
  assert.equal(second.ok, true);
  assert.equal((await setPostReaction({ companyId: foreign.companyId, postId, candidateId: foreignId, emoji: '👍' })).errorCode, ERR.NOT_FOUND);

  const comment = await createPostComment({ companyId: own.companyId, postId, candidateId: authorId, body: 'Primeiro comentário' });
  assert.equal(comment.ok, true);
  assert.equal((await createPostComment({ companyId: foreign.companyId, postId, candidateId: foreignId, body: 'Intrusão' })).errorCode, ERR.NOT_FOUND);
  const listed = await listCompanyPosts(null, { companyId: own.companyId, viewerCandidateId: authorId });
  const notice = listed.posts.find(row => String(row.id) === String(postId));
  assert.equal(notice.bodyHtml, '<p>Original notice</p>');
  assert.equal(notice.commentCount, 1);
  assert.equal(notice.reactions.length, 2);
  assert.equal(notice.reactions.find(row => row.emoji === '👍').mine, true);
  assert.equal((await listCompanyPosts(null, { companyId: foreign.companyId })).posts.some(row => String(row.id) === String(postId)), false);
  const comments = await listPostComments({ companyId: own.companyId, postId, candidateId: authorId });
  assert.equal(comments.comments[0].body, 'Primeiro comentário');
  assert.equal(comments.comments[0].mine, true);
  assert.equal((await deleteOwnPostComment({ companyId: own.companyId, postId, candidateId: otherId, commentId: comment.id })).errorCode, ERR.NOT_FOUND);

  await assert.rejects(
    pool.query('INSERT INTO company_post_reactions(company_id,post_id,candidate_id,emoji) VALUES($1,$2,$3,$4)', [own.companyId, postId, foreignId, '👏']),
    error => error.code === '23503'
  );
  await pool.query(migration);
  await pool.query(migration);
  assert.equal((await listPostComments({ companyId: own.companyId, postId, candidateId: authorId })).comments.length, 1, 'migration replay preserves comments');
  assert.equal((await deleteOwnPostComment({ companyId: own.companyId, postId, candidateId: authorId, commentId: comment.id })).ok, true);
  assert.equal((await listCompanyPosts(null, { companyId: own.companyId })).posts.find(row => String(row.id) === String(postId)).commentCount, 0);
  console.log('company-post-interactions.test.js: ok');
} finally {
  if (postId) await pool.query('DELETE FROM company_posts WHERE id=$1', [postId]);
  await pool.end();
}
