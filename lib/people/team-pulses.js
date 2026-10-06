/**
 * Short anonymous team pulse scoped to a saved team_group (B-603).
 */

import crypto from 'crypto';
import { asDb } from '../ae/as-db.js';
import { ERR } from '../api-error-codes.js';
import { TEAM_PULSE_STATUS } from '../domain-status.js';
import { t as i18nT, contentLocale } from '../i18n.js';

const TITLE_MAX = 200;
const PROMPT_MAX = 500;
const LIST_CAP = 20;
const QUESTIONS_CAP = 8;
const INVITE_TTL_DAYS = 21;
const INVITE_BATCH_CAP = 40;

export function teamPulseMinResponses() {
  const n = parseInt(String(process.env.TEAM_PULSE_MIN_RESPONSES || '3'), 10);
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 50) : 3;
}

const STATUSES = new Set(Object.values(TEAM_PULSE_STATUS));

/** Fixed hedged prompts — workplace pulse, not clinical. */
export const DEFAULT_TEAM_PULSE_PROMPTS = Object.freeze([
  {
    key: 'contribute',
    pt: 'Neste grupo, sinto que posso contribuir com o meu melhor.',
    en: 'In this group, I feel I can contribute my best.',
  },
  {
    key: 'clarity',
    pt: 'Tenho clareza do que o grupo espera de mim nesta fase.',
    en: 'I am clear on what the group expects from me in this phase.',
  },
  {
    key: 'speak_up',
    pt: 'Consigo levantar riscos ou dúvidas sem medo de retaliação.',
    en: 'I can raise risks or doubts without fear of retaliation.',
  },
  {
    key: 'energy',
    pt: 'O ritmo do grupo tende a ser sustentável para mim.',
    en: 'The group’s pace tends to be sustainable for me.',
  },
]);

function normalizeTitle(raw) {
  const title = String(raw || '').trim().slice(0, TITLE_MAX);
  return title.length >= 1 ? title : null;
}

async function assertGroupInCompany(db, { companyId, teamGroupId }) {
  const res = await db.query(
    `SELECT id FROM team_groups
     WHERE id = $1 AND company_id = $2 AND deleted = FALSE
     LIMIT 1`,
    [teamGroupId, companyId]
  );
  return res.rowCount > 0;
}

export async function createTeamPulse(dbOrQuery, {
  companyId,
  teamGroupId,
  title,
  createdByUserId = null,
  locale = 'pt-BR',
}) {
  const db = asDb(dbOrQuery);
  if (!(await assertGroupInCompany(db, { companyId, teamGroupId }))) {
    return { ok: false, errorCode: ERR.INVALID_GROUP };
  }
  const safeTitle = normalizeTitle(title);
  if (!safeTitle) return { ok: false, errorCode: ERR.TITLE_REQUIRED };

  const res = await db.query(
    `INSERT INTO team_pulses (company_id, team_group_id, title, status, created_by_user_id)
     VALUES ($1, $2, $3, 'draft', $4)
     RETURNING id, company_id AS "companyId", team_group_id AS "teamGroupId",
               title, status, opens_at AS "opensAt", closes_at AS "closesAt",
               created_at AS "createdAt", updated_at AS "updatedAt"`,
    [companyId, teamGroupId, safeTitle, createdByUserId || null]
  );
  const pulse = res.rows[0];
  const prompts = DEFAULT_TEAM_PULSE_PROMPTS;
  for (let i = 0; i < prompts.length; i += 1) {
    const p = prompts[i];
    const text = contentLocale(locale) === 'en' ? p.en : p.pt;
    await db.query(
      `INSERT INTO team_pulse_questions (
         pulse_id, company_id, prompt_key, prompt, sort_order
       ) VALUES ($1, $2, $3, $4, $5)`,
      [pulse.id, companyId, p.key, text.slice(0, PROMPT_MAX), i]
    );
  }
  return { ok: true, pulse: await getTeamPulse(db, { companyId, pulseId: pulse.id }) };
}

