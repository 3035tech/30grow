'use client';

import { t, localeHtmlLang } from '../../lib/i18n';
import { EMPLOYMENT_STATUS } from '../../lib/domain-status';
import { StatusToneChip } from './StatusToneChip';

export function PersonOperationalSummary({ person, candidate, locale = 'pt-BR', compact = false }) {
  const status = person?.employmentStatus || candidate?.employmentStatus;
  const role = person?.jobRoleName || candidate?.jobRoleName;
  const date = person?.startDate || candidate?.startDate || person?.hiredAt || candidate?.hiredAt;
  const parsed = date ? new Date(String(date).length === 10 ? `${date}T12:00:00` : date) : null;
  const dateLabel = parsed && !Number.isNaN(parsed.getTime()) ? parsed.toLocaleDateString(localeHtmlLang(locale)) : null;
  const fields = [
    [t(locale, 'betaPeople.company'), person?.companyName || t(locale, 'betaPeople.notRecorded')],
    [t(locale, 'betaPeople.role'), role || t(locale, 'betaPeople.notRecorded')],
    [t(locale, 'betaPeople.manager'), person?.managerName || t(locale, 'betaPeople.notRecorded')],
    [t(locale, 'betaPeople.unit'), person?.orgUnitName || t(locale, 'betaPeople.notRecorded')],
  ];
  const Container = compact ? 'div' : 'section';
  return <Container aria-label={t(locale, 'betaPeople.operationalTitle')} className={compact ? 'space-y-1.5' : 'rounded-card border border-ink/12 bg-surface p-4 sm:p-5'}>
    {!compact ? <h3 className="mb-3 mt-0 font-ui text-base font-semibold text-ink">{t(locale, 'betaPeople.operationalTitle')}</h3> : null}
    <dl className={compact ? 'm-0 flex flex-wrap gap-x-4 gap-y-1 text-sm' : 'm-0 grid gap-3 sm:grid-cols-2 lg:grid-cols-3'}>
      {fields.map(([label,value]) => <div key={label} className="min-w-0 break-words"><dt className="text-xs text-ink-muted">{label}</dt><dd className="m-0 text-sm text-ink">{value}</dd></div>)}
      {!compact ? <div><dt className="text-xs text-ink-muted">{t(locale, 'betaPeople.admission')}</dt><dd className="m-0 text-sm text-ink">{dateLabel || t(locale, 'betaPeople.notRecorded')}</dd></div> : null}
    </dl>
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {status ? <StatusToneChip tone={status === EMPLOYMENT_STATUS.EMPLOYEE ? 'success' : 'neutral'}>{t(locale, status === EMPLOYMENT_STATUS.ALUMNI ? 'panel.rehire.formerEmployee' : `panel.team.employment.${status}`)}</StatusToneChip> : null}
      {person ? <StatusToneChip tone={person.overdueCount > 0 ? 'warning' : 'neutral'}>{person.overdueCount > 0 ? t(locale, 'betaPeople.overdueCount', { n: person.overdueCount }) : t(locale, 'betaPeople.noOverdue')}</StatusToneChip> : null}
      {!compact && person?.overdueCount > 0 ? <p className="m-0 text-xs text-ink-muted">{t(locale, 'betaPeople.overdueBreakdown', { pdi: person.pdiOverdue, onboarding: person.onboardingOverdue, lms: person.lmsOverdue })}</p> : null}
    </div>
  </Container>;
}
