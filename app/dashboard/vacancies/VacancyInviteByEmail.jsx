'use client';

import { useState } from 'react';
import { cn } from '../../../lib/cn';
import { t } from '../../../lib/i18n';
import { titleCasePersonName } from '../../../lib/person-name';
import { useAppFeedback } from '../../_components/AppFeedback';

export function VacancyInviteByEmail({ vacancyId, onSent, locale = 'pt-BR' }) {
  const { promptForm } = useAppFeedback();
  const [busy, setBusy] = useState(false);
  const [localErr, setLocalErr] = useState('');
  const [localOk, setLocalOk] = useState('');

  const openInvite = async () => {
    setLocalErr('');
    setLocalOk('');
    const values = await promptForm({
      title: t(locale, 'recruiting.inviteEmailIntro'),
      confirmLabel: t(locale, 'recruiting.inviteSendChallenge'),
      fields: [
        {
          key: 'name',
          label: t(locale, 'recruiting.inviteCandidateNamePh'),
          placeholder: t(locale, 'recruiting.inviteCandidateNamePh'),
          defaultValue: '',
        },
        {
          key: 'email',
          type: 'email',
          label: t(locale, 'recruiting.inviteCandidateEmailPh'),
          placeholder: t(locale, 'recruiting.inviteCandidateEmailPh'),
          defaultValue: '',
        },
      ],
    });
    if (!values) return;

    const name = titleCasePersonName(String(values.name || ''));
    const mail = String(values.email || '').trim().toLowerCase();
    if (!name) {
      setLocalErr(t(locale, 'recruiting.inviteNeedName'));
      return;
    }
    if (!mail) {
      setLocalErr(t(locale, 'recruiting.inviteNeedEmail'));
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/vacancies/${encodeURIComponent(vacancyId)}/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidateName: name, candidateEmail: mail }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || t(locale, 'panel.common.error'));
      setLocalOk(t(locale, 'recruiting.inviteSendOk', { email: mail }));
      onSent?.();
      setTimeout(() => setLocalOk(''), 5000);
    } catch (e) {
      setLocalErr(e?.message || t(locale, 'panel.common.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3.5 w-full border-t border-ink/12 pt-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <span className="font-mono text-2xs text-ink-muted">
          {t(locale, 'recruiting.inviteEmailIntro')}
        </span>
        <button
          type="button"
          onClick={openInvite}
          disabled={busy}
          className={cn(
            'min-h-touch shrink-0 cursor-pointer rounded-control border border-success/35 bg-success/[0.09] px-3.5 py-2 font-mono text-xs text-success',
            busy && 'cursor-default opacity-60'
          )}
        >
          {busy ? t(locale, 'recruiting.inviteSending') : t(locale, 'recruiting.openInviteBtn')}
        </button>
      </div>
      {localErr ? (
        <p className="mb-0 mt-2 font-mono text-2xs text-danger">{localErr}</p>
      ) : null}
      {localOk ? (
        <p className="mb-0 mt-2 font-mono text-2xs text-success">{localOk}</p>
      ) : null}
    </div>
  );
}