export async function listTeamPulses(dbOrQuery, { companyId, teamGroupId, limit = LIST_CAP }) {
  const db = asDb(dbOrQuery);
  const cap = Math.min(Math.max(1, Number(limit) || LIST_CAP), LIST_CAP);
  const res = await db.query(
    `SELECT p.id, p.company_id AS "companyId", p.team_group_id AS "teamGroupId",
            p.title, p.status, p.opens_at AS "opensAt", p.closes_at AS "closesAt",
            p.created_at AS "createdAt", p.updated_at AS "updatedAt",
            (SELECT COUNT(*)::int FROM team_pulse_questions q
              WHERE q.pulse_id = p.id AND q.active = TRUE) AS "questionCount",
            (SELECT COUNT(*)::int FROM team_pulse_responses r
              WHERE r.pulse_id = p.id) AS "responseCount"
     FROM team_pulses p
     WHERE p.company_id = $1 AND p.team_group_id = $2 AND p.deleted = FALSE
     ORDER BY p.updated_at DESC, p.id DESC
     LIMIT $3`,
    [companyId, teamGroupId, cap]
  );
  return res.rows;
}

export async function getTeamPulse(dbOrQuery, { companyId, pulseId }) {
  const db = asDb(dbOrQuery);
  const res = await db.query(
    `SELECT p.id, p.company_id AS "companyId", p.team_group_id AS "teamGroupId",
            p.title, p.status, p.opens_at AS "opensAt", p.closes_at AS "closesAt",
            p.created_at AS "createdAt", p.updated_at AS "updatedAt"
     FROM team_pulses p
     WHERE p.id = $1 AND p.company_id = $2 AND p.deleted = FALSE
     LIMIT 1`,
    [pulseId, companyId]
  );
  if (res.rowCount === 0) return null;
  const pulse = res.rows[0];
  const q = await db.query(
    `SELECT id, pulse_id AS "pulseId", prompt_key AS "promptKey", prompt,
            sort_order AS "sortOrder", scale_min AS "scaleMin", scale_max AS "scaleMax"
     FROM team_pulse_questions
     WHERE pulse_id = $1 AND company_id = $2 AND active = TRUE
     ORDER BY sort_order ASC, id ASC
     LIMIT $3`,
    [pulseId, companyId, QUESTIONS_CAP]
  );
  const counts = await db.query(
    `SELECT COUNT(*)::int AS n FROM team_pulse_responses
     WHERE pulse_id = $1 AND company_id = $2`,
    [pulseId, companyId]
  );
  return {
    ...pulse,
    questions: q.rows,
    responseCount: Number(counts.rows[0]?.n) || 0,
    minResponses: teamPulseMinResponses(),
  };
}

export async function setTeamPulseStatus(dbOrQuery, { companyId, pulseId, status }) {
  const db = asDb(dbOrQuery);
  const next = STATUSES.has(String(status)) ? String(status) : null;
  if (!next) return { ok: false, errorCode: ERR.INVALID_STATUS };
  const opens = next === 'open' ? new Date().toISOString() : null;
  const closes = next === 'closed' ? new Date().toISOString() : null;
  const res = await db.query(
    `UPDATE team_pulses
     SET status = $3,
         opens_at = CASE WHEN $3 = 'open' THEN COALESCE(opens_at, $4::timestamptz) ELSE opens_at END,
         closes_at = CASE WHEN $3 = 'closed' THEN $5::timestamptz ELSE closes_at END,
         updated_at = NOW()
     WHERE id = $1 AND company_id = $2 AND deleted = FALSE
     RETURNING id`,
    [pulseId, companyId, next, opens, closes]
  );
  if (res.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND };
  return { ok: true, pulse: await getTeamPulse(db, { companyId, pulseId }) };
}

export async function createTeamPulseInvite(dbOrQuery, { companyId, pulseId }) {
  const batch = await insertTeamPulseInvites(dbOrQuery, { companyId, pulseId, count: 1 });
  if (!batch.ok) return batch;
  return { ok: true, invite: batch.invites[0] };
}

export async function createTeamPulseInviteBatch(dbOrQuery, { companyId, pulseId, count = 5 }) {
  return insertTeamPulseInvites(dbOrQuery, {
    companyId,
    pulseId,
    count: Math.min(Math.max(1, Number(count) || 5), INVITE_BATCH_CAP),
  });
}

