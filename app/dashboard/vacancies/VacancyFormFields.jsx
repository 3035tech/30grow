'use client';

import { cn } from '../../../lib/cn';
import { t, contentLocale } from '../../../lib/i18n';
import { formatSalaryBr, digitsOnly } from '../../../lib/br-masks';
import { VACANCY_STATUS } from '../../../lib/domain-status.js';
import { VACANCY_EMPLOYMENT_TYPES, employmentTypeLabelKey } from '../../../lib/recruiting/vacancy-employment-type';
import { FormField } from '../../_components/FormField';
import { SelectField } from '../../_components/SelectField';
import { DateField } from '../../_components/DateField';
import { InlineCallout } from '../../_components/InlineCallout';
import { RichTextEditor } from '../../_components/RichTextEditor';
import { RubricEditor } from '../../_components/RubricEditor';
import { VacancyWorkplaceFields } from '../../_components/VacancyWorkplaceFields';
import { fieldInputClass, fieldSelectBlockClass } from '../../_components/form-control-styles';
import { VacancyFormSection } from './VacancyFormSection';
import { VacancyPublicFlagsFields } from './VacancyPublicFlagsFields';
import { VacancyDescriptionAssistBar } from './VacancyDescriptionAssistBar';

const INPUT = `${fieldInputClass} w-full`;
const GRID_2 = 'grid grid-cols-1 items-start gap-x-3 gap-y-4 sm:grid-cols-2';
const GRID_3 = 'grid grid-cols-1 items-start gap-x-3 gap-y-4 sm:grid-cols-3';
const STACK = 'flex min-w-0 flex-col gap-4';

/**
 * Shared vacancy create/edit fields.
 * - `layout="split"` (full-page editor): content on the left, settings in a right column on `lg`.
 * - `layout="stack"` (create drawer): single column, settings right after the essentials.
 * `mode="create"` adds company (admin) and pipeline template, which are fixed after creation.
 *
 * @param {{
 *   locale: string,
 *   mode: 'create' | 'edit',
 *   layout?: 'split' | 'stack',
 *   values: Record<string, any>,
 *   onChange: (patch: Record<string, any>) => void,
 *   error?: string,
 *   isAdmin?: boolean,
 *   companies?: Array<{ id: number, name: string }>,
 *   jobRoles?: Array<{ id: number, name: string, rubric?: object }>,
 *   pipelineTemplates?: Array<object>,
 *   pipelineTemplatesLoading?: boolean,
 *   pipelineTemplatesError?: string,
 *   descAiBusy?: boolean,
 *   onDescAiBusyChange?: (busy: boolean) => void,
 * }} props
 */
