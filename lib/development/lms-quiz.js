/**
 * B-2713 — Light LMS quiz (1–5 MC questions per lesson). Not SCORM.
 */

import { asDb } from '../ae/as-db.js';
import { ERR } from '../api-error-codes.js';
import { query } from '../db.js';

export const LMS_QUIZ_MAX_QUESTIONS = 5;
export const LMS_QUIZ_MAX_CHOICES = 4;

function dbApi(dbOrQuery) {
  return asDb(dbOrQuery || query);
}

function clipPrompt(s) {
  return String(s || '').trim().slice(0, 500);
}

function normalizeChoices(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const out = [];
  for (let i = 0; i < Math.min(LMS_QUIZ_MAX_CHOICES, list.length); i += 1) {
    const item = list[i] || {};
    const id = String(item.id || String.fromCharCode(97 + i)).trim().slice(0, 40);
    const text = String(item.text || '').trim().slice(0, 200);
    if (!id || !text) continue;
    out.push({ id, text });
  }
  return out;
}

function mapQuestion(row, { includeAnswer = false } = {}) {
  const choices = Array.isArray(row.choices) ? row.choices : [];
  const base = {
    id: Number(row.id),
    lessonId: Number(row.lessonId),
    prompt: row.prompt || '',
    choices: choices.map((c) => ({
      id: String(c.id),
      text: String(c.text || ''),
    })),
    sortOrder: Number(row.sortOrder) || 0,
  };
  if (includeAnswer) {
    base.correctChoiceId = String(row.correctChoiceId || '');
  }
  return base;
}

export async function countQuizQuestionsForLessons(dbOrQuery, { companyId, lessonIds }) {
  const db = dbApi(dbOrQuery);
  const cid = Number(companyId);
  const ids = (lessonIds || []).map(Number).filter((n) => Number.isFinite(n) && n > 0);
  if (!Number.isFinite(cid) || !ids.length) return new Map();
  const r = await db.query(
    `SELECT lesson_id AS "lessonId", COUNT(*)::int AS n
     FROM lms_lesson_quiz_questions
     WHERE company_id = $1 AND lesson_id = ANY($2::bigint[])
     GROUP BY lesson_id`,
    [cid, ids]
  );
  return new Map((r.rows || []).map((row) => [Number(row.lessonId), Number(row.n) || 0]));
}

export async function listPassedQuizLessonIds(dbOrQuery, { companyId, enrollmentIds }) {
  const db = dbApi(dbOrQuery);
  const cid = Number(companyId);
  const ids = (enrollmentIds || []).map(Number).filter((n) => Number.isFinite(n) && n > 0);
  if (!Number.isFinite(cid) || !ids.length) return new Set();
  const r = await db.query(
    `SELECT enrollment_id AS "enrollmentId", lesson_id AS "lessonId"
     FROM lms_lesson_quiz_attempts
     WHERE company_id = $1 AND enrollment_id = ANY($2::bigint[]) AND passed = TRUE`,
    [cid, ids]
  );
  return new Set((r.rows || []).map((row) => `${row.enrollmentId}:${row.lessonId}`));
}

export async function getLessonQuiz(dbOrQuery, { companyId, lessonId, includeAnswer = false }) {
  const db = dbApi(dbOrQuery);
  const cid = Number(companyId);
  const lid = Number(lessonId);
  if (!Number.isFinite(cid) || !Number.isFinite(lid)) {
    return { ok: false, errorCode: ERR.INVALID_DATA };
  }
  const lesson = await db.query(
    `SELECT id FROM lms_lessons WHERE id = $1 AND company_id = $2 AND active = TRUE LIMIT 1`,
    [lid, cid]
  );
  if (lesson.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND };

  const r = await db.query(
    `SELECT id, lesson_id AS "lessonId", prompt, choices, correct_choice_id AS "correctChoiceId",
            sort_order AS "sortOrder"
     FROM lms_lesson_quiz_questions
     WHERE company_id = $1 AND lesson_id = $2
     ORDER BY sort_order ASC, id ASC
     LIMIT ${LMS_QUIZ_MAX_QUESTIONS}`,
    [cid, lid]
  );
  return {
    ok: true,
    questions: (r.rows || []).map((row) => mapQuestion(row, { includeAnswer })),
  };
}

/**
 * Replace quiz for a lesson (0–5 questions). Empty clears.
 */
