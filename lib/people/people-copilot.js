/**
 * People copilot (B-3011): "who is on the radar" and "what to look at in the next 1:1".
 * A fixed registry of typed server tools reads existing signals (turnover radar, 1:1 cadence,
 * overdue PDI items, retention watches) scoped by the session company. The LLM never writes
 * SQL nor picks tools: it only drafts hedged agendas from pseudonymous refs (P1…P8), and the
 * deterministic list works without AI. Separate from the Help assistant.
 */

import { asDb } from '../ae/as-db.js';
import { ERR } from '../api-error-codes.js';
import { AI_FEATURE, aiUsageContext } from '../ai-usage.js';
import { DEVELOPMENT_PLAN_ITEM_STATUS, DEVELOPMENT_PLAN_STATUS, EMPLOYMENT_STATUS } from '../domain-status.js';
import { contentLocale } from '../i18n.js';
import { extractJsonObject, isOpenAiConfigured, openAiChatCompletion } from '../openai-chat.js';
import { getCompanyTurnoverRisks, loadTurnoverRadars } from '../turnover-radar.js';
import { getCompanyPdiPulse } from './development-plans.js';
import { lastOneOnOneByCandidate, listStaleOneOnOnes } from './one-on-ones.js';
import { listCompanyRetentionWatches } from './retention-watch.js';

export const COPILOT_QUESTION = Object.freeze({ RADAR: 'radar', PERSON: 'person' });
export const COPILOT_QUESTIONS = Object.freeze(Object.values(COPILOT_QUESTION));

export const COPILOT_TOOL = Object.freeze({
  TURNOVER: 'turnover_radar',
  ONE_ON_ONE: 'one_on_one_cadence',
  PDI: 'pdi_overdue',
  RETENTION: 'retention_watch',
});

export const COPILOT_REASON = Object.freeze({
  TURNOVER_HIGH: 'turnover_high',
  TURNOVER_MEDIUM: 'turnover_medium',
  RETENTION_WATCH: 'retention_watch',
  PDI_OVERDUE: 'pdi_overdue',
  NEVER_ONE_ON_ONE: 'never_one_on_one',
  STALE_ONE_ON_ONE: 'stale_one_on_one',
});

export const COPILOT_PEOPLE_CAP = 8;
export const COPILOT_STALE_DAYS = 30;
const RETENTION_DAYS = 14;

const WEIGHT = Object.freeze({
  [COPILOT_REASON.TURNOVER_HIGH]: 4,
  [COPILOT_REASON.RETENTION_WATCH]: 3,
  [COPILOT_REASON.TURNOVER_MEDIUM]: 2,
  [COPILOT_REASON.PDI_OVERDUE]: 2,
  [COPILOT_REASON.NEVER_ONE_ON_ONE]: 2,
  [COPILOT_REASON.STALE_ONE_ON_ONE]: 1,
});

const isoDate = (v) => (v ? (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10) : null);

function staleReason(lastMeeting) {
  return lastMeeting
    ? { code: COPILOT_REASON.STALE_ONE_ON_ONE, lastMeeting: isoDate(lastMeeting) }
    : { code: COPILOT_REASON.NEVER_ONE_ON_ONE };
}

function turnoverReason(risk, riskScore) {
  if (risk === 'high') return { code: COPILOT_REASON.TURNOVER_HIGH, riskScore: Number(riskScore) || 0 };
  if (risk === 'medium') return { code: COPILOT_REASON.TURNOVER_MEDIUM, riskScore: Number(riskScore) || 0 };
  return null;
}

/**
 * Typed tool registry. Each tool receives `{ db, companyId }` from the server session and
 * returns `[{ candidateId, name, reason }]`; nothing comes from the client except the question.
 */
