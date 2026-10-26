import { query } from './db.js';
import { clientIpFromRequest } from './identity/rate-limit.js';
import { redactSensitiveUrl, redactSensitiveValue } from './identity/redact-secrets.js';

/** Tipos de ator em audit_log (constantes string — não enum TS). */
export const AUDIT_ACTOR_KIND = Object.freeze({
  MANAGER: 'manager',
  EMPLOYEE: 'employee',
  SYSTEM: 'system',
  PUBLIC: 'public',
});

/**
 * Contexto HTTP para audit (path + IP).
 * @param {Request} request
 */
export function auditRequestContext(request) {
  if (!request?.url) return {};
  try {
    const url = new URL(request.url);
    return {
      requestPath: url.pathname.slice(0, 512),
      requestIp: clientIpFromRequest(request)?.slice(0, 64) || null,
    };
  } catch {
    return {};
  }
}

/**
 * Grava evento append-only (best-effort — não quebra fluxo principal).
 * @param {object} opts
 * @param {number|null} [opts.actorUserId]
 * @param {number|null} [opts.actorCandidateId]
 * @param {string} [opts.actorKind]
 * @param {number|null} [opts.companyId]
 * @param {string} opts.action
 * @param {string|null} [opts.targetType]
 * @param {string|number|null} [opts.targetId]
 * @param {object} [opts.metadata]
 * @param {string|null} [opts.requestPath]
 * @param {string|null} [opts.requestIp]
 */
export async function audit({
  actorUserId = null,
  actorCandidateId = null,
  actorKind = AUDIT_ACTOR_KIND.MANAGER,
  companyId = null,
  action,
  targetType = null,
  targetId = null,
  metadata = {},
  requestPath = null,
  requestIp = null,
}) {
  const kind = String(actorKind || AUDIT_ACTOR_KIND.MANAGER);
  const uid = actorUserId != null && Number.isFinite(Number(actorUserId)) ? Number(actorUserId) : null;
  const cid =
    actorCandidateId != null && Number.isFinite(Number(actorCandidateId))
      ? Number(actorCandidateId)
      : null;
  const coId = companyId != null && Number.isFinite(Number(companyId)) ? Number(companyId) : null;
  const tid = targetId != null && targetId !== '' ? String(targetId).slice(0, 128) : null;

  let meta = metadata && typeof metadata === 'object' ? redactSensitiveValue({ ...metadata }) : {};
  try {
    JSON.stringify(meta);
  } catch {
    meta = { note: 'metadata_not_serializable' };
  }

  try {
    await query(
      `INSERT INTO audit_log (
         actor_user_id, actor_candidate_id, actor_kind, company_id,
         action, target_type, target_id, metadata, request_path, request_ip
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        uid,
        cid,
        kind,
        coId,
        String(action || '').slice(0, 120),
        targetType ? String(targetType).slice(0, 64) : null,
        tid,
        JSON.stringify(meta),
        requestPath ? redactSensitiveUrl(requestPath).slice(0, 512) : null,
        requestIp ? String(requestIp).slice(0, 64) : null,
      ]
    );
  } catch (e) {
    console.error('audit_log failed:', { code: e?.code || 'UNKNOWN' });
  }
}

/** @param {Request} request @param {Parameters<typeof audit>[0]} opts */
export async function auditFromRequest(request, opts) {
  return audit({ ...auditRequestContext(request), ...opts });
}
