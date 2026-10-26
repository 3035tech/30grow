import { SignJWT, jwtVerify } from 'jose';
import { getJwtSecret } from './jwt-secret.js';
import { MANAGER_SESSION_MAX_AGE_SEC } from './session-ttl.js';
import {
  EMPLOYEE_KIND,
  EMPLOYEE_SESSION_MAX_AGE,
} from '../employee/employee-auth-constants.js';
import { normalizeLocale } from '../locale-negotiation.js';

function getSecretKey() {
  try {
    return new TextEncoder().encode(getJwtSecret());
  } catch {
    const raw = String(process.env.JWT_SECRET || '').trim();
    if (raw.length >= 32) return new TextEncoder().encode(raw);
    return null;
  }
}

/**
 * Reassina JWT de gestor no Edge (sliding session). Mesmos claims que `signToken`.
 * @returns {Promise<string|null>}
 */
export async function signManagerTokenEdge(claims = {}) {
  if (claims.kind === EMPLOYEE_KIND) return null;
  const { userId, role, companyId = null, locale = 'pt-BR', sv } = claims;
  const sessionVersion = Number(sv);
  if (!Number.isFinite(sessionVersion) || sessionVersion < 1) return null;
  const uid = Number(userId);
  if (!Number.isFinite(uid) || uid <= 0 || !role) return null;
  let company = null;
  if (companyId != null && companyId !== '') {
    company = Number(companyId);
    if (!Number.isFinite(company) || company <= 0) return null;
  }
  const key = getSecretKey();
  if (!key) return null;
  try {
    return await new SignJWT({
      userId: uid,
      role,
      companyId: company,
      locale: normalizeLocale(locale),
      sv: sessionVersion,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(`${MANAGER_SESSION_MAX_AGE_SEC}s`)
      .sign(key);
  } catch {
    return null;
  }
}

/**
 * Reassina JWT de colaborador no Edge (sliding). Mesmos claims que `signEmployeeToken`.
 * @returns {Promise<string|null>}
 */
export async function signEmployeeTokenEdge({
  candidateId,
  companyId,
  email,
  locale = 'pt-BR',
  sv,
}) {
  const cid = Number(candidateId);
  const company = Number(companyId);
  const sessionVersion = Number(sv);
  if (!Number.isFinite(cid) || cid <= 0 || !Number.isFinite(company) || company <= 0) return null;
  if (!Number.isFinite(sessionVersion) || sessionVersion < 1) return null;
  const key = getSecretKey();
  if (!key) return null;
  try {
    return await new SignJWT({
      kind: EMPLOYEE_KIND,
      candidateId: cid,
      companyId: company,
      email: String(email || '').trim().toLowerCase().slice(0, 320) || null,
      locale: normalizeLocale(locale),
      sv: sessionVersion,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(`${EMPLOYEE_SESSION_MAX_AGE}s`)
      .sign(key);
  } catch {
    return null;
  }
}

export async function verifyTokenEdge(token) {
  try {
    const key = getSecretKey();
    if (!key) return null;
    const { payload } = await jwtVerify(token, key);
    return payload;
  } catch {
    return null;
  }
}

/** Collaborator JWT (kind=employee). Does not grant manager /dashboard. Inclui `exp` para sliding. */
export async function verifyEmployeeTokenEdge(token) {
  const payload = await verifyTokenEdge(token);
  if (!payload || payload.kind !== EMPLOYEE_KIND) return null;
  const candidateId = Number(payload.candidateId);
  const companyId = Number(payload.companyId);
  const sv = Number(payload.sv);
  if (!Number.isFinite(candidateId) || !Number.isFinite(companyId)) return null;
  if (!Number.isFinite(sv) || sv < 1) return null;
  const exp = Number(payload.exp);
  return {
    ...(Number.isSafeInteger(payload.rememberUntil) ? { rememberUntil: payload.rememberUntil } : {}),
    kind: EMPLOYEE_KIND,
    candidateId,
    companyId,
    email: payload.email || null,
    locale: normalizeLocale(payload.locale),
    sv,
    exp: Number.isFinite(exp) ? exp : null,
  };
}
