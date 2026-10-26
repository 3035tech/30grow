'use client';

import { cn } from '../../../lib/cn';
import { t } from '../../../lib/i18n';
import { computeJobSeoScore } from '../../../lib/recruiting/job-seo-score';
import { fieldCheckboxClass } from '../../_components/form-control-styles';

function VacancyPublicFlagCheckbox({ locale, checked, onChange, labelKey, helpKey }) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 font-ui text-xs leading-[1.45] text-ink-muted">
      <input
        type="checkbox"
        checked={Boolean(checked)}
        onChange={(e) => onChange(e.target.checked)}
        className={fieldCheckboxClass}
      />
      <span className="min-w-0">
        <strong className="block text-prose font-medium text-ink">{t(locale, labelKey)}</strong>
        {t(locale, helpKey)}
      </span>
    </label>
  );
}

export function VacancyPublicFlagsFields({ locale, values, onChange, seoContext = null }) {
  const publicOn = Boolean(values.publicPageEnabled);
  const score = computeJobSeoScore({
    title: seoContext?.title,
    description: seoContext?.description,
    employmentType: seoContext?.employmentType,
    workplaceModality: seoContext?.workplaceModality,
    salaryMin: seoContext?.salaryMin,
    salaryMax: seoContext?.salaryMax,
    publicPageEnabled: values.publicPageEnabled,
    publicAllowIndex: values.publicAllowIndex,
    publicShowCompanyInfo: values.publicShowCompanyInfo,
    companyWebsite: seoContext?.companyWebsite,
    companyAboutHtml: seoContext?.companyAboutHtml,
  });

  return (
    <div className="flex flex-col gap-3">
      <VacancyPublicFlagCheckbox
        locale={locale}
        checked={values.publicPageEnabled}
        onChange={(v) => onChange({ publicPageEnabled: v })}
        labelKey="recruiting.publicPageEnabled"
        helpKey="recruiting.publicPageEnabledHelp"
      />
      {publicOn ? (
        <>
          <VacancyPublicFlagCheckbox
            locale={locale}
            checked={values.publicAllowIndex}
            onChange={(v) => onChange({ publicAllowIndex: v })}
            labelKey="recruiting.publicAllowIndex"
            helpKey="recruiting.publicAllowIndexHelp"
          />
          <VacancyPublicFlagCheckbox
            locale={locale}
            checked={values.publicShowCompanyInfo}
            onChange={(v) => onChange({ publicShowCompanyInfo: v })}
            labelKey="recruiting.publicShowCompanyInfo"
            helpKey="recruiting.publicShowCompanyInfoHelp"
          />
          <VacancyPublicFlagCheckbox
            locale={locale}
            checked={values.publicShowSalary}
            onChange={(v) => onChange({ publicShowSalary: v })}
            labelKey="recruiting.publicShowSalary"
            helpKey="recruiting.publicShowSalaryHelp"
          />
          <div className="mt-1 rounded-control border border-ink/12 bg-canvas/60 p-3">
            <div className="mb-2 font-mono text-xs text-ink">
              {t(locale, 'recruiting.seoScoreTitle', {
                score: String(score.score),
                max: String(score.maxScore),
              })}
            </div>
            <ul className="m-0 list-disc py-0 pl-4 text-2xs leading-[1.55] text-ink-muted">
              {score.checks.map((c) => (
                <li key={c.id} className={cn(c.ok ? 'text-success' : 'text-ink-muted')}>
                  {c.ok ? '✓' : '○'} {t(locale, `recruiting.seoCheck_${c.id}`)}
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : (
        <p className="m-0 font-mono text-2xs leading-snug text-ink-faint">
          {t(locale, 'recruiting.publicPageOffHint')}
        </p>
      )}
    </div>
  );
}
