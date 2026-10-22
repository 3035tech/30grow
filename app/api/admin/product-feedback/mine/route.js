import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../../lib/admin-api.js';
import { CAP } from '../../../../../lib/permissions.js';
import { query } from '../../../../../lib/db.js';

export const GET = withAdminApi({ cap: CAP.PROFILE_SELF, requireCompany: false, companyFrom: 'none', logLabel: 'support-mine' }, async ({ payload }) => {
  const result = await query(`SELECT id, kind, status, message, public_response AS "publicResponse",
    created_at AS "createdAt", CASE WHEN NULLIF(BTRIM(public_response), '') IS NOT NULL THEN first_response_at END AS "firstResponseAt"
    FROM product_feedback WHERE user_id=$1 AND company_id IS NOT DISTINCT FROM $2::bigint
    ORDER BY created_at DESC,id DESC LIMIT 20`, [payload.userId, payload.companyId ?? null]);
  return NextResponse.json({ items: result.rows }, { headers: { 'Cache-Control': 'no-store' } });
});
