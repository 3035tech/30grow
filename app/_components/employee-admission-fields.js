import { t } from '../../lib/i18n';
import { normalizeStartDate } from '../../lib/recruiting/pipeline';
import { ONBOARDING_STAGES, onboardingStageOptions } from '../../lib/development/onboarding-stage-selection';

/** Shared UI contract: an explicit activation, distinct from the recruiting stage. */
export function employeeAdmissionFields(locale, person, hiringLinks = []) {
  const today = new Date().toISOString().slice(0, 10);
  const vacancyId = hiringLinks.length === 1 ? String(hiringLinks[0].vacancyId) : '';
  return [
    { key: 'existingEmployee', type: 'boolean', label: t(locale,'employeeAdmission.existing'), help: t(locale,'employeeAdmission.existingHelp'),
      defaultValue: false, whenTrue: { onboardingStages: [], startDate: person.startDate || '', vacancyId: '' },
      whenFalse: { onboardingStages: [...ONBOARDING_STAGES], startDate: today, vacancyId } },
    { key: 'startDate', type: 'date', label: t(locale,'employeeAdmission.actualStart'), help: t(locale,'employeeAdmission.actualStartHelp'),
      defaultValue: person.startDate || today, required: true,
      validate: value => !normalizeStartDate(value) ? t(locale,'formValidation.invalid') : value > today ? t(locale,'errors.ADMISSION_NOT_STARTED') : null },
    { key: 'personalEmail', type: 'email', label: t(locale,'employeeAdmission.personalEmail'), help: t(locale,'employeeAdmission.personalHelp'),
      defaultValue: person.personalEmail || person.email || '', required: true },
    { key: 'corporateEmail', type: 'email', label: t(locale,'employeeAdmission.corporateEmail'), help: t(locale,'employeeAdmission.corporateHelp'),
      defaultValue: person.personalEmail && person.email !== person.personalEmail ? person.email : '' },
    ...(hiringLinks.length ? [{ key: 'vacancyId', type: 'select', label: t(locale,'employeeAdmission.sourceVacancy'), help: t(locale,'employeeAdmission.sourceHelp'),
      defaultValue: vacancyId, options: [{value:'',label:t(locale,'employeeAdmission.noVacancy')}, ...hiringLinks.map(link => ({value:String(link.vacancyId),label:link.title}))] }] : []),
    { key: 'onboardingStages', type: 'checkboxGroup', label: t(locale,'onboardingStages.title'), help: t(locale,'onboardingStages.help'),
      defaultValue: [...ONBOARDING_STAGES], options: onboardingStageOptions(locale,t),
      selectAllLabel: t(locale,'onboardingStages.selectAll'), clearAllLabel: t(locale,'onboardingStages.clearAll'),
      selectionSummary: (n,total) => t(locale,'onboardingStages.summary',{n,total}), emptySelectionLabel: t(locale,'onboardingStages.empty') },
    { key: 'sendAccessInvite', type: 'boolean', defaultValue: true, label: t(locale,'employeeAdmission.invite'), help: t(locale,'employeeAdmission.inviteHelp') },
    { key: 'startedWorking', type: 'boolean', defaultValue: false, required: true, label: t(locale,'employeeAdmission.startedWorking') },
  ];
}

export function employeeAdmissionPayload(values) {
  return { startDate: values.startDate, personalEmail: String(values.personalEmail || '').trim().toLowerCase(),
    ...(String(values.corporateEmail || '').trim() ? { corporateEmail: String(values.corporateEmail).trim().toLowerCase() } : {}),
    vacancyId: values.vacancyId ? Number(values.vacancyId) : null,
    entryMode: values.existingEmployee ? 'existing_employee' : 'new_hire',
    onboardingStages: values.onboardingStages, sendAccessInvite: Boolean(values.sendAccessInvite), startedWorking: values.startedWorking === true };
}