const COMPANY_TOOLS = Object.freeze({
  [COPILOT_TOOL.TURNOVER]: async ({ companyId }) => {
    const r = await getCompanyTurnoverRisks(companyId, { limit: COPILOT_PEOPLE_CAP, minRisk: 'medium' });
    return (r.risks || [])
      .map((x) => ({ candidateId: Number(x.candidateId), name: x.candidateName, reason: turnoverReason(x.risk, x.riskScore) }))
      .filter((x) => x.reason);
  },
  [COPILOT_TOOL.ONE_ON_ONE]: async ({ db, companyId }) => {
    const rows = await listStaleOneOnOnes(db, { companyId, staleDays: COPILOT_STALE_DAYS, limit: COPILOT_PEOPLE_CAP });
    return rows.map((r) => ({ candidateId: Number(r.candidateId), name: r.candidateName, reason: staleReason(r.lastMeeting) }));
  },
  [COPILOT_TOOL.PDI]: async ({ db, companyId }) => {
    const pulse = await getCompanyPdiPulse(db, { companyId, queueLimit: COPILOT_PEOPLE_CAP, activePlansLimit: 1 });
    const byPerson = new Map();
    for (const item of pulse?.queue?.overdue || []) {
      const id = Number(item.candidateId);
      const cur = byPerson.get(id) || { candidateId: id, name: item.candidateName, reason: { code: COPILOT_REASON.PDI_OVERDUE, count: 0, oldestDue: item.dueDate || null } };
      cur.reason.count += 1;
      byPerson.set(id, cur);
    }
    return [...byPerson.values()];
  },
  [COPILOT_TOOL.RETENTION]: async ({ db, companyId }) => {
    const r = await listCompanyRetentionWatches(db, { companyId, days: RETENTION_DAYS, limit: COPILOT_PEOPLE_CAP });
    return (r.items || []).map((x) => ({
      candidateId: Number(x.candidateId),
      name: x.name,
      reason: { code: COPILOT_REASON.RETENTION_WATCH, since: isoDate(x.createdAt) },
    }));
  },
});

function rankPeople(hits) {
  const people = new Map();
  for (const hit of hits) {
    if (!Number.isSafeInteger(hit.candidateId) || hit.candidateId <= 0 || !hit.reason) continue;
    const cur = people.get(hit.candidateId) || { candidateId: hit.candidateId, name: hit.name || '', reasons: [], score: 0 };
    if (!cur.name && hit.name) cur.name = hit.name;
    if (!cur.reasons.some((r) => r.code === hit.reason.code)) {
      cur.reasons.push(hit.reason);
      cur.score += WEIGHT[hit.reason.code] || 1;
    }
    people.set(hit.candidateId, cur);
  }
  return [...people.values()]
    .map((p) => ({ ...p, reasons: p.reasons.sort((a, b) => (WEIGHT[b.code] || 0) - (WEIGHT[a.code] || 0)) }))
    .sort((a, b) => b.score - a.score || String(a.name).localeCompare(String(b.name)))
    .slice(0, COPILOT_PEOPLE_CAP);
}

/** Company radar: runs every company tool in parallel (each bounded) and ranks people. */
export async function buildCopilotRadar(dbOrQuery, { companyId }) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  if (!Number.isSafeInteger(cid) || cid <= 0) return { ok: false, errorCode: ERR.COMPANY_REQUIRED };
  const names = Object.keys(COMPANY_TOOLS);
  const settled = await Promise.allSettled(names.map((name) => COMPANY_TOOLS[name]({ db, companyId: cid })));
  const tools = names.map((name, i) => ({ name, ok: settled[i].status === 'fulfilled' }));
  for (const [i, s] of settled.entries()) {
    if (s.status === 'rejected') console.error(`[copilot] tool ${names[i]}`, s.reason?.message || s.reason);
  }
  const hits = settled.flatMap((s) => (s.status === 'fulfilled' ? s.value : []));
  return { ok: true, question: COPILOT_QUESTION.RADAR, people: rankPeople(hits), tools, staleDays: COPILOT_STALE_DAYS };
}

