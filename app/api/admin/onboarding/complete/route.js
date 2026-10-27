import { cookies } from 'next/headers';
import { verifyToken } from '../../../../../lib/identity/auth.js';
import { query } from '../../../../../lib/db.js';
import { apiError, apiErrorFromResult, ERR } from '../../../../../lib/api-error.js';
import { hydrateSessionPayload } from '../../../../../lib/identity/session.js';
import { setCompanyEnabledModules } from '../../../../../lib/company/company-module-entitlements.js';
import { modulesSelectionForPersist } from '../../../../../lib/company/company-modules.js';
import { canManageCompanyModules } from '../../../../../lib/identity/permissions.js';
import { audit } from '../../../../../lib/audit.js';

/**
 * POST /api/admin/onboarding/complete
 * Marca o wizard como completo. Body opcional: { modules: string[] } grava entitlements da empresa.
 * Sem modules / skip → não altera enabled_modules (continua NULL = todos).
 */
export async function POST(request) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('team30_session')?.value;
    if (!token) {
      return apiError(request, ERR.REQUIRED_LOGIN, 401);
    }

    const rawPayload = verifyToken(token);
    const payload = await hydrateSessionPayload(rawPayload);
    if (!payload) {
      return apiError(request, ERR.INVALID_CREDENTIALS, 401);
    }

    const userId = payload.userId;
    const body = await request.json().catch(() => ({}));
    const applyModules =
      Array.isArray(body.modules) && payload.companyId && canManageCompanyModules(payload);

    if (applyModules) {
      const result = await setCompanyEnabledModules(query, {
        companyId: payload.companyId,
        modules: modulesSelectionForPersist(body.modules),
      });
      if (!result.ok) {
        return apiErrorFromResult(request, result, { fallbackCode: ERR.INVALID_DATA });
      }
      await audit({
        action: 'company_modules_onboarding',
        actorUserId: userId,
        targetType: 'company',
        targetId: payload.companyId,
        metadata: { modules: result.enabledModules },
      });
    }

    await query(
      `UPDATE users
       SET onboarding_completed = TRUE,
           onboarding_completed_at = NOW()
       WHERE id = $1
         AND deleted = FALSE
         AND active = TRUE`,
      [userId]
    );

    return Response.json({
      ok: true,
      companyModules: applyModules ? body.modules : undefined,
    });
  } catch (err) {
    if (err?.code === '42703') {
      return apiError(request, ERR.SCHEMA_NOT_INITIALIZED, 503);
    }
    console.error('[onboarding] Complete error:', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