export async function replaceLessonQuiz(dbOrQuery, { companyId, lessonId, questions }) {
  const db = dbApi(dbOrQuery);
  const cid = Number(companyId);
  const lid = Number(lessonId);
  if (!Number.isFinite(cid) || !Number.isFinite(lid)) {
    return { ok: false, errorCode: ERR.INVALID_DATA };
  }
  const lesson = await db.query(
    `SELECT id FROM lms_lessons WHERE id = $1 AND company_id = $2 LIMIT 1`,
    [lid, cid]
  );
  if (lesson.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND };

  const incoming = Array.isArray(questions) ? questions.slice(0, LMS_QUIZ_MAX_QUESTIONS) : [];
  const normalized = [];
  for (let i = 0; i < incoming.length; i += 1) {
    const q = incoming[i] || {};
    const prompt = clipPrompt(q.prompt);
    const choices = normalizeChoices(q.choices);
    const correct = String(q.correctChoiceId || '').trim().slice(0, 40);
    if (!prompt || choices.length < 2) {
      return { ok: false, errorCode: ERR.LMS_QUIZ_INVALID };
    }
    if (!choices.some((c) => c.id === correct)) {
      return { ok: false, errorCode: ERR.LMS_QUIZ_INVALID };
    }
    normalized.push({
      prompt,
      choices: JSON.stringify(choices),
      correctChoiceId: correct,
      sortOrder: i,
    });
  }

  await db.query(`DELETE FROM lms_lesson_quiz_questions WHERE company_id = $1 AND lesson_id = $2`, [
    cid,
    lid,
  ]);
  for (const q of normalized) {
    await db.query(
      `INSERT INTO lms_lesson_quiz_questions (
         company_id, lesson_id, prompt, choices, correct_choice_id, sort_order
       ) VALUES ($1,$2,$3,$4::jsonb,$5,$6)`,
      [cid, lid, q.prompt, q.choices, q.correctChoiceId, q.sortOrder]
    );
  }
  return getLessonQuiz(db, { companyId: cid, lessonId: lid, includeAnswer: true });
}

export async function hasPassedLessonQuiz(dbOrQuery, { companyId, enrollmentId, lessonId }) {
  const db = dbApi(dbOrQuery);
  const r = await db.query(
    `SELECT 1 FROM lms_lesson_quiz_attempts
     WHERE company_id = $1 AND enrollment_id = $2 AND lesson_id = $3 AND passed = TRUE
     LIMIT 1`,
    [companyId, enrollmentId, lessonId]
  );
  return r.rowCount > 0;
}

/**
 * Submit answers { [questionId]: choiceId }. Pass = all correct.
 */
export async function submitLessonQuiz(dbOrQuery, {
  companyId,
  candidateId,
  lessonId,
  answers = {},
}) {
  const db = dbApi(dbOrQuery);
  const cid = Number(companyId);
  const cand = Number(candidateId);
  const lid = Number(lessonId);
  if (![cid, cand, lid].every((n) => Number.isFinite(n) && n > 0)) {
    return { ok: false, errorCode: ERR.INVALID_DATA };
  }

  const lesson = await db.query(
    `SELECT l.id, l.course_id AS "courseId"
     FROM lms_lessons l
     JOIN lms_courses c ON c.id = l.course_id AND c.company_id = l.company_id
     WHERE l.id = $1 AND l.company_id = $2 AND l.active = TRUE AND c.active = TRUE
     LIMIT 1`,
    [lid, cid]
  );
  if (lesson.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND };
  const courseId = lesson.rows[0].courseId;

  const enr = await db.query(
    `SELECT id FROM lms_enrollments
     WHERE company_id = $1 AND course_id = $2 AND candidate_id = $3
     LIMIT 1`,
    [cid, courseId, cand]
  );
  if (enr.rowCount === 0) return { ok: false, errorCode: ERR.UNAUTHORIZED };
  const enrollmentId = enr.rows[0].id;

  const quiz = await getLessonQuiz(db, { companyId: cid, lessonId: lid, includeAnswer: true });
  if (!quiz.ok) return quiz;
  if (!quiz.questions.length) {
    return { ok: false, errorCode: ERR.LMS_QUIZ_INVALID };
  }

  if (await hasPassedLessonQuiz(db, { companyId: cid, enrollmentId, lessonId: lid })) {
    return {
      ok: true,
      passed: true,
      alreadyPassed: true,
      correctCount: quiz.questions.length,
      totalCount: quiz.questions.length,
      enrollmentId,
      lessonId: lid,
      courseId,
    };
  }

  let correctCount = 0;
  const stored = {};
  for (const q of quiz.questions) {
    const picked = String(answers[String(q.id)] ?? answers[q.id] ?? '').trim();
    stored[String(q.id)] = picked;
    if (picked && picked === q.correctChoiceId) correctCount += 1;
  }
  const totalCount = quiz.questions.length;
  const passed = correctCount === totalCount;

  await db.query(
    `INSERT INTO lms_lesson_quiz_attempts (
       company_id, enrollment_id, lesson_id, answers, correct_count, total_count, passed
     ) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7)`,
    [cid, enrollmentId, lid, JSON.stringify(stored), correctCount, totalCount, passed]
  );

  if (!passed) {
    return {
      ok: false,
      errorCode: ERR.LMS_QUIZ_FAILED,
      correctCount,
      totalCount,
      passed: false,
      enrollmentId,
      lessonId: lid,
      courseId,
    };
  }

  return {
    ok: true,
    passed: true,
    correctCount,
    totalCount,
    enrollmentId,
    lessonId: lid,
    courseId,
  };
}
