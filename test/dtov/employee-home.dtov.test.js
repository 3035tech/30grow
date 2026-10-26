/**
 * DTOV proof — password invite + login + employee home (PDI/LMS).
 * Requires DTOV env (POSTGRES_* from dtov:reset).
 */
import assert from 'node:assert/strict';
import { query, pool } from '../../lib/db.js';
import { closeRateLimitRedis } from '../../lib/rate-limit.js';
import { EMPLOYMENT_STATUS, DEVELOPMENT_PLAN_ITEM_STATUS, DEVELOPMENT_PLAN_STATUS } from '../../lib/domain-status.js';
import {
  completeEmployeePasswordSetup,
  consumeEmployeeMagicToken,
  findEmployeesByEmail,
  generateEmployeeMagicToken,
  issueEmployeePasswordInvite,
  loginEmployeeWithPassword,
  peekEmployeePasswordSetupToken,
  signEmployeeToken,
  verifyEmployeeToken,
} from '../../lib/employee/employee-auth.js';
import { dismissEmployeeWelcome, getEmployeeHome } from '../../lib/employee/employee-home.js';
import {
  employeeAckOnboardingItem,
  getEmployeeOnboardingJourney,
} from '../../lib/people/employee-onboarding-journey.js';
import { setPreOnboardingMeetUrl } from '../../lib/people/pre-onboarding.js';
import { updateEmployeePdiItemStatus } from '../../lib/employee/employee-pdi.js';
import {
  EMPLOYEE_NOTIF,
  notifyCandidate,
  listCandidateNotifications,
} from '../../lib/employee/employee-notifications.js';
import {
  addDevelopmentPlanItem,
  createDevelopmentPlan,
} from '../../lib/people/development-plans.js';
import {
  completeLmsLesson,
  createLmsCourse,
  createLmsLesson,
  enrollLmsCandidates,
  lmsEmbedUrl,
} from '../../lib/lms.js';

