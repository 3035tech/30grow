/**
 * Weekly manager digest — Overview attention highlights + retention + stale 1:1s.
 */

import { asDb } from './ae/as-db.js';
import { notifyCompanyManagers, NOTIF } from './manager-notifications.js';
import { sendTransactionalMail, isMailConfigured } from './mail.js';
import { EMPLOYMENT_STATUS, OFFER_STATUS, VACANCY_STATUS } from './domain-status.js';
import { PIPELINE_STAGE } from './pipeline.js';
import { canonicalStageJoinSql, canonicalStageExprSql } from './company-pipeline-stages.js';
import { countRecentCompanyKudos } from './company-kudos.js';
import { listStaleOneOnOnes } from './people/one-on-ones.js';

const COMPANIES_CAP = 80;
const SIGNALS_CAP = 8;
const STALE_CAP = 8;
const ATTENTION_CAP = 6;

function isoWeekKey(d = new Date()) {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/**
 * Light company-scoped attention counts (same kinds as Overview, no filters).
 */
async function loadAttentionDigest(db, companyId) {
  const cid = Number(companyId);
  const [
    stuckInterview,
    missingScorecard,
    hireGaps,
    targetSoon,
    invites,
  ] = await Promise.all([
    db.query(
      `SELECT COUNT(*)::int AS n
       FROM assessments ass
       JOIN candidates c ON c.id = ass.candidate_id
       LEFT JOIN LATERAL (
         SELECT MAX(h.changed_at) AS entered_at
         FROM assessment_pipeline_history h
         LEFT JOIN company_pipeline_stages cps_h
           ON cps_h.company_id = ass.company_id AND cps_h.stage_key = h.to_stage AND cps_h.deleted_at IS NULL
         WHERE h.assessment_id = ass.id
           AND COALESCE(cps_h.canonical_key, h.to_stage) = '${PIPELINE_STAGE.INTERVIEW}'
       ) stage_enter ON TRUE
       ${canonicalStageJoinSql('ass')}
       WHERE c.company_id = $1
         AND ${canonicalStageExprSql('ass')} = '${PIPELINE_STAGE.INTERVIEW}'
         AND COALESCE(stage_enter.entered_at, ass.created_at) < NOW() - INTERVAL '7 days'`,
      [cid]
    ),
    db.query(
      `SELECT COUNT(*)::int AS n
       FROM assessments ass
       JOIN candidates c ON c.id = ass.candidate_id
       JOIN vacancies v ON v.id = ass.vacancy_id AND v.deleted = FALSE
       LEFT JOIN LATERAL (
         SELECT MAX(h.changed_at) AS entered_at
         FROM assessment_pipeline_history h
         LEFT JOIN company_pipeline_stages cps_h
           ON cps_h.company_id = ass.company_id AND cps_h.stage_key = h.to_stage AND cps_h.deleted_at IS NULL
         WHERE h.assessment_id = ass.id
           AND COALESCE(cps_h.canonical_key, h.to_stage) = '${PIPELINE_STAGE.INTERVIEW}'
       ) stage_enter ON TRUE
       LEFT JOIN interview_scorecards sc
         ON sc.vacancy_id = ass.vacancy_id AND sc.candidate_id = c.id
       ${canonicalStageJoinSql('ass')}
       WHERE c.company_id = $1
         AND ${canonicalStageExprSql('ass')} = '${PIPELINE_STAGE.INTERVIEW}'
         AND COALESCE(stage_enter.entered_at, ass.created_at) < NOW() - INTERVAL '7 days'
         AND (
           sc.id IS NULL
           OR NOT EXISTS (
             SELECT 1
             FROM jsonb_array_elements(COALESCE(sc.items, '[]'::jsonb)) it
             WHERE (it->>'rating') ~ '^[1-5]$'
           )
         )`,
      [cid]
    ).catch(() => ({ rows: [{ n: 0 }] })),
    db.query(
      `SELECT COUNT(*)::int AS n
       FROM assessments ass
       JOIN candidates c ON c.id = ass.candidate_id
       JOIN vacancies v ON v.id = ass.vacancy_id AND v.deleted = FALSE AND v.status = '${VACANCY_STATUS.OPEN}'
       ${canonicalStageJoinSql('ass')}
       WHERE c.company_id = $1
         AND ${canonicalStageExprSql('ass')} = '${PIPELINE_STAGE.APPROVED}'
         AND (
           COALESCE(ass.offer_status, '${OFFER_STATUS.NONE}') = '${OFFER_STATUS.NONE}'
           OR NOT EXISTS (
             SELECT 1 FROM ae_attempts att
             WHERE att.candidate_id = c.id AND att.status = 'completed'
           )
         )`,
      [cid]
    ).catch(() => ({ rows: [{ n: 0 }] })),
    db.query(
      `SELECT COUNT(*)::int AS n
       FROM vacancies v
       WHERE v.company_id = $1 AND v.deleted = FALSE AND v.status = '${VACANCY_STATUS.OPEN}'
         AND v.target_date IS NOT NULL
         AND v.target_date <= (CURRENT_DATE + INTERVAL '7 days')`,
      [cid]
    ),
    db.query(
      `SELECT COUNT(*)::int AS n
       FROM candidate_invites i
       JOIN vacancies v ON v.id = i.vacancy_id AND v.deleted = FALSE
       WHERE i.company_id = $1
         AND i.status IN ('sent', 'opened')
         AND i.sent_at < NOW() - INTERVAL '2 days'`,
      [cid]
    ).catch(() => ({ rows: [{ n: 0 }] })),
  ]);

  const counts = {
    stuckInterview: Number(stuckInterview.rows[0]?.n) || 0,
    missingScorecard: Number(missingScorecard.rows[0]?.n) || 0,
    hireGaps: Number(hireGaps.rows[0]?.n) || 0,
    targetSoon: Number(targetSoon.rows[0]?.n) || 0,
    invites: Number(invites.rows[0]?.n) || 0,
  };
  const attentionTotal =
    counts.stuckInterview +
    counts.missingScorecard +
    counts.hireGaps +
    counts.targetSoon +
    counts.invites;

  const lines = [];
  if (counts.hireGaps) lines.push(`${counts.hireGaps} aprovado(s) com gap hire-ready`);
  if (counts.missingScorecard) lines.push(`${counts.missingScorecard} entrevista(s) sem scorecard`);
  if (counts.stuckInterview) lines.push(`${counts.stuckInterview} parado(s) em entrevista ≥7d`);
  if (counts.targetSoon) lines.push(`${counts.targetSoon} vaga(s) perto do prazo`);
  if (counts.invites) lines.push(`${counts.invites} convite(s) eneagrama sem resposta`);

  return {
    attentionTotal,
    attentionCounts: counts,
    attentionLines: lines.slice(0, ATTENTION_CAP),
    attentionSummary: lines.slice(0, ATTENTION_CAP).join(' · ') || '—',
  };
}

/**
 * @returns {Promise<{ companies: number, notified: number, emailed: number, weekKey: string }>}
 */
export async function runManagerWeeklyDigest(dbOrQuery, {
  retentionDays = 7,
  staleOneOnOneDays = 21,
  sendEmail = true,
} = {}) {
  const db = asDb(dbOrQuery);
  const retDays = Math.min(30, Math.max(1, Number(retentionDays) || 7));
  const staleDays = Math.min(90, Math.max(7, Number(staleOneOnOneDays) || 21));
  const weekKey = isoWeekKey();

  const companies = await db.query(
    `SELECT c.id
     FROM companies c
     WHERE c.deleted = FALSE
       AND EXISTS (
         SELECT 1 FROM users u
         WHERE u.company_id = c.id
           AND u.deleted = FALSE AND u.active = TRUE
           AND u.role IN ('hr', 'direction', 'admin')
       )
     ORDER BY c.id
     LIMIT $1`,
    [COMPANIES_CAP]
  );

  let notified = 0;
  let emailed = 0;

  for (const { id: companyId } of companies.rows) {
    const [retention, stale, attention, kudosCount] = await Promise.all([
      db.query(
        `SELECT DISTINCT ON (n.entity_id)
           n.entity_id AS "candidateId",
           n.payload->>'candidateName' AS "candidateName",
           n.payload->>'signalLabels' AS "signalLabels",
           n.created_at AS "createdAt"
         FROM manager_notifications n
         WHERE n.company_id = $1
           AND n.type = 'retention_watch'
           AND n.created_at >= NOW() - ($2::int * INTERVAL '1 day')
           AND n.entity_id IS NOT NULL
         ORDER BY n.entity_id, n.created_at DESC
         LIMIT $3`,
        [companyId, retDays, SIGNALS_CAP]
      ),
      listStaleOneOnOnes(db, { companyId, staleDays, limit: STALE_CAP }).then((rows) => ({ rows, rowCount: rows.length })),
      loadAttentionDigest(db, companyId),
      countRecentCompanyKudos(db, { companyId, days: 7 }),
    ]);

    const retentionCount = retention.rowCount || 0;
    const staleCount = stale.rowCount || 0;
    const attentionTotal = attention.attentionTotal || 0;
    if (retentionCount === 0 && staleCount === 0 && attentionTotal === 0 && kudosCount === 0) continue;

    const retentionNames = retention.rows
      .map((r) => r.candidateName || `#${r.candidateId}`)
      .filter(Boolean)
      .slice(0, 5)
      .join(', ');
    const staleNames = stale.rows
      .map((r) => r.candidateName || `#${r.candidateId}`)
      .filter(Boolean)
      .slice(0, 5)
      .join(', ');

    const r = await notifyCompanyManagers(db, {
      companyId,
      type: NOTIF.MANAGER_WEEKLY_DIGEST,
      entityType: 'company',
      entityId: companyId,
      dedupeKey: `weekly_digest:${companyId}:${weekKey}`,
      payload: {
        weekKey,
        retentionCount,
        staleCount,
        retentionNames: retentionNames || '—',
        staleNames: staleNames || '—',
        staleDays,
        attentionTotal,
        attentionSummary: attention.attentionSummary,
        hireGaps: attention.attentionCounts.hireGaps,
        missingScorecard: attention.attentionCounts.missingScorecard,
        stuckInterview: attention.attentionCounts.stuckInterview,
        kudosCount,
      },
    });
    notified += r.inserted || 0;

    if (sendEmail && isMailConfigured() && (r.inserted || 0) > 0) {
      const managers = await db.query(
        `SELECT email, display_name AS "displayName"
         FROM users
         WHERE company_id = $1
           AND deleted = FALSE AND active = TRUE
           AND role IN ('hr', 'direction', 'admin')
           AND email IS NOT NULL AND btrim(email) <> ''
         LIMIT 40`,
        [companyId]
      );
      const base = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '');
      const overviewUrl = base ? `${base}/dashboard?tab=overview` : '/dashboard?tab=overview';
      for (const m of managers.rows) {
        try {
          const subject = `30Grow: resumo semanal (${attentionTotal} atenção, ${retentionCount} retenção)`;
          const text = [
            'Resumo semanal 30Grow (mesma lógica da Visão geral → Atenção)',
            '',
            attentionTotal
              ? `Atenção agora (${attentionTotal}): ${attention.attentionSummary}`
              : 'Sem itens de atenção no funil/vagas.',
            retentionCount
              ? `Retenção Motivadores (últimos ${retDays} dias): ${retentionCount}. ${retentionNames || '—'}`
              : `Sem alertas de retenção nos últimos ${retDays} dias.`,
            staleCount
              ? `1:1 em atraso (>${staleDays} dias ou nunca): ${staleCount}. ${staleNames || '—'}`
              : `Nenhum 1:1 em atraso (>${staleDays} dias).`,
            '',
            `Abrir Visão geral: ${overviewUrl}`,
          ].join('\n');
          await sendTransactionalMail({ to: m.email, subject, text });
          emailed += 1;
        } catch {
          /* continue */
        }
      }
    }
  }

  return { companies: companies.rowCount, notified, emailed, weekKey };
}
