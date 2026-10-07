'use client';

import { DP_ADDRESS_NUMBER_MAX_LENGTH } from '../../lib/dp-profile-constants';
import { dpUploadValidationKey, dpUploadResponseKey } from '../../lib/dp-upload-validation';

import { useCallback, useEffect, useRef, useState } from 'react';
import { t, tCount, localeHtmlLang } from '../../lib/i18n';
import { kinshipLabel, kinshipOptions } from '../../lib/kinship-relation.js';
import { cn } from '../../lib/cn';
import { S, PanelSubNav } from '../dashboard/dashboard-shared';
import { useAppFeedback } from './AppFeedback';
import { AppLoading, ContentEnter } from './AppLoading';
import { EmptyState } from './EmptyState';
import { FormField } from './FormField';
import { InlineCallout } from './InlineCallout';
import { StatusToneChip } from './StatusToneChip';
import { PrivateAttachment } from './PrivateAttachment';
import { RichTextView } from './RichTextView';
import { LeaveBalanceSummary } from './LeaveBalanceSummary';
import { BR_STATES } from '../../lib/candidate-profile.js';
import { formatCepBr, formatCpfBr, formatPhoneBr } from '../../lib/br-masks.js';
import { SignaturePadField, SignatureStrokePreview } from './SignaturePadField';
import { Icon } from './Icon';
import {
  DP_DOCUMENT_STATUS,
  DP_DOCUMENT_SIGNATURE_STATUS,
  DP_LEAVE_STATUS,
  DP_LEAVE_TYPE,
  DP_LEAVE_TYPES,
  EMERGENCY_KINSHIP_RELATIONS,
} from '../../lib/domain-status.js';
import { leaveInclusiveDays } from '../../lib/leave-days.js';