async function personOverduePdi(db, companyId, candidateId) {
  const r = await db.query(
    `SELECT COUNT(*)::int AS n, MIN(i.due_date) AS "oldestDue"
     FROM development_plan_items i
     JOIN development_plans p ON p.id = i.plan_id
     WHERE p.company_id = $1 AND p.candidate_id = $2
       AND p.status = '${DEVELOPMENT_PLAN_STATUS.ACTIVE}'
       AND i.status <> '${DEVELOPMENT_PLAN_ITEM_STATUS.DONE}'
       AND i.due_date IS NOT NULL AND i.due_date < CURRENT_DATE`,
    [companyId, candidateId]
  );
  const n = Number(r.rows[0]?.n) || 0;
  return n ? { code: COPILOT_REASON.PDI_OVERDUE, count: n, oldestDue: isoDate(r.rows[0].oldestDue) } : null;
}

/** One person (must be an active employee of the session company): every signal, no cap needed. */
export async function buildCopilotPerson(dbOrQuery, { companyId, candidateId }) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  const pid = Number(candidateId);
  if (![cid, pid].every((n) => Number.isSafeInteger(n) && n > 0)) return { ok: false, errorCode: ERR.INVALID_ID };
  const own = await db.query(
    `SELECT full_name AS name FROM candidates
     WHERE id = $1 AND company_id = $2 AND employment_status = '${EMPLOYMENT_STATUS.EMPLOYEE}' LIMIT 1`,
    [pid, cid]
  );
  if (!own.rowCount) return { ok: false, errorCode: ERR.NOT_FOUND };

  const steps = [
    [COPILOT_TOOL.TURNOVER, async () => {
      const radar = (await loadTurnoverRadars(db, cid, [pid])).get(pid);
      return radar ? turnoverReason(radar.risk, radar.riskScore) : null;
    }],
    [COPILOT_TOOL.ONE_ON_ONE, async () => {
      const last = (await lastOneOnOneByCandidate(db, { companyId: cid, candidateIds: [pid] })).get(pid) || null;
      const stale = !last || Date.now() - new Date(last).getTime() > COPILOT_STALE_DAYS * 86400000;
      return stale ? staleReason(last) : null;
    }],
    [COPILOT_TOOL.PDI, () => personOverduePdi(db, cid, pid)],
    [COPILOT_TOOL.RETENTION, async () => {
      const r = await listCompanyRetentionWatches(db, { companyId: cid, days: RETENTION_DAYS, limit: 50 });
      const hit = (r.items || []).find((x) => Number(x.candidateId) === pid);
      return hit ? { code: COPILOT_REASON.RETENTION_WATCH, since: isoDate(hit.createdAt) } : null;
    }],
  ];
  const settled = await Promise.allSettled(steps.map(([, fn]) => fn()));
  const tools = steps.map(([name], i) => ({ name, ok: settled[i].status === 'fulfilled' }));
  const hits = settled
    .map((s) => (s.status === 'fulfilled' ? s.value : null))
    .filter(Boolean)
    .map((reason) => ({ candidateId: pid, name: own.rows[0].name, reason }));
  const [person] = rankPeople(hits);
  return {
    ok: true,
    question: COPILOT_QUESTION.PERSON,
    people: [person || { candidateId: pid, name: own.rows[0].name, reasons: [], score: 0 }],
    tools,
    staleDays: COPILOT_STALE_DAYS,
  };
}