/** Pulse checked once, all tokens in one insert; nothing inserted unless the pulse is open. */
async function insertTeamPulseInvites(dbOrQuery, { companyId, pulseId, count }) {
  const db = asDb(dbOrQuery);
  const pulse = await getTeamPulse(db, { companyId, pulseId });
  if (!pulse) return { ok: false, errorCode: ERR.NOT_FOUND };
  if (pulse.status !== TEAM_PULSE_STATUS.OPEN) return { ok: false, errorCode: ERR.PULSE_NOT_OPEN };
  const tokens = Array.from({ length: count }, () => crypto.randomBytes(24).toString('hex'));
  const expires = new Date();
  expires.setUTCDate(expires.getUTCDate() + INVITE_TTL_DAYS);
  const res = await db.query(
    `INSERT INTO team_pulse_invites (pulse_id, company_id, token, expires_at)
     SELECT $1::bigint, $2::bigint, t.token, $4::timestamptz
     FROM unnest($3::text[]) AS t(token)
     RETURNING id, token, expires_at AS "expiresAt"`,
    [pulseId, companyId, tokens, expires.toISOString()]
  );
  return { ok: true, invites: res.rows.sort((a, b) => Number(a.id) - Number(b.id)) };
}

/**
 * Hedged reading of pulse means + optional T1–T9 mix of the saved group.
 */
export function buildTeamPulseReading({ overallMean, locale = 'pt-BR', typeMix = [] }) {
  const mean = Number(overallMean);
  let bandKey = 'mid';
  if (Number.isFinite(mean)) {
    if (mean >= 4) bandKey = 'high';
    else if (mean < 3.2) bandKey = 'low';
  }
  const bandText = {
    high: i18nT(locale, 'ui.teamPulses.overallScoresTendToLook'),
    mid: i18nT(locale, 'ui.teamPulses.scoresAreMixedSomeAreas'),
    low: i18nT(locale, 'ui.teamPulses.thereAreIndicationsTheGroup'),
  }[bandKey];

  let mixText = null;
  const top = (Array.isArray(typeMix) ? typeMix : [])
    .slice()
    .sort((a, b) => (b.n || 0) - (a.n || 0))
    .slice(0, 3)
    .filter((x) => x.type != null);
  if (top.length > 0) {
    const labels = top.map((x) => `T${x.type}×${x.n}`).join(', ');
    mixText = i18nT(locale, 'ui.teamPulses.groupStyleMixIndicativePulse', { labels });
  }

  return { bandKey, overallText: bandText, mixText };
}

async function loadGroupTypeMix(db, { companyId, teamGroupId }) {
  if (!teamGroupId) return [];
  try {
    const res = await db.query(
      `SELECT a.top_type AS type, COUNT(*)::int AS n
       FROM team_groups g
       CROSS JOIN LATERAL unnest(
         COALESCE(g.member_assessment_ids, '{}'::bigint[])
         || CASE WHEN g.base_assessment_id IS NOT NULL THEN ARRAY[g.base_assessment_id] ELSE '{}'::bigint[] END
       ) AS aid(assessment_id)
       JOIN assessments a ON a.id = aid.assessment_id AND a.top_type IS NOT NULL
       WHERE g.id = $1 AND g.company_id = $2 AND g.deleted = FALSE
       GROUP BY a.top_type
       ORDER BY n DESC
       LIMIT 9`,
      [teamGroupId, companyId]
    );
    return res.rows.map((r) => ({ type: Number(r.type), n: Number(r.n) || 0 }));
  } catch {
    return [];
  }
}

