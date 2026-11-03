import { runtimeAppUrl } from './app-url.js';
/**
 * Weekly manager digest — Overview attention highlights + retention + stale 1:1s.
 */

import { asDb } from './ae/as-db.js';
import { notifyCompanyManagers, NOTIF } from './manager-notifications.js';
import { sendTransactionalMail, isMailConfigured } from './mail.js';
import { EMPLOYMENT_STATUS, OFFER_STATUS, VACANCY_STATUS } from './domain-status.js';
import { PIPELINE_STAGE } from './recruiting/pipeline.js';
import { canonicalStageJoinSql, canonicalStageExprSql } from './company/company-pipeline-stages.js';
import { countRecentCompanyKudos } from './company/company-kudos.js';
import { listStaleOneOnOnes } from './people/one-on-ones.js';
import { escapeEmailHtml, renderEmailLayout } from './email-layout.js';

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

function digestMetric(label, value) {
  return `<td width="33.33%" valign="top" style="padding:14px 8px;border-right:1px solid #E5E7EB;"><p style="margin:0 0 6px;font-size:25px;line-height:1;font-weight:700;color:#111827;">${Number(value) || 0}</p><p style="margin:0;font-size:13px;line-height:1.4;color:#5A6980;">${escapeEmailHtml(label)}</p></td>`;
}

function digestSection(title, detail, badge = '') {
  return `<tr><td style="padding:18px 0;border-top:1px solid #E5E7EB;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td><h2 style="margin:0 0 8px;font-size:17px;line-height:1.35;color:#111827;">${escapeEmailHtml(title)}</h2><p style="margin:0;font-size:14px;line-height:1.6;color:#334155;">${escapeEmailHtml(detail)}</p></td>${badge ? `<td align="right" valign="top" style="padding-left:12px;"><span style="display:inline-block;padding:5px 10px;border-radius:16px;background:#EAF2FF;color:#2563EB;font-size:12px;font-weight:700;white-space:nowrap;">${escapeEmailHtml(badge)}</span></td>` : ''}</tr></table></td></tr>`;
}

function buildWeeklyDigestHtml({ attention, attentionTotal, retentionCount, retentionNames, staleCount, staleDays, staleNames, kudosCount, overviewUrl, subject, text, periodLabel }) {
  const counts = attention.attentionCounts;
  const recruitingTotal = counts.missingScorecard + counts.stuckInterview + counts.hireGaps + counts.targetSoon;
  const recruitingLines = attention.attentionLines.filter((line) => !line.includes('convite(s) eneagrama'));
  const recommendations = [];
  if (counts.missingScorecard) recommendations.push('Finalize os scorecards das entrevistas.');
  if (counts.stuckInterview) recommendations.push('Revise os processos seletivos sem movimentação.');
  if (counts.invites) recommendations.push('Reforce os convites de Eneagrama pendentes.');
  if (staleCount) recommendations.push('Retome os acompanhamentos individuais em atraso.');
  if (retentionCount) recommendations.push('Revise os alertas recentes de retenção.');

  const sections = [];
  if (recruitingLines.length) sections.push(digestSection('Recrutamento e seleção', recruitingLines.join(' · '), 'Atenção'));
  if (counts.invites) sections.push(digestSection('Engajamento', `${counts.invites} convites de Eneagrama sem resposta.`, 'Pendente'));
  if (retentionCount) sections.push(digestSection('Retenção e Motivadores', `${retentionCount} alerta(s) recente(s): ${retentionNames || '—'}.`, 'Acompanhar'));
  if (staleCount) sections.push(digestSection('Acompanhamento de pessoas', `${staleCount} acompanhamentos 1:1 em atraso (mais de ${staleDays} dias ou nunca realizados): ${staleNames || '—'}.`, 'Atenção'));
  if (kudosCount) sections.push(digestSection('Reconhecimentos', `${kudosCount} reconhecimento(s) compartilhado(s) nos últimos 7 dias.`));

  const recommendationsHtml = recommendations.length
    ? `<tr><td style="padding:20px 0 4px;border-top:1px solid #E5E7EB;"><h2 style="margin:0 0 12px;font-size:17px;color:#111827;">O que merece atenção nesta semana?</h2><ul style="margin:0;padding-left:21px;color:#334155;">${recommendations.map((item) => `<li style="margin:0 0 8px;font-size:14px;line-height:1.55;">${escapeEmailHtml(item)}</li>`).join('')}</ul></td></tr>`
    : '';
  const contentHtml = `<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="padding:0 0 20px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #E5E7EB;border-radius:10px;background:#FFFFFF;"><tr>${digestMetric('Pontos de atenção', attentionTotal)}${digestMetric('Recrutamento e seleção', recruitingTotal)}<td width="33.33%" valign="top" style="padding:14px 8px;"><p style="margin:0 0 6px;font-size:25px;line-height:1;font-weight:700;color:#111827;">${counts.invites}</p><p style="margin:0;font-size:13px;line-height:1.4;color:#5A6980;">Convites sem resposta</p></td></tr></table></td></tr>${sections.join('')}${recommendationsHtml}</table>`;
  return renderEmailLayout({
    subject,
    title: 'Resumo de gestão de pessoas',
    subtitle: `Período de ${periodLabel}`,
    preheader: `${attentionTotal} pontos de atenção, ${retentionCount} alertas de retenção e ${staleCount} acompanhamentos em atraso.`,
    text,
    contentHtml,
    ctaUrl: overviewUrl,
    ctaLabel: 'Acesse seu painel 30Grow',
    locale: 'pt-BR',
  });
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
      const base = (runtimeAppUrl() || '').replace(/\/$/, '');
      const overviewUrl = base ? `${base}/dashboard?tab=overview` : '/dashboard?tab=overview';
      const periodEnd = new Date();
      periodEnd.setUTCHours(0, 0, 0, 0);
      periodEnd.setUTCDate(periodEnd.getUTCDate() - ((periodEnd.getUTCDay() + 6) % 7));
      const periodStart = new Date(periodEnd.getTime() - 7 * 24 * 60 * 60 * 1000);
      const formatPeriodDate = (date) => date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
      const periodLabel = `${formatPeriodDate(periodStart)} a ${formatPeriodDate(periodEnd)}`;
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
          const html = buildWeeklyDigestHtml({
            attention,
            attentionTotal,
            retentionCount,
            retentionNames,
            staleCount,
            staleDays,
            staleNames,
            kudosCount,
            overviewUrl,
            subject,
            text,
            periodLabel,
          });
          await sendTransactionalMail({ to: m.email, subject, text, html, locale: 'pt-BR' });
          emailed += 1;
        } catch {
          /* continue */
        }
      }
    }
  }

  return { companies: companies.rowCount, notified, emailed, weekKey };
}
