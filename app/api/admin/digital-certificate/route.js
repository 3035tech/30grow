import { readCertificateUpload, validateAndSaveUploadedCertificate } from '../../../../lib/rep/certificate-upload.js';
import { runtimeAppUrl } from '../../../../lib/app-url.js';
import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../lib/admin-api.js';
import { apiError, ERR, HTTP_STATUS } from '../../../../lib/api-error.js';
import { CAP } from '../../../../lib/identity/permissions.js';
import {
  canManageDigitalCertificate,
} from '../../../../lib/rep/certificate-admin.js';
import {
  certificateSecretConfigured,
  publicCertificateSettings,
  readSigningSettings,
} from '../../../../lib/rep/certificate-settings.js';
import { auditFromRequest } from '../../../../lib/audit.js';
import { checkRateLimit } from '../../../../lib/identity/rate-limit.js';
const headers = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
};
const options = {
  cap: CAP.USERS_MANAGE,
  requireCompany: false,
  companyFrom: 'none',
};
const fail = (request, code, status) =>
  apiError(request, code, status, {}, { headers });
export const GET = withAdminApi(options, async ({ request, payload }) => {
  if (!canManageDigitalCertificate(payload))
    return fail(request, ERR.FORBIDDEN, HTTP_STATUS.FORBIDDEN);
  try {
    return NextResponse.json(
      publicCertificateSettings(await readSigningSettings()),
      { headers },
    );
  } catch {
    return fail(request, ERR.REP_NOT_READY, HTTP_STATUS.SERVICE_UNAVAILABLE);
  }
});
export const POST = withAdminApi(
  options,
  async ({ request, payload }) => {
    if (!canManageDigitalCertificate(payload))
      return fail(request, ERR.FORBIDDEN, HTTP_STATUS.FORBIDDEN);
    // Do not accept cross-site submissions containing a platform-wide credential.
    const origin = request.headers.get('origin');
    if (!origin || origin !== new URL(runtimeAppUrl() || request.url).origin)
      return fail(request, ERR.FORBIDDEN, HTTP_STATUS.FORBIDDEN);
    if (!certificateSecretConfigured())
      return fail(request, ERR.REP_NOT_READY, HTTP_STATUS.SERVICE_UNAVAILABLE);
    const limit = await checkRateLimit(
      `rep-certificate:${payload.userId}`,
      10,
      15 * 60 * 1000,
    );
    if (!limit.ok)
      return fail(request, ERR.RATE_LIMIT, HTTP_STATUS.TOO_MANY_REQUESTS);
    let body;
    try { body = await readCertificateUpload(request); }
    catch { return fail(request, ERR.INVALID_DATA, HTTP_STATUS.BAD_REQUEST); }
    try {
      const result = await validateAndSaveUploadedCertificate(body);
      await auditFromRequest(request, {
        actorUserId: payload.userId,
        action:
          body.action === 'save'
            ? 'rep.certificate.updated'
            : 'rep.certificate.tested',
        targetType: 'rep_certificate',
        targetId: 'platform',
        metadata: { fingerprint: result.certificate.fingerprint },
      });
      return NextResponse.json(result, { headers });
    } catch (error) {
      return fail(
        request,
        error.name === 'ZodError' ? ERR.INVALID_DATA : ERR.REP_NOT_READY,
        error.name === 'ZodError'
          ? HTTP_STATUS.BAD_REQUEST
          : HTTP_STATUS.SERVICE_UNAVAILABLE,
      );
    }
  },
);
