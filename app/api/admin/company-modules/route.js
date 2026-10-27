import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../lib/admin-api.js';
import { CAP } from '../../../../lib/ae/require-admin.js';
import { apiErrorFromResult, ERR } from '../../../../lib/api-error.js';
import { z, zPositiveInt } from '../../../../lib/validate.js';
import { listCompanyModuleCatalog, modulesSelectionForPersist } from '../../../../lib/company/company-modules.js';
import {
  getCompanyEnabledModules,
  setCompanyEnabledModules,
} from '../../../../lib/company/company-module-entitlements.js';
import { auditFromRequest } from '../../../../lib/audit.js';

const querySchema = z.object({
  companyId: zPositiveInt.optional(),
});

const putBodySchema = z.object({
  companyId: zPositiveInt.optional(),
  /** null = all modules (unrestricted). Array = allow-list (+ core). */
  modules: z.array(z.string().trim().min(1).max(64)).max(32).nullable(),
});

/** GET /api/admin/company-modules — catalog + current company entitlements */
export const GET = withAdminApi(
  {
    cap: CAP.USERS_MANAGE,
    query: querySchema,
    companyFrom: 'query',
    requireCompany: true,
    logLabel: 'company-modules GET',
  },
  async ({ companyId }) => {
    const enabledModules = await getCompanyEnabledModules(null, companyId);
    return NextResponse.json({
      ok: true,
      catalog: listCompanyModuleCatalog(),
      enabledModules,
      unrestricted: enabledModules == null,
    });
  }
);

/** PUT /api/admin/company-modules — set company module allow-list */
export const PUT = withAdminApi(
  {
    anyCap: [CAP.USERS_MANAGE, CAP.COMPANIES_MANAGE],
    body: putBodySchema,
    companyFrom: 'body',
    requireCompany: true,
    logLabel: 'company-modules PUT',
  },
  async ({ request, payload, companyId, body }) => {
    const result = await setCompanyEnabledModules(null, {
      companyId,
      modules:
        body.modules == null ? null : modulesSelectionForPersist(body.modules),
    });
    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.INVALID_DATA });
    }
    await auditFromRequest(request, {
      action: 'company_modules_set',
      actorUserId: payload.userId,
      companyId,
      targetType: 'company',
      targetId: companyId,
      metadata: {
        unrestricted: result.enabledModules == null,
        modules: result.enabledModules,
      },
    });
    return NextResponse.json({
      ok: true,
      enabledModules: result.enabledModules,
      unrestricted: result.enabledModules == null,
    });
  }
);
