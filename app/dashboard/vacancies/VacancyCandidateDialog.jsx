'use client';

import { useEffect, useState } from 'react';
import { AdminRichFormDrawer, dialogBtnGhostClass } from '../../_components/AdminRichFormDrawer';
import { SelectField } from '../../_components/SelectField';
import { FormField } from '../../_components/FormField';
import { RichTextView } from '../../_components/RichTextView';
import { AppLoading } from '../../_components/AppLoading';
import { t } from '../../../lib/i18n';
import { titleCasePersonName } from '../../../lib/person-name';
import { rejectionReasonLabel } from '../pipeline-prompts';
import { daysInStage } from './vacancy-admin-shared';
import { useEmployeeAdmission } from '../../_components/useEmployeeAdmission';

export function VacancyCandidateDialog({ row, vacancyId, locale, stages, recruiters, workspaceLoading, onAssign, onClose, onPersonClick, canAdmitCandidate = false }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [assigning, setAssigning] = useState(false);
  const [assignmentError, setAssignmentError] = useState('');
  const [saved, setSaved] = useState(false);
  const { admit, busyId: admissionBusyId } = useEmployeeAdmission({ locale, onAdmitted: () => { onClose(); onPersonClick?.(row.candidateId); } });
  const stageLabel = (key) => stages.find((stage) => stage.id === key)?.label || key || '—';
  const days = daysInStage(row.stageEnteredAt || row.createdAt);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    fetch(`/api/admin/vacancies/${encodeURIComponent(vacancyId)}/candidates/${encodeURIComponent(row.candidateId)}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body?.error || t(locale, 'panel.common.error'));
        if (!controller.signal.aborted) setData(body);
      })
      .catch((err) => { if (!controller.signal.aborted) setError(err.message || t(locale, 'panel.common.error')); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [vacancyId, row.candidateId, locale, retry]);

  const assign = async (value) => {
    setAssigning(true);
    setAssignmentError('');
    setSaved(false);
    try { await onAssign(row, value); setSaved(true); }
    catch (err) { setAssignmentError(err.message || t(locale, 'panel.common.error')); }
    finally { setAssigning(false); }
  };

  return (
    <AdminRichFormDrawer protectChanges={false} open title={titleCasePersonName(row.name)} locale={locale} onClose={onClose}
      maxWidth="760px" eyebrow={t(locale, 'recruiting.candidateDialogEyebrow')}
      headerMeta={<><span>{data?.vacancyTitle}</span><span className="rounded-full bg-brand-500/10 px-2 py-1 text-sm text-brand-600">{stageLabel(row.pipelineStage || 'new')}</span></>}
      footer={<>
        {canAdmitCandidate && data?.employmentStatus === 'candidate' ? <button type="button" className={dialogBtnGhostClass} disabled={Boolean(admissionBusyId)} onClick={() => admit(row.candidateId)}>{t(locale,'employeeAdmission.action')}</button> : null}
        <button type="button" className={dialogBtnGhostClass} onClick={onClose}>{t(locale, 'panel.common.close')}</button>
        {onPersonClick ? <button type="button" className={dialogBtnGhostClass} onClick={() => { onClose(); onPersonClick(row.candidateId); }}>{t(locale, 'recruiting.candidateDialogFullProfile')}</button> : null}
      </>}
    >
      <div className="space-y-5">
        {data?.employmentStatus === 'candidate' && stages.find(stage => stage.id === row.pipelineStage)?.canonicalKey === 'hired' ? <p className="rounded-control border border-ink/12 bg-canvas p-3 text-sm text-ink-muted">{t(locale,'employeeAdmission.pending')}</p> : null}
        <section className="grid gap-3 rounded-card border border-ink/10 bg-canvas p-4 sm:grid-cols-2">
          <div className="min-w-0 space-y-1 text-sm text-ink-muted">
            {row.email ? <p className="m-0 break-words">{row.email}</p> : null}
            {data?.phone ? <p className="m-0">{data.phone}</p> : null}
            {data?.city || data?.state ? <p className="m-0">{[data.city, data.state].filter(Boolean).join(' · ')}</p> : null}
            {days != null ? <p className="m-0">{t(locale, 'recruiting.stageAgingTitle', { n: days })}</p> : null}
          </div>
          <div>
            <FormField label={t(locale, 'recruiting.candidateOwner')} hint={t(locale, 'recruiting.candidateDialogOwnerHint')}>
              <SelectField value={row.ownerUserId || ''} disabled={assigning || workspaceLoading} onChange={(event) => void assign(event.target.value)} aria-label={t(locale, 'recruiting.candidateOwner')}>
                <option value="">{t(locale, 'recruiting.filterUnassigned')}</option>
                {recruiters.map((owner) => <option key={owner.id} value={owner.id}>{owner.name}</option>)}
              </SelectField>
            </FormField>
            {assignmentError ? <p role="alert" className="mt-2 text-sm text-danger">{assignmentError}</p> : null}
            {saved ? <p role="status" className="mt-2 text-sm text-success">{t(locale, 'recruiting.candidateOwnerUpdated')}</p> : null}
          </div>
        </section>
        {row.rejectionReason ? <p className="text-sm text-danger">{rejectionReasonLabel(locale, row.rejectionReasons?.length ? row.rejectionReasons : row.rejectionReason)}</p> : null}
        {loading ? <AppLoading variant="inline" /> : error ? (
          <div role="alert"><p className="text-sm text-danger">{error}</p><button type="button" className={dialogBtnGhostClass} onClick={() => setRetry((n) => n + 1)}>{t(locale, 'recruiting.candidateDialogRetry')}</button></div>
        ) : <>
          {data?.professionalSummary ? <section><h3 className="mb-2 text-sm font-semibold text-ink">{t(locale, 'recruiting.candidateDialogSummary')}</h3><RichTextView html={data.professionalSummary} /></section> : null}
          <section>
            <h3 className="mb-2 text-sm font-semibold text-ink">{t(locale, 'recruiting.interviewNotesTitle')}</h3>
            {data?.interviewNotes ? <RichTextView html={data.interviewNotes} /> : <p className="text-sm text-ink-muted">{t(locale, 'recruiting.candidateDialogNoNotes')}</p>}
          </section>
          <section>
            <h3 className="mb-2 text-sm font-semibold text-ink">{t(locale, 'recruiting.candidateDialogHistory')}</h3>
            {data?.history?.length ? <ol className="m-0 list-none divide-y divide-ink/10 p-0">{data.history.map((event) => (
              <li key={event.eventKey} className="py-2.5 text-sm text-ink-muted">
                <p className="m-0 text-ink">{stageLabel(event.fromStage)} → {stageLabel(event.toStage)}</p>
                {event.reason ? <p className="m-0">{rejectionReasonLabel(locale, event.reasons?.length ? event.reasons : event.reason)}</p> : null}
                <time dateTime={event.changedAt}>{new Date(event.changedAt).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' })}</time>
              </li>
            ))}</ol> : <p className="text-sm text-ink-muted">{t(locale, 'recruiting.timelineEmpty')}</p>}
            {data?.historyTruncated ? <p className="text-xs text-ink-muted">{t(locale, 'recruiting.candidateDialogHistoryLimit')}</p> : null}
          </section>
        </>}
      </div>
    </AdminRichFormDrawer>
  );
}