export function VacancyFormFields({
  locale,
  mode,
  layout = 'stack',
  values,
  onChange,
  error = '',
  isAdmin = false,
  companies = [],
  jobRoles = [],
  pipelineTemplates = [],
  pipelineTemplatesLoading = false,
  pipelineTemplatesError = '',
  descAiBusy = false,
  onDescAiBusyChange,
}) {
  const isCreate = mode === 'create';
  const split = layout === 'split';
  const set = (key) => (e) => onChange({ [key]: e.target.value });

  const selectedJobRole = jobRoles.find((jr) => String(jr.id) === String(values.jobRoleId || ''));
  const rubric = selectedJobRole?.rubric && typeof selectedJobRole.rubric === 'object' ? selectedJobRole.rubric : {};
  const selectedTemplate = pipelineTemplates.find((tpl) => String(tpl.id) === String(values.pipelineTemplateId || ''));

  const essentials = (
    <VacancyFormSection locale={locale} titleKey="recruiting.formSectionEssentials" defaultOpen>
      <div className={STACK}>
        {isCreate && isAdmin ? (
          <FormField label={t(locale, 'panel.admin.companyLabel')}>
            <SelectField value={values.companyId} onChange={set('companyId')} className={fieldSelectBlockClass}>
              {companies.length === 0 ? (
                <option value="">{t(locale, 'panel.admin.loadingCompanies')}</option>
              ) : companies.map((c) => (
                <option key={c.id} value={String(c.id)}>{c.name} (#{c.id})</option>
              ))}
            </SelectField>
          </FormField>
        ) : null}
        <FormField label={t(locale, 'recruiting.vacancyTitlePh')}>
          <input
            value={values.title}
            onChange={set('title')}
            placeholder={t(locale, 'recruiting.createTitlePh')}
            required
            className={INPUT}
          />
        </FormField>
        <div className={GRID_2}>
          <FormField label={t(locale, 'recruiting.slugLabel')} hint={t(locale, 'recruiting.slugHint')}>
            <input
              value={values.slug}
              onChange={set('slug')}
              placeholder={t(locale, 'recruiting.vacancySlugPh')}
              className={INPUT}
            />
          </FormField>
        </div>
        {isCreate ? (
          <div className="flex flex-col gap-2">
            <FormField
              label={t(locale, 'panel.pipelineTemplates.fieldLabel')}
              hint={pipelineTemplatesError || t(locale, 'panel.pipelineTemplates.fieldHint')}
            >
              <SelectField
                value={values.pipelineTemplateId}
                onChange={set('pipelineTemplateId')}
                className={fieldSelectBlockClass}
                disabled={pipelineTemplatesLoading || pipelineTemplates.length === 0}
              >
                {pipelineTemplatesLoading ? (
                  <option value="">{t(locale, 'panel.pipelineTemplates.loading')}</option>
                ) : null}
                {!pipelineTemplatesLoading && pipelineTemplates.length === 0 ? (
                  <option value="">{t(locale, 'panel.pipelineTemplates.empty')}</option>
                ) : null}
                {pipelineTemplates.map((template) => (
                  <option key={template.id} value={String(template.id)}>
                    {t(locale, 'panel.pipelineTemplates.optionLabel', {
                      name: template.name,
                      n: template.stageCount,
                      default: template.isDefault ? ` · ${t(locale, 'panel.pipelineTemplates.defaultBadge')}` : '',
                    })}
                  </option>
                ))}
              </SelectField>
            </FormField>
            {selectedTemplate?.stages?.length ? (
              <ol className="m-0 flex list-none flex-wrap gap-1.5 p-0" aria-label={t(locale, 'panel.pipelineTemplates.previewLabel')}>
                {selectedTemplate.stages.map((stage, index) => (
                  <li
                    key={stage.id || stage.stageKey}
                    className="inline-flex items-center gap-1 rounded-full border border-ink/10 bg-canvas px-2 py-1 font-ui text-prose text-ink-muted"
                  >
                    <span className="tabular-nums text-ink/60">{index + 1}</span>
                    {contentLocale(locale) === 'en' ? (stage.labelEn || stage.labelPt) : (stage.labelPt || stage.labelEn)}
                  </li>
                ))}
              </ol>
            ) : null}
          </div>
        ) : null}
      </div>
    </VacancyFormSection>
  );

  const statusDeadline = (
    <VacancyFormSection locale={locale} titleKey="recruiting.formSectionStatus" defaultOpen>
      <div className={split ? STACK : GRID_3}>
        <FormField label={t(locale, 'recruiting.statusLabel')}>
          <SelectField value={values.status} onChange={set('status')} className={fieldSelectBlockClass}>
            <option value={VACANCY_STATUS.OPEN}>{t(locale, 'recruiting.openStatus')}</option>
            <option value={VACANCY_STATUS.CLOSED}>{t(locale, 'recruiting.closedStatus')}</option>
          </SelectField>
        </FormField>
        <FormField label={t(locale, 'recruiting.positionsLabel')}>
          <input
            type="number"
            min="1"
            inputMode="numeric"
            value={values.positionsCount}
            onChange={set('positionsCount')}
            className={cn(INPUT, 'tabular-nums')}
          />
        </FormField>
        <FormField as="div" label={t(locale, 'recruiting.targetDateLabel')}>
          <DateField
            value={values.targetDate}
            onChange={set('targetDate')}
            locale={locale}
            aria-label={t(locale, 'recruiting.targetDateLabel')}
            className={INPUT}
          />
        </FormField>
      </div>
    </VacancyFormSection>
  );

  const jobRole = jobRoles.length > 0 ? (
    <VacancyFormSection locale={locale} titleKey="recruiting.formSectionJobRole" defaultOpen>
      <div className={STACK}>
        <FormField label={t(locale, 'recruiting.jobRoleLabel')} hint={t(locale, 'recruiting.jobRoleHint')}>
          <SelectField value={values.jobRoleId || ''} onChange={set('jobRoleId')} className={fieldSelectBlockClass}>
            <option value="">{t(locale, 'recruiting.noJobRole')}</option>
            {jobRoles.map((jr) => (
              <option key={jr.id} value={String(jr.id)}>{jr.name}</option>
            ))}
          </SelectField>
        </FormField>
        {values.jobRoleId && Object.keys(rubric).length > 0 ? (
          <div className="rounded-control border border-ink/10 bg-canvas/60 p-3">
            <p className="m-0 mb-2 font-ui text-prose font-medium text-ink-muted">{t(locale, 'jobRoles.rubricPreview')}</p>
            <RubricEditor value={rubric} locale={locale} compact />
          </div>
        ) : null}
      </div>
    </VacancyFormSection>
  ) : null;

  const contract = (
    <VacancyFormSection locale={locale} titleKey="recruiting.formSectionRolePay" defaultOpen>
      <div className={GRID_3}>
        <FormField label={t(locale, 'recruiting.employmentTypeLabel')}>
          <SelectField value={values.employmentType} onChange={set('employmentType')} className={fieldSelectBlockClass}>
            <option value="">{t(locale, 'recruiting.employmentTypeNone')}</option>
            {VACANCY_EMPLOYMENT_TYPES.map((type) => (
              <option key={type} value={type}>{t(locale, employmentTypeLabelKey(type))}</option>
            ))}
          </SelectField>
        </FormField>
        <FormField label={t(locale, 'ui.vacanciesAdminTab.minimumSalary')}>
          <input
            value={formatSalaryBr(values.salaryMin)}
            onChange={(e) => onChange({ salaryMin: digitsOnly(e.target.value).slice(0, 15) })}
            placeholder={t(locale, 'recruiting.salaryMinPh')}
            inputMode="numeric"
            className={cn(INPUT, 'tabular-nums')}
          />
        </FormField>
        <FormField label={t(locale, 'ui.vacanciesAdminTab.maximumSalary')}>
          <input
            value={formatSalaryBr(values.salaryMax)}
            onChange={(e) => onChange({ salaryMax: digitsOnly(e.target.value).slice(0, 15) })}
            placeholder={t(locale, 'recruiting.salaryMaxPh')}
            inputMode="numeric"
            className={cn(INPUT, 'tabular-nums')}
          />
        </FormField>
        <VacancyWorkplaceFields
          locale={locale}
          workplaceModality={values.workplaceModality}
          workplaceState={values.workplaceState}
          workplaceCity={values.workplaceCity}
          onChange={onChange}
        />
      </div>
    </VacancyFormSection>
  );

  const description = (
    <VacancyFormSection locale={locale} titleKey="recruiting.formSectionDescription" defaultOpen>
      <div className="flex flex-col gap-3">
        <VacancyDescriptionAssistBar
          locale={locale}
          busy={descAiBusy}
          title={values.title}
          descriptionHtml={values.description}
          employmentType={values.employmentType}
          salaryMin={values.salaryMin}
          salaryMax={values.salaryMax}
          vacancyId={isCreate ? undefined : values.id}
          onApplyDescription={(html) => onChange({ description: html })}
          onBusyChange={onDescAiBusyChange}
        />
        <FormField as="div" label={t(locale, 'recruiting.vacancyDescriptionLabel')}>
          <RichTextEditor
            value={values.description}
            onChange={(html) => onChange({ description: html })}
            placeholder={t(locale, 'recruiting.vacancyDescriptionPh')}
            minHeight={split ? 240 : 140}
            locale={locale}
            disabled={descAiBusy}
          />
        </FormField>
      </div>
    </VacancyFormSection>
  );

  const publicPage = (
    <VacancyFormSection locale={locale} titleKey="recruiting.formSectionPublic" defaultOpen={split}>
      <VacancyPublicFlagsFields
        locale={locale}
        values={{
          publicPageEnabled: values.publicPageEnabled,
          publicAllowIndex: values.publicAllowIndex,
          publicShowCompanyInfo: values.publicShowCompanyInfo,
          publicShowSalary: values.publicShowSalary,
        }}
        seoContext={{
          title: values.title,
          description: values.description,
          employmentType: values.employmentType,
          salaryMin: values.salaryMin,
          salaryMax: values.salaryMax,
          workplaceModality: values.workplaceModality,
          workplaceCity: values.workplaceCity,
          workplaceState: values.workplaceState,
        }}
        onChange={onChange}
      />
    </VacancyFormSection>
  );

  const errorCallout = error ? (
    <InlineCallout tone="danger" role="alert" emphasis>{error}</InlineCallout>
  ) : null;

  if (split) {
    return (
      <div className="flex flex-col gap-4">
        {errorCallout}
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px] xl:gap-6">
          <div className={STACK}>
            {essentials}
            {contract}
            {description}
          </div>
          <aside className={STACK} aria-label={t(locale, 'recruiting.formSettingsAside')}>
            {statusDeadline}
            {jobRole}
            {publicPage}
          </aside>
        </div>
      </div>
    );
  }

  return (
    <div className={STACK}>
      {errorCallout}
      {essentials}
      {statusDeadline}
      {contract}
      {jobRole}
      {description}
      {publicPage}
    </div>
  );
}
