import { issueSecondFactorChallenge, secondFactorChallengeLive } from './second-factor-challenge.js';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { query, withTransaction } from './db.js';
import { EMPLOYMENT_STATUS } from './domain-status.js';
import { verifyEmployeeCompanyPickChallenge } from './employee-company-pick.js';
import { loadEmployeeSessionVersion } from './employee-session-revocation.js';
import { getJwtSecret } from './jwt-secret.js';

export const MOBILE_EMPLOYEE_AUTH_OUTCOME = Object.freeze({
  AUTHENTICATED: 'authenticated',
  REQUIRES_COMPANY_SELECTION: 'requires_company_selection',
  REQUIRES_SECOND_FACTOR: 'requires_second_factor',
});

export const MOBILE_EMPLOYEE_TOKEN_PURPOSE = Object.freeze({
  ACCESS: 'mobile_employee_access',
  SECOND_FACTOR: 'mobile_employee_second_factor',
});

const ACCESS_TTL_SEC = 15 * 60;
const CHALLENGE_TTL_SEC = 5 * 60;
const REFRESH_TTL_SEC = 30 * 24 * 60 * 60;
const TOKEN_AUDIENCE = '30team-mobile-employee';
const TOKEN_ISSUER = '30team';

function tokenHash(token) {
  return crypto.createHash('sha256').update(String(token || ''), 'utf8').digest('hex');
}

function opaqueToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function expiresIso(ttlSeconds) {
  return new Date(Date.now() + ttlSeconds * 1000).toISOString();
}

function signToken(payload, expiresIn) {
  return jwt.sign(payload, getJwtSecret(), {
    audience: TOKEN_AUDIENCE,
    expiresIn,
    issuer: TOKEN_ISSUER,
  });
}

function verifyToken(token, purpose) {
  try {
    const payload = jwt.verify(String(token || ''), getJwtSecret(), {
      audience: TOKEN_AUDIENCE,
      issuer: TOKEN_ISSUER,
    });
    return payload?.purpose === purpose ? payload : null;
  } catch {
    return null;
  }
}