export async function getTeamPulseAggregate(dbOrQuery, { companyId, pulseId, locale = 'pt-BR' }) {
  const db = asDb(dbOrQuery);
  const pulse = await getTeamPulse(db, { companyId, pulseId });
  if (!pulse) return null;
  const min = teamPulseMinResponses();
  if ((pulse.responseCount || 0) < min) {
    return {
      pulseId,
      responseCount: pulse.responseCount,
      minResponses: min,
      ready: false,
      questions: [],
      reading: null,
    };
  }
  const responses = await db.query(
    `SELECT answers FROM team_pulse_responses
     WHERE pulse_id = $1 AND company_id = $2
     ORDER BY submitted_at DESC
     LIMIT 500`,
    [pulseId, companyId]
  );
  const byQ = {};
  for (const q of pulse.questions || []) {
    byQ[String(q.id)] = { questionId: q.id, prompt: q.prompt, promptKey: q.promptKey, sum: 0, n: 0 };
  }
  for (const row of responses.rows) {
    const answers = row.answers || {};
    for (const [qid, val] of Object.entries(answers)) {
      const bucket = byQ[String(qid)];
      const num = Number(val);
      if (!bucket || !Number.isFinite(num)) continue;
      bucket.sum += num;
      bucket.n += 1;
    }
  }
  const questions = Object.values(byQ).map((b) => ({
    questionId: b.questionId,
    prompt: b.prompt,
    promptKey: b.promptKey,
    mean: b.n > 0 ? Math.round((b.sum / b.n) * 10) / 10 : null,
    n: b.n,
  }));
  const means = questions.map((q) => q.mean).filter((m) => m != null);
  const overall =
    means.length > 0
      ? Math.round((means.reduce((a, b) => a + b, 0) / means.length) * 10) / 10
      : null;
  const typeMix = await loadGroupTypeMix(db, {
    companyId,
    teamGroupId: pulse.teamGroupId,
  });
  return {
    pulseId,
    responseCount: pulse.responseCount,
    minResponses: min,
    ready: true,
    overallMean: overall,
    questions,
    reading: buildTeamPulseReading({
      overallMean: overall,
      locale,
      typeMix,
    }),
  };
}

export async function getPublicTeamPulseByToken(dbOrQuery, token) {
  const db = asDb(dbOrQuery);
  const tok = String(token || '').trim();
  if (tok.length < 16) return { ok: false, errorCode: ERR.NOT_FOUND };
  const res = await db.query(
    `SELECT i.id AS "inviteId", i.token, i.expires_at AS "expiresAt", i.used_at AS "usedAt",
            p.id AS "pulseId", p.company_id AS "companyId", p.title, p.status,
            p.deleted
     FROM team_pulse_invites i
     JOIN team_pulses p ON p.id = i.pulse_id
     WHERE i.token = $1
     LIMIT 1`,
    [tok]
  );
  if (res.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND };
  const row = res.rows[0];
  if (row.deleted || row.status !== 'open') return { ok: false, errorCode: ERR.UNAVAILABLE };
  if (row.usedAt) return { ok: false, errorCode: ERR.ALREADY_USED };
  if (row.expiresAt && new Date(row.expiresAt) < new Date()) {
    return { ok: false, errorCode: ERR.EXPIRED };
  }
  const pulse = await getTeamPulse(db, { companyId: row.companyId, pulseId: row.pulseId });
  return {
    ok: true,
    inviteId: row.inviteId,
    companyId: row.companyId,
    pulse: {
      id: pulse.id,
      title: pulse.title,
      questions: (pulse.questions || []).map((q) => ({
        id: q.id,
        prompt: q.prompt,
        scaleMin: q.scaleMin,
        scaleMax: q.scaleMax,
      })),
    },
  };
}

export async function submitPublicTeamPulse(dbOrQuery, { token, answers }) {
  const loaded = await getPublicTeamPulseByToken(dbOrQuery, token);
  if (!loaded.ok) return loaded;
  const db = asDb(dbOrQuery);
  const allowed = new Set((loaded.pulse.questions || []).map((q) => String(q.id)));
  const clean = {};
  for (const [k, v] of Object.entries(answers || {})) {
    if (!allowed.has(String(k))) continue;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 1 || n > 10) continue;
    clean[String(k)] = Math.round(n);
  }
  if (Object.keys(clean).length < 1) return { ok: false, errorCode: ERR.ANSWERS_REQUIRED };

  await db.query('BEGIN');
  try {
    const lock = await db.query(
      `SELECT id, used_at AS "usedAt" FROM team_pulse_invites
       WHERE id = $1 FOR UPDATE`,
      [loaded.inviteId]
    );
    if (lock.rowCount === 0 || lock.rows[0].usedAt) {
      await db.query('ROLLBACK');
      return { ok: false, errorCode: ERR.ALREADY_USED };
    }
    await db.query(
      `INSERT INTO team_pulse_responses (pulse_id, company_id, invite_id, answers)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [loaded.pulse.id, loaded.companyId, loaded.inviteId, JSON.stringify(clean)]
    );
    await db.query(`UPDATE team_pulse_invites SET used_at = NOW() WHERE id = $1`, [
      loaded.inviteId,
    ]);
    await db.query('COMMIT');
    return { ok: true };
  } catch (err) {
    await db.query('ROLLBACK');
    throw err;
  }
}
