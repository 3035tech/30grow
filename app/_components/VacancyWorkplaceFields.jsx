'use client';

import { SelectField } from './SelectField';

import { t } from '../../lib/i18n';
import { BrStateSelect } from './BrStateSelect';
import { BrCitySelect } from './BrCitySelect';
import { FormField } from './FormField';
import {
  VACANCY_WORKPLACE_MODALITIES,
  workplaceModalityLabelKey,
} from '../../lib/recruiting/vacancy-workplace';
import { fieldSelectBlockClass } from './form-control-styles';

/**
 * Modalidade + UF + cidade (IBGE autocomplete) para create/edit de vaga.
 * Renders the three FormFields directly into the parent grid (pair with a 3-column grid).
 */
export function VacancyWorkplaceFields({
  locale,
  workplaceModality = '',
  workplaceState = '',
  workplaceCity = '',
  onChange,
}) {
  return (
    <>
      <FormField label={t(locale, 'recruiting.workplaceModalityLabel')}>
        <SelectField
          value={workplaceModality || ''}
          onChange={(e) => onChange?.({ workplaceModality: e.target.value })}
          aria-label={t(locale, 'recruiting.workplaceModalityLabel')}
          className={fieldSelectBlockClass}
        >
          <option value="">{t(locale, 'recruiting.workplaceModalityNone')}</option>
          {VACANCY_WORKPLACE_MODALITIES.map((mod) => (
            <option key={mod} value={mod}>
              {t(locale, workplaceModalityLabelKey(mod))}
            </option>
          ))}
        </SelectField>
      </FormField>
      <FormField label={t(locale, 'recruiting.workplaceStateLabel')}>
        <BrStateSelect
          locale={locale}
          value={workplaceState || ''}
          onChange={(uf) =>
            onChange?.({
              workplaceState: uf,
              workplaceCity: uf === workplaceState ? workplaceCity : '',
            })
          }
          aria-label={t(locale, 'recruiting.workplaceStateLabel')}
          className={fieldSelectBlockClass}
        />
      </FormField>
      <FormField
        label={t(locale, 'recruiting.workplaceCityLabel')}
        hint={workplaceState ? null : t(locale, 'recruiting.workplaceCityHelp')}
      >
        <BrCitySelect
          mode="autocomplete"
          locale={locale}
          uf={workplaceState || ''}
          value={workplaceCity || ''}
          onChange={(city) => onChange?.({ workplaceCity: city })}
          aria-label={t(locale, 'recruiting.workplaceCityLabel')}
          className="w-full"
        />
      </FormField>
    </>
  );
}
