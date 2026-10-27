/**
 * DTOV proof — LMS B-2713: quiz gate, certificate payload, cohort report.
 * Requires DTOV env (POSTGRES_* from dtov:reset).
 */
import assert from 'node:assert/strict';
import { query, pool } from '../../lib/db.js';
import { EMPLOYMENT_STATUS } from '../../lib/domain-status.js';
import { ERR } from '../../lib/api-error-codes.js';
import {
  completeLmsLesson,
  createLmsCourse,
  createLmsLesson,
  enrollLmsCandidates,
  getLmsCertificatePayload,
  getLmsCohortReport,
  listCandidateLmsCourses,
} from '../../lib/development/lms.js';
import { replaceLessonQuiz, submitLessonQuiz } from '../../lib/development/lms-quiz.js';

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
  assert.ok(emp.rowCount > 0, 'need employee in DTOV seed');
  const person = emp.rows[0];

  const course = await createLmsCourse(query, {
    companyId: person.companyId,
    title: `DTOV Quiz ${Date.now()}`,
    description: 'DTOV quiz course',
    createdByUserId: null,
  });
  assert.equal(course.ok, true, course.errorCode);

  const lesson = await createLmsLesson(query, {
    companyId: person.companyId,
    courseId: course.course.id,
    title: 'Quiz lesson',
    contentUrl: 'https://example.com/lesson',
    contentKind: 'link',
  });
  assert.equal(lesson.ok, true, lesson.errorCode);

  const quiz = await replaceLessonQuiz(query, {
    companyId: person.companyId,
    lessonId: lesson.lesson.id,
    questions: [
      {
        prompt: '2+2?',
        correctChoiceId: 'a',
        choices: [
          { id: 'a', text: '4' },
          { id: 'b', text: '5' },
        ],
      },
      {
        prompt: 'Capital of Brazil?',
        correctChoiceId: 'b',
        choices: [
          { id: 'a', text: 'SP' },
          { id: 'b', text: 'Brasília' },
        ],
      },
      {
        prompt: 'Color of sky (often)?',
        correctChoiceId: 'a',
        choices: [
          { id: 'a', text: 'Blue' },
          { id: 'b', text: 'Green' },
        ],
      },
    ],
  });
  assert.equal(quiz.ok, true, quiz.errorCode);
  assert.equal(quiz.questions.length, 3);

  const enrolled = await enrollLmsCandidates(query, {
    companyId: person.companyId,
    courseId: course.course.id,
    candidateIds: [person.candidateId],
    dueDate: '2099-06-01',
    mandatory: true,
    cohortName: 'DTOV turma A',
  });
  assert.equal(enrolled.ok, true, enrolled.errorCode);

  const blocked = await completeLmsLesson(query, {
    companyId: person.companyId,
    candidateId: person.candidateId,
    lessonId: lesson.lesson.id,
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.errorCode, ERR.LMS_QUIZ_REQUIRED);

  const fail = await submitLessonQuiz(query, {
    companyId: person.companyId,
    candidateId: person.candidateId,
    lessonId: lesson.lesson.id,
    answers: {
      [String(quiz.questions[0].id)]: 'b',
      [String(quiz.questions[1].id)]: 'b',
      [String(quiz.questions[2].id)]: 'a',
    },
  });
  assert.equal(fail.ok, false);
  assert.equal(fail.errorCode, ERR.LMS_QUIZ_FAILED);

  const pass = await submitLessonQuiz(query, {
    companyId: person.companyId,
    candidateId: person.candidateId,
    lessonId: lesson.lesson.id,
    answers: {
      [String(quiz.questions[0].id)]: 'a',
      [String(quiz.questions[1].id)]: 'b',
      [String(quiz.questions[2].id)]: 'a',
    },
  });
  assert.equal(pass.ok, true, pass.errorCode);
  assert.equal(pass.passed, true);

  const marked = await completeLmsLesson(query, {
    companyId: person.companyId,
    candidateId: person.candidateId,
    lessonId: lesson.lesson.id,
  });
  assert.equal(marked.ok, true, marked.errorCode);
  assert.equal(marked.isComplete, true);

  const listed = await listCandidateLmsCourses(query, {
    companyId: person.companyId,
    candidateId: person.candidateId,
  });
  const row = listed.find((c) => c.courseId === course.course.id);
  assert.ok(row);
  assert.equal(row.certificateAvailable, true);
  assert.ok(row.lessons[0].quizPassed);

  const cert = await getLmsCertificatePayload(query, {
    companyId: person.companyId,
    candidateId: person.candidateId,
    enrollmentId: row.enrollmentId,
  });
  assert.equal(cert.ok, true, cert.errorCode);
  assert.ok(cert.certificate?.courseTitle);

  const report = await getLmsCohortReport(query, {
    companyId: person.companyId,
    courseId: course.course.id,
  });
  assert.equal(report.ok, true, report.errorCode);
  assert.ok(Array.isArray(report.items));
  assert.ok(report.items.some((i) => i.name === 'DTOV turma A' && i.completed >= 1));

  console.log('lms-quiz.dtov.test.js OK');
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
