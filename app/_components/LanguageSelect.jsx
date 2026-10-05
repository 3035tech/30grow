'use client';

import { SelectField } from './SelectField';

import {
  LOCALES,
  LOCALE_COOKIE,
  localeAccessibleLabel,
  localeFlag,
  localeLabel,
  localeShortCode,
  normalizeLocale,
  t,
} from '../../lib/i18n';
import { cn } from '../../lib/cn';
import { fieldSelectClass } from './form-control-styles';

/** `bare`: select only, full width; use inside `FormField`, which already renders the label. */
export default function LanguageSelect({ locale, onChange, persistUser = false, compact = false, bare = false }) {
  const current = normalizeLocale(locale);

  const changeLocale = async (nextRaw) => {
    const next = normalizeLocale(nextRaw);
    document.cookie = `${LOCALE_COOKIE}=${encodeURIComponent(next)}; path=/; max-age=31536000; samesite=lax`;
    onChange?.(next);
    if (persistUser) {
      try {
        await fetch('/api/me/locale', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ locale: next }),
        });
      } catch (e) {
        console.error('Failed to persist locale:', e);
      }
    }
  };

  const options = LOCALES.map((loc) => (
    <option key={loc} value={loc} aria-label={localeAccessibleLabel(loc)}>
      {localeFlag(loc)} {localeLabel(loc)}
    </option>
  ));

  if (bare) {
    return (
      <SelectField
        aria-label={t(current, 'common.language')}
        value={current}
        onChange={(e) => changeLocale(e.target.value)}
        className={cn(fieldSelectClass, 'w-full')}
      >
        {options}
      </SelectField>
    );
  }

  return (
    <label
      className={cn(
        'inline-flex items-center gap-2 text-ink-muted',
        'font-ui text-prose'
      )}
    >
      <span className="font-medium normal-case tracking-normal">{t(current, 'common.language')}</span>
      <SelectField
        aria-label={t(current, 'common.language')}
        title={compact ? localeLabel(current) : undefined}
        valueLabel={compact ? `${localeFlag(current)} ${localeShortCode(current)}` : undefined}
        value={current}
        onChange={(e) => changeLocale(e.target.value)}
        className={cn(
          fieldSelectClass,
          'border-brand-500/16',
          compact ? 'min-h-touch' : ''
        )}
      >
        {options}
      </SelectField>
    </label>
  );
}
