'use client';

import { DP_ADDRESS_NUMBER_MAX_LENGTH } from '../../lib/dp-profile-constants';
import { dpUploadValidationKey, dpUploadResponseKey } from '../../lib/dp-upload-validation';

import { useCallback, useEffect, useRef, useState } from 'react';
import { t, tCount, localeHtmlLang, t as i18nT } from '../../lib/i18n';
import { kinshipLabel, kinshipOptions } from '../../lib/kinship-relation.js';
import { cn } from '../../lib/cn';
import {
  S,
  AdminCreateButton,
  AdminDeleteButton,
  AdminEditButton,
  AdminIconButton,
} from '../dashboard/dashboard-shared';
import { EmptyState } from './EmptyState';
import { AppLoading, ContentEnter } from './AppLoading';
import { useAppFeedback } from './AppFeedback';
import { StatusToneChip } from './StatusToneChip';
import { DpDependentsEditor } from './DpDependentsEditor';
import { Icon } from './Icon';
import { InlineCallout } from './InlineCallout';
import { TimeClockScheduleBlock } from './TimeClockScheduleBlock';
import { PrivateAttachment } from './PrivateAttachment';
import { formatDisplayDateTime } from '../../lib/format-display-date';
import { RichTextView } from './RichTextView';
import { LeaveBalanceSummary } from './LeaveBalanceSummary';
import { SignatureStrokePreview } from './SignaturePadField';
import { BR_STATES } from '../../lib/candidate-profile.js';
import { formatCepBr, formatCpfBr, formatPhoneBr } from '../../lib/br-masks.js';
import {
  DP_DOCUMENT_KEYS,
  DP_DOCUMENT_STATUS,
  DP_DOCUMENT_STATUSES,
  DP_DOCUMENT_SIGNATURE_STATUS,
  DP_LEAVE_STATUS,
  DP_LEAVE_TYPE,
  DP_LEAVE_TYPES,
  EMPLOYMENT_STATUS,
  EMERGENCY_KINSHIP_RELATIONS,
} from '../../lib/domain-status.js';
import { leaveInclusiveDays } from '../../lib/leave-days.js';
import { TIME_CLOCK_REASON, resolveTimeClockEligibility } from '../../lib/people/time-clock-eligibility.js';

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

