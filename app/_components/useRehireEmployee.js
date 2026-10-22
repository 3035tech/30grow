'use client';

import { useCallback, useState } from 'react';
import { useAppFeedback } from './AppFeedback';
import { t } from '../../lib/i18n';
import { formatDisplayDate } from '../../lib/format-display-date.js';

/**
 * Reactivate a former employee (alumni) keeping the exit as history.
 * Shared by Equipe (row menu + person detail) and Exit Analysis.
 * @returns {{ rehire: (person: { candidateId: number, name?: string, exitDate?: string|null }) => Promise<boolean>, busyId: number|null }}
 */
export function useRehireEmployee({ locale = 'pt-BR', companyId = null } = {}) {
  const { promptForm, toast } = useAppFeedback();
  const [busyId, setBusyId] = useState(null);

  const rehire = useCallback(
    async ({ candidateId, name = '', exitDate = null }) => {
      if (!candidateId || busyId) return false;
      const values = await promptForm({
        title: t(locale, 'panel.rehire.title', { name }),
        message: exitDate
          ? t(locale, 'panel.rehire.hintWithExit', { date: formatDisplayDate(exitDate, locale) })
          : t(locale, 'panel.rehire.hint'),
        confirmLabel: t(locale, 'panel.rehire.confirm'),
        fields: [
          {
            key: 'rehireDate',
            type: 'date',
            label: t(locale, 'panel.rehire.date'),
            required: true,
            defaultValue: new Date().toISOString().slice(0, 10),
          },
          {
            key: 'corporateEmail',
            type: 'email',
            label: t(locale, 'recruiting.hireCorporateEmailLabel'),
            help: t(locale, 'recruiting.hireCorporateEmailHint'),
          },
          {
            key: 'sendAccessInvite',
            type: 'boolean',
            label: t(locale, 'panel.rehire.invite'),
            help: t(locale, 'panel.rehire.inviteHelp'),
            defaultValue: true,
          },
        ],
      });
      if (!values) return false;

      setBusyId(candidateId);
      try {
        const res = await fetch('/api/admin/exit-analysis/rehire', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...(companyId ? { companyId: Number(companyId) } : {}),
            candidateId: Number(candidateId),
            rehireDate: values.rehireDate || null,
            ...(String(values.corporateEmail || '').trim() ? { corporateEmail: String(values.corporateEmail).trim() } : {}),
            sendAccessInvite: Boolean(values.sendAccessInvite),
            locale,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || t(locale, 'panel.rehire.error'));
        if (values.sendAccessInvite && !data.inviteSent) {
          toast(t(locale, 'panel.rehire.okInviteFailed'), 'warning');
        } else {
          toast(
            data.inviteSent ? t(locale, 'panel.rehire.okInvite') : t(locale, 'panel.rehire.ok'),
            'ok'
          );
        }
        return true;
      } catch (e) {
        toast(e?.message || t(locale, 'panel.rehire.error'), 'error');
        return false;
      } finally {
        setBusyId(null);
      }
    },
    [busyId, companyId, locale, promptForm, toast]
  );

  return { rehire, busyId };
}
