/**
 * DTOV proof — LMS B-2717 watch progress upsert + list resume fields.
 */
import assert from 'node:assert/strict';
import { query, pool } from '../../lib/db.js';
import { EMPLOYMENT_STATUS } from '../../lib/domain-status.js';
import {
  createLmsCourse,
  createLmsLesson,
  enrollLmsCandidates,
  listCandidateLmsCourses,
  updateLmsCourse,
  upsertLmsWatchProgress,
} from '../../lib/development/lms.js';
import { ERR } from '../../lib/api-error-codes.js';

async function main() {
  const emp = await query(
    `SELECT c.id AS "candidateId", c.company_id AS "companyId"
     FROM candidates c
     JOIN companies co ON co.id = c.company_id AND co.deleted = FALSE
     WHERE c.employment_status = $1
     ORDER BY c.id ASC
     LIMIT 1`,
    [EMPLOYMENT_STATUS.EMPLOYEE]
  );
  assert.ok(emp.rowCount > 0);
  const person = emp.rows[0];

  const course = await createLmsCourse(query, {
    companyId: person.companyId,
    title: `DTOV Watch ${Date.now()}`,
    description: 'watch progress',
  });
  assert.equal(course.ok, true, course.errorCode);

  const updatedWithoutDescription = await updateLmsCourse(query, {
    companyId: person.companyId,
    courseId: course.course.id,
    title: course.course.title,
    description: null,
  });
  assert.equal(updatedWithoutDescription.ok, true, updatedWithoutDescription.errorCode);
  assert.equal(updatedWithoutDescription.course.description, '');

  const lesson = await createLmsLesson(query, {
    companyId: person.companyId,
    courseId: course.course.id,
    title: 'YT lesson',
    description: 'Watch the introduction before answering the quiz.',
    contentUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    contentKind: 'youtube',
  });
  assert.equal(lesson.ok, true, lesson.errorCode);
  assert.equal(lesson.lesson.description, 'Watch the introduction before answering the quiz.');

  const pdf = await createLmsLesson(query, {
    companyId: person.companyId,
    courseId: course.course.id,
    title: 'PDF lesson',
    contentUrl: 'https://example.com/doc.pdf',
    contentKind: 'pdf',
  });
  assert.equal(pdf.ok, true, pdf.errorCode);

  const enrolled = await enrollLmsCandidates(query, {
    companyId: person.companyId,
    courseId: course.course.id,
    candidateIds: [person.candidateId],
  });
  assert.equal(enrolled.ok, true, enrolled.errorCode);

  const bad = await upsertLmsWatchProgress(query, {
    companyId: person.companyId,
    candidateId: person.candidateId,
    lessonId: pdf.lesson.id,
    positionSec: 10,
    durationSec: 100,
  });
  assert.equal(bad.ok, false);
  assert.equal(bad.errorCode, ERR.INVALID_ACTION);

  const saved = await upsertLmsWatchProgress(query, {
    companyId: person.companyId,
    candidateId: person.candidateId,
    lessonId: lesson.lesson.id,
    positionSec: 95,
    durationSec: 212,
  });
  assert.equal(saved.ok, true, saved.errorCode);
  assert.equal(saved.positionSec, 95);

  const again = await upsertLmsWatchProgress(query, {
    companyId: person.companyId,
    candidateId: person.candidateId,
    lessonId: lesson.lesson.id,
    positionSec: 120,
    durationSec: 212,
  });
  assert.equal(again.ok, true);
  assert.equal(again.positionSec, 120);

  const listed = await listCandidateLmsCourses(query, {
    companyId: person.companyId,
    candidateId: person.candidateId,
  });
  const row = listed.find((c) => c.courseId === course.course.id);
  assert.ok(row);
  const yt = row.lessons.find((l) => l.id === lesson.lesson.id);
  assert.equal(yt.description, 'Watch the introduction before answering the quiz.');
  assert.equal(yt.watchPositionSec, 120);
  assert.equal(yt.watchDurationSec, 212);
  assert.ok(yt.videoId);

  console.log('lms-watch.dtov.test.js OK');
  await pool.end().catch(() => {});
}

main().catch(async (err) => {
  console.error(err);
  try {
    await pool.end();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
