import { runtimeAppUrl } from './app-url.js';
/**
 * Collaborator home — tasks + PDI + LMS + 1:1 + company snapshot.
 * Parallel section loads; PDI items batched (no N×getDevelopmentPlan).
 */

import { asDb } from './ae/as-db.js';
import { query } from './db.js';
import { ERR } from './api-error-codes.js';
import {
  EMPLOYMENT_STATUS,
  DEVELOPMENT_PLAN_ITEM_STATUS,
} from './domain-status.js';
import { toDateOnlyIso } from './format-display-date.js';
import { listCandidateLmsCourses } from './lms.js';
import { listActiveDevelopmentPlansWithItems } from './people/development-plans.js';
import { getCompanyPostsPreview } from './company-posts.js';
import { getCompanyKudosPreview } from './company-kudos.js';
import { listOneOnOnes } from './people/one-on-ones.js';
import { buildManagementHypotheses } from './people/management-hypotheses.js';
import {
  getEmployeeOnboardingJourney,
  buildOnboardingTasksFromJourney,
} from './people/employee-onboarding-journey.js';
import { getEmployeeOneOnOnePrep } from './employee-one-on-one-prep.js';
import { listOkrActivitiesForCandidate } from './okr-cycles.js';
import { listAssignedKeyResults } from './okr-hierarchy.js';

function appBaseUrl() {
  return String(runtimeAppUrl() || '').replace(/\/$/, '');
}

function dateOrNull(raw) {
  return toDateOnlyIso(raw);
}

async function loadMotivatorsTasks(db, { cid, cand, base }) {
  const tasks = [];
  try {
    const inv = await db.query(
      `SELECT i.id, i.token, i.status, i.created_at AS "createdAt", i.expires_at AS "expiresAt"
       FROM ae_invites i
       WHERE i.company_id = $1
         AND i.candidate_id = $2
         AND i.status IN ('sent', 'opened')
         AND (i.expires_at IS NULL OR i.expires_at > NOW())
       ORDER BY i.created_at DESC
       LIMIT 10`,
      [cid, cand]
    );
    for (const row of inv.rows || []) {
      tasks.push({
        id: `motivators-${row.id}`,
        kind: 'motivators_invite',
        titleKey: 'employeeHome.taskMotivators',
        href: base ? `${base}/assessment/motivators/${row.token}` : `/assessment/motivators/${row.token}`,
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
      });
    }
  } catch (err) {
    if (err?.code !== '42P01' && err?.code !== '42703') throw err;
  }
  return tasks;
}

async function loadLmsSection(db, { cid, cand }) {
  const tasks = [];
  let courses = [];
  try {
    courses = await listCandidateLmsCourses(db, { companyId: cid, candidateId: cand });
    for (const course of courses) {
      if (course.isComplete) continue;
      if (course.overdue) {
        tasks.push({
          id: `lms-overdue-${course.enrollmentId}`,
          kind: 'lms_overdue',
          titleKey: 'employeeHome.taskLmsOverdue',
          titleValues: { title: course.title },
          href: '/employee/lms',
          dueDate: course.dueDate,
          mandatory: course.mandatory,
        });
      } else {
        tasks.push({
          id: `lms-progress-${course.enrollmentId}`,
          kind: 'lms_progress',
          titleKey: 'employeeHome.taskLmsProgress',
          titleValues: { title: course.title, pct: course.progressPct },
          href: '/employee/lms',
          dueDate: course.dueDate,
          mandatory: course.mandatory,
        });
      }
    }
  } catch (err) {
    if (err?.code !== '42P01' && err?.code !== '42703') throw err;
    courses = [];
  }
  return { courses, tasks };
}

async function loadPdiSection(db, { cid, cand }) {
  const tasks = [];
  let planDetails = [];
  try {
    const active = await listActiveDevelopmentPlansWithItems(db, {
      companyId: cid,
      candidateId: cand,
      planLimit: 2,
    });
    for (const detail of active) {
      planDetails.push({
        id: detail.id,
        title: detail.title,
        objective: detail.objective,
        periodStart: detail.periodStart ? dateOrNull(detail.periodStart) : null,
        periodEnd: detail.periodEnd ? dateOrNull(detail.periodEnd) : null,
        items: (detail.items || []).map((it) => ({
          id: it.id,
          title: it.title,
          status: it.status,
          dueDate: it.dueDate ? dateOrNull(it.dueDate) : null,
          ownerLabel: it.ownerLabel || '',
        })),
      });
      const openItems = (detail.items || [])
        .filter((it) => it.status !== DEVELOPMENT_PLAN_ITEM_STATUS.DONE)
        .slice(0, 5);
      for (const it of openItems) {
        tasks.push({
          id: `pdi-${it.id}`,
          kind: 'pdi_item',
          titleKey: 'employeeHome.taskPdiItem',
          titleValues: { title: it.title },
          href: '/employee/pdi',
          dueDate: it.dueDate ? dateOrNull(it.dueDate) : null,
        });
      }
    }
  } catch (err) {
    if (err?.code !== '42P01' && err?.code !== '42703') throw err;
  }
  return { plans: planDetails, tasks };
}

