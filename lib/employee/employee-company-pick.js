/**
 * Short-lived challenge after password OK on multiple employee rows (same email).
 * Lists only companies where the password matched — never before auth.
 */
import jwt from 'jsonwebtoken';
import { getJwtSecret } from '../identity/jwt-secret.js';

const PICK_TTL_SEC = 5 * 60;
const PURPOSE = 'employee-company-pick';

/**
 * @param {{ email: string, choices: Array<{ candidateId: number, companyId: number }> }} opts
 */
export function signEmployeeCompanyPickChallenge({ email, choices }) {
  const em = String(email || '').trim().toLowerCase();
  const list = (Array.isArray(choices) ? choices : [])
    .map((c) => ({
      candidateId: Number(c.candidateId),
      companyId: Number(c.companyId),
    }))
    .filter((c) => Number.isFinite(c.candidateId) && Number.isFinite(c.companyId))
    .slice(0, 10);
  if (!em || list.length < 2) {
    throw new Error('signEmployeeCompanyPickChallenge requires email and 2+ choices');
  }
  return jwt.sign(
    { purpose: PURPOSE, subject: 'employee', email: em, choices: list },
    getJwtSecret(),
    { expiresIn: PICK_TTL_SEC }
  );
}

/**
 * @returns {{ email: string, choices: Array<{ candidateId: number, companyId: number }> } | null}
 */
export function verifyEmployeeCompanyPickChallenge(token) {
  try {
    const payload = jwt.verify(String(token || ''), getJwtSecret());
    if (payload?.purpose !== PURPOSE || payload?.subject !== 'employee') return null;
    const email = String(payload.email || '').trim().toLowerCase();
    const choices = (Array.isArray(payload.choices) ? payload.choices : [])
      .map((c) => ({
        candidateId: Number(c.candidateId),
        companyId: Number(c.companyId),
      }))
      .filter((c) => Number.isFinite(c.candidateId) && Number.isFinite(c.companyId));
    if (!email || choices.length < 2) return null;
    return { email, choices };
  } catch {
    return null;
  }
}
