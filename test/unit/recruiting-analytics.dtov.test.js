import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { pool, query } from '../../lib/db.js';
import { getRecruitingUxMetrics } from '../../lib/recruiting/recruiting-ux-metrics.js';
import { getVacancyFunnelAnalytics } from '../../lib/recruiting/job-funnel.js';
import { getVacancyRanking } from '../../lib/recruiting/vacancy-ranking.js';
import { getVacancyById, listVacancies } from '../../lib/recruiting/vacancies-admin.js';
import {
  assignRecruitingCandidate,
  getRecruitingWorkspace,
  saveRecruitingView,
} from '../../lib/recruiting/recruiting-workspace.js';

const dtov = process.env.DTOV === '1';

after(async () => {
  await pool.end();
});

describe('recruiting analytics (DTOV)', { skip: !dtov }, () => {
  it('returns tenant-scoped stage and UX metrics', async () => {
    const vacancy = await query(
      `SELECT id, company_id FROM vacancies WHERE deleted = FALSE ORDER BY id LIMIT 1`
    );
    assert.equal(vacancy.rowCount, 1);
    const vacancyId = Number(vacancy.rows[0].id);
    const companyId = Number(vacancy.rows[0].company_id);

    const funnel = await getVacancyFunnelAnalytics({ vacancyId, companyId, isAdmin: false });
    assert.equal(funnel.ok, true);
    assert.ok(Array.isArray(funnel.stagePerformance));

    await query(
      `INSERT INTO audit_log (company_id, action, metadata)
       VALUES ($1, 'recruiting.ux.vacancy_create_opened', '{}'::jsonb),
              ($1, 'recruiting.ux.vacancy_create_completed', '{"elapsedMs": 120000}'::jsonb)`,
      [companyId]
    );
    const metrics = await getRecruitingUxMetrics(companyId);
    assert.ok(metrics.opened >= 1);
    assert.ok(metrics.completed >= 1);
    assert.equal(metrics.avgElapsedMs, 120000);

    const crossTenant = await getRecruitingUxMetrics(companyId + 99999);
    assert.equal(crossTenant.opened, 0);
  });

  it('assigns tenant recruiters and persists a bounded saved view', async () => {
    const row = await query(
      `SELECT v.id AS vacancy_id, v.company_id, u.id AS user_id,
              COALESCE(vc.candidate_id, ass.candidate_id) AS candidate_id
       FROM vacancies v
       JOIN users u ON u.company_id = v.company_id AND u.deleted = FALSE AND u.active = TRUE
       LEFT JOIN vacancy_candidates vc ON vc.vacancy_id = v.id
       LEFT JOIN assessments ass ON ass.vacancy_id = v.id
       WHERE v.deleted = FALSE AND COALESCE(vc.candidate_id, ass.candidate_id) IS NOT NULL
       ORDER BY v.id LIMIT 1`
    );
    assert.equal(row.rowCount, 1);
    const companyId = Number(row.rows[0].company_id);
    const vacancyId = Number(row.rows[0].vacancy_id);
    const userId = Number(row.rows[0].user_id);
    const candidateId = Number(row.rows[0].candidate_id);

    const assigned = await assignRecruitingCandidate({
      companyId, vacancyId, candidateId, ownerUserId: userId, updatedByUserId: userId,
    });
    assert.equal(assigned.ok, true);
    assert.equal(assigned.ownerUserId, userId);
    await query(`UPDATE vacancies SET owner_user_id = $2 WHERE id = $1`, [vacancyId, userId]);
    const vacancyList = await listVacancies({ isAdmin: false, companyId, page: 1, pageSize: 20 });
    const ownedVacancy = vacancyList.items.find((item) => Number(item.id) === vacancyId);
    assert.equal(Number(ownedVacancy.ownerUserId), userId);
    assert.ok(ownedVacancy.ownerName);
    const vacancyDetail = await getVacancyById(vacancyId);
    assert.equal(Number(vacancyDetail.ownerUserId), userId);
    assert.ok(vacancyDetail.ownerName);

    const ranking = await getVacancyRanking({ vacancyId, companyId, isAdmin: false });
    assert.equal(ranking.ok, true);
    const ownedCandidate = ranking.ranking.find((item) => Number(item.candidateId) === candidateId);
    assert.equal(Number(ownedCandidate.ownerUserId), userId);

    const saved = await saveRecruitingView({
      companyId, userId, vacancyId,
      name: `Parados DTOV ${Date.now()}`,
      filters: { owner: 'mine', aging: 'stalled', notes: true, ignored: 'discarded' },
    });
    assert.equal(saved.ok, true);
    assert.deepEqual(saved.view.filters, {
      q: '', owner: 'mine', aging: 'stalled', fit: 'all', notes: true, hideEmpty: false, compact: false, tagIds: [], tagMode: 'any',
    });

    const workspace = await getRecruitingWorkspace({ companyId, userId, vacancyId });
    assert.equal(workspace.ok, true);
    assert.ok(workspace.recruiters.some((recruiter) => recruiter.id === userId));
    assert.ok(workspace.views.some((view) => view.id === saved.view.id));

    const crossTenant = await assignRecruitingCandidate({
      companyId: companyId + 99999, vacancyId, candidateId, ownerUserId: userId, updatedByUserId: userId,
    });
    assert.equal(crossTenant.ok, false);
  });
});