function systemPrompt(locale) {
  return contentLocale(locale) === 'en'
    ? [
        'You prepare 1:1 agendas for an HR manager at 30Grow. Use ONLY the JSON provided.',
        'People are pseudonymous refs (P1, P2…); never guess names or invent facts, scores or events.',
        'Hedged language ("tends to", "there are signs"); never clinical or legal conclusions, never mention dismissal.',
        'Reply ONLY with JSON: {"summary":"1-2 short sentences","agendas":[{"ref":"P1","topics":["…","…"]}]}.',
        'Max 3 topics per ref, each a short open question or concrete next step.',
      ].join(' ')
    : [
        'Você prepara pautas de 1:1 para um gestor de RH no 30Grow. Use SOMENTE o JSON fornecido.',
        'Pessoas são refs pseudônimas (P1, P2…); nunca adivinhe nomes nem invente fatos, scores ou eventos.',
        'Linguagem hedged (“tende a”, “há indícios”); nunca conclusões clínicas ou jurídicas, nunca fale em desligamento.',
        'Responda APENAS com JSON: {"summary":"1-2 frases curtas","agendas":[{"ref":"P1","topics":["…","…"]}]}.',
        'Máx. 3 tópicos por ref, cada um uma pergunta aberta curta ou próximo passo concreto.',
      ].join(' ');
}

/**
 * Optional AI agenda over the deterministic result. Sends only refs + reason codes/numbers
 * (no names, no free text). Returns `null` when AI is off or fails; the list stays usable.
 */
export async function draftCopilotAgendas({ people, locale = 'pt-BR', usage = null }) {
  const list = (people || []).slice(0, COPILOT_PEOPLE_CAP);
  if (!list.length || !isOpenAiConfigured()) return null;
  const refs = list.map((p, i) => ({ ref: `P${i + 1}`, candidateId: p.candidateId }));
  const payload = list.map((p, i) => ({
    ref: refs[i].ref,
    reasons: p.reasons.map(({ code, riskScore, count, lastMeeting }) => ({
      code,
      ...(riskScore != null ? { riskScore } : {}),
      ...(count != null ? { count } : {}),
      ...(lastMeeting ? { lastMeeting } : {}),
    })),
  }));
  try {
    const text = await openAiChatCompletion({
      messages: [
        { role: 'system', content: systemPrompt(locale) },
        { role: 'user', content: JSON.stringify({ people: payload, staleDays: COPILOT_STALE_DAYS, expected: '"agendas"' }) },
      ],
      temperature: 0.3,
      maxTokens: 700,
      responseFormat: 'json_object',
      usage: aiUsageContext(usage, AI_FEATURE.PEOPLE_COPILOT),
      feature: AI_FEATURE.PEOPLE_COPILOT,
    });
    const raw = extractJsonObject(text);
    const parsed = raw ? JSON.parse(raw) : {};
    const idByRef = new Map(refs.map((r) => [r.ref, r.candidateId]));
    const agendas = {};
    for (const a of Array.isArray(parsed?.agendas) ? parsed.agendas : []) {
      const id = idByRef.get(String(a?.ref || ''));
      if (!id) continue;
      const topics = (Array.isArray(a.topics) ? a.topics : []).map((s) => String(s || '').trim().slice(0, 240)).filter(Boolean).slice(0, 3);
      if (topics.length) agendas[id] = topics;
    }
    const summary = String(parsed?.summary || '').trim().slice(0, 600);
    if (!summary && !Object.keys(agendas).length) return null;
    return { summary, agendas };
  } catch (err) {
    if (err?.code !== ERR.AI_MONTHLY_LIMIT && err?.code !== ERR.RUBRIC_AI_NOT_CONFIGURED) {
      console.error('[copilot] ai', err?.message || err);
    }
    return null;
  }
}

/** Counts only (no names) for the audit trail. */
export function copilotAuditMetadata(result, { explain, aiOk }) {
  const reasonCounts = {};
  for (const p of result.people || []) {
    for (const r of p.reasons) reasonCounts[r.code] = (reasonCounts[r.code] || 0) + 1;
  }
  return {
    question: result.question,
    peopleCount: (result.people || []).length,
    reasonCounts,
    toolsFailed: (result.tools || []).filter((t) => !t.ok).map((t) => t.name),
    explain: Boolean(explain),
    aiOk: Boolean(aiOk),
  };
}