function formatDate(value, locale) {
  if (!value) return '—';
  const raw = String(value).slice(0, 10);
  const [y, m, d] = raw.split('-').map(Number);
  if (!y || !m || !d) return raw;
  return new Date(y, m - 1, d).toLocaleDateString(localeHtmlLang(locale), {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function formatDateTime(value, locale) {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(localeHtmlLang(locale), {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function docKeyLabel(locale, key) {
  const k = `panel.dp.docKey.${key}`;
  const label = t(locale, k);
  return label === k ? key : label;
}

function docStatusLabel(locale, status) {
  const k = `panel.dp.docStatus.${status}`;
  const label = t(locale, k);
  return label === k ? status : label;
}

function sigStatusLabel(locale, status) {
  const k = `panel.dp.sigStatus.${status}`;
  const label = t(locale, k);
  return label === k ? status : label;
}

function leaveTypeLabel(locale, type) {
  const k = `panel.dp.leaveType.${type}`;
  const label = t(locale, k);
  return label === k ? type : label;
}

function leaveStatusLabel(locale, status) {
  const k = `panel.dp.leaveStatus.${status}`;
  const label = t(locale, k);
  return label === k ? status : label;
}

function docStatusTone(status, hasFile) {
  if (status === DP_DOCUMENT_STATUS.RECEIVED && !hasFile) return 'neutral';
  if (status === DP_DOCUMENT_STATUS.RECEIVED) return 'success';
  if (status === DP_DOCUMENT_STATUS.WAIVED) return 'neutral';
  return 'warning';
}

function sigStatusTone(status) {
  if (status === DP_DOCUMENT_SIGNATURE_STATUS.SIGNED) return 'success';
  if (status === DP_DOCUMENT_SIGNATURE_STATUS.REQUESTED) return 'warning';
  if (status === DP_DOCUMENT_SIGNATURE_STATUS.WAIVED) return 'neutral';
  return 'neutral';
}

function leaveStatusTone(status) {
  if (status === DP_LEAVE_STATUS.APPROVED || status === DP_LEAVE_STATUS.TAKEN) return 'success';
  if (status === DP_LEAVE_STATUS.REJECTED) return 'danger';
  if (status === DP_LEAVE_STATUS.CANCELLED) return 'neutral';
  return 'warning';
}

/**
 * Collaborator DP: emergency contact, doc checklist (read), leave request.
 */
export function EmployeeDpSection({ locale = 'pt-BR', onBadge, showIntro = true }) {
  const { toast, promptForm, confirm } = useAppFeedback();
  const [activePanel, setActivePanel] = useState('documents');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [profile, setProfile] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [leaves, setLeaves] = useState([]);
  const [balance, setBalance] = useState(null);
  const [pendingDocs, setPendingDocs] = useState(0);
  const [uploadKey, setUploadKey] = useState(null);
  const [leaveUploadId, setLeaveUploadId] = useState(null);
  const [signingDocKey, setSigningDocKey] = useState(null);
  const [signerName, setSignerName] = useState('');
  const [signConsent, setSignConsent] = useState(false);
  const [padEmpty, setPadEmpty] = useState(true);
  const fileInputRef = useRef(null);
  const leaveFileRef = useRef(null);
  const padApiRef = useRef(null);
  const signPanelRef = useRef(null);
  const signerNameRef = useRef(null);
  const onBadgeRef = useRef(onBadge);
  onBadgeRef.current = onBadge;

  useEffect(() => {
    if (!signingDocKey) return undefined;
    const onKey = (ev) => {
      if (ev.key !== 'Escape' || busy) return;
      setSigningDocKey(null);
      setSignerName('');
      setSignConsent(false);
      setPadEmpty(true);
      padApiRef.current?.clear?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [signingDocKey, busy]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await fetch('/api/employee/dp');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'load');
      setProfile(data.profile || null);
      setDocuments(Array.isArray(data.documents) ? data.documents : []);
      setLeaves(Array.isArray(data.leaves) ? data.leaves : []);
      setBalance(data.balance || null);
      const badge = Number(data.badge) || 0;
      setPendingDocs(Number(data.pendingDocs) || 0);
      onBadgeRef.current?.(badge);
    } catch (e) {
      setLoadError(true);
      setProfile(null);
      setDocuments([]);
      setLeaves([]);
      setBalance(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const saveProfile = async () => {
    const values = await promptForm({
      title: t(locale, 'panel.dp.editProfile'),
      confirmLabel: t(locale, 'panel.dp.save'),
      fields: [
        {
          key: 'addressPostal',
          type: 'cep',
          label: t(locale, 'panel.dp.addressPostal'),
          defaultValue: profile?.addressPostal || '',
          help: t(locale, 'panel.dp.cepHelp'),
          cepAutofill: {
            addressLine: 'addressLine',
            addressCity: 'addressCity',
            addressState: 'addressState',
          },
        },
        {
          key: 'addressLine',
          label: t(locale, 'panel.dp.addressLine'),
          defaultValue: profile?.addressLine || '',
          maxLength: 240,
          row: 'streetNumber',
        },
        {
          key: 'addressNumber',
          row: 'streetNumber',
          label: t(locale, 'panel.dp.addressNumber'),
          defaultValue: profile?.addressNumber || '',
          maxLength: DP_ADDRESS_NUMBER_MAX_LENGTH,
          help: t(locale, 'panel.dp.addressNumberHelp'),
        },
        {
          key: 'addressCity',
          label: t(locale, 'panel.dp.addressCity'),
          defaultValue: profile?.addressCity || '',
          maxLength: 120,
          row: 'cityUf',
        },
        {
          key: 'addressState',
          type: 'select',
          label: t(locale, 'panel.dp.addressState'),
          defaultValue: profile?.addressState || '',
          options: [
            { value: '', label: t(locale, 'panel.dp.ufEmpty') },
            ...BR_STATES.map((s) => ({ value: s.uf, label: s.uf })),
          ],
          row: 'cityUf',
        },
        {
          key: 'cpf',
          type: 'cpf',
          label: t(locale, 'panel.dp.cpf'),
          defaultValue: profile?.cpf || '',
          help: t(locale, 'panel.dp.cpfHelp'),
        },
        {
          key: 'emergencyName',
          label: t(locale, 'panel.dp.emergencyName'),
          defaultValue: profile?.emergencyName || '',
          maxLength: 120,
        },
        {
          key: 'emergencyPhone',
          type: 'phone',
          label: t(locale, 'panel.dp.emergencyPhone'),
          defaultValue: profile?.emergencyPhone || '',
        },
        {
          key: 'emergencyRelation',
          label: t(locale, 'panel.dp.emergencyRelation'),
          defaultValue: profile?.emergencyRelation || '',
          type: 'select',
          options: kinshipOptions(locale, EMERGENCY_KINSHIP_RELATIONS),
        },
      ],
    });
    if (!values) return;
    setBusy(true);
    try {
      const res = await fetch('/api/employee/dp', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'save');
      setProfile(data.profile || profile);
      toast(t(locale, 'employeeHome.dpSaved'), 'ok');
    } catch (e) {
      toast(e?.message || t(locale, 'employeeHome.dpSaveError'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const startUpload = (docKey) => {
    setUploadKey(docKey);
    fileInputRef.current?.click();
  };

  const onFilePicked = async (ev) => {
    const file = ev.target.files?.[0];
    const docKey = uploadKey;
    ev.target.value = '';
    if (!file || !docKey) {
      setUploadKey(null);
      return;
    }
    const validationKey = dpUploadValidationKey(file);
    if (validationKey) {
      toast(t(locale, `panel.dp.${validationKey}`), 'error');
      setUploadKey(null);
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(
        `/api/employee/dp/documents/${encodeURIComponent(docKey)}/file`,
        { method: 'POST', body: fd, signal: AbortSignal.timeout(30000) }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const key = dpUploadResponseKey(res.status, data?.errorCode);
        throw new Error(key ? t(locale, `panel.dp.${key}`) : data?.error || t(locale, 'panel.dp.uploadError'));
      }
      toast(t(locale, 'panel.dp.uploadOk'), 'ok');
      await load();
    } catch (e) {
      toast(e?.name === 'TimeoutError' ? t(locale, 'panel.dp.uploadTimeout') : e?.message || t(locale, 'panel.dp.uploadError'), 'error');
    } finally {
      setBusy(false);
      setUploadKey(null);
    }
  };

  const removeFile = async (doc) => {
    const ok = await confirm({
      title: t(locale, 'panel.dp.deleteFileTitle'),
      message: t(locale, 'panel.dp.deleteFileConfirm'),
      confirmLabel: t(locale, 'panel.dp.docDeleteFile'),
      tone: 'danger',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/employee/dp/documents/${encodeURIComponent(doc.docKey)}/file`,
        { method: 'DELETE' }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'delete');
      toast(t(locale, 'panel.dp.fileDeleted'), 'ok');
      await load();
    } catch (e) {
      toast(e?.message || t(locale, 'panel.dp.fileDeleteError'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const signDocument = async (doc) => {
    setSigningDocKey(doc.docKey);
    setSignerName(String(profile?.fullName || '').trim());
    setSignConsent(false);
    setPadEmpty(true);
    padApiRef.current?.clear?.();
    requestAnimationFrame(() => {
      signPanelRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
      padApiRef.current?.focus?.();
    });
  };

  const cancelSign = () => {
    setSigningDocKey(null);
    setSignerName('');
    setSignConsent(false);
    setPadEmpty(true);
    padApiRef.current?.clear?.();
  };

  const submitSignature = async (doc) => {
    if (!padApiRef.current || padApiRef.current.isEmpty()) {
      toast(t(locale, 'employeeHome.dpSignStrokeRequired'), 'error');
      return;
    }
    const strokePng = padApiRef.current.toDataURL('image/png');
    if (!signerName.trim() || signerName.trim().length < 3) {
      toast(t(locale, 'errors.DP_SIGNATURE_NAME_REQUIRED'), 'error');
      return;
    }
    if (!signConsent) {
      toast(t(locale, 'errors.DP_SIGNATURE_CONSENT_REQUIRED'), 'error');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(
        `/api/employee/dp/documents/${encodeURIComponent(doc.docKey)}/sign`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            signerName: signerName.trim(),
            consent: true,
            strokePng,
          }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'sign');
      toast(t(locale, 'employeeHome.dpSignOk'), 'ok');
      cancelSign();
      await load();
    } catch (e) {
      toast(e?.message || t(locale, 'employeeHome.dpSignError'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const requestLeave = async () => {
    const avail =
      balance?.availableDays != null ? Number(balance.availableDays) : null;
    const values = await promptForm({
      title: t(locale, 'employeeHome.dpRequestLeave'),
      confirmLabel: t(locale, 'employeeHome.dpLeaveSubmit'),
      fields: [
        {
          key: 'leaveType',
          label: t(locale, 'panel.dp.colType'),
          type: 'select',
          defaultValue: DP_LEAVE_TYPE.VACATION,
          options: DP_LEAVE_TYPES.map((v) => ({
            value: v,
            label: leaveTypeLabel(locale, v),
          })),
        },
        {
          key: 'startsOn',
          label: t(locale, 'panel.dp.leaveStarts'),
          type: 'date',
          required: true,
          row: 'leaveDates',
        },
        {
          key: 'endsOn',
          label: t(locale, 'panel.dp.leaveEnds'),
          type: 'date',
          required: true,
          row: 'leaveDates',
        },
        {
          key: 'reason',
          label: t(locale, 'panel.dp.leaveReason'),
          type: 'richText',
          defaultValue: '',
          minHeight: 100,
          help:
            avail != null
              ? t(locale, 'employeeHome.dpBalanceFormHint', { n: avail })
              : t(locale, 'panel.dp.leaveReasonHelp'),
        },
      ],
    });
    if (!values) return;
    setBusy(true);
    try {
      const res = await fetch('/api/employee/dp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'leave');
      toast(t(locale, 'employeeHome.dpLeaveOk'), 'ok');
      await load();
    } catch (e) {
      toast(e?.message || t(locale, 'employeeHome.dpLeaveError'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const cancelLeave = async (row) => {
    const ok = await confirm({
      title: t(locale, 'employeeHome.dpCancelLeaveTitle'),
      message: t(locale, 'employeeHome.dpCancelLeaveConfirm'),
      confirmLabel: t(locale, 'employeeHome.dpCancelLeave'),
      tone: 'danger',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/employee/dp/leave/${encodeURIComponent(row.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'cancel');
      toast(t(locale, 'employeeHome.dpCancelLeaveOk'), 'ok');
      await load();
    } catch (e) {
      toast(e?.message || t(locale, 'employeeHome.dpCancelLeaveError'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const startLeaveUpload = (leaveId) => {
    setLeaveUploadId(leaveId);
    leaveFileRef.current?.click();
  };

  const onLeaveFilePicked = async (ev) => {
    const file = ev.target.files?.[0];
    const leaveId = leaveUploadId;
    ev.target.value = '';
    if (!file || !leaveId) {
      setLeaveUploadId(null);
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(
        `/api/employee/dp/leave/${encodeURIComponent(leaveId)}/file`,
        { method: 'POST', body: fd }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'upload');
      toast(t(locale, 'panel.dp.uploadOk'), 'ok');
      await load();
    } catch (e) {
      toast(e?.message || t(locale, 'panel.dp.uploadError'), 'error');
    } finally {
      setBusy(false);
      setLeaveUploadId(null);
    }
  };

  if (loading) {
    return <AppLoading variant="panel" label={t(locale, 'panel.common.loading')} />;
  }

  if (loadError) {
    return <ContentEnter animKey="emp-dp-error">
      <InlineCallout tone="danger" role="alert" emphasis>
        <p className="m-0">{t(locale, 'panel.dp.loadError')}</p>
        <button type="button" className={cn(S.btnGhost, 'mt-3')} onClick={() => void load()}>
          {t(locale, 'common.retry')}
        </button>
      </InlineCallout>
    </ContentEnter>;
  }

  const openLeaveCount = leaves.filter(
    (l) => l.status === DP_LEAVE_STATUS.REQUESTED || l.status === DP_LEAVE_STATUS.APPROVED
  ).length;

  return (
    <ContentEnter animKey={`emp-dp|${pendingDocs}|${openLeaveCount}|${leaves.length}|${balance?.availableDays ?? 'x'}`}>
      <div className="space-y-4">
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,image/jpeg,image/png"
          className="hidden"
          onChange={(e) => void onFilePicked(e)}
        />
        <input
          ref={leaveFileRef}
          type="file"
          accept="application/pdf,image/jpeg,image/png"
          className="hidden"
          onChange={(e) => void onLeaveFilePicked(e)}
        />
        {showIntro ? (
          <p className={cn(S.muted, 'm-0 text-xs')}>{t(locale, 'employeeHome.dpHint')}</p>
        ) : null}

        {pendingDocs > 0 ? (
          <InlineCallout tone="warning">
            {tCount(locale, 'employeeHome.dpDocsPending', pendingDocs)}
          </InlineCallout>
        ) : null}

        <PanelSubNav
          ariaLabel={t(locale, 'employeeHome.dpTitle')}
          active={activePanel}
          onChange={setActivePanel}
          tabs={[
            { id: 'documents', label: t(locale, 'panel.dp.docsTitle'), badge: pendingDocs || undefined },
            { id: 'leave', label: t(locale, 'panel.dp.leaveTitle') },
            { id: 'profile', label: t(locale, 'panel.dp.profileTitle') },
          ].map(tab => ({ ...tab, tabId: `employee-dp-tab-${tab.id}`, panelId: `employee-dp-panel-${tab.id}` }))}
        />
        <div role="tabpanel" id="employee-dp-panel-profile" aria-labelledby="employee-dp-tab-profile" hidden={activePanel !== 'profile'} className={cn(S.cardShell, 'p-4 sm:p-5')}>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className={cn(S.cardSection, 'm-0')}>{t(locale, 'panel.dp.profileTitle')}</h2>
            <button
              type="button"
              disabled={busy}
              className={cn(S.btnBrandSoft, 'min-h-touch text-sm')}
              onClick={() => void saveProfile()}
            >
              {t(locale, 'panel.dp.editProfile')}
            </button>
          </div>
          {!profile?.emergencyName && !profile?.addressLine && !profile?.addressPostal && !profile?.cpf ? (
            <InlineCallout tone="info" className="mb-3">
              {t(locale, 'panel.dp.noProfile')}
            </InlineCallout>
          ) : null}
          {[
            {
              id: 'address',
              title: t(locale, 'panel.dp.addressSection'),
              fields: [
                ['cpf', profile?.cpf ? formatCpfBr(profile.cpf) : ''],
                ['addressLine', profile?.addressLine],
                ['addressNumber', profile?.addressNumber],
                ['addressCity', profile?.addressCity],
                ['addressState', profile?.addressState],
                ['addressPostal', profile?.addressPostal ? formatCepBr(profile.addressPostal) : ''],
              ],
            },
            {
              id: 'emergency',
              title: t(locale, 'panel.dp.emergencySection'),
              fields: [
                ['emergencyName', profile?.emergencyName],
                ['emergencyPhone', profile?.emergencyPhone ? formatPhoneBr(profile.emergencyPhone) : ''],
                ['emergencyRelation', kinshipLabel(locale, profile?.emergencyRelation)],
              ],
            },
          ].map((group) => (
            <section key={group.id} className="mt-3 border-t border-ink/8 pt-3 first-of-type:mt-0 first-of-type:border-t-0 first-of-type:pt-0">
              <h3 className={cn(S.cardTitle, 'mb-2 mt-0')}>{group.title}</h3>
              <dl className="m-0 grid items-start gap-x-4 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
                {group.fields.map(([key, value]) => (
                  <FormField key={key} label={t(locale, `panel.dp.${key}`)}>
                    <p className={cn(S.cardMuted, 'm-0')}>{value || '—'}</p>
                  </FormField>
                ))}
              </dl>
            </section>
          ))}
        </div>

        <div role="tabpanel" id="employee-dp-panel-documents" aria-labelledby="employee-dp-tab-documents" hidden={activePanel !== 'documents'} className={cn(S.cardShell, 'p-4 sm:p-5')}>
          <h2 className={cn(S.cardSection, 'mb-2 mt-0')}>{t(locale, 'panel.dp.docsTitle')}</h2>
          <p className={cn(S.muted, 'mb-3 mt-0 text-xs')}>{t(locale, 'employeeHome.dpDocsUploadHint')}</p>
          <InlineCallout tone="info" className="mb-3">
            {t(locale, 'employeeHome.dpSignHint')}
          </InlineCallout>
          {documents.length === 0 ? (
            <div data-emp-empty tabIndex={-1} className="outline-none">
              <EmptyState message={t(locale, 'panel.dp.docsEmptyHint')} />
            </div>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {[...documents]
                .sort((a, b) => {
                  const rank = (d) => {
                    if ((d.signatureStatus || '') === DP_DOCUMENT_SIGNATURE_STATUS.REQUESTED) return 0;
                    return d.status === DP_DOCUMENT_STATUS.PENDING ? 1 : 2;
                  };
                  return rank(a) - rank(b);
                })
                .map((doc) => {
                const sig = doc.signatureStatus || DP_DOCUMENT_SIGNATURE_STATUS.NONE;
                const isSigning = signingDocKey === doc.docKey;
                const canConfirmSign =
                  !busy
                  && !padEmpty
                  && signerName.trim().length >= 3
                  && signConsent;
                const nextHint = padEmpty
                  ? t(locale, 'employeeHome.dpSignStrokeRequired')
                  : signerName.trim().length < 3
                    ? t(locale, 'employeeHome.dpSignNeedName')
                    : !signConsent
                      ? t(locale, 'employeeHome.dpSignNeedConsent')
                      : '';
                return (
                <li
                  key={doc.docKey}
                  className={cn(
                    'flex flex-col gap-2 rounded-control border bg-canvas/40 px-2.5 py-2',
                    isSigning
                      ? 'border-brand-500/40 ring-1 ring-brand-500/15'
                      : 'border-ink/8'
                  )}
                >
                  <div className="grid grid-cols-1 items-center gap-3 lg:grid-cols-[minmax(0,1fr)_18rem]">
                  <div className="min-w-0">
                    <div className={S.cardMuted}>{docKeyLabel(locale, doc.docKey)}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <StatusToneChip tone={docStatusTone(doc.status, doc.hasFile)}>
                        {doc.status === DP_DOCUMENT_STATUS.RECEIVED && !doc.hasFile
                          ? t(locale, 'panel.dp.docStatus.receivedNoFile')
                          : docStatusLabel(locale, doc.status)}
                      </StatusToneChip>
                      {sig !== DP_DOCUMENT_SIGNATURE_STATUS.NONE ? (
                        <StatusToneChip tone={sigStatusTone(sig)}>
                          {sigStatusLabel(locale, sig)}
                        </StatusToneChip>
                      ) : null}
                      {doc.hasFile ? (
                        <PrivateAttachment href={`/api/employee/dp/documents/${encodeURIComponent(doc.docKey)}/file`} fileName={doc.fileName} updatedAt={doc.updatedAt} locale={locale} />
                      ) : doc.status !== DP_DOCUMENT_STATUS.RECEIVED ? (
                        <span className="font-mono text-2xs text-ink-muted">{t(locale, 'panel.dp.docNoFile')}</span>
                      ) : null}
                    </div>
                    {sig === DP_DOCUMENT_SIGNATURE_STATUS.SIGNED ? (
                      <p className={cn(S.muted, 'mb-0 mt-1 text-xs')}>
                        {t(locale, 'panel.dp.sigSignedMeta', {
                          name: doc.signerName || '—',
                          when: formatDateTime(doc.signedAt, locale),
                        })}
                      </p>
                    ) : null}
                    {sig === DP_DOCUMENT_SIGNATURE_STATUS.SIGNED && doc.signerStrokePng ? (
                      <SignatureStrokePreview
                        src={doc.signerStrokePng}
                        alt={t(locale, 'panel.dp.sigStrokeAlt')}
                        caption={t(locale, 'panel.dp.sigStrokeLabel')}
                        maxHeightClass="max-h-16"
                      />
                    ) : null}
                  </div>
                  {!isSigning ? (
                  <div className="flex shrink-0 flex-wrap gap-1">
                    {sig === DP_DOCUMENT_SIGNATURE_STATUS.REQUESTED && doc.hasFile ? (
                      <button
                        type="button"
                        disabled={busy}
                        className={cn(S.btnPrimary, 'min-h-touch text-sm')}
                        onClick={() => void signDocument(doc)}
                      >
                        {t(locale, 'employeeHome.dpSignBtn')}
                      </button>
                    ) : null}
                    {doc.status !== DP_DOCUMENT_STATUS.WAIVED
                      && sig !== DP_DOCUMENT_SIGNATURE_STATUS.SIGNED ? (
                      <button
                        type="button"
                        disabled={busy || uploadKey === doc.docKey}
                        className={cn(S.btnGhost, 'min-h-touch text-sm')}
                        onClick={() => startUpload(doc.docKey)}
                      >
                        {uploadKey === doc.docKey
                          ? t(locale, 'panel.common.loading')
                          : t(locale, 'panel.dp.docUpload')}
                      </button>
                    ) : null}
                    {doc.hasFile && sig !== DP_DOCUMENT_SIGNATURE_STATUS.SIGNED ? (
                      <button
                        type="button"
                        disabled={busy}
                        className={cn(S.btnGhost, 'min-h-touch text-sm text-danger')}
                        onClick={() => void removeFile(doc)}
                      >
                        {t(locale, 'panel.dp.docDeleteFile')}
                      </button>
                    ) : null}
                  </div>
                  ) : null}
                  </div>
                  {isSigning ? (
                    <ContentEnter animKey={`sign|${doc.docKey}`}>
                      <div
                        ref={signPanelRef}
                        className="rounded-control border border-brand-500/25 bg-surface p-3 shadow-sm"
                      >
                        <p className={cn(S.label, 'mb-1')}>
                          {t(locale, 'employeeHome.dpSignTitle', {
                            doc: docKeyLabel(locale, doc.docKey),
                          })}
                        </p>
                        <p className={cn(S.muted, 'mb-3 mt-0 text-prose')}>
                          {t(locale, 'employeeHome.dpSignPadHint')}
                        </p>
                        {doc.hasFile ? (
                          <div className="mb-3">
                            <PrivateAttachment href={`/api/employee/dp/documents/${encodeURIComponent(doc.docKey)}/file`} fileName={doc.fileName} updatedAt={doc.updatedAt} locale={locale} />
                          </div>
                        ) : null}
                        <FormField label={t(locale, 'panel.dp.sigStrokeLabel')}>
                          <SignaturePadField
                            locale={locale}
                            padRef={padApiRef}
                            disabled={busy}
                            height={168}
                            onEmptyChange={setPadEmpty}
                          />
                        </FormField>
                        <div className="mt-3 grid grid-cols-1 gap-3 sm:items-start">
                          <FormField
                            label={t(locale, 'employeeHome.dpSignNameLabel')}
                            hint={t(locale, 'employeeHome.dpSignNameHelp')}
                          >
                            <input
                              ref={signerNameRef}
                              type="text"
                              className={S.input}
                              value={signerName}
                              maxLength={120}
                              autoComplete="name"
                              disabled={busy}
                              onChange={(e) => setSignerName(e.target.value)}
                            />
                          </FormField>
                          <label className="inline-flex min-h-touch cursor-pointer items-start gap-2 font-ui text-prose text-ink">
                            <input
                              type="checkbox"
                              className={cn(S.checkbox, 'mt-1')}
                              checked={signConsent}
                              disabled={busy}
                              onChange={(e) => setSignConsent(e.target.checked)}
                            />
                            <span>{t(locale, 'employeeHome.dpSignConsent')}</span>
                          </label>
                        </div>
                        {!canConfirmSign && nextHint ? (
                          <p className={cn(S.faint, 'mb-0 mt-2')} aria-live="polite">
                            {nextHint}
                          </p>
                        ) : null}
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            type="button"
                            className={cn(S.btnPrimary, 'inline-flex min-h-touch items-center gap-1.5')}
                            disabled={!canConfirmSign}
                            onClick={() => void submitSignature(doc)}
                          >
                            {busy ? null : <Icon name="check" className="h-4 w-4" />}
                            {busy
                              ? t(locale, 'panel.common.loading')
                              : t(locale, 'employeeHome.dpSignConfirm')}
                          </button>
                          <button
                            type="button"
                            className={cn(S.btnGhost, 'min-h-touch')}
                            disabled={busy}
                            onClick={cancelSign}
                          >
                            {t(locale, 'panel.common.cancel')}
                          </button>
                        </div>
                      </div>
                    </ContentEnter>
                  ) : null}
                </li>
                );
              })}
            </ul>
          )}
        </div>

        <div role="tabpanel" id="employee-dp-panel-leave" aria-labelledby="employee-dp-tab-leave" hidden={activePanel !== 'leave'} className={cn(S.cardShell, 'p-4 sm:p-5')}>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className={cn(S.cardSection, 'm-0')}>{t(locale, 'panel.dp.leaveTitle')}</h2>
            <button
              type="button"
              disabled={busy}
              className={cn(S.btnPrimary, 'min-h-touch text-sm')}
              onClick={() => void requestLeave()}
            >
              {t(locale, 'employeeHome.dpRequestLeave')}
            </button>
          </div>
          <LeaveBalanceSummary
            locale={locale}
            balance={balance}
            showPeriod
            className="mb-3"
          />
          <p className={cn(S.faint, 'mb-3 mt-0')}>{t(locale, 'employeeHome.dpBalanceHint')}</p>
          {leaves.length === 0 ? (
            <div data-emp-empty tabIndex={-1} className="outline-none">
              <EmptyState message={t(locale, 'employeeHome.dpEmptyLeave')} />
            </div>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {leaves.map((row) => {
                const days = leaveInclusiveDays(row.startsOn, row.endsOn);
                return (
                <li
                  key={row.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-ink/8 bg-canvas/40 px-2.5 py-2"
                >
                  <div className="min-w-0">
                    <div className={S.cardMuted}>{leaveTypeLabel(locale, row.leaveType)}</div>
                    <div className="text-xs text-ink-muted">
                      {formatDate(row.startsOn, locale)}–{formatDate(row.endsOn, locale)}
                      {days != null
                        ? ` · ${tCount(locale, 'panel.dp.leaveDaysMeta', days)}`
                        : ''}
                    </div>
                    {row.reason ? (
                      <div className="mt-1 text-xs text-ink-muted">
                        <RichTextView html={row.reason} />
                      </div>
                    ) : null}
                    {row.hasFile ? (
                      <div className="mt-2">
                        <PrivateAttachment href={`/api/employee/dp/leave/${encodeURIComponent(row.id)}/file`} fileName={row.fileName} locale={locale} />
                      </div>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <StatusToneChip tone={leaveStatusTone(row.status)}>
                      {leaveStatusLabel(locale, row.status)}
                    </StatusToneChip>
                    <div className="flex flex-wrap justify-end gap-1">
                      {row.status === DP_LEAVE_STATUS.REQUESTED ? (
                        <button
                          type="button"
                          disabled={busy}
                          className={cn(S.btnGhost, 'min-h-touch text-sm text-danger')}
                          onClick={() => void cancelLeave(row)}
                        >
                          {t(locale, 'employeeHome.dpCancelLeave')}
                        </button>
                      ) : null}
                      {row.leaveType === DP_LEAVE_TYPE.SICK &&
                      row.status !== DP_LEAVE_STATUS.CANCELLED &&
                      row.status !== DP_LEAVE_STATUS.REJECTED ? (
                        <button
                          type="button"
                          disabled={busy || leaveUploadId === row.id}
                          className={cn(S.btnGhost, 'min-h-touch text-sm')}
                          onClick={() => startLeaveUpload(row.id)}
                        >
                          {leaveUploadId === row.id
                            ? t(locale, 'panel.common.loading')
                            : t(locale, 'panel.dp.leaveAttachFile')}
                        </button>
                      ) : null}
                    </div>
                  </div>
                </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </ContentEnter>
  );
}
