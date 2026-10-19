import { redirect } from 'next/navigation';
import { getSessionPayload } from '../../../../lib/ae/require-admin.js';
import { I18nBoot } from '../../../_components/I18nBoot';
import { BillingReturnClient } from '../../../_components/BillingReturnClient';

export default async function BillingReturnPage({ searchParams }) {
  const payload = await getSessionPayload();
  if (!payload) redirect('/login');
  const params = await searchParams;
  return <I18nBoot locales={[payload.locale]}><BillingReturnClient locale={payload.locale} sessionId={String(params.session_id || '')} companyId={payload.role === 'admin' ? Number(params.companyId) || payload.companyId : payload.companyId} /></I18nBoot>;
}