async function main() {
  const emp = await query(
    `SELECT c.id AS "candidateId", c.company_id AS "companyId", c.email, c.full_name AS "fullName"
     FROM candidates c
     JOIN companies co ON co.id = c.company_id AND co.deleted = FALSE
     WHERE c.employment_status = $1
       AND c.email IS NOT NULL AND TRIM(c.email) <> ''
     ORDER BY c.id ASC
     LIMIT 1`,
    [EMPLOYMENT_STATUS.EMPLOYEE]
  );
  assert.ok(emp.rowCount > 0, 'need at least one employee in DTOV seed');
  const person = emp.rows[0];

  const invited = await issueEmployeePasswordInvite(query, {
    candidateId: person.candidateId,
    companyId: person.companyId,
    requireMail: false,
    returnUrl: true,
  });
  assert.equal(invited.ok, true, invited.errorCode);
  assert.ok(invited.setupUrl?.includes('/employee/set-password'));

  const tokRow = await query(
    `SELECT password_setup_token AS token FROM candidates WHERE id = $1 AND company_id = $2`,
    [person.candidateId, person.companyId]
  );
  const setupToken = tokRow.rows[0].token;
  assert.ok(setupToken);

  const peek = await peekEmployeePasswordSetupToken(query, setupToken);
  assert.equal(peek.ok, true);

  const completed = await completeEmployeePasswordSetup(query, {
    token: setupToken,
    password: 'ColabTest!2026',
  });
  assert.equal(completed.ok, true, completed.errorCode);
  assert.ok(Number(completed.sessionVersion) >= 1);

  const login = await loginEmployeeWithPassword(query, {
    email: person.email,
    password: 'ColabTest!2026',
    companyId: person.companyId,
  });
  assert.equal(login.ok, true, login.errorCode);
  assert.equal(login.candidateId, person.candidateId);

  const bad = await loginEmployeeWithPassword(query, {
    email: person.email,
    password: 'wrong-password',
    companyId: person.companyId,
  });
  assert.equal(bad.ok, false);

  // Multi-company pick: clone employee into another company with same password
  const otherCo = await query(
    `SELECT id FROM companies WHERE deleted = FALSE AND id <> $1 ORDER BY id ASC LIMIT 1`,
    [person.companyId]
  );
  if (otherCo.rowCount) {
    const otherCompanyId = Number(otherCo.rows[0].id);
    const hashRow = await query(
      `SELECT password_hash AS "passwordHash" FROM candidates WHERE id = $1 AND company_id = $2 LIMIT 1`,
      [person.candidateId, person.companyId]
    );
    const pwdHash = hashRow.rows[0]?.passwordHash;
    assert.ok(pwdHash, 'password hash for pick test');

    let cloneId = null;
    const existing = await query(
      `SELECT id FROM candidates
       WHERE company_id = $1 AND LOWER(TRIM(email)) = LOWER(TRIM($2))
         AND employment_status = $3
       LIMIT 1`,
      [otherCompanyId, person.email, EMPLOYMENT_STATUS.EMPLOYEE]
    );
    if (existing.rowCount) {
      cloneId = existing.rows[0].id;
      await query(`UPDATE candidates SET password_hash = $3 WHERE id = $1 AND company_id = $2`, [
        cloneId,
        otherCompanyId,
        pwdHash,
      ]);
    } else {
      const clone = await query(
        `INSERT INTO candidates (
           company_id, full_name, email, employment_status, password_hash
         ) VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [
          otherCompanyId,
          `${person.fullName || 'Clone'} (DTOV)`,
          person.email,
          EMPLOYMENT_STATUS.EMPLOYEE,
          pwdHash,
        ]
      );
      cloneId = clone.rows[0]?.id;
    }

    if (cloneId) {
      const choices = await findEmployeesByEmail(query, { email: person.email });
      assert.ok(choices.some((item) => Number(item.companyId) === Number(person.companyId)));
      assert.ok(choices.some((item) => Number(item.companyId) === otherCompanyId));

      const switched = await loginEmployeeWithPassword(query, {
        email: person.email,
        password: 'ColabTest!2026',
        companyId: otherCompanyId,
      });
      assert.equal(switched.ok, true, switched.errorCode);
      assert.equal(Number(switched.candidateId), Number(cloneId));
      assert.equal(Number(switched.companyId), otherCompanyId);

      const multi = await loginEmployeeWithPassword(query, {
        email: person.email,
        password: 'ColabTest!2026',
      });
      assert.equal(multi.ok, true, multi.errorCode);
      assert.equal(multi.needsCompanyPick, true);
      assert.ok(multi.pickToken);
      assert.ok(Array.isArray(multi.companies) && multi.companies.length >= 2);
      assert.ok(multi.companies.every((c) => c.companyName));
      const { completeEmployeeCompanyPick } = await import('../../lib/employee/employee-auth.js');
      const picked = await completeEmployeeCompanyPick(query, {
        pickToken: multi.pickToken,
        candidateId: person.candidateId,
      });
      assert.equal(picked.ok, true, picked.errorCode);
      assert.equal(picked.candidateId, person.candidateId);
      assert.equal(picked.companyId, person.companyId);
    }
  }

  const magic = generateEmployeeMagicToken();
  await query(
    `INSERT INTO employee_login_tokens (company_id, candidate_id, token, expires_at)
     VALUES ($1, $2, $3, NOW() + INTERVAL '30 minutes')`,
    [person.companyId, person.candidateId, magic]
  );
  const consumed = await consumeEmployeeMagicToken(query, { token: magic });
  assert.equal(consumed.ok, true);
  const consumedAgain = await consumeEmployeeMagicToken(query, { token: magic });
  assert.equal(consumedAgain.ok, false);

  const jwt = signEmployeeToken({
    candidateId: person.candidateId,
    companyId: person.companyId,
    email: person.email,
    sv: completed.sessionVersion || 1,
  });
  assert.ok(verifyEmployeeToken(jwt));
  assert.equal(verifyEmployeeToken(jwt).sv, completed.sessionVersion || 1);

  const course = await createLmsCourse(query, {
    companyId: person.companyId,
    title: `DTOV Emp ${Date.now()}`,
    createdByUserId: null,
  });
  assert.equal(course.ok, true, course.errorCode);
  const lesson = await createLmsLesson(query, {
    companyId: person.companyId,
    courseId: course.course.id,
    title: 'Lesson 1',
    contentUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    contentKind: 'youtube',
  });
  assert.equal(lesson.ok, true, lesson.errorCode);
  assert.ok(lmsEmbedUrl(lesson.lesson.contentUrl, 'youtube')?.includes('embed/'));

  const enrolled = await enrollLmsCandidates(query, {
    companyId: person.companyId,
    courseId: course.course.id,
    candidateIds: [person.candidateId],
    dueDate: '2099-01-15',
    mandatory: true,
  });
  assert.equal(enrolled.ok, true, enrolled.errorCode);

  const plan = await createDevelopmentPlan(query, {
    companyId: person.companyId,
    candidateId: person.candidateId,
    title: `DTOV PDI ${Date.now()}`,
    status: DEVELOPMENT_PLAN_STATUS.ACTIVE,
  });
  assert.equal(plan.ok, true, plan.errorCode);
  const item = await addDevelopmentPlanItem(query, {
    companyId: person.companyId,
    planId: plan.plan.id,
    candidateId: person.candidateId,
    title: 'DTOV item',
    status: DEVELOPMENT_PLAN_ITEM_STATUS.TODO,
  });
  assert.equal(item.ok, true, item.errorCode);

  const pdiNotif = await notifyCandidate(query, {
    companyId: person.companyId,
    candidateId: person.candidateId,
    type: EMPLOYEE_NOTIF.PDI_UPDATED,
    payload: { planTitle: plan.plan.title, planId: plan.plan.id },
    dedupeKey: `dtov-pdi:${plan.plan.id}:${Date.now()}`,
  });
  assert.ok(pdiNotif.inserted >= 1);

  const motNotif = await notifyCandidate(query, {
    companyId: person.companyId,
    candidateId: person.candidateId,
    type: EMPLOYEE_NOTIF.MOTIVATORS_INVITE,
    payload: { assessmentUrl: 'https://example.com/assessment/motivators/x' },
    dedupeKey: `dtov-mot:${person.candidateId}:${Date.now()}`,
  });
  assert.ok(motNotif.inserted >= 1);

  const home = await getEmployeeHome(query, {
    companyId: person.companyId,
    candidateId: person.candidateId,
    locale: 'pt-BR',
  });
  assert.equal(home.ok, true);
  assert.ok(Array.isArray(home.plans));
  assert.ok(Array.isArray(home.courses));
  assert.ok(home.company);
  assert.ok(home.courses.some((c) => c.courseId === course.course.id));
  const ytCourse = home.courses.find((c) => c.courseId === course.course.id);
  assert.ok(ytCourse.lessons?.some((l) => l.embedUrl && l.embedUrl.includes('youtube.com/embed')));
  assert.ok(home.plans.some((p) => p.id === plan.plan.id));

  const journey = await getEmployeeOnboardingJourney(query, {
    companyId: person.companyId,
    candidateId: person.candidateId,
    ensure: true,
  });
  assert.equal(journey.ok, true, journey.errorCode);
  assert.equal(journey.hasJourney, true);
  assert.ok(journey.preItems.length >= 3);
  assert.ok(journey.checkins.length >= 3);

  const kit = journey.preItems.find((i) => i.itemKey === 'welcome_kit');
  assert.ok(kit?.id);
  const ack = await employeeAckOnboardingItem(query, {
    companyId: person.companyId,
    candidateId: person.candidateId,
    kind: 'pre',
    itemId: kit.id,
  });
  assert.equal(ack.ok, true);

  const rhCall = journey.preItems.find((i) => i.itemKey === 'rh_onboarding_call');
  assert.ok(rhCall?.id);
  const meet = await setPreOnboardingMeetUrl(query, {
    companyId: person.companyId,
    candidateId: person.candidateId,
    itemId: rhCall.id,
    meetUrl: 'https://meet.google.com/dtov-test',
  });
  assert.equal(meet.ok, true);
  assert.equal(meet.item.meetUrl, 'https://meet.google.com/dtov-test');

  const home2 = await getEmployeeHome(query, {
    companyId: person.companyId,
    candidateId: person.candidateId,
    locale: 'pt-BR',
  });
  assert.equal(home2.ok, true);
  assert.ok(home2.journey?.preItems?.some((i) => i.meetUrl?.includes('meet.google.com')));
  assert.ok(home2.tasks.some((t) => t.kind === 'onboarding_pre' || t.kind === 'onboarding_checkin'));

  const pdiDone = await updateEmployeePdiItemStatus(query, {
    companyId: person.companyId,
    candidateId: person.candidateId,
    itemId: item.item.id,
    status: DEVELOPMENT_PLAN_ITEM_STATUS.DONE,
  });
  assert.equal(pdiDone.ok, true, pdiDone.errorCode);
  assert.equal(pdiDone.item.status, DEVELOPMENT_PLAN_ITEM_STATUS.DONE);

  const marked = await completeLmsLesson(query, {
    companyId: person.companyId,
    candidateId: person.candidateId,
    lessonId: lesson.lesson.id,
  });
  assert.equal(marked.ok, true);

  const notifs = await listCandidateNotifications(query, {
    companyId: person.companyId,
    candidateId: person.candidateId,
  });
  assert.equal(notifs.ok, true);
  assert.ok(notifs.unreadCount >= 2);

  // First-access welcome card: shown until dismissed, idempotent, scoped by company.
  await query(
    `UPDATE candidates SET employee_welcome_dismissed_at = NULL WHERE id = $1 AND company_id = $2`,
    [person.candidateId, person.companyId]
  );
  const homeWelcome = await getEmployeeHome(query, {
    companyId: person.companyId,
    candidateId: person.candidateId,
  });
  assert.equal(homeWelcome.showWelcome, true);
  const wrongTenant = await dismissEmployeeWelcome(query, {
    companyId: Number(person.companyId) + 999999,
    candidateId: person.candidateId,
  });
  assert.equal(wrongTenant.ok, true);
  const stillShown = await getEmployeeHome(query, {
    companyId: person.companyId,
    candidateId: person.candidateId,
  });
  assert.equal(stillShown.showWelcome, true, 'other company id must not dismiss');
  assert.equal((await dismissEmployeeWelcome(query, person)).ok, true);
  const firstAt = (await query(
    `SELECT employee_welcome_dismissed_at AS at FROM candidates WHERE id = $1`,
    [person.candidateId]
  )).rows[0].at;
  assert.ok(firstAt);
  assert.equal((await dismissEmployeeWelcome(query, person)).ok, true);
  const secondAt = (await query(
    `SELECT employee_welcome_dismissed_at AS at FROM candidates WHERE id = $1`,
    [person.candidateId]
  )).rows[0].at;
  assert.equal(new Date(secondAt).getTime(), new Date(firstAt).getTime(), 'dismiss keeps first timestamp');
  const homeAfter = await getEmployeeHome(query, {
    companyId: person.companyId,
    candidateId: person.candidateId,
  });
  assert.equal(homeAfter.showWelcome, false);

  console.log('employee-home.dtov.test.js OK');
  await closeRateLimitRedis().catch(() => {});
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
