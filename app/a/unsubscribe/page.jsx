import { t } from '../../../lib/i18n';
import { unsubscribeJobAlert } from '../../../lib/recruiting/job-alerts';
import { BrandMark } from '../../_components/BrandMark';
import Link from 'next/link';

export const metadata = {
  robots: { index: false, follow: false },
};

/**
 * Cancelamento de alerta de vagas — path neutro `/a/unsubscribe?token=…`
 * (não usar URL em português).
 */
export default async function JobAlertUnsubscribePage(props) {
  const searchParams = await props.searchParams;
  const locale = 'pt-BR';
  const token = String(searchParams?.token || '').trim();
  let kind = 'invalid';
  if (token) {
    const result = await unsubscribeJobAlert(token);
    if (!result.ok) kind = 'invalid';
    else if (result.updated) kind = 'ok';
    else kind = 'already';
  }

  const title = t(locale, 'publicVacancy.alertUnsubTitle');
  const message =
    kind === 'ok'
      ? t(locale, 'publicVacancy.alertUnsubOk')
      : kind === 'already'
        ? t(locale, 'publicVacancy.alertUnsubAlready')
        : t(locale, 'publicVacancy.alertUnsubInvalid');

  return (
    <div className="relative min-h-screen overflow-hidden bg-canvas font-ui text-ink">
      <div className="relative mx-auto max-w-[520px] px-5 py-12">
        <BrandMark size={28} withWordmark className="mb-6 text-navy" />
        <h1 className="m-0 font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">
          {title}
        </h1>
        <div className="mt-5 rounded-card border border-ink/12 bg-white px-6 py-[22px]">
          <p className="m-0 leading-relaxed text-ink-muted">{message}</p>
          <p className="mb-0 mt-4">
            <Link href="/jobs" className="text-brand-500">
              {t(locale, 'publicVacancy.browseOpenCta')}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
