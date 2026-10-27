/**
 * B-2707 — Interview slots per vacancy/candidate (light calendar, no Google sync).
 */

import { query, queryRead } from '../db.js';
import { ERR } from '../api-error-codes.js';
import { INTERVIEW_SLOT_STATUS, INTERVIEW_SLOT_STATUSES } from '../domain-status.js';
import { notifyCompanyManagers } from '../manager-notifications.js';
import { NOTIF } from '../manager-notification-catalog.js';
import { enqueueTransactionalMail, isMailConfigured } from '../mail.js';
import { t, localeHtmlLang, contentLocale } from '../i18n.js';

export const INTERVIEW_SLOTS_LIST_CAP = 100;
export const INTERVIEW_SLOT_NOTES_MAX = 2000;
export const INTERVIEW_MEET_URL_MAX = 500;

const SLOT_STATUSES = new Set(INTERVIEW_SLOT_STATUSES);

/**
 * @param {string} url
 */
export function validateMeetUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return { ok: false, errorCode: ERR.INVALID_MEET_URL };
  if (raw.length > INTERVIEW_MEET_URL_MAX) return { ok: false, errorCode: ERR.INVALID_MEET_URL };
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') return { ok: false, errorCode: ERR.INVALID_MEET_URL };
    return { ok: true, meetUrl: raw };
  } catch {
    return { ok: false, errorCode: ERR.INVALID_MEET_URL };
  }
}

function parseIsoDate(value, fieldErr = ERR.INVALID_DATE) {
  const raw = String(value || '').trim();
  if (!raw) return { ok: false, errorCode: fieldErr };
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return { ok: false, errorCode: fieldErr };
  return { ok: true, date: d };
}

