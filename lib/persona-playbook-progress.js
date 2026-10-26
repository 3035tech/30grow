/**
 * Progresso dos playbooks por persona — detecção via dados existentes.
 */

import { asDb } from './ae/as-db.js';
import { EMPLOYMENT_STATUS } from './domain-status.js';
import { PIPELINE_STAGE } from './recruiting/pipeline.js';
import { PERSONA_PLAYBOOKS, PLAYBOOK_IDS, playbooksForTab } from './persona-playbooks.js';

async function detectTask(db, companyId, taskId) {
  const cid = Number(companyId);
  switch (taskId) {
    case 'create_vacancy':
      return db
        .query(
          `SELECT EXISTS(SELECT 1 FROM vacancies WHERE company_id = $1 AND deleted = FALSE) AS ok`,
          [cid]
        )
        .then((r) => r.rows[0]?.ok);
    case 'send_invite':
      return db
        .query(
          `SELECT EXISTS(
             SELECT 1 FROM vacancy_links vl
             JOIN vacancies v ON v.id = vl.vacancy_id
             WHERE v.company_id = $1 AND v.deleted = FALSE
           ) AS ok`,
          [cid]
        )
        .then((r) => r.rows[0]?.ok);
    case 'view_ranking':
      return db
        .query(
          `SELECT EXISTS(
             SELECT 1 FROM assessments ass
             JOIN candidates c ON c.id = ass.candidate_id
             WHERE c.company_id = $1 AND ass.vacancy_id IS NOT NULL AND ass.top_type IS NOT NULL
           ) AS ok`,
          [cid]
        )
        .then((r) => r.rows[0]?.ok);
    case 'scorecard':
      return db
        .query(
          `SELECT EXISTS(
             SELECT 1 FROM interview_scorecards isc
             JOIN candidates c ON c.id = isc.candidate_id
             WHERE c.company_id = $1
           ) AS ok`,
          [cid]
        )
        .then((r) => r.rows[0]?.ok)
        .catch(() => false);
    case 'hire':
      return db
        .query(
          `SELECT EXISTS(
             SELECT 1 FROM assessments ass
             JOIN candidates c ON c.id = ass.candidate_id
             WHERE c.company_id = $1 AND ass.pipeline_stage = '${PIPELINE_STAGE.HIRED}'
           ) AS ok`,
          [cid]
        )
        .then((r) => r.rows[0]?.ok);
    case 'hire_kit':
      return db
        .query(
          `SELECT EXISTS(
             SELECT 1 FROM employee_pre_onboarding_items epo
             WHERE epo.company_id = $1
           ) AS ok`,
          [cid]
        )
        .then((r) => r.rows[0]?.ok)
        .catch(() =>
          db
            .query(
              `SELECT EXISTS(
                 SELECT 1 FROM employee_onboarding_checkins eoc
                 JOIN candidates c ON c.id = eoc.candidate_id
                 WHERE c.company_id = $1
               ) AS ok`,
              [cid]
            )
            .then((r) => r.rows[0]?.ok)
            .catch(() => false)
        );
    case 'view_overview':
      return db
        .query(
          `SELECT EXISTS(
             SELECT 1 FROM hr_scores hs
             JOIN candidates c ON c.id = hs.candidate_id
             WHERE c.company_id = $1
           ) AS ok`,
          [cid]
        )
        .then((r) => r.rows[0]?.ok)
        .catch(() => false);
    case 'open_dossier':
      return db
        .query(
          `SELECT EXISTS(
             SELECT 1 FROM one_on_ones o
             JOIN candidates c ON c.id = o.candidate_id
             WHERE c.company_id = $1
           ) AS ok`,
          [cid]
        )
        .then((r) => r.rows[0]?.ok)
        .catch(() => false);
    case 'log_one_on_one':
      return db
        .query(
          `SELECT EXISTS(
             SELECT 1 FROM one_on_ones o
             JOIN candidates c ON c.id = o.candidate_id
             WHERE c.company_id = $1 AND o.meeting_date IS NOT NULL
           ) AS ok`,
          [cid]
        )
        .then((r) => r.rows[0]?.ok)
        .catch(() => false);
    case 'active_pdi':
      return db
        .query(
          `SELECT EXISTS(
             SELECT 1 FROM development_plans dp
             JOIN candidates c ON c.id = dp.candidate_id
             WHERE c.company_id = $1 AND dp.status = 'active'
           ) AS ok`,
          [cid]
        )
        .then((r) => r.rows[0]?.ok)
        .catch(() => false);
    case 'view_analytics':
      return db
        .query(
          `SELECT EXISTS(
             SELECT 1 FROM candidates c
             WHERE c.company_id = $1 AND c.employment_status = '${EMPLOYMENT_STATUS.EMPLOYEE}'
           ) AS ok`,
          [cid]
        )
        .then((r) => r.rows[0]?.ok);
    case 'review_culture':
      return db
        .query(
          `SELECT EXISTS(
             SELECT 1 FROM climate_surveys cs
             WHERE cs.company_id = $1 AND cs.deleted = FALSE
           ) AS ok`,
          [cid]
        )
        .then((r) => r.rows[0]?.ok)
        .catch(() => false);
    case 'review_exits':
      return db
        .query(
          `SELECT EXISTS(SELECT 1 FROM exit_records er WHERE er.company_id = $1) AS ok`,
          [cid]
        )
        .then((r) => r.rows[0]?.ok)
        .catch(() => false);
    case 'review_succession':
      return db
        .query(
          `SELECT EXISTS(SELECT 1 FROM succession_plans sp WHERE sp.company_id = $1) AS ok`,
          [cid]
        )
        .then((r) => r.rows[0]?.ok)
        .catch(() => false);
    default:
      return false;
  }
}

export async function getPersonaPlaybookProgress(dbOrQuery, { companyId, playbookId }) {
  const db = asDb(dbOrQuery);
  const def = PERSONA_PLAYBOOKS[playbookId];
  if (!def) return null;

  const flags = await Promise.all(
    def.tasks.map((t) => detectTask(db, companyId, t.id))
  );
  const tasks = def.tasks.map((t, i) => ({
    id: t.id,
    tab: t.tab,
    completed: Boolean(flags[i]),
  }));
  const completed = tasks.filter((t) => t.completed).length;
  const progress =
    tasks.length > 0 ? Math.round((completed / tasks.length) * 100) : 0;
  return { playbookId, progress, tasks, completed, total: tasks.length };
}

export async function getPlaybooksForTab(dbOrQuery, { companyId, tab, role }) {
  const defs = playbooksForTab(tab, role);
  const out = [];
  for (const def of defs) {
    const progress = await getPersonaPlaybookProgress(dbOrQuery, {
      companyId,
      playbookId: def.id,
    });
    if (progress) out.push(progress);
  }
  return out;
}

export { PLAYBOOK_IDS };
