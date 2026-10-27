/**
 * Collaborator self-service profile + password (candidates, not users).
 */

import { asDb } from '../ae/as-db.js';
import { query } from '../db.js';
import { ERR } from '../api-error-codes.js';
import { EMPLOYMENT_STATUS } from '../domain-status.js';
import { normalizeCandidateProfile } from '../recruiting/candidate-profile.js';
import { toDateOnlyIso } from '../format-display-date.js';
import { normalizeLocale } from '../i18n.js';

function cleanName(v) {
  const s = String(v || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 200);
  return s || null;
}

function cleanBirthDate(v) {
  if (v == null || v === '') return null;
  const s = String(v).trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

export async function getEmployeeProfile(dbOrQuery, { companyId, candidateId }) {
  const db = asDb(dbOrQuery || query);
  const cid = Number(companyId);
  const cand = Number(candidateId);
  if (!Number.isFinite(cid) || !Number.isFinite(cand)) {
    return { ok: false, errorCode: ERR.UNAUTHORIZED };
  }

  const r = await db.query(
    `SELECT c.id AS "candidateId", c.full_name AS "fullName", c.email,
            c.phone, c.linkedin_url AS "linkedinUrl", c.city, c.state,
            c.birth_date AS "birthDate",
            c.preferred_locale AS "preferredLocale",
            c.password_hash IS NOT NULL AS "hasPassword",
            co.name AS "companyName",
            co.logo_url AS "companyLogoUrl"
     FROM candidates c
     JOIN companies co ON co.id = c.company_id AND co.deleted = FALSE
     WHERE c.id = $1 AND c.company_id = $2
       AND c.employment_status = '${EMPLOYMENT_STATUS.EMPLOYEE}'
     LIMIT 1`,
    [cand, cid]
  );
  if (r.rowCount === 0) return { ok: false, errorCode: ERR.UNAUTHORIZED };
  const row = r.rows[0];
  return {
    ok: true,
    person: {
      candidateId: Number(row.candidateId),
      fullName: row.fullName,
      email: row.email,
      phone: row.phone,
      linkedinUrl: row.linkedinUrl,
      city: row.city,
      state: row.state,
      birthDate: toDateOnlyIso(row.birthDate),
      preferredLocale: row.preferredLocale ? normalizeLocale(row.preferredLocale) : null,
      hasPassword: Boolean(row.hasPassword),
      companyName: row.companyName,
      companyLogoUrl: row.companyLogoUrl || null,
    },
  };
}

/**
 * Self-edit safe fields only (no employment, salary, hr_notes, email).
 */
export async function updateEmployeeProfile(dbOrQuery, { companyId, candidateId, patch = {} }) {
  const db = asDb(dbOrQuery || query);
  const cid = Number(companyId);
  const cand = Number(candidateId);
  if (!Number.isFinite(cid) || !Number.isFinite(cand)) {
    return { ok: false, errorCode: ERR.UNAUTHORIZED };
  }

  const profile = normalizeCandidateProfile(patch);
  const fullName = patch.fullName !== undefined ? cleanName(patch.fullName) : undefined;
  const birthDate = patch.birthDate !== undefined ? cleanBirthDate(patch.birthDate) : undefined;
  const preferredLocale =
    patch.preferredLocale !== undefined ? normalizeLocale(patch.preferredLocale) : undefined;

  const sets = [];
  const params = [];
  let n = 1;

  if (fullName !== undefined) {
    if (!fullName) return { ok: false, errorCode: ERR.INVALID_DATA };
    sets.push(`full_name = $${n++}`);
    params.push(fullName);
  }
  if (patch.phone !== undefined) {
    sets.push(`phone = $${n++}`);
    params.push(profile.phone);
  }
  if (patch.linkedinUrl !== undefined || patch.linkedin !== undefined) {
    sets.push(`linkedin_url = $${n++}`);
    params.push(profile.linkedinUrl);
  }
  if (patch.city !== undefined) {
    sets.push(`city = $${n++}`);
    params.push(profile.city);
  }
  if (patch.state !== undefined) {
    sets.push(`state = $${n++}`);
    params.push(profile.state);
  }
  if (birthDate !== undefined) {
    sets.push(`birth_date = $${n++}::date`);
    params.push(birthDate);
  }
  if (preferredLocale !== undefined) {
    sets.push(`preferred_locale = $${n++}`);
    params.push(preferredLocale);
  }

  if (sets.length === 0) return { ok: false, errorCode: ERR.NO_FIELDS_TO_UPDATE };

  params.push(cand, cid);
  const r = await db.query(
    `UPDATE candidates
     SET ${sets.join(', ')}
     WHERE id = $${n++} AND company_id = $${n}
       AND employment_status = '${EMPLOYMENT_STATUS.EMPLOYEE}'
     RETURNING id`,
    params
  );
  if (r.rowCount === 0) return { ok: false, errorCode: ERR.UNAUTHORIZED };
  return getEmployeeProfile(db, { companyId: cid, candidateId: cand });
}

export async function changeEmployeePassword(dbOrQuery, {
  companyId,
  candidateId,
  currentPassword,
  newPassword,
}) {
  const db = asDb(dbOrQuery || query);
  const cid = Number(companyId);
  const cand = Number(candidateId);
  const next = String(newPassword || '');
  if (!Number.isFinite(cid) || !Number.isFinite(cand)) {
    return { ok: false, errorCode: ERR.UNAUTHORIZED };
  }
  if (next.length < 8) return { ok: false, errorCode: ERR.PASSWORD_TOO_SHORT };

  const r = await db.query(
    `SELECT password_hash AS "passwordHash"
     FROM candidates
     WHERE id = $1 AND company_id = $2
       AND employment_status = '${EMPLOYMENT_STATUS.EMPLOYEE}'
     LIMIT 1`,
    [cand, cid]
  );
  if (r.rowCount === 0) return { ok: false, errorCode: ERR.UNAUTHORIZED };
  const hash = r.rows[0].passwordHash;
  if (!hash) return { ok: false, errorCode: ERR.UNAUTHORIZED };

  const { verifyPassword, hashPassword } = await import('../identity/auth.js');
  const ok = await verifyPassword(String(currentPassword || ''), hash);
  if (!ok) return { ok: false, errorCode: ERR.UNAUTHORIZED };

  const newHash = await hashPassword(next);
  await db.query(
    `UPDATE candidates
     SET password_hash = $3,
         password_setup_token = NULL,
         password_setup_expires_at = NULL
     WHERE id = $1 AND company_id = $2`,
    [cand, cid, newHash]
  );
  const { bumpEmployeeSessionVersion } = await import('./employee-session-revocation.js');
  await bumpEmployeeSessionVersion(db, cand, cid);
  return { ok: true };
}
