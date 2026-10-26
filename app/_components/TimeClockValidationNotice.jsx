import { t } from '../../lib/i18n';

/** Product status shared by public offers and authenticated time tracking. */
export function TimeClockValidationNotice({ locale = 'pt-BR', className = '' }) {
  return (
    <aside aria-label={t(locale, 'timeClockValidation.title')} className={`rounded-control border border-warning/30 bg-warning/10 p-4 text-ink ${className}`}>
      <p className="m-0 font-ui text-sm font-semibold">{t(locale, 'timeClockValidation.title')}</p>
      <p className="mb-0 mt-1 font-ui text-sm leading-6">{t(locale, 'timeClockValidation.body')}</p>
    </aside>
  );
}