export async function getEmployeeOneOnOne(dbOrQuery, { companyId, candidateId, locale = 'pt-BR' }) {
  const db = asDb(dbOrQuery);
  const prep = await getEmployeeOneOnOnePrep(db, { companyId, candidateId });
  if (!prep.ok) return prep;
  const scope = { cid: companyId, cand: candidateId, locale };
  const [agreements, prompts] = await Promise.all([
    loadRecentAgreements(db, scope), loadOneOnOnePrompts(db, scope),
  ]);
  return { ok: true, agreements, prompts, preparation: { preparedAt: prep.preparedAt, noteToManager: prep.noteToManager } };
}

async function loadRecentAgreements(db, { cid, cand }) {
  try {
    const oos = await listOneOnOnes(db, { companyId: cid, candidateId: cand, limit: 8 });
    return (oos || [])
      .filter((o) => o.nextSteps)
      .slice(0, 3)
      .map((o) => ({
        id: o.id,
        meetingDate: o.meetingDate ? dateOrNull(o.meetingDate) : null,
        nextSteps: o.nextSteps,
      }));
  } catch (err) {
    if (err?.code !== '42P01' && err?.code !== '42703') throw err;
    return [];
  }
}

async function loadOneOnOnePrompts(db, { cid, cand, locale }) {
  try {
    const [mot, enn] = await Promise.all([
      db.query(
        `SELECT a.dimension_scores AS "dimensionScores", a.ranking
         FROM ae_attempts a
         WHERE a.candidate_id = $1 AND a.company_id = $2 AND a.status = 'completed'
         ORDER BY a.completed_at DESC NULLS LAST, a.id DESC
         LIMIT 1`,
        [cand, cid]
      ),
      db.query(
        `SELECT a.top_type AS "topType", a.scores
         FROM assessments a
         JOIN candidates c ON c.id = a.candidate_id
         WHERE a.candidate_id = $1 AND c.company_id = $2
         ORDER BY a.created_at DESC NULLS LAST, a.id DESC
         LIMIT 1`,
        [cand, cid]
      ),
    ]);
    const hyp = buildManagementHypotheses({
      locale,
      scores: enn.rows[0]?.scores || null,
      topType: enn.rows[0]?.topType ?? null,
      motivators: mot.rows[0]
        ? {
            dimensionScores: mot.rows[0].dimensionScores,
            ranking: mot.rows[0].ranking,
          }
        : null,
    });
    return (hyp.oneOnOnePrompts || []).slice(0, 5);
  } catch {
    return [];
  }
}

async function loadJourney(db, { cid, cand }) {
  try {
    const j = await getEmployeeOnboardingJourney(db, {
      companyId: cid,
      candidateId: cand,
      ensure: false,
    });
    if (j.ok && j.hasJourney) {
      return {
        journey: {
          startDate: j.startDate,
          preItems: j.preItems,
          checkins: j.checkins,
        },
        tasks: buildOnboardingTasksFromJourney(j),
      };
    }
  } catch (err) {
    if (err?.code !== '42P01' && err?.code !== '42703') throw err;
  }
  return { journey: null, tasks: [] };
}

async function loadPrep(db, { cid, cand }) {
  try {
    const prep = await getEmployeeOneOnOnePrep(db, { companyId: cid, candidateId: cand });
    if (prep.ok) {
      return {
        preparedAt: prep.preparedAt,
        noteToManager: prep.noteToManager || '',
      };
    }
  } catch (err) {
    if (err?.code !== '42P01' && err?.code !== '42703') throw err;
  }
  return { preparedAt: null, noteToManager: '' };
}

function buildOkrTasks(items) {
  const tasks = [];
  for (const act of items || []) {
    if (act.urgency === 'overdue' || act.urgency === 'critical') {
      tasks.push({
        id: `okr-${act.id}`,
        kind: 'okr',
        titleKey: 'employeeHome.taskOkrActivity',
        titleValues: { title: act.title },
        href: '#okr',
        meta: act.deadline || null,
      });
    }
  }
  return tasks;
}

