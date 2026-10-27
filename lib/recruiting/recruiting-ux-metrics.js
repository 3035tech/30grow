import { queryRead } from '../db.js';
import { RECRUITING_UX_EVENT } from './recruiting-ux-events.js';

export async function getRecruitingUxMetrics(companyId) {
  const cid = Number(companyId);
  if (!Number.isInteger(cid) || cid <= 0) return null;
  const result = await queryRead(
    `SELECT
       COUNT(*) FILTER (WHERE action = $2)::int AS opened,
       COUNT(*) FILTER (WHERE action = $3)::int AS cancelled,
       COUNT(*) FILTER (WHERE action = $4)::int AS completed,
       ROUND(AVG((metadata->>'elapsedMs')::numeric) FILTER (
         WHERE action = $4
           AND metadata->>'elapsedMs' ~ '^[0-9]+$'
       ))::bigint AS avg_elapsed_ms
     FROM audit_log
     WHERE company_id = $1
       AND created_at >= NOW() - INTERVAL '30 days'
       AND action = ANY($5::text[])`,
    [
      cid,
      `recruiting.ux.${RECRUITING_UX_EVENT.VACANCY_CREATE_OPENED}`,
      `recruiting.ux.${RECRUITING_UX_EVENT.VACANCY_CREATE_CANCELLED}`,
      `recruiting.ux.${RECRUITING_UX_EVENT.VACANCY_CREATE_COMPLETED}`,
      [
        `recruiting.ux.${RECRUITING_UX_EVENT.VACANCY_CREATE_OPENED}`,
        `recruiting.ux.${RECRUITING_UX_EVENT.VACANCY_CREATE_CANCELLED}`,
        `recruiting.ux.${RECRUITING_UX_EVENT.VACANCY_CREATE_COMPLETED}`,
      ],
    ]
  );
  const row = result.rows[0] || {};
  const opened = Number(row.opened || 0);
  const completed = Number(row.completed || 0);
  return {
    opened,
    cancelled: Number(row.cancelled || 0),
    completed,
    completionRate: opened > 0 ? Math.min(1, completed / opened) : null,
    avgElapsedMs: row.avg_elapsed_ms == null ? null : Number(row.avg_elapsed_ms),
  };
}