function rowToDto(row) {
  return {
    id: row.id,
    companyId: row.companyId,
    vacancyId: row.vacancyId,
    candidateId: row.candidateId,
    candidateName: row.candidateName || null,
    candidateEmail: row.candidateEmail || null,
    startsAt: row.startsAt,
    endsAt: row.endsAt || null,
    meetUrl: row.meetUrl || '',
    status: row.status,
    notes: row.notes || '',
    createdByUserId: row.createdByUserId ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function loadVacancyScope(vacancyId, companyId, isAdmin) {
  const vid = Number(vacancyId);
  if (!Number.isFinite(vid) || vid <= 0) return { ok: false, errorCode: ERR.INVALID_VACANCY };
  const res = await queryRead(
    `SELECT v.id, v.company_id AS "companyId", v.title
     FROM vacancies v
     WHERE v.id = $1 AND v.deleted = FALSE ${!isAdmin ? 'AND v.company_id = $2' : ''}
     LIMIT 1`,
    !isAdmin ? [vid, companyId] : [vid]
  );
  if (res.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND };
  return { ok: true, vacancy: res.rows[0] };
}

async function assertCandidateOnVacancy(vacancyId, candidateId, companyId) {
  const res = await queryRead(
    `SELECT c.id, c.full_name AS "fullName", c.email
     FROM vacancy_candidates vc
     JOIN candidates c ON c.id = vc.candidate_id
     WHERE vc.vacancy_id = $1 AND vc.candidate_id = $2 AND vc.company_id = $3
     LIMIT 1`,
    [vacancyId, candidateId, companyId]
  );
  if (res.rowCount === 0) return { ok: false, errorCode: ERR.CANDIDATE_NOT_FOUND };
  return { ok: true, candidate: res.rows[0] };
}

/**
 * @param {{ vacancyId: number, companyId: number|null, isAdmin: boolean, weekStart?: string, weekEnd?: string }} opts
 */
export async function listInterviewSlots(opts) {
  const loaded = await loadVacancyScope(opts.vacancyId, opts.companyId, opts.isAdmin);
  if (!loaded.ok) return loaded;
  const vacCompanyId = Number(loaded.vacancy.companyId);

  let fromTs;
  let toTs;
  if (opts.weekStart || opts.weekEnd) {
    const from = parseIsoDate(opts.weekStart || opts.weekEnd);
    const to = parseIsoDate(opts.weekEnd || opts.weekStart);
    if (!from.ok || !to.ok) return { ok: false, errorCode: ERR.INVALID_DATE };
    fromTs = from.date;
    toTs = to.date;
    if (fromTs > toTs) {
      const tmp = fromTs;
      fromTs = toTs;
      toTs = tmp;
    }
  }

  const params = [opts.vacancyId];
  let where = 's.vacancy_id = $1';
  if (!opts.isAdmin) {
    params.push(vacCompanyId);
    where += ` AND s.company_id = $${params.length}`;
  }
  if (fromTs && toTs) {
    params.push(fromTs.toISOString(), toTs.toISOString());
    where += ` AND s.starts_at >= $${params.length - 1}::timestamptz AND s.starts_at < $${params.length}::timestamptz`;
  }

  const res = await queryRead(
    `SELECT s.id, s.company_id AS "companyId", s.vacancy_id AS "vacancyId",
            s.candidate_id AS "candidateId", c.full_name AS "candidateName", c.email AS "candidateEmail",
            s.starts_at AS "startsAt", s.ends_at AS "endsAt", s.meet_url AS "meetUrl",
            s.status, s.notes, s.created_by_user_id AS "createdByUserId",
            s.created_at AS "createdAt", s.updated_at AS "updatedAt"
     FROM interview_slots s
     JOIN candidates c ON c.id = s.candidate_id
     WHERE ${where}
     ORDER BY s.starts_at ASC
     LIMIT ${INTERVIEW_SLOTS_LIST_CAP}`,
    params
  );

  return {
    ok: true,
    items: res.rows.map(rowToDto),
    truncated: res.rowCount >= INTERVIEW_SLOTS_LIST_CAP,
  };
}

function formatSlotWhen(startsAt, locale) {
  try {
    const d = new Date(startsAt);
    return d.toLocaleString(localeHtmlLang(locale), {
      dateStyle: 'full',
      timeStyle: 'short',
    });
  } catch {
    return String(startsAt || '');
  }
}

async function sendInterviewInviteEmail({ to, candidateName, vacancyTitle, startsAt, meetUrl, locale }) {
  if (!to || !isMailConfigured()) return;
  const when = formatSlotWhen(startsAt, locale);
  const subject = t(locale, 'recruiting.interviewSlotMailSubject', { title: vacancyTitle || '—' });
  const text = t(locale, 'recruiting.interviewSlotMailBody', {
    name: candidateName || '—',
    title: vacancyTitle || '—',
    when,
    meetUrl,
  });
  enqueueTransactionalMail({ to, subject, text });
}

/**
 * @param {{ vacancyId: number, companyId: number|null, isAdmin: boolean, body: object, actorUserId?: number|null, request?: Request }} opts
 */
export async function createInterviewSlot(opts) {
  const loaded = await loadVacancyScope(opts.vacancyId, opts.companyId, opts.isAdmin);
  if (!loaded.ok) return loaded;
  const vac = loaded.vacancy;
  const vacCompanyId = Number(vac.companyId);

  const candidateId = Number(opts.body?.candidateId);
  if (!Number.isFinite(candidateId) || candidateId <= 0) {
    return { ok: false, errorCode: ERR.INVALID_DATA };
  }

  const cand = await assertCandidateOnVacancy(opts.vacancyId, candidateId, vacCompanyId);
  if (!cand.ok) return cand;

  const starts = parseIsoDate(opts.body?.startsAt, ERR.INVALID_DATE);
  if (!starts.ok) return starts;

  let endsAt = null;
  if (opts.body?.endsAt != null && String(opts.body.endsAt).trim() !== '') {
    const ends = parseIsoDate(opts.body.endsAt, ERR.INVALID_DATE);
    if (!ends.ok) return ends;
    endsAt = ends.date.toISOString();
    if (ends.date <= starts.date) return { ok: false, errorCode: ERR.INVALID_DATE };
  }

  const meet = validateMeetUrl(opts.body?.meetUrl);
  if (!meet.ok) return meet;

  const notes = String(opts.body?.notes || '').trim().slice(0, INTERVIEW_SLOT_NOTES_MAX);
  const actorId =
    opts.actorUserId != null && Number.isFinite(Number(opts.actorUserId))
      ? Number(opts.actorUserId)
      : null;

  const ins = await query(
    `INSERT INTO interview_slots (
       company_id, vacancy_id, candidate_id, starts_at, ends_at, meet_url, notes, created_by_user_id
     ) VALUES ($1, $2, $3, $4::timestamptz, $5::timestamptz, $6, $7, $8)
     RETURNING id, company_id AS "companyId", vacancy_id AS "vacancyId", candidate_id AS "candidateId",
               starts_at AS "startsAt", ends_at AS "endsAt", meet_url AS "meetUrl", status, notes,
               created_by_user_id AS "createdByUserId", created_at AS "createdAt", updated_at AS "updatedAt"`,
    [
      vacCompanyId,
      opts.vacancyId,
      candidateId,
      starts.date.toISOString(),
      endsAt,
      meet.meetUrl,
      notes,
      actorId,
    ]
  );

  const slotRow = {
    ...ins.rows[0],
    candidateName: cand.candidate.fullName,
    candidateEmail: cand.candidate.email,
  };
  const slot = rowToDto(slotRow);

  const locale = contentLocale(opts.locale);

  await notifyCompanyManagers(query, {
    companyId: vacCompanyId,
    type: NOTIF.INTERVIEW_SCHEDULED,
    payload: {
      candidateId,
      candidateName: cand.candidate.fullName,
      vacancyId: opts.vacancyId,
      vacancyTitle: vac.title,
      slotId: slot.id,
      startsAt: slot.startsAt,
    },
    entityType: 'interview_slot',
    entityId: slot.id,
  });

  if (cand.candidate.email) {
    await sendInterviewInviteEmail({
      to: cand.candidate.email,
      candidateName: cand.candidate.fullName,
      vacancyTitle: vac.title,
      startsAt: slot.startsAt,
      meetUrl: slot.meetUrl,
      locale,
    });
  }

  return { ok: true, slot };
}

async function loadSlotScope(slotId, vacancyId, companyId, isAdmin) {
  const sid = Number(slotId);
  const vid = Number(vacancyId);
  if (!Number.isFinite(sid) || sid <= 0 || !Number.isFinite(vid) || vid <= 0) {
    return { ok: false, errorCode: ERR.INVALID_ID };
  }
  const res = await queryRead(
    `SELECT s.id, s.company_id AS "companyId", s.vacancy_id AS "vacancyId",
            s.candidate_id AS "candidateId", c.full_name AS "candidateName", c.email AS "candidateEmail",
            s.starts_at AS "startsAt", s.ends_at AS "endsAt", s.meet_url AS "meetUrl",
            s.status, s.notes, s.created_by_user_id AS "createdByUserId",
            s.created_at AS "createdAt", s.updated_at AS "updatedAt"
     FROM interview_slots s
     JOIN candidates c ON c.id = s.candidate_id
     WHERE s.id = $1 AND s.vacancy_id = $2 ${!isAdmin ? 'AND s.company_id = $3' : ''}
     LIMIT 1`,
    !isAdmin ? [sid, vid, companyId] : [sid, vid]
  );
  if (res.rowCount === 0) return { ok: false, errorCode: ERR.INTERVIEW_SLOT_NOT_FOUND };
  return { ok: true, slot: res.rows[0] };
}

/**
 * @param {{ slotId: number, vacancyId: number, companyId: number|null, isAdmin: boolean, body: object }} opts
 */
export async function updateInterviewSlot(opts) {
  const loaded = await loadSlotScope(opts.slotId, opts.vacancyId, opts.companyId, opts.isAdmin);
  if (!loaded.ok) return loaded;

  const sets = [];
  const params = [opts.slotId, opts.vacancyId];
  let n = 3;

  if (opts.body?.startsAt !== undefined) {
    const starts = parseIsoDate(opts.body.startsAt, ERR.INVALID_DATE);
    if (!starts.ok) return starts;
    sets.push(`starts_at = $${n++}::timestamptz`);
    params.push(starts.date.toISOString());
  }
  if (opts.body?.endsAt !== undefined) {
    if (opts.body.endsAt == null || String(opts.body.endsAt).trim() === '') {
      sets.push('ends_at = NULL');
    } else {
      const ends = parseIsoDate(opts.body.endsAt, ERR.INVALID_DATE);
      if (!ends.ok) return ends;
      sets.push(`ends_at = $${n++}::timestamptz`);
      params.push(ends.date.toISOString());
    }
  }
  if (opts.body?.meetUrl !== undefined) {
    const meet = validateMeetUrl(opts.body.meetUrl);
    if (!meet.ok) return meet;
    sets.push(`meet_url = $${n++}`);
    params.push(meet.meetUrl);
  }
  if (opts.body?.notes !== undefined) {
    sets.push(`notes = $${n++}`);
    params.push(String(opts.body.notes || '').trim().slice(0, INTERVIEW_SLOT_NOTES_MAX));
  }
  if (opts.body?.status !== undefined) {
    const st = String(opts.body.status || '').trim();
    if (!SLOT_STATUSES.has(st)) return { ok: false, errorCode: ERR.INVALID_DATA };
    sets.push(`status = $${n++}`);
    params.push(st);
  }

  if (sets.length === 0) return { ok: false, errorCode: ERR.NO_FIELDS_TO_UPDATE };

  sets.push('updated_at = NOW()');

  let whereExtra = '';
  if (!opts.isAdmin) {
    params.push(Number(loaded.slot.companyId));
    whereExtra = ` AND company_id = $${params.length}`;
  }

  const up = await query(
    `UPDATE interview_slots SET ${sets.join(', ')}
     WHERE id = $1 AND vacancy_id = $2${whereExtra}
     RETURNING id, company_id AS "companyId", vacancy_id AS "vacancyId", candidate_id AS "candidateId",
               starts_at AS "startsAt", ends_at AS "endsAt", meet_url AS "meetUrl", status, notes,
               created_by_user_id AS "createdByUserId", created_at AS "createdAt", updated_at AS "updatedAt"`,
    params
  );
  if (up.rowCount === 0) return { ok: false, errorCode: ERR.INTERVIEW_SLOT_NOT_FOUND };

  const row = {
    ...up.rows[0],
    candidateName: loaded.slot.candidateName,
    candidateEmail: loaded.slot.candidateEmail,
  };
  return { ok: true, slot: rowToDto(row) };
}

/**
 * @param {{ slotId: number, vacancyId: number, companyId: number|null, isAdmin: boolean }} opts
 */
export async function cancelInterviewSlot(opts) {
  return updateInterviewSlot({
    ...opts,
    body: { status: INTERVIEW_SLOT_STATUS.CANCELLED },
  });
}
