import { cookies } from 'next/headers';
import { LOCALE_COOKIE, normalizeLocale } from '../../lib/i18n.js';
import { buildPublicLegalMetadata, getPublicLegalDocument } from '../../lib/marketing/public-legal.js';
import { PublicLegalDocument } from '../_components/PublicLegalDocument.jsx';

export const dynamic = 'force-dynamic';

export async function generateMetadata() {
  const locale = normalizeLocale(await (await cookies()).get(LOCALE_COOKIE)?.value);
  return buildPublicLegalMetadata('privacy', locale);
}

export default async function PrivacyPage() {
  const locale = normalizeLocale(await (await cookies()).get(LOCALE_COOKIE)?.value);
  return <PublicLegalDocument copy={getPublicLegalDocument('privacy', locale)} />;
}
