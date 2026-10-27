/**
 * Unit smoke for LMS helpers (no DB).
 */
import assert from 'node:assert/strict';
import {
  inferLmsContentKind,
  lmsDueDaysLeft,
  lmsEmbedUrl,
  lmsPdfCanEmbed,
  lmsYoutubeVideoId,
  lmsVimeoVideoId,
} from '../../lib/development/lms.js';
import { LMS_QUIZ_MAX_QUESTIONS } from '../../lib/development/lms-quiz.js';

assert.equal(inferLmsContentKind('https://youtu.be/abc'), 'youtube');
assert.equal(inferLmsContentKind('https://vimeo.com/1'), 'vimeo');
assert.equal(inferLmsContentKind('https://cdn.example.com/a.pdf'), 'pdf');
assert.equal(inferLmsContentKind('https://docs.example.com/guide'), 'link');

assert.equal(lmsYoutubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
assert.equal(lmsVimeoVideoId('https://vimeo.com/123456789'), '123456789');
assert.ok(lmsEmbedUrl('https://youtu.be/dQw4w9WgXcQ', 'youtube').includes('enablejsapi=1'));
assert.equal(lmsEmbedUrl('/demo/lms-guide.pdf', 'pdf'), '/demo/lms-guide.pdf');
assert.equal(lmsPdfCanEmbed('/demo/lms-guide.pdf', 'https://team.3035service.com'), true);
assert.equal(
  lmsPdfCanEmbed('https://example.com/demo-lms-guide.pdf', 'https://team.3035service.com'),
  false
);
assert.equal(
  lmsPdfCanEmbed('https://team.3035service.com/files/a.pdf', 'https://team.3035service.com'),
  true
);

assert.equal(LMS_QUIZ_MAX_QUESTIONS, 5);

const today = new Date('2026-08-30T12:00:00');
assert.equal(lmsDueDaysLeft('2026-08-30', { today }), 0);
assert.equal(lmsDueDaysLeft('2026-08-31', { today }), 1);
assert.equal(lmsDueDaysLeft('2026-08-29', { today }), -1);
assert.equal(lmsDueDaysLeft('2026-08-30', { completed: true, today }), null);
assert.equal(lmsDueDaysLeft(null, { today }), null);

console.log('lms-basic.test.js OK');
process.exit(0);
