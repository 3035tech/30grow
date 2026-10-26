import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../lib/admin-api.js';
import { queryRead } from '../../../../lib/db.js';
import { CAP } from '../../../../lib/identity/permissions.js';
import { getCompanyPdiPulse } from '../../../../lib/people/development-plans.js';
import { DEVELOPMENT_PLAN_ITEM_STATUS, DEVELOPMENT_PLAN_STATUS, EMPLOYMENT_STATUS } from '../../../../lib/domain-status.js';

/** GET /api/admin/pdi — company PDI cockpit with actionable people rows. */
export const GET = withAdminApi(
  {
    cap: CAP.TEAM_VIEW,
    requireCompany: true,
    companyFrom: 'query',
    logLabel: 'pdi cockpit',
  },
  async ({ request, companyId }) => {
    const params = new URL(request.url).searchParams;
    const view = ['active', 'attention', 'no-plan', 'all'].includes(params.get('view'))
      ? params.get('view')
      : 'attention';
    const q = String(params.get('q') || '').trim().slice(0, 120);
    const page = Math.max(1, Number.parseInt(params.get('page') || '1', 10) || 1);
    const pageSize = Math.min(50, Math.max(1, Number.parseInt(params.get('pageSize') || '20', 10) || 20));
    const offset = (page - 1) * pageSize;
    const values = [companyId];
    const where = [
      'c.company_id = $1',
      `c.employment_status = '${EMPLOYMENT_STATUS.EMPLOYEE}'`,
    ];

    if (q) {
      values.push(`%${q}%`);
      where.push(`c.full_name ILIKE $${values.length}`);
    }
    if (view === 'active') where.push('p.plan_id IS NOT NULL');
    if (view === 'no-plan') where.push('p.plan_id IS NULL');
    if (view === 'attention') {
      where.push('(p.plan_id IS NULL OR p.period_overdue OR p.overdue_item_count > 0 OR (p.item_count > 0 AND p.done_count = 0))');
    }

    values.push(pageSize, offset);
    const rows = await queryRead(
      `SELECT
         c.id AS "candidateId",
         c.full_name AS "candidateName",
         c.email,
         p.plan_id AS "planId",
         p.plan_title AS "planTitle",
         p.period_start AS "periodStart",
         p.period_end AS "periodEnd",
         p.item_count AS "itemCount",
         p.done_count AS "doneCount",
         p.overdue_item_count AS "overdueItemCount",
         p.period_overdue AS "periodOverdue",
         COUNT(*) OVER()::int AS "total"
       FROM candidates c
       LEFT JOIN LATERAL (
         SELECT
           p0.id AS plan_id,
           p0.title AS plan_title,
           p0.period_start AS period_start,
           p0.period_end AS period_end,
           COUNT(i.id)::int AS item_count,
           COUNT(i.id) FILTER (WHERE i.status = '${DEVELOPMENT_PLAN_ITEM_STATUS.DONE}')::int AS done_count,
           COUNT(i.id) FILTER (
             WHERE i.status <> '${DEVELOPMENT_PLAN_ITEM_STATUS.DONE}'
               AND i.due_date IS NOT NULL
               AND i.due_date < CURRENT_DATE
           )::int AS overdue_item_count,
           (p0.period_end IS NOT NULL AND p0.period_end < CURRENT_DATE) AS period_overdue
         FROM development_plans p0
         LEFT JOIN development_plan_items i ON i.plan_id = p0.id
         WHERE p0.company_id = c.company_id
           AND p0.candidate_id = c.id
           AND p0.status = '${DEVELOPMENT_PLAN_STATUS.ACTIVE}'
         GROUP BY p0.id
         ORDER BY p0.updated_at DESC, p0.id DESC
         LIMIT 1
       ) p ON TRUE
       WHERE ${where.join(' AND ')}
       ORDER BY
         CASE
           WHEN p.plan_id IS NOT NULL AND (p.period_overdue OR p.overdue_item_count > 0) THEN 0
           WHEN p.plan_id IS NOT NULL THEN 1
           ELSE 2
         END ASC,
         p.period_overdue DESC,
         p.overdue_item_count DESC,
         CASE WHEN p.item_count > 0 THEN p.done_count::float / p.item_count ELSE 0 END ASC,
         c.full_name ASC NULLS LAST
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    );

    const pulse = await getCompanyPdiPulse(queryRead, {
      companyId,
      queueLimit: 8,
      activePlansLimit: 8,
    });

    return NextResponse.json({
      ok: true,
      view,
      query: q,
      page,
      pageSize,
      total: rows.rows[0]?.total || 0,
      summary: pulse || {},
      rows: rows.rows.map((row) => {
        const itemCount = Number(row.itemCount) || 0;
        const doneCount = Number(row.doneCount) || 0;
        return {
          ...row,
          total: undefined,
          itemCount,
          doneCount,
          overdueItemCount: Number(row.overdueItemCount) || 0,
          donePct: itemCount > 0 ? Math.round((doneCount / itemCount) * 100) : null,
          periodStart: row.periodStart ? String(row.periodStart).slice(0, 10) : null,
          periodEnd: row.periodEnd ? String(row.periodEnd).slice(0, 10) : null,
          periodOverdue: Boolean(row.periodOverdue),
        };
      }),
    });
  }
);
