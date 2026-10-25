'use client';
import { useState } from 'react';
import { useAppFeedback } from './AppFeedback';
import { employeeAdmissionFields, employeeAdmissionPayload } from './employee-admission-fields';
import { t } from '../../lib/i18n';

export function useEmployeeAdmission({ locale = 'pt-BR', onAdmitted } = {}) {
  const { promptForm, toast } = useAppFeedback();
  const [busyId, setBusyId] = useState(null);
  const admit = async candidateId => {
    if (!candidateId || busyId) return null;
    setBusyId(candidateId);
    try {
      const response = await fetch(`/api/admin/candidates/${encodeURIComponent(candidateId)}/admission`);
      const info = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(info.error || t(locale,'panel.common.error'));
      if (info.person.employmentStatus !== 'candidate') {
        toast(t(locale,info.person.employmentStatus === 'alumni' ? 'employeeAdmission.useRehire' : 'employeeAdmission.alreadyEmployee'),'warning'); return null;
      }
      let result;
      const values = await promptForm({ title: t(locale,'employeeAdmission.title',{name:info.person.fullName}),
        message: t(locale,'employeeAdmission.intro'), confirmLabel: t(locale,'employeeAdmission.confirm'),
        fields: employeeAdmissionFields(locale, info.person, info.hiringLinks),
        submit: async submitted => {
          const saved = await fetch(`/api/admin/candidates/${encodeURIComponent(candidateId)}/admission`, {
            method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({...employeeAdmissionPayload(submitted),companyId:info.person.companyId,locale}),
          });
          result = await saved.json().catch(() => ({}));
          if (!saved.ok) throw new Error(result.error || t(locale,'panel.common.error'));
        },
      });
      if (!values) return null;
      const failedInvite = values.sendAccessInvite && !result.inviteSent && !result.alreadyEmployee;
      toast(t(locale, result.alreadyEmployee ? 'employeeAdmission.alreadyEmployee' : failedInvite ? 'employeeAdmission.inviteFailed' : 'employeeAdmission.success'), failedInvite ? 'warning' : 'ok');
      await onAdmitted?.(result);
      return result;
    } catch (error) { toast(error.message || t(locale,'panel.common.error'),'error'); return null; }
    finally { setBusyId(null); }
  };
  return { admit, busyId };
}
