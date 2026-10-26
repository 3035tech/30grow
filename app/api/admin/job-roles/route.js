import { withAdminApi } from '../../../../lib/admin-api.js';
import { apiError, ERR } from '../../../../lib/api-error.js';
import { CAP } from '../../../../lib/ae/require-admin.js';
import { z, zPositiveInt, zQueryBool } from '../../../../lib/validate.js';
import { listCompanyJobRoles, createJobRole } from '../../../../lib/recruiting/job-roles.js';
import { jobRoleDescriptionSchema } from '../../../../lib/recruiting/job-role-description.js';

const listQuerySchema = z.object({
  companyId: zPositiveInt.optional(),
  includeInactive: zQueryBool,
});

const createBodySchema = z.object({
  companyId: zPositiveInt.optional(),
  name: z.string().trim().min(1).max(200),
  description: jobRoleDescriptionSchema.optional().nullable(),
  rubric: z.record(z.coerce.number()).optional().default({}),
  marketSalaryMin: z.union([z.string(), z.number()]).optional().nullable(),
  marketSalaryMax: z.union([z.string(), z.number()]).optional().nullable(),
});

/**
 * GET /api/admin/job-roles?companyId=X&includeInactive=false
 * Lista cargos — vacancies.manage (seleção em vagas) ou job_roles.view (aba).
 */
export const GET = withAdminApi(
  {
    anyCap: [CAP.VACANCIES_MANAGE, CAP.JOB_ROLES_VIEW],
    query: listQuerySchema,
    companyFrom: 'query',
    logLabel: 'job-roles GET',
  },
  async ({ companyId, query }) => {
    const rolesResult = await listCompanyJobRoles(companyId, {
      includeInactive: query.includeInactive,
    });
    return Response.json({
      companyId,
      total: rolesResult.roles.length,
      roles: rolesResult.roles,
      truncated: rolesResult.truncated,
      scanCap: rolesResult.scanCap,
    });
  }
);

/**
 * POST /api/admin/job-roles — cria cargo (job_roles.view)
 */
export const POST = withAdminApi(
  {
    cap: CAP.JOB_ROLES_VIEW,
    body: createBodySchema,
    companyFrom: 'body',
    logLabel: 'job-roles POST',
  },
  async ({ request, companyId, body }) => {
    try {
      const newRole = await createJobRole({
        companyId,
        name: body.name,
        description: body.description || null,
        rubric: body.rubric || {},
        marketSalaryMin: body.marketSalaryMin ?? null,
        marketSalaryMax: body.marketSalaryMax ?? null,
      });
      return Response.json(newRole, { status: 201 });
    } catch (err) {
      if (err?.message === 'INVALID_MARKET_BAND' || err?.message === 'INVALID_RUBRIC') {
        return apiError(request, ERR.INVALID_DATA, 400);
      }
      if (err?.code === '23505') {
        return apiError(request, ERR.JOB_ROLE_NAME_EXISTS, 409);
      }
      throw err;
    }
  }
);
