import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ERR } from '../../lib/api-error-codes.js';
import {
  createPostComment,
  loadPostInteractionSummaries,
  setPostReaction,
} from '../../lib/company/company-post-interactions.js';

test('feed summaries group reactions and comments for the requested company and posts', async () => {
  const calls = [];
  const db = { query: async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes('company_post_reactions')) return { rows: [{ postId: '8', emoji: '👍', count: 2, mine: true }] };
    return { rows: [{ postId: '8', count: 3 }, { postId: '9', count: 1 }] };
  } };
  const result = await loadPostInteractionSummaries(db, 4, [8, 9], 12);
  assert.deepEqual(result.get('8'), { reactions: [{ emoji: '👍', count: 2, mine: true }], commentCount: 3 });
  assert.deepEqual(result.get('9'), { reactions: [], commentCount: 1 });
  assert.deepEqual(calls.map(call => call.params.slice(0, 2)), [[4, [8, 9]], [4, [8, 9]]]);
});

test('old feed remains readable before the additive migration', async () => {
  const db = { query: async () => { throw Object.assign(new Error('missing relation'), { code: '42P01' }); } };
  assert.equal((await loadPostInteractionSummaries(db, 4, [8], 12)).size, 0);
});

test('invalid reactions and comments fail before database access', async () => {
  const noDb = () => { throw new Error('database should not be called'); };
  assert.equal((await setPostReaction({ companyId: 1, postId: 2, candidateId: 3, emoji: '🚀' }, noDb)).errorCode, ERR.INVALID_DATA);
  assert.equal((await createPostComment({ companyId: 1, postId: 2, candidateId: 3, body: '   ' }, noDb)).errorCode, ERR.INVALID_DATA);
  assert.equal((await createPostComment({ companyId: 1, postId: 2, candidateId: 3, body: { text: 'oops' } }, noDb)).errorCode, ERR.INVALID_DATA);
  assert.equal((await createPostComment({ companyId: 1, postId: 2, candidateId: 3, body: 'x'.repeat(1001) }, noDb)).errorCode, ERR.INVALID_DATA);
});

test('a post outside the requested company cannot receive a reaction or comment', async () => {
  const calls = [];
  const transaction = async work => work({ query: async (sql, params) => {
    calls.push({ sql, params });
    return { rowCount: 0, rows: [] };
  } });
  assert.equal((await setPostReaction({ companyId: 4, postId: 8, candidateId: 12, emoji: '👍' }, transaction)).errorCode, ERR.NOT_FOUND);
  assert.equal((await createPostComment({ companyId: 4, postId: 8, candidateId: 12, body: 'Olá' }, transaction)).errorCode, ERR.NOT_FOUND);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.sql.includes('company_id=$1') && call.params[0] === 4 && call.params[1] === 8));
});