function ageFromBirthDate(value) {
  if (!value) return null;
  const birth = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(birth.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const beforeBirthday =
    today.getMonth() < birth.getMonth() ||
    (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate());
  if (beforeBirthday) age -= 1;
  return age >= 0 ? age : null;
}

function maritalStatusLabel(locale, value) {
  const keys = {
    single: 'maritalSingle',
    married: 'maritalMarried',
    stable_union: 'maritalStableUnion',
    divorced: 'maritalDivorced',
    widowed: 'maritalWidowed',
  };
  return value ? t(locale, `panel.dp.${keys[value] || 'notInformed'}`) : '—';
}

function timeClockStatusLabel(locale, candidate) {
  const { enabled, reason } = resolveTimeClockEligibility({
    workFormat: candidate?.workFormat,
    override: candidate?.timeClockOverride,
  });
  const status = t(locale, enabled ? 'panel.dp.timeClockOn' : 'panel.dp.timeClockOff');
  const why = t(locale, reason === TIME_CLOCK_REASON.OVERRIDE ? 'panel.dp.timeClockReasonOverride' : 'panel.dp.timeClockReasonWorkFormat');
  return `${status} · ${why}`;
}

function workFormatLabel(locale, value) {
  const keys = {
    clt: 'workFormatClt',
    intern: 'workFormatIntern',
    cooperative: 'workFormatCooperative',
    pj: 'workFormatPj',
  };
  return value ? t(locale, `panel.dp.${keys[value] || 'notInformed'}`) : '—';
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

function docStatusTone(status) {
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
 * Lightweight DP: emergency/address profile, document checklist, leave.
 */
function ProfileSection({ title, action = null, first = false, plain = false, children }) {
  return (
    <section className={cn(!first && 'mt-4 border-t border-ink/10 pt-4')}>
      <div className="mb-3 flex min-h-touch items-center justify-between gap-2">
        <h3 className="m-0 font-ui text-sm font-semibold text-ink">{title}</h3>
        {action}
      </div>
      {plain ? children : <dl className="m-0 grid items-start gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">{children}</dl>}
    </section>
  );
}

function ProfileInfo({ label, children, className, breakAll = false, pre = false }) {
  const empty = children == null || children === '';
  return (
    <div className={cn('min-w-0', className)}>
      <dt className={S.label}>{label}</dt>
      <dd className={cn('m-0 text-sm', empty ? 'text-ink-faint' : 'text-ink', breakAll && 'break-all', pre && 'whitespace-pre-wrap')}>{empty ? '—' : children}</dd>
    </div>
  );
}

export function DpBlock({ locale, candidateId, employmentStatus, companyId }) {
  const { toast, promptForm, confirm } = useAppFeedback();
  const [profile, setProfile] = useState(null);
  const [candidate, setCandidate] = useState(null);
  const [workFormatHistory, setWorkFormatHistory] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [leaves, setLeaves] = useState([]);
  const [balance, setBalance] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editingDependents, setEditingDependents] = useState(false);
  const [uploadKey, setUploadKey] = useState(null);
  const [leaveUploadId, setLeaveUploadId] = useState(null);
  const fileInputRef = useRef(null);
  const leaveFileRef = useRef(null);

  const readOnly = employmentStatus === EMPLOYMENT_STATUS.ALUMNI;
  const visible =
    employmentStatus === EMPLOYMENT_STATUS.EMPLOYEE ||
    employmentStatus === EMPLOYMENT_STATUS.ALUMNI;

  const baseUrl = `/api/admin/candidates/${encodeURIComponent(candidateId)}/dp`;
  const scopedCompanyId = companyId != null ? Number(companyId) : null;

  // Skeleton only on first load per key; reloads after saves keep the block mounted.
  const loadedKeyRef = useRef(null);
  const load = useCallback(async () => {
    if (!candidateId || !visible) {
      setProfile(null);
      setCandidate(null);
      setDocuments([]);
      setLeaves([]);
      setBalance(null);
      setLoading(false);
      return;
    }
    if (loadedKeyRef.current !== baseUrl) setLoading(true);
    try {
      const res = await fetch(baseUrl);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'load');
      setProfile(data.profile || null);
      setCandidate(data.candidate || null);
      setWorkFormatHistory(data.workFormatHistory || []);
      setDocuments(Array.isArray(data.documents) ? data.documents : []);
      setLeaves(Array.isArray(data.leaves) ? data.leaves : []);
      setBalance(data.balance || null);
    } catch (e) {
      toast(e?.message || t(locale, 'panel.dp.loadError'), 'error');
      setProfile(null);
      setDocuments([]);
      setLeaves([]);
      setBalance(null);
    } finally {
      loadedKeyRef.current = baseUrl;
      setLoading(false);
    }
  }, [candidateId, visible, locale, toast, baseUrl]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!visible) {
    return (
      <p className="m-0 rounded-control border border-ink/12 bg-ink/[0.02] px-3.5 py-3 text-xs leading-normal text-ink-muted">
        {t(locale, 'panel.dp.notInternal')}
      </p>
    );
  }

  const editProfile = async () => {
    await promptForm({
      size: 'wide',
      title: t(locale, 'panel.dp.editProfile'),
      confirmLabel: t(locale, 'panel.dp.save'),
      submit: async (values) => {
        if ([values.phone, values.emergencyPhone].some(value => value && (String(value).replace(/\D/g, '').length < 10 || String(value).replace(/\D/g, '').length > 15))) {
          throw new Error(i18nT(locale, 'ui.dpBlock.enterAPhoneNumberWith'));
        }
        if (values.cpf && String(values.cpf).replace(/\D/g, '').length !== 11) {
          throw new Error(i18nT(locale, 'ui.dpBlock.enterAn11DigitCpf'));
        }
        const res = await fetch(`/api/admin/candidates/${encodeURIComponent(candidateId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fullName: values.fullName,
            email: values.email,
            personalEmail: values.personalEmail,
            phone: values.phone,
            maritalStatus: values.maritalStatus,
            employeeNumber: values.employeeNumber,
            workFormat: values.workFormat,
            workFormatEffectiveDate: values.workFormatEffectiveDate,
            timeClockOverride: values.timeClockOverride,
            workHistory: values.workHistory,
            birthDate: values.birthDate,
            dpProfile: values,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || t(locale, 'panel.dp.saveError'));
        const { dpProfile, portalAccessReset, ...savedCandidate } = data;
        setProfile(dpProfile);
        setCandidate((prev) => ({ ...prev, ...savedCandidate }));
        if (portalAccessReset) {
          toast(t(locale, portalAccessReset.inviteSent ? 'panel.dp.emailChangedInviteSent' : 'panel.dp.emailChangedInviteFailed'), portalAccessReset.inviteSent ? 'ok' : 'info');
        } else {
          toast(t(locale, 'panel.dp.saved'), 'ok');
        }
        await load();
      },
      fields: [
        {
          key: 'fullName',
          label: t(locale, 'panel.dp.fullName'),
          defaultValue: candidate?.fullName || '',
          required: true,
          section: i18nT(locale, 'ui.dpBlock.personal'),
        },
        {
          key: 'maritalStatus',
          type: 'select',
          label: t(locale, 'panel.dp.maritalStatus'),
          defaultValue: candidate?.maritalStatus || '',
          options: [
            { value: '', label: t(locale, 'panel.dp.notInformed') },
            { value: 'single', label: t(locale, 'panel.dp.maritalSingle') },
            { value: 'married', label: t(locale, 'panel.dp.maritalMarried') },
            { value: 'stable_union', label: t(locale, 'panel.dp.maritalStableUnion') },
            { value: 'divorced', label: t(locale, 'panel.dp.maritalDivorced') },
            { value: 'widowed', label: t(locale, 'panel.dp.maritalWidowed') },
          ],
          row: 'maritalBirth',
        },
        {
          key: 'birthDate',
          type: 'date',
          label: t(locale, 'panel.dp.birthDate'),
          defaultValue: candidate?.birthDate ? String(candidate.birthDate).slice(0, 10) : '',
          row: 'maritalBirth',
        },
        {
          key: 'cpf',
          type: 'cpf',
          label: t(locale, 'panel.dp.cpf'),
          defaultValue: profile?.cpf || '',
          help: t(locale, 'panel.dp.cpfHelp'),
          row: 'docs',
        },
        {
          key: 'rg',
          label: t(locale, 'panel.dp.rg'),
          defaultValue: profile?.rg || '',
          row: 'docs',
        },
        {
          key: 'email',
          type: 'email',
          label: t(locale, 'panel.dp.corporateEmail'),
          defaultValue: candidate?.email || '',
          required: true,
          help: t(locale, 'panel.dp.corporateEmailHelp'),
          section: i18nT(locale, 'ui.dpBlock.contact'),
          row: 'emails',
        },
        {
          key: 'personalEmail',
          type: 'email',
          label: t(locale, 'panel.dp.personalEmail'),
          defaultValue: candidate?.personalEmail || '',
          row: 'emails',
        },
        {
          key: 'phone',
          type: 'phone',
          label: t(locale, 'panel.dp.mobile'),
          defaultValue: candidate?.phone || '',
          row: 'phoneCep',
        },
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
          row: 'phoneCep',
        },
        {
          key: 'addressLine',
          label: t(locale, 'panel.dp.addressLine'),
          defaultValue: profile?.addressLine || '',
          maxLength: 240,
          row: 'street',
          rowWeight: 3,
        },
        {
          key: 'addressNumber',
          label: t(locale, 'panel.dp.addressNumber'),
          defaultValue: profile?.addressNumber || '',
          maxLength: DP_ADDRESS_NUMBER_MAX_LENGTH,
          help: t(locale, 'panel.dp.addressNumberHelp'),
          row: 'street',
        },
        {
          key: 'addressCity',
          label: t(locale, 'panel.dp.addressCity'),
          defaultValue: profile?.addressCity || '',
          maxLength: 120,
          row: 'city',
          rowWeight: 3,
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
          row: 'city',
        },
        {
          key: 'employeeNumber',
          label: t(locale, 'panel.dp.employeeNumber'),
          defaultValue: candidate?.employeeNumber || '',
          section: i18nT(locale, 'ui.dpBlock.professional'),
          row: 'work',
        },
        {
          key: 'workFormat',
          type: 'select',
          label: t(locale, 'panel.dp.workFormat'),
          defaultValue: candidate?.workFormat || '',
          options: [
            { value: '', label: t(locale, 'panel.dp.notInformed') },
            { value: 'clt', label: t(locale, 'panel.dp.workFormatClt') },
            { value: 'intern', label: t(locale, 'panel.dp.workFormatIntern') },
            { value: 'cooperative', label: t(locale, 'panel.dp.workFormatCooperative') },
            { value: 'pj', label: t(locale, 'panel.dp.workFormatPj') },
          ],
          row: 'work',
        },
        {
          key: 'workFormatEffectiveDate',
          type: 'date',
          required: true,
          label: t(locale, 'panel.dp.workFormatEffectiveDate'),
          showWhen: values => (values.workFormat || '') !== (candidate?.workFormat || ''),
          width: 'half',
        },
        {
          key: 'timeClockOverride',
          type: 'select',
          label: t(locale, 'panel.dp.timeClock'),
          defaultValue: candidate?.timeClockOverride == null ? '' : String(candidate.timeClockOverride),
          options: [
            { value: '', label: t(locale, 'panel.dp.timeClockFollow') },
            { value: 'true', label: t(locale, 'panel.dp.timeClockForceOn') },
            { value: 'false', label: t(locale, 'panel.dp.timeClockForceOff') },
          ],
          help: t(locale, 'panel.dp.timeClockHelp'),
          width: 'half',
        },
        {
          key: 'workHistory',
          type: 'textarea',
          label: t(locale, 'panel.dp.workHistory'),
          defaultValue: candidate?.workHistory || '',
          rows: 3,
        },
        {
          key: 'internalNotes',
          type: 'textarea',
          label: t(locale, 'panel.dp.internalNotes'),
          defaultValue: profile?.internalNotes || '',
          rows: 3,
          maxLength: 4000,
        },
        {
          key: 'emergencyName',
          label: t(locale, 'panel.dp.emergencyName'),
          defaultValue: profile?.emergencyName || '',
          maxLength: 120,
          section: i18nT(locale, 'ui.dpBlock.emergency'),
          row: 'emergency',
          rowWeight: 2,
        },
        {
          key: 'emergencyRelation',
          label: t(locale, 'panel.dp.emergencyRelation'),
          defaultValue: profile?.emergencyRelation || '',
          type: 'select',
          options: kinshipOptions(locale, EMERGENCY_KINSHIP_RELATIONS),
          row: 'emergency',
        },
        {
          key: 'emergencyPhone',
          type: 'phone',
          label: t(locale, 'panel.dp.emergencyPhone'),
          defaultValue: profile?.emergencyPhone || '',
          width: 'half',
        },
      ],
    });
  };

  const editDocument = async (doc) => {
    const values = await promptForm({
      title: t(locale, 'panel.dp.docEdit'),
      confirmLabel: t(locale, 'panel.dp.save'),
      fields: [
        {
          key: 'status',
          type: 'select',
          label: t(locale, 'panel.dp.docStatusLabel'),
          defaultValue: doc.status || DP_DOCUMENT_STATUS.PENDING,
          required: true,
          options: DP_DOCUMENT_STATUSES.map((s) => ({
            value: s,
            label: docStatusLabel(locale, s),
          })),
        },
        {
          key: 'notes',
          type: 'textarea',
          label: t(locale, 'panel.dp.docNotes'),
          defaultValue: doc.notes || '',
          rows: 3,
          maxLength: 2000,
        },
      ],
    });
    if (!values) return;
    setBusy(true);
    try {
      const res = await fetch(
        `${baseUrl}/documents/${encodeURIComponent(doc.docKey)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: values.status, notes: values.notes }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'save');
      setDocuments((prev) =>
        prev.map((d) => (d.docKey === doc.docKey ? data.item || { ...d, ...values } : d))
      );
      toast(t(locale, 'panel.dp.saved'), 'ok');
    } catch (e) {
      toast(e?.message || t(locale, 'panel.dp.saveError'), 'error');
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
        `${baseUrl}/documents/${encodeURIComponent(docKey)}/file`,
        { method: 'POST', body: fd, signal: AbortSignal.timeout(30000) }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const key = dpUploadResponseKey(res.status, data?.errorCode);
        throw new Error(key ? t(locale, `panel.dp.${key}`) : data?.error || t(locale, 'panel.dp.uploadError'));
      }
      setDocuments((prev) =>
        prev.map((d) => (d.docKey === docKey ? data.item || d : d))
      );
      toast(t(locale, 'panel.dp.uploadOk'), 'ok');
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
        `${baseUrl}/documents/${encodeURIComponent(doc.docKey)}/file`,
        { method: 'DELETE' }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'delete');
      setDocuments((prev) =>
        prev.map((d) => (d.docKey === doc.docKey ? data.item || { ...d, hasFile: false, fileName: '', fileUrl: null } : d))
      );
      toast(t(locale, 'panel.dp.fileDeleted'), 'ok');
    } catch (e) {
      toast(e?.message || t(locale, 'panel.dp.fileDeleteError'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const signatureAction = async (doc, action) => {
    setBusy(true);
    try {
      const res = await fetch(
        `${baseUrl}/documents/${encodeURIComponent(doc.docKey)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'signature');
      setDocuments((prev) =>
        prev.map((d) => (d.docKey === doc.docKey ? data.item || d : d))
      );
      toast(
        action === 'requestSignature'
          ? t(locale, 'panel.dp.sigRequested')
          : t(locale, 'panel.dp.sigWaived'),
        'ok'
      );
    } catch (e) {
      toast(e?.message || t(locale, 'panel.dp.saveError'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const addLeave = async () => {
    const today = new Date().toISOString().slice(0, 10);
    const avail =
      balance?.availableDays != null ? Number(balance.availableDays) : null;
    const values = await promptForm({
      title: t(locale, 'panel.dp.leaveAdd'),
      confirmLabel: t(locale, 'panel.dp.save'),
      fields: [
        {
          key: 'leaveType',
          type: 'select',
          label: t(locale, 'panel.dp.leaveTypeLabel'),
          defaultValue: DP_LEAVE_TYPE.VACATION,
          required: true,
          options: DP_LEAVE_TYPES.map((v) => ({
            value: v,
            label: leaveTypeLabel(locale, v),
          })),
        },
        {
          key: 'startsOn',
          type: 'date',
          label: t(locale, 'panel.dp.leaveStarts'),
          defaultValue: today,
          required: true,
          row: 'leaveDates',
        },
        {
          key: 'endsOn',
          type: 'date',
          label: t(locale, 'panel.dp.leaveEnds'),
          defaultValue: today,
          required: true,
          row: 'leaveDates',
        },
        {
          key: 'reason',
          type: 'richText',
          label: t(locale, 'panel.dp.leaveReason'),
          defaultValue: '',
          minHeight: 100,
          help:
            avail != null
              ? t(locale, 'panel.dp.leaveBalanceFormHelp', { n: avail })
              : t(locale, 'panel.dp.leaveReasonHelp'),
        },
        {
          key: 'allowOverBalance',
          type: 'boolean',
          label: t(locale, 'panel.dp.leaveAllowOver'),
          defaultValue: false,
          showWhen: (v) => v.leaveType === DP_LEAVE_TYPE.VACATION,
        },
      ],
    });
    if (!values) return;
    setBusy(true);
    try {
      const res = await fetch(`${baseUrl}/leave`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leaveType: values.leaveType,
          startsOn: values.startsOn,
          endsOn: values.endsOn,
          reason: values.reason,
          autoApprove: true,
          allowOverBalance: values.allowOverBalance === true,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'save');
      if (data.item) setLeaves((prev) => [data.item, ...prev]);
      await load();
      toast(t(locale, 'panel.dp.leaveCreated'), 'ok');
    } catch (e) {
      toast(e?.message || t(locale, 'panel.dp.leaveCreateError'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const editBalance = async () => {
    const values = await promptForm({
      title: t(locale, 'panel.dp.balanceEdit'),
      confirmLabel: t(locale, 'panel.dp.save'),
      fields: [
        {
          key: 'entitlementDays',
          type: 'number',
          label: t(locale, 'panel.dp.balanceEntitlement'),
          defaultValue: String(balance?.entitlementDays ?? 30),
          required: true,
          min: 0,
          max: 365,
        },
        {
          key: 'adjustmentDays',
          type: 'number',
          label: t(locale, 'panel.dp.balanceAdjustment'),
          defaultValue: String(balance?.adjustmentDays ?? 0),
          min: -365,
          max: 365,
        },
        {
          key: 'periodStart',
          row: 'period',
          type: 'date',
          label: t(locale, 'panel.dp.balancePeriodStart'),
          defaultValue: balance?.periodStart || '',
        },
        {
          key: 'periodEnd',
          row: 'period',
          type: 'date',
          label: t(locale, 'panel.dp.balancePeriodEnd'),
          defaultValue: balance?.periodEnd || '',
        },
        {
          key: 'notes',
          type: 'textarea',
          label: t(locale, 'panel.dp.balanceNotes'),
          defaultValue: balance?.notes || '',
          rows: 2,
          maxLength: 1000,
        },
      ],
    });
    if (!values) return;
    const entitlementDays = Number(values.entitlementDays);
    const adjustmentDays = Number(values.adjustmentDays || 0);
    if (!Number.isFinite(entitlementDays) || !Number.isFinite(adjustmentDays)) {
      toast(t(locale, 'panel.dp.balanceSaveError'), 'error');
      return;
    }
    setBusy(true);
    try {
      const payload = {
        entitlementDays,
        adjustmentDays,
        notes: values.notes,
      };
      if (values.periodStart && values.periodEnd) {
        payload.periodStart = values.periodStart;
        payload.periodEnd = values.periodEnd;
      } else if (!values.periodStart && !values.periodEnd && balance?.customPeriod) {
        payload.clearPeriod = true;
      }
      const res = await fetch(`${baseUrl}/leave-balance`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'save');
      setBalance(data.balance || null);
      toast(t(locale, 'panel.dp.balanceSaved'), 'ok');
    } catch (e) {
      toast(e?.message || t(locale, 'panel.dp.balanceSaveError'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const editLeave = async (row) => {
    if (!scopedCompanyId) {
      toast(t(locale, 'panel.dp.needCompanyHint'), 'error');
      return;
    }
    const values = await promptForm({
      title: t(locale, 'panel.dp.editLeave'),
      confirmLabel: t(locale, 'panel.dp.save'),
      fields: [
        {
          key: 'status',
          type: 'select',
          label: t(locale, 'panel.dp.leaveStatusLabel'),
          defaultValue: row.status,
          required: true,
          options: [
            DP_LEAVE_STATUS.REQUESTED,
            DP_LEAVE_STATUS.APPROVED,
            DP_LEAVE_STATUS.REJECTED,
            DP_LEAVE_STATUS.CANCELLED,
            DP_LEAVE_STATUS.TAKEN,
          ].map((s) => ({
            value: s,
            label: leaveStatusLabel(locale, s),
          })),
        },
        {
          key: 'managerNotes',
          type: 'textarea',
          label: t(locale, 'panel.dp.managerNotes'),
          defaultValue: row.managerNotes || '',
          rows: 3,
          maxLength: 2000,
        },
      ],
    });
    if (!values) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/dp/leave/${encodeURIComponent(row.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: scopedCompanyId,
          status: values.status,
          managerNotes: values.managerNotes,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'save');
      await load();
      toast(t(locale, 'panel.dp.leaveUpdated'), 'ok');
    } catch (e) {
      toast(e?.message || t(locale, 'panel.dp.leaveUpdateError'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const decideLeave = async (row, status) => {
    if (!scopedCompanyId) {
      toast(t(locale, 'panel.dp.needCompanyHint'), 'error');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/dp/leave/${encodeURIComponent(row.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: scopedCompanyId, status }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'save');
      await load();
      toast(
        status === DP_LEAVE_STATUS.APPROVED
          ? t(locale, 'panel.dp.leaveApproved')
          : t(locale, 'panel.dp.leaveRejected'),
        'ok'
      );
    } catch (e) {
      toast(e?.message || t(locale, 'panel.dp.leaveUpdateError'), 'error');
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
    if (!file || !leaveId || !scopedCompanyId) {
      setLeaveUploadId(null);
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const params = new URLSearchParams({ companyId: String(scopedCompanyId) });
      const res = await fetch(
        `/api/admin/dp/leave/${encodeURIComponent(leaveId)}/file?${params}`,
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

  if (loading) return <AppLoading variant="panel" label={t(locale, 'panel.common.loading')} />;

  const orderedDocs = [...documents].sort((a, b) => {
    const ia = DP_DOCUMENT_KEYS.indexOf(a.docKey);
    const ib = DP_DOCUMENT_KEYS.indexOf(b.docKey);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  const pendingDocCount = orderedDocs.filter((d) => d.status === DP_DOCUMENT_STATUS.PENDING).length;
  const requestedLeaveCount = leaves.filter((l) => l.status === DP_LEAVE_STATUS.REQUESTED).length;
  const timeClockEnabled = resolveTimeClockEligibility({
    workFormat: candidate?.workFormat,
    override: candidate?.timeClockOverride,
  }).enabled;

  return (
    <ContentEnter
      animKey={`dp-block|${candidateId}|${pendingDocCount}|${leaves.length}|${balance?.availableDays ?? 'x'}`}
    >
    <section
      className="flex flex-col gap-4"
      aria-label={t(locale, 'panel.dp.profileTitle')}
    >
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

        {readOnly ? (
          <InlineCallout tone="info" className="mb-0">
            {t(locale, 'panel.dp.alumniReadOnly')}
          </InlineCallout>
        ) : null}
      {pendingDocCount > 0 ? (
        <InlineCallout tone="warning">
          {t(locale, 'panel.dp.pendingBanner', { n: pendingDocCount })}
        </InlineCallout>
      ) : null}

      {requestedLeaveCount > 0 ? (
        <InlineCallout tone="info">
          {t(locale, 'panel.dp.requestedLeaveBanner', { n: requestedLeaveCount })}
        </InlineCallout>
      ) : null}

      <div className="rounded-control border border-ink/12 bg-canvas/40 p-4">
        <h2 className="sr-only">{t(locale, 'panel.dp.profileTitle')}</h2>
        {editingDependents && !readOnly ? (
          <DpDependentsEditor
            key={candidateId}
            locale={locale}
            dependents={profile?.dependents}
            onClose={() => setEditingDependents(false)}
            onSave={async (dependents) => {
              setBusy(true);
              try {
                const res = await fetch(baseUrl, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ dependents }),
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data?.error || t(locale, 'panel.dp.saveError'));
                setProfile((prev) => data.profile || { ...prev, dependents });
                setEditingDependents(false);
                toast(t(locale, 'panel.dp.saved'), 'ok');
              } finally {
                setBusy(false);
              }
            }}
          />
        ) : null}
        {profile ? (
          <div className="flex flex-col">
            <ProfileSection
              title={i18nT(locale, 'ui.dpBlock.personal')}
              first
              action={!readOnly ? (
                <button type="button" className={cn(S.btnGhost, 'gap-1.5')} onClick={() => void editProfile()} disabled={busy}>
                  <Icon name="pencil" className="h-3.5 w-3.5" />
                  {t(locale, 'panel.dp.editProfile')}
                </button>
              ) : null}
            >
              <ProfileInfo className="lg:col-span-2" label={t(locale, 'panel.dp.fullName')}>{candidate?.fullName}</ProfileInfo>
              <ProfileInfo label={t(locale, 'panel.dp.maritalStatus')}>{candidate?.maritalStatus ? maritalStatusLabel(locale, candidate.maritalStatus) : null}</ProfileInfo>
              <ProfileInfo label={t(locale, 'panel.dp.birthDate')}>{candidate?.birthDate ? formatDate(candidate.birthDate, locale) : null}</ProfileInfo>
              <ProfileInfo label={t(locale, 'panel.dp.age')}>{ageFromBirthDate(candidate?.birthDate)}</ProfileInfo>
              <ProfileInfo label={t(locale, 'panel.dp.cpf')}>{profile.cpf ? formatCpfBr(profile.cpf) : null}</ProfileInfo>
              <ProfileInfo label={t(locale, 'panel.dp.rg')}>{profile.rg}</ProfileInfo>
            </ProfileSection>
            <ProfileSection title={i18nT(locale, 'ui.dpBlock.contact')}>
              <ProfileInfo className="lg:col-span-2" breakAll label={t(locale, 'panel.dp.corporateEmail')}>{candidate?.email}</ProfileInfo>
              <ProfileInfo className="lg:col-span-2" breakAll label={t(locale, 'panel.dp.personalEmail')}>{candidate?.personalEmail}</ProfileInfo>
              <ProfileInfo label={t(locale, 'panel.dp.mobile')}>{candidate?.phone ? formatPhoneBr(candidate.phone) : null}</ProfileInfo>
              <ProfileInfo label={t(locale, 'panel.dp.addressPostal')}>{profile.addressPostal ? formatCepBr(profile.addressPostal) : null}</ProfileInfo>
              <ProfileInfo className="sm:col-span-2" label={t(locale, 'panel.dp.addressLine')}>
                {[profile.addressLine, profile.addressNumber].filter(Boolean).join(', ') || null}
              </ProfileInfo>
              <ProfileInfo className="sm:col-span-2" label={t(locale, 'panel.dp.addressCity')}>
                {[profile.addressCity, profile.addressState].filter(Boolean).join(' · ') || null}
              </ProfileInfo>
            </ProfileSection>
            <ProfileSection title={i18nT(locale, 'ui.dpBlock.professional')}>
              <ProfileInfo label={t(locale, 'panel.dp.employeeNumber')}>{candidate?.employeeNumber}</ProfileInfo>
              <ProfileInfo label={t(locale, 'panel.dp.workFormat')}>{candidate?.workFormat ? workFormatLabel(locale, candidate.workFormat) : null}</ProfileInfo>
              <ProfileInfo label={t(locale, 'panel.dp.timeClock')}>{timeClockStatusLabel(locale, candidate)}</ProfileInfo>
              <ProfileInfo label={t(locale, 'panel.dp.jobRole')}>{candidate?.jobRoleName}</ProfileInfo>
              <ProfileInfo label={t(locale, 'panel.dp.startDate')}>{candidate?.startDate ? formatDate(candidate.startDate, locale) : null}</ProfileInfo>
              {candidate?.workHistory ? (
                <ProfileInfo className="sm:col-span-2 lg:col-span-4" pre label={t(locale, 'panel.dp.workHistory')}>{candidate.workHistory}</ProfileInfo>
              ) : null}
              {workFormatHistory.length ? (
                <ProfileInfo className="sm:col-span-2 lg:col-span-4" label={t(locale, 'panel.dp.workFormatHistory')}>
                  <ol className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2">
                    {workFormatHistory.map(event => <li key={event.id} className="text-sm">
                      <div>{workFormatLabel(locale, event.previousFormat)} → {workFormatLabel(locale, event.newFormat)}</div>
                      <div className={S.faint}>{t(locale, 'panel.dp.workFormatEffectiveDate')}: {formatDate(event.effectiveDate, locale)}</div>
                      <div className={S.faint}>{formatDisplayDateTime(event.changedAt, locale)} · {event.actorName || event.actorUserId || '—'}</div>
                    </li>)}
                  </ol>
                </ProfileInfo>
              ) : null}
              {profile.internalNotes ? (
                <ProfileInfo className="sm:col-span-2 lg:col-span-4" pre label={t(locale, 'panel.dp.internalNotes')}>{profile.internalNotes}</ProfileInfo>
              ) : null}
            </ProfileSection>
            {!readOnly && scopedCompanyId && timeClockEnabled ? (
              <section className="mt-4 border-t border-ink/10 pt-4">
                <TimeClockScheduleBlock locale={locale} companyId={scopedCompanyId} candidateId={candidateId} />
              </section>
            ) : null}
            <ProfileSection
              title={i18nT(locale, 'ui.dpBlock.dependents')}
              plain
              action={!readOnly ? (
                <button type="button" className={cn(S.btnGhost, 'gap-1.5')} onClick={() => setEditingDependents(true)} disabled={busy}>
                  <Icon name="pencil" className="h-3.5 w-3.5" />
                  {t(locale, 'panel.dp.editDependents')}
                </button>
              ) : null}
            >
              {profile.dependents?.length ? (
                <ul className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2 lg:grid-cols-3">
                  {profile.dependents.map((dependent, index) => (
                    <li key={`${dependent.name}-${index}`} className="min-w-0 rounded-control border border-ink/10 bg-surface px-3 py-2">
                      <div className="truncate text-sm font-medium text-ink" title={dependent.name || ''}>{dependent.name || '—'}</div>
                      <div className="text-xs text-ink-muted">
                        {[kinshipLabel(locale, dependent.relation), dependent.birthDate ? formatDate(dependent.birthDate, locale) : null, dependent.cpf ? formatCpfBr(dependent.cpf) : null].filter(Boolean).join(' · ') || '—'}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="m-0 text-sm text-ink-muted">{t(locale, 'panel.dp.noDependents')}</p>
              )}
            </ProfileSection>
            <ProfileSection title={i18nT(locale, 'ui.dpBlock.emergency')}>
              <ProfileInfo className="lg:col-span-2" label={t(locale, 'panel.dp.emergencyName')}>{profile.emergencyName}</ProfileInfo>
              <ProfileInfo label={t(locale, 'panel.dp.emergencyPhone')}>{profile.emergencyPhone ? formatPhoneBr(profile.emergencyPhone) : null}</ProfileInfo>
              <ProfileInfo label={t(locale, 'panel.dp.emergencyRelation')}>{kinshipLabel(locale, profile.emergencyRelation)}</ProfileInfo>
            </ProfileSection>
          </div>
        ) : (
          <p className={cn(S.muted, 'm-0 text-xs')}>{t(locale, 'panel.dp.noProfile')}</p>
        )}
      </div>

      <div className="rounded-control border border-ink/12 bg-canvas/40 p-3.5">
        <span className={cn(S.cardSection, 'mb-3 block')}>{t(locale, 'panel.dp.docsTitle')}</span>
        <InlineCallout tone="info" className="mb-3">
          {t(locale, 'panel.dp.sigHint')}
        </InlineCallout>
        {orderedDocs.length === 0 ? (
          <EmptyState
            title={t(locale, 'panel.dp.docsEmptyTitle')}
            message={t(locale, 'panel.dp.docsEmptyHint')}
          />
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {orderedDocs.map((doc) => {
              const sig = doc.signatureStatus || DP_DOCUMENT_SIGNATURE_STATUS.NONE;
              return (
              <li
                key={doc.docKey}
                className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-ink/10 bg-surface px-3 py-2.5"
              >
                <div className="min-w-0 max-w-full">
                  <div className="font-ui text-sm text-ink">{docKeyLabel(locale, doc.docKey)}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <StatusToneChip tone={docStatusTone(doc.status)}>
                      {docStatusLabel(locale, doc.status)}
                    </StatusToneChip>
                    {sig !== DP_DOCUMENT_SIGNATURE_STATUS.NONE ? (
                      <StatusToneChip tone={sigStatusTone(sig)}>
                        {sigStatusLabel(locale, sig)}
                      </StatusToneChip>
                    ) : null}
                      {doc.hasFile ? (
                        <PrivateAttachment href={`/api/admin/candidates/${encodeURIComponent(candidateId)}/dp/documents/${encodeURIComponent(doc.docKey)}/file`} fileName={doc.fileName} updatedAt={doc.updatedAt} locale={locale} />
                      ) : (
                        <span className="font-mono text-2xs text-ink-muted">{t(locale, 'panel.dp.docNoFile')}</span>
                      )}
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
                      maxHeightClass="max-h-20"
                    />
                  ) : null}
                  {sig === DP_DOCUMENT_SIGNATURE_STATUS.REQUESTED ? (
                    <p className={cn(S.faint, 'mb-0 mt-1')}>
                      {t(locale, 'panel.dp.sigWaiting')}
                    </p>
                  ) : null}
                  {doc.notes ? (
                    <p className={cn(S.muted, 'mb-0 mt-1 text-xs')}>{doc.notes}</p>
                  ) : null}
                </div>
                {!readOnly ? (
                  <div className="flex w-full min-w-0 flex-wrap gap-1 sm:w-auto">
                    <AdminEditButton
                      label={t(locale, 'panel.dp.docEdit')}
                      onClick={() => void editDocument(doc)}
                      disabled={busy}
                    />
                    <button
                      type="button"
                      disabled={busy || uploadKey === doc.docKey}
                      className={cn(S.btnGhost, 'min-h-touch text-xs')}
                      onClick={() => startUpload(doc.docKey)}
                    >
                      {uploadKey === doc.docKey
                        ? t(locale, 'panel.common.loading')
                        : t(locale, 'panel.dp.docUpload')}
                    </button>
                    {doc.hasFile
                      && sig !== DP_DOCUMENT_SIGNATURE_STATUS.SIGNED
                      && sig !== DP_DOCUMENT_SIGNATURE_STATUS.REQUESTED ? (
                      <button
                        type="button"
                        disabled={busy}
                        className={cn(S.btnBrandSoft, 'min-h-touch text-xs')}
                        onClick={() => void signatureAction(doc, 'requestSignature')}
                      >
                        {t(locale, 'panel.dp.sigRequestBtn')}
                      </button>
                    ) : null}
                    {sig === DP_DOCUMENT_SIGNATURE_STATUS.REQUESTED ? (
                      <button
                        type="button"
                        disabled={busy}
                        className={cn(S.btnGhost, 'min-h-touch text-xs')}
                        onClick={() => void signatureAction(doc, 'waiveSignature')}
                      >
                        {t(locale, 'panel.dp.sigWaiveBtn')}
                      </button>
                    ) : null}
                    {doc.hasFile ? (
                      <AdminDeleteButton
                        label={t(locale, 'panel.dp.docDeleteFile')}
                        onClick={() => void removeFile(doc)}
                        disabled={busy || sig === DP_DOCUMENT_SIGNATURE_STATUS.SIGNED}
                      />
                    ) : null}
                  </div>
                ) : null}
              </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="rounded-control border border-ink/12 bg-canvas/40 p-3.5">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            <span className={cn(S.cardSection, 'block')}>{t(locale, 'panel.dp.balanceTitle')}</span>
            <p className={cn(S.muted, 'mb-0 mt-1 text-xs')}>{t(locale, 'panel.dp.balanceHint')}</p>
          </div>
          {!readOnly ? (
            <AdminEditButton
              label={t(locale, 'panel.dp.balanceEdit')}
              onClick={() => void editBalance()}
              disabled={busy}
            />
          ) : null}
        </div>
          <LeaveBalanceSummary
            locale={locale}
            balance={balance}
            showPoolMeta
            showNotes
            showDefaultHint
            showPeriod
          />
      </div>

      <div className="rounded-control border border-ink/12 bg-canvas/40 p-3.5">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <span className={cn(S.cardSection, 'block')}>{t(locale, 'panel.dp.leaveTitle')}</span>
          {!readOnly ? (
            <AdminCreateButton variant="secondary"
              label={t(locale, 'panel.dp.leaveAdd')}
              onClick={() => void addLeave()}
              disabled={busy}
            />
          ) : null}
        </div>
        {leaves.length === 0 ? (
          <EmptyState
            title={t(locale, 'panel.dp.leaveEmpty')}
            message={t(locale, 'panel.dp.leaveEmptyHint')}
          />
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {leaves.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-ink/10 bg-surface px-3 py-2.5"
              >
                <div className="min-w-0">
                  <div className="font-ui text-sm text-ink">
                    {leaveTypeLabel(locale, row.leaveType)}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-2xs text-ink-muted">
                    <span>
                      {formatDate(row.startsOn, locale)}
                      {' · '}
                      {formatDate(row.endsOn, locale)}
                    </span>
                    {(() => {
                      const days = leaveInclusiveDays(row.startsOn, row.endsOn);
                      return days != null ? (
                        <span>{tCount(locale, 'panel.dp.leaveDaysMeta', days)}</span>
                      ) : null;
                    })()}
                    <StatusToneChip tone={leaveStatusTone(row.status)}>
                      {leaveStatusLabel(locale, row.status)}
                    </StatusToneChip>
                  </div>
                  {row.reason ? (
                    <div className="mt-1 text-xs text-ink-muted">
                      <RichTextView html={row.reason} />
                    </div>
                  ) : null}
                  {row.managerNotes ? (
                    <p className={cn(S.muted, 'mb-0 mt-1 text-xs')}>
                      {t(locale, 'panel.dp.managerNotes')}: {row.managerNotes}
                    </p>
                  ) : null}
                    {row.hasFile && scopedCompanyId ? (
                      <div className="mt-2">
                        <PrivateAttachment href={`/api/admin/dp/leave/${encodeURIComponent(row.id)}/file?companyId=${encodeURIComponent(scopedCompanyId)}`} fileName={row.fileName} locale={locale} />
                      </div>
                    ) : null}
                </div>
                {!readOnly && scopedCompanyId ? (
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                    {row.status === DP_LEAVE_STATUS.REQUESTED ? (
                      <>
                        <AdminIconButton
                          icon="check"
                          label={t(locale, 'panel.dp.approveLeave')}
                          onClick={() => void decideLeave(row, DP_LEAVE_STATUS.APPROVED)}
                          disabled={busy}
                        />
                        <AdminIconButton
                          icon="x"
                          label={t(locale, 'panel.dp.rejectLeave')}
                          onClick={() => void decideLeave(row, DP_LEAVE_STATUS.REJECTED)}
                          disabled={busy}
                        />
                      </>
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
                    <AdminEditButton
                      label={t(locale, 'panel.dp.editLeave')}
                      onClick={() => void editLeave(row)}
                      disabled={busy}
                    />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
    </ContentEnter>
  );
}