function positiveId(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function mobileEmployeeBearerToken(request) {
  const authorization = String(request?.headers?.get?.('authorization') || '').trim();
  return /^Bearer\s+([^\s]+)$/i.exec(authorization)?.[1] || null;
}

async function loadContexts(rawContexts) {
  const requested = (Array.isArray(rawContexts) ? rawContexts : [])
    .map((item) => ({ candidateId: positiveId(item?.candidateId), companyId: positiveId(item?.companyId) }))
    .filter((item) => item.candidateId && item.companyId)
    .slice(0, 10);
  if (requested.length === 0) return [];
  const candidateIds = requested.map((item) => item.candidateId);
  const result = await query(
    `SELECT c.id AS "candidateId", c.company_id AS "companyId", c.full_name AS "displayName",
            c.email, COALESCE(c.session_version, 1) AS "sessionVersion",
            co.name AS "companyName", co.logo_url AS "companyLogoUrl"
     FROM candidates c
     JOIN companies co ON co.id = c.company_id
     WHERE c.id = ANY($1::bigint[])
       AND c.employment_status = $2
       AND co.active = TRUE AND co.deleted = FALSE
     ORDER BY LOWER(co.name), c.id`,
    [candidateIds, EMPLOYMENT_STATUS.EMPLOYEE]
  );
  const allowed = new Set(requested.map((item) => `${item.candidateId}:${item.companyId}`));
  return result.rows
    .filter((row) => allowed.has(`${row.candidateId}:${row.companyId}`))
    .map((row) => ({
      candidateId: Number(row.candidateId),
      company: { id: Number(row.companyId), logoUrl: row.companyLogoUrl || null, name: row.companyName },
      displayName: row.displayName,
      email: row.email,
      sessionVersion: Number(row.sessionVersion) || 1,
    }));
}

function publicContext(context) {
  return { candidateId: context.candidateId, company: context.company };
}

async function createRefreshSession(context, contexts) {
  const refreshToken = opaqueToken();
  const familyId = crypto.randomUUID();
  const refreshTokenExpiresAt = expiresIso(REFRESH_TTL_SEC);
  const allowedContexts = contexts.map((item) => ({
    candidateId: item.candidateId,
    companyId: item.company.id,
    sessionVersion: item.sessionVersion,
  }));
  await query(
    `INSERT INTO mobile_employee_refresh_sessions (
       family_id, candidate_id, company_id, token_hash, session_version, allowed_contexts, expires_at
     ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
    [familyId, context.candidateId, context.company.id, tokenHash(refreshToken), context.sessionVersion,
      JSON.stringify(allowedContexts), refreshTokenExpiresAt]
  );
  return { familyId, refreshToken, refreshTokenExpiresAt };
}

function buildSession(context, contexts, tokenContext) {
  const accessToken = signToken({
    purpose: MOBILE_EMPLOYEE_TOKEN_PURPOSE.ACCESS,
    candidateId: context.candidateId,
    companyId: context.company.id,
    sv: context.sessionVersion,
    sid: tokenContext.familyId,
  }, ACCESS_TTL_SEC);
  return {
    identity: {
      candidateId: context.candidateId,
      displayName: context.displayName,
      email: context.email,
      locale: 'pt-BR',
    },
    activeContext: publicContext(context),
    availableContexts: contexts.map(publicContext),
    tokens: {
      accessToken,
      accessTokenExpiresAt: expiresIso(ACCESS_TTL_SEC),
      ...(tokenContext.refreshToken ? {
        refreshToken: tokenContext.refreshToken,
        refreshTokenExpiresAt: tokenContext.refreshTokenExpiresAt,
      } : {}),
    },
  };
}

export async function signMobileEmployeeSecondFactor(result, rawContexts) {
  const binding = await issueSecondFactorChallenge('mobile_employee', {
    candidateId: Number(result.candidateId),
    companyId: Number(result.companyId),
  });
  return signToken({
    purpose: MOBILE_EMPLOYEE_TOKEN_PURPOSE.SECOND_FACTOR,
    candidateId: Number(result.candidateId),
    companyId: Number(result.companyId),
    contexts: rawContexts,
    ...binding,
  }, CHALLENGE_TTL_SEC);
}

export async function verifyMobileEmployeeSecondFactor(token) {
  const payload = verifyToken(token, MOBILE_EMPLOYEE_TOKEN_PURPOSE.SECOND_FACTOR);
  const candidateId = positiveId(payload?.candidateId);
  const companyId = positiveId(payload?.companyId);
  if (!(await secondFactorChallengeLive(payload))) return null;
  return candidateId && companyId && Array.isArray(payload?.contexts)
    ? { candidateId, companyId, contexts: payload.contexts }
    : null;
}

export async function completeMobileEmployeeAuthentication(result, rawContexts, expectedVersion = null) {
  const contexts = await loadContexts(rawContexts);
  const active = contexts.find((item) =>
    item.candidateId === Number(result.candidateId) && item.company.id === Number(result.companyId));
  if (!active || (expectedVersion != null && active.sessionVersion !== Number(expectedVersion))) {
    return { ok: false };
  }
  const refresh = await createRefreshSession(active, contexts);
  return {
    ok: true,
    outcome: MOBILE_EMPLOYEE_AUTH_OUTCOME.AUTHENTICATED,
    session: buildSession(active, contexts, refresh),
  };
}

export function mobileEmployeeSelectionResponse(email, pickToken, companies) {
  return {
    outcome: MOBILE_EMPLOYEE_AUTH_OUTCOME.REQUIRES_COMPANY_SELECTION,
    email,
    selectionToken: pickToken,
    contexts: companies.map((item) => ({
      candidateId: Number(item.candidateId),
      company: { id: Number(item.companyId), logoUrl: null, name: item.companyName },
    })),
  };
}

export function contextsFromSelectionToken(selectionToken) {
  return verifyEmployeeCompanyPickChallenge(selectionToken)?.choices || null;
}

async function revokeFamily(client, familyId) {
  await client.query(
    `UPDATE mobile_employee_refresh_sessions
     SET revoked_at = COALESCE(revoked_at, NOW())
     WHERE family_id = $1 AND revoked_at IS NULL AND rotated_at IS NULL`,
    [familyId]
  );
}

async function rotateRefresh(refreshToken, targetCandidateId = null) {
  if (!refreshToken) return { ok: false };
  return withTransaction(async (client) => {
    const found = await client.query(
      `SELECT id, family_id AS "familyId", candidate_id AS "candidateId", company_id AS "companyId",
              session_version AS "sessionVersion", allowed_contexts AS "allowedContexts",
              expires_at AS "expiresAt", rotated_at AS "rotatedAt", revoked_at AS "revokedAt"
       FROM mobile_employee_refresh_sessions WHERE token_hash = $1 FOR UPDATE`,
      [tokenHash(refreshToken)]
    );
    if (!found.rowCount) return { ok: false };
    const current = found.rows[0];
    if (current.rotatedAt) {
      await revokeFamily(client, current.familyId);
      return { ok: false };
    }
    if (current.revokedAt || new Date(current.expiresAt).getTime() <= Date.now()) return { ok: false };
    const allowed = Array.isArray(current.allowedContexts) ? current.allowedContexts : [];
    const targetId = targetCandidateId == null ? Number(current.candidateId) : Number(targetCandidateId);
    const target = allowed.find((item) => Number(item.candidateId) === targetId);
    if (!target) return { ok: false };
    const live = await client.query(
      `SELECT c.id AS "candidateId", c.company_id AS "companyId", c.full_name AS "displayName", c.email,
              COALESCE(c.session_version, 1) AS "sessionVersion", co.name AS "companyName", co.logo_url AS "companyLogoUrl"
       FROM candidates c JOIN companies co ON co.id = c.company_id
       WHERE c.id = $1 AND c.company_id = $2 AND c.employment_status = $3
         AND COALESCE(c.session_version, 1) = $4 AND co.active = TRUE AND co.deleted = FALSE
       LIMIT 1`,
      [target.candidateId, target.companyId, EMPLOYMENT_STATUS.EMPLOYEE, target.sessionVersion]
    );
    if (!live.rowCount) {
      await revokeFamily(client, current.familyId);
      return { ok: false };
    }
    const nextToken = opaqueToken();
    const expiry = expiresIso(REFRESH_TTL_SEC);
    const context = live.rows[0];
    const inserted = await client.query(
      `INSERT INTO mobile_employee_refresh_sessions (
         family_id, candidate_id, company_id, token_hash, session_version, allowed_contexts, expires_at
       ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7) RETURNING id`,
      [current.familyId, context.candidateId, context.companyId, tokenHash(nextToken), context.sessionVersion,
        JSON.stringify(allowed), expiry]
    );
    await client.query(
      `UPDATE mobile_employee_refresh_sessions SET rotated_at = NOW(), last_used_at = NOW(), replaced_by_id = $2
       WHERE id = $1 AND rotated_at IS NULL AND revoked_at IS NULL`,
      [current.id, inserted.rows[0].id]
    );
    return { ok: true, familyId: current.familyId, context, allowedContexts: allowed,
      refreshToken: nextToken, refreshTokenExpiresAt: expiry };
  });
}

async function contextsForAllowed(allowedContexts) {
  return loadContexts(allowedContexts);
}

export async function refreshMobileEmployeeSession(refreshToken, targetCandidateId = null) {
  const rotated = await rotateRefresh(refreshToken, targetCandidateId);
  if (!rotated.ok) return rotated;
  const contexts = await contextsForAllowed(rotated.allowedContexts);
  const active = contexts.find((item) => item.candidateId === Number(rotated.context.candidateId));
  if (!active) return { ok: false };
  return {
    ok: true,
    outcome: MOBILE_EMPLOYEE_AUTH_OUTCOME.AUTHENTICATED,
    session: buildSession(active, contexts, rotated),
  };
}

export async function authenticateMobileEmployee(accessToken) {
  const payload = verifyToken(accessToken, MOBILE_EMPLOYEE_TOKEN_PURPOSE.ACCESS);
  const candidateId = positiveId(payload?.candidateId);
  const companyId = positiveId(payload?.companyId);
  if (!candidateId || !companyId || !payload?.sid) return null;
  const live = await loadEmployeeSessionVersion(candidateId, companyId);
  if (!live || live.employmentStatus !== EMPLOYMENT_STATUS.EMPLOYEE || live.sessionVersion !== Number(payload.sv)) return null;
  const active = await query(
    `SELECT 1 FROM mobile_employee_refresh_sessions
     WHERE family_id = $1 AND candidate_id = $2 AND company_id = $3
       AND revoked_at IS NULL AND rotated_at IS NULL AND expires_at > NOW() LIMIT 1`,
    [payload.sid, candidateId, companyId]
  );
  return active.rowCount ? { candidateId, companyId, familyId: payload.sid } : null;
}

export async function switchMobileEmployeeCompany(accessToken, refreshToken, candidateId) {
  const authenticated = await authenticateMobileEmployee(accessToken);
  if (!authenticated) return { ok: false };
  const switched = await refreshMobileEmployeeSession(refreshToken, candidateId);
  if (!switched.ok) return switched;
  return switched;
}

export async function revokeMobileEmployeeSession(refreshToken) {
  if (!refreshToken) return { ok: true };
  return withTransaction(async (client) => {
    const found = await client.query(
      `SELECT family_id AS "familyId" FROM mobile_employee_refresh_sessions
       WHERE token_hash = $1 FOR UPDATE`,
      [tokenHash(refreshToken)]
    );
    if (found.rowCount) await revokeFamily(client, found.rows[0].familyId);
    return { ok: true };
  });
}