/** Hides the /employee first-access welcome card for this collaborator (idempotent). */
export async function dismissEmployeeWelcome(dbOrQuery, { companyId, candidateId }) {
  const db = asDb(dbOrQuery || query);
  const cid = Number(companyId);
  const cand = Number(candidateId);
  if (!Number.isFinite(cid) || !Number.isFinite(cand)) {
    return { ok: false, errorCode: ERR.UNAUTHORIZED };
  }
  await db.query(
    `UPDATE candidates
     SET employee_welcome_dismissed_at = NOW()
     WHERE id = $1 AND company_id = $2
       AND employee_welcome_dismissed_at IS NULL`,
    [cand, cid]
  );
  return { ok: true };
}

/**
 * @returns {Promise<{ ok: true, person, showWelcome, tasks, courses, plans, recentAgreements, oneOnOnePrompts, company, okrActivities } | { ok: false, errorCode }>}
 */
export async function getEmployeeHome(dbOrQuery, { companyId, candidateId, locale = 'pt-BR' }) {
  const db = asDb(dbOrQuery || query);
  const cid = Number(companyId);
  const cand = Number(candidateId);
  if (!Number.isFinite(cid) || !Number.isFinite(cand)) {
    return { ok: false, errorCode: ERR.UNAUTHORIZED };
  }

  const personR = await db.query(
    `SELECT c.id, c.full_name AS "fullName", c.email,
            c.employment_status AS "employmentStatus",
            co.name AS "companyName",
            co.about_html AS "companyAboutHtml",
            co.website AS "companyWebsite",
            co.logo_url AS "companyLogoUrl",
            c.employee_welcome_dismissed_at AS "welcomeDismissedAt"
     FROM candidates c
     JOIN companies co ON co.id = c.company_id AND co.deleted = FALSE
     WHERE c.id = $1 AND c.company_id = $2
       AND c.employment_status = '${EMPLOYMENT_STATUS.EMPLOYEE}'
     LIMIT 1`,
    [cand, cid]
  );
  if (personR.rowCount === 0) return { ok: false, errorCode: ERR.UNAUTHORIZED };
  const person = personR.rows[0];
  const base = appBaseUrl();

  const [motivatorsTasks, lms, pdi, recentAgreements, oneOnOnePrompts, journeyPack, oneOnOnePrep, feedPrev, kudosPrev, okrPack] =
    await Promise.all([
      loadMotivatorsTasks(db, { cid, cand, base }),
      loadLmsSection(db, { cid, cand }),
      loadPdiSection(db, { cid, cand }),
      loadRecentAgreements(db, { cid, cand }),
      loadOneOnOnePrompts(db, { cid, cand, locale }),
      loadJourney(db, { cid, cand }),
      loadPrep(db, { cid, cand }),
      getCompanyPostsPreview(db, { companyId: cid }),
      getCompanyKudosPreview(db, { companyId: cid }),
      listOkrActivitiesForCandidate(db, { companyId: cid, candidateId: cand }),
    ]);

  const assignedKeyResults = await listAssignedKeyResults(db, { companyId: cid, candidateId: cand });
  const okrActivities = [...(okrPack?.ok ? okrPack.items || [] : []), ...assignedKeyResults.map(k => ({...k,id:`kr:${k.id}`}))];

  const tasks = [
    ...(journeyPack.tasks || []),
    ...motivatorsTasks,
    ...lms.tasks,
    ...pdi.tasks,
    ...buildOkrTasks(okrActivities),
  ];

  const about = String(person.companyAboutHtml || '').trim();
  const company = {
    name: person.companyName,
    website: person.companyWebsite || null,
    aboutHtml: about ? about.slice(0, 4000) : null,
    logoUrl: person.companyLogoUrl || null,
  };

  return {
    ok: true,
    locale,
    person: {
      candidateId: person.id,
      fullName: person.fullName,
      email: person.email,
      companyName: person.companyName,
      companyLogoUrl: person.companyLogoUrl || null,
    },
    showWelcome: !person.welcomeDismissedAt,
    tasks,
    journey: journeyPack.journey,
    courses: lms.courses,
    plans: pdi.plans,
    okrActivities,
    recentAgreements,
    oneOnOnePrompts,
    oneOnOnePrep,
    company,
    feed: {
      items: feedPrev?.ok ? feedPrev.items : [],
      total: feedPrev?.ok ? feedPrev.total : 0,
    },
    kudos: {
      items: kudosPrev?.ok ? kudosPrev.items : [],
      total: kudosPrev?.ok ? kudosPrev.total : 0,
    },
  };
}
