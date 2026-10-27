import { NextResponse } from 'next/server';
import { query } from '../db.js';
import { apiError, ERR } from '../api-error.js';
import { checkRateLimit } from '../identity/rate-limit.js';
import { listReceipts, signedReceipt } from './receipts.js';
const headers = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
};
export async function employeeReceiptResponse(request, session) {
  if (!session) return apiError(request, ERR.UNAUTHORIZED, 401);
  const p = new URL(request.url).searchParams;
  if (p.has('nsr')) {
    const limit = await checkRateLimit(
      `rep-receipt:${session.companyId}:${session.candidateId}`,
      120,
      60 * 60 * 1000,
    );
    if (!limit.ok) return apiError(request, ERR.RATE_LIMIT, 429);
    const nsr = p.get('nsr'),
      establishmentId = p.get('establishmentId');
    if (
      !/^[1-9]\d{0,8}$/.test(nsr) ||
      !/^[1-9]\d{0,14}$/.test(establishmentId || '')
    )
      return apiError(request, ERR.INVALID_DATA, 400);
    try {
      const pdf = await signedReceipt(
        { query },
        { ...session, nsr, establishmentId },
      );
      if (!pdf) return apiError(request, ERR.NOT_FOUND, 404);
      return new NextResponse(new Uint8Array(pdf), {
        headers: {
          ...headers,
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="comprovante-${nsr}.pdf"`,
        },
      });
    } catch {
      return apiError(request, ERR.REP_NOT_READY, 503);
    }
  }
  const after = p.get('after') || '0';
  if (!/^\d{1,9}$/.test(after)) return apiError(request, ERR.INVALID_DATA, 400);
  return NextResponse.json(
    {
      ...(await listReceipts({ query }, { ...session, after })),
      serverTime: new Date().toISOString(),
    },
    { headers },
  );
}
