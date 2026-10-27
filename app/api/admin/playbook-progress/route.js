import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { COOKIE_NAME } from '../../../../lib/identity/auth.js';
import { verifySessionWithCapabilities } from '../../../../lib/identity/user-capabilities.js';
import { apiError, ERR } from '../../../../lib/api-error.js';
import { CAP, isSuperAdminPayload, requireCapability } from '../../../../lib/identity/permissions.js';
import { queryRead } from '../../../../lib/db.js';
import { getPlaybooksForTab } from '../../../../lib/development/persona-playbook-progress.js';

export const dynamic = 'force-dynamic';

/** GET /api/admin/playbook-progress?tab=vagas */
export async function GET(request) {
  try {
    const cookieStore = await cookies();
    const session = cookieStore.get(COOKIE_NAME)?.value;
    const payload = await verifySessionWithCapabilities(session);
    if (!requireCapability(payload, CAP.OVERVIEW_VIEW)) {
      return apiError(request, ERR.UNAUTHORIZED, 401);
    }

    const isAdmin = isSuperAdminPayload(payload);
    const companyId = payload?.companyId ?? null;
    if (!isAdmin && !companyId) return apiError(request, ERR.UNAUTHORIZED, 401);

    const { searchParams } = new URL(request.url);
    const tab = String(searchParams.get('tab') || 'overview').trim();
    const role = String(payload?.role || 'hr');

    if (isAdmin && !companyId) {
      return NextResponse.json({ tab, role, playbooks: [] });
    }

    const playbooks = await getPlaybooksForTab(queryRead, {
      companyId: isAdmin ? companyId : companyId,
      tab,
      role,
    });

    return NextResponse.json({ tab, role, playbooks });
  } catch (err) {
    console.error('GET playbook-progress', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
