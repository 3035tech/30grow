'use client';

import { t, t as i18nT } from '../../lib/i18n';
import { BR_STATES, AVAILABILITY_VALUES, SOURCE_VALUES } from '../../lib/recruiting/candidate-profile';
import { salaryToCentsDigits, stripSalary, formatSalaryBr } from '../../lib/br-masks';
import { formatDisplayDate } from '../../lib/format-display-date';
import { S, AdminEditButton } from '../dashboard/dashboard-shared';
import { useAppFeedback } from './AppFeedback';
import { FormField } from './FormField';
import { RichTextView } from './RichTextView';
import { StatusToneChip } from './StatusToneChip';

const availabilityKeys = { immediate: 'availabilityImmediate', '15_days': 'availability15', '30_days': 'availability30', '60_days': 'availability60', other: 'availabilityOther' };
const sourceKeys = { linkedin: 'sourceLinkedin', referral: 'sourceReferral', agency: 'sourceAgency', job_board: 'sourceJobBoard', other: 'sourceOther' };

// Uses the same authorized candidate record and PATCH as the former Cadastro tab.
// Recruitment fields remain separate from DP address, notes and current salary.
export function CandidateRegistrationBlock({ candidate, lmsOverdue = [], locale = 'pt-BR', readOnly = false, onSaved }) {
  const { promptForm, toast } = useAppFeedback();
  const heading = i18nT(locale, 'ui.candidateRegistrationBlock.recruitmentRecord');
  const editLabel = i18nT(locale, 'ui.candidateRegistrationBlock.editRecruitmentRecord');
  const label = (keys, value) => value ? (keys[value] ? t(locale, `recruiting.${keys[value]}`) : value) : '—';
  const enumOptions = (values, keys, current) => [
    { value: '', label: t(locale, 'panel.dp.notInformed') },
    ...values.map(value => ({ value, label: label(keys, value) })),
    ...(current && !values.includes(current) ? [{ value: current, label: current }] : []),
  ];

  async function edit() {
    if (readOnly) return;
    await promptForm({
      title: editLabel,
      confirmLabel: t(locale, 'panel.dp.save'),
      fields: [
        { key: 'linkedinUrl', type: 'url', label: t(locale, 'recruiting.linkedinLabel'), defaultValue: candidate.linkedinUrl || '', maxLength: 500 },
        { key: 'state', label: t(locale, 'recruiting.stateLabel'), type: 'select', defaultValue: candidate.state || '', options: [{ value: '', label: t(locale, 'panel.dp.notInformed') }, ...BR_STATES.map(item => ({ value: item.uf, label: `${item.uf} · ${item.name}` }))] },
        { key: 'city', label: t(locale, 'recruiting.cityLabel'), defaultValue: candidate.city || '', maxLength: 120 },
        { key: 'salaryExpectation', label: t(locale, 'recruiting.salaryExpectationLabel'), type: 'salary', defaultValue: salaryToCentsDigits(candidate.salaryExpectation) },
        { key: 'availability', label: t(locale, 'recruiting.availabilityLabel'), type: 'select', defaultValue: candidate.availability || '', options: enumOptions(AVAILABILITY_VALUES, availabilityKeys, candidate.availability) },
        { key: 'source', label: t(locale, 'recruiting.sourceLabel'), type: 'select', defaultValue: candidate.source || '', options: enumOptions(SOURCE_VALUES, sourceKeys, candidate.source) },
        { key: 'hrNotes', label: t(locale, 'panel.team.hrNotes'), type: 'richText', defaultValue: candidate.hrNotes || '', maxLength: 20000 },
      ],
      submit: async values => {
        const response = await fetch(`/api/admin/candidates/${encodeURIComponent(candidate.id)}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...values, salaryExpectation: stripSalary(values.salaryExpectation) }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || t(locale, 'panel.dp.saveError'));
        onSaved?.(data);
        toast(t(locale, 'recruiting.profileSaved'), 'ok');
      },
    });
  }

  return <section className={`${S.card} mt-5`} aria-label={heading}>
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h3 className={`${S.cardSection} m-0`}>{heading}</h3>
      {!readOnly ? <AdminEditButton label={editLabel} onClick={() => void edit()} /> : null}
    </div>
    <div className="grid min-w-0 gap-4 sm:grid-cols-2">
      <FormField as="div" label={t(locale, 'recruiting.linkedinLabel')}>
        {/^https?:\/\//i.test(candidate.linkedinUrl || '')
          ? <a href={candidate.linkedinUrl} target="_blank" rel="noopener noreferrer" className="break-all text-sm text-brand-600 dark:text-brand-300">{candidate.linkedinUrl}</a>
          : <p className="m-0 break-words text-sm">{candidate.linkedinUrl || '—'}</p>}
      </FormField>
      <FormField as="div" label={`${t(locale, 'recruiting.cityLabel')} / ${t(locale, 'recruiting.stateLabel')}`}><p className="m-0 break-words text-sm">{[candidate.city, candidate.state].filter(Boolean).join(' / ') || '—'}</p></FormField>
      <FormField as="div" label={t(locale, 'recruiting.salaryExpectationLabel')}><p className="m-0 text-sm">{candidate.salaryExpectation ? formatSalaryBr(candidate.salaryExpectation) : '—'}</p></FormField>
      <FormField as="div" label={t(locale, 'recruiting.availabilityLabel')}><p className="m-0 text-sm">{label(availabilityKeys, candidate.availability)}</p></FormField>
      <FormField as="div" label={t(locale, 'recruiting.sourceLabel')}><p className="m-0 text-sm">{label(sourceKeys, candidate.source)}</p></FormField>
      <FormField as="div" label={t(locale, 'panel.team.hrNotes')} className="sm:col-span-2"><RichTextView html={candidate.hrNotes || ''} /></FormField>
    </div>
    {candidate.createdAt || candidate.createdByName ? <p className={`mt-4 mb-0 ${S.faint}`}>{t(locale, candidate.createdByName ? 'panel.team.registeredBy' : 'panel.team.registeredAt', { name: candidate.createdByName, date: formatDisplayDate(candidate.createdAt, locale) })}</p> : null}
    {lmsOverdue.length ? <ul className="mt-3 mb-0 list-none space-y-2 p-0">{lmsOverdue.map(course => <li key={course.enrollmentId}><StatusToneChip tone="danger">{t(locale, 'panel.team.lmsOverdue', { title: course.courseTitle, date: formatDisplayDate(course.dueDate, locale) })}</StatusToneChip></li>)}</ul> : null}
  </section>;
}
