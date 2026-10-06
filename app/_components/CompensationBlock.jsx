'use client';

import { SelectField } from './SelectField';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { t, localeHtmlLang } from '../../lib/i18n';
import { cn } from '../../lib/cn';
import { formatSalaryDisplay, formatVacancySalaryRangeDisplay, salaryToCentsDigits, stripSalary } from '../../lib/br-masks';
import { S, AdminCreateButton, AdminDeleteButton, AdminEditButton } from '../dashboard/dashboard-shared';
import { EmptyState } from './EmptyState';
import { AppLoading, ContentEnter } from './AppLoading';
import { useAppFeedback } from './AppFeedback';
import { RichTextView } from './RichTextView';
import { isRichTextEmpty } from '../../lib/sanitize-html.js';
import { FormField } from './FormField';
import { StatusToneChip } from './StatusToneChip';
import { InlineCallout } from './InlineCallout';
import {
  COMPENSATION_APPROVAL_STATUS,
  COMPENSATION_EVENT_TYPE,
  EMPLOYMENT_STATUS,
} from '../../lib/domain-status.js';
import { fieldSelectClass } from './form-control-styles';

function formatDate(value, locale) {
  if (!value) return t(locale, 'panel.common.notApplicable');
  const raw = String(value).slice(0, 10);
  const [y, m, d] = raw.split('-').map(Number);
  if (!y || !m || !d) return raw;
  return new Date(y, m - 1, d).toLocaleDateString(localeHtmlLang(locale), {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function isFutureEffectiveDate(value) {
  const raw = String(value || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
  const parsed = new Date(`${raw}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return false;
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return raw > today;
}

const EVENT_TYPE_OPTIONS = [
  COMPENSATION_EVENT_TYPE.HIRE,
  COMPENSATION_EVENT_TYPE.RAISE,
  COMPENSATION_EVENT_TYPE.ADJUSTMENT,
  COMPENSATION_EVENT_TYPE.BONUS,
  COMPENSATION_EVENT_TYPE.OTHER,
];

function eventTypeLabel(locale, type) {
  const key = `panel.compensation.type.${type}`;
  const label = t(locale, key);
  return label === key ? type : label;
}

/**
 * Internal RH compensation — current salary + timeline (not payroll).
 */
export function CompensationBlock({
  locale,
  candidateId,
  employmentStatus,
  companyId,
  canManage = true,
  canViewJobRoles = false,
  navigateDashboard = null,
}) {
  const { toast, promptForm, confirm } = useAppFeedback();
  const jobRoleSelectRef = useRef(null);
  const [items, setItems] = useState([]);
  const [current, setCurrent] = useState(null);
  const [offerHint, setOfferHint] = useState(null);
  const [market, setMarket] = useState(null);
  const [roles, setRoles] = useState([]);
  const [rolesLoading, setRolesLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const readOnly = employmentStatus === EMPLOYMENT_STATUS.ALUMNI || !canManage;
  const currentIsUpcoming = isFutureEffectiveDate(current?.effectiveDate);
  const visible =
    employmentStatus === EMPLOYMENT_STATUS.EMPLOYEE ||
    employmentStatus === EMPLOYMENT_STATUS.ALUMNI;

  const money = (amount) => formatSalaryDisplay(amount, locale);

  const sortedItems = useMemo(() => {
    const rank = (s) =>
      s === COMPENSATION_APPROVAL_STATUS.PROPOSED
        ? 0
        : s === COMPENSATION_APPROVAL_STATUS.APPROVED
          ? 1
          : 2;
    return [...items].sort((a, b) => {
      const d = rank(a.approvalStatus) - rank(b.approvalStatus);
      if (d !== 0) return d;
      return String(b.effectiveDate || '').localeCompare(String(a.effectiveDate || ''));
    });
  }, [items]);

  const proposedCount = useMemo(
    () =>
      items.filter((i) => i.approvalStatus === COMPENSATION_APPROVAL_STATUS.PROPOSED).length,
    [items]
  );

  const load = useCallback(async () => {
    if (!candidateId || !visible) {
      setItems([]);
      setCurrent(null);
      setMarket(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(
        `/api/admin/candidates/${encodeURIComponent(candidateId)}/compensation`
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'load');
      setItems(Array.isArray(data.items) ? data.items : []);
      setCurrent(data.current || null);
      setOfferHint(data.offerHint || null);
      setMarket(data.market || null);
    } catch (e) {
      toast(e?.message || t(locale, 'panel.compensation.loadError'), 'error');
      setItems([]);
      setCurrent(null);
      setMarket(null);
    } finally {
      setLoading(false);
    }
  }, [candidateId, visible, locale, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!companyId || !visible || !canViewJobRoles) {
      setRoles([]);
      setRolesLoading(false);
      return;
    }
    let cancelled = false;
    setRolesLoading(true);
    (async () => {
      try {
        const res = await fetch(
          `/api/admin/job-roles?companyId=${encodeURIComponent(companyId)}`
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok || cancelled) return;
        setRoles(Array.isArray(data.roles) ? data.roles.filter((r) => r.active !== false) : []);
      } catch {
        if (!cancelled) setRoles([]);
      } finally {
        if (!cancelled) setRolesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [companyId, visible, canViewJobRoles]);

  const setJobRole = async (jobRoleId) => {
    if (readOnly) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/admin/candidates/${encodeURIComponent(candidateId)}/compensation`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'setJobRole',
            jobRoleId: jobRoleId === '' || jobRoleId == null ? null : Number(jobRoleId),
          }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'role');
      setMarket(data.market || null);
      toast(t(locale, 'panel.compensation.jobRoleSaved'), 'ok');
    } catch (e) {
      toast(e?.message || t(locale, 'panel.compensation.jobRoleError'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const openJobRolePicker = () => {
    const select = jobRoleSelectRef.current;
    if (!select) return;
    select.focus();
    select.click();
  };

  const marketChip = (() => {
    const status = market?.compare?.status;
    if (!status || status === 'no_band') return null;
    if (status === 'no_salary') {
      return (
        <StatusToneChip tone="neutral" bordered>
          {t(locale, 'panel.compensation.marketNeedSalary')}
        </StatusToneChip>
      );
    }
    if (status === 'below') {
      return (
        <StatusToneChip tone="warning" bordered>
          {t(locale, 'panel.compensation.marketBelow')}
        </StatusToneChip>
      );
    }
    if (status === 'above') {
      return (
        <StatusToneChip tone="info" bordered>
          {t(locale, 'panel.compensation.marketAbove')}
        </StatusToneChip>
      );
    }
    return (
      <StatusToneChip tone="success" bordered>
        {t(locale, 'panel.compensation.marketInBand')}
      </StatusToneChip>
    );
  })();

  const applyMarketPayload = (data) => {
    if (data?.market !== undefined) setMarket(data.market || null);
  };

  if (!visible) {
    return (
      <p className="m-0 rounded-control border border-ink/12 bg-ink/[0.02] px-3.5 py-3 text-xs leading-normal text-ink-muted">
        {t(locale, 'panel.compensation.notInternal')}
      </p>
    );
  }

  const formFields = (defaults = {}) => [
    {
      key: 'eventType',
      type: 'select',
      label: t(locale, 'panel.compensation.typeLabel'),
      defaultValue: defaults.eventType || COMPENSATION_EVENT_TYPE.RAISE,
      required: true,
      options: EVENT_TYPE_OPTIONS.map((value) => ({
        value,
        label: eventTypeLabel(locale, value),
      })),
    },
    {
      key: 'amount',
      type: 'salary',
      label: t(locale, 'panel.compensation.amountLabel'),
      placeholder: t(locale, 'panel.compensation.amountPh'),
      defaultValue: defaults.amount ? salaryToCentsDigits(defaults.amount) : '',
      required: true,
      row: 'amountDate',
    },
    {
      key: 'effectiveDate',
      type: 'date',
      label: t(locale, 'panel.compensation.effectiveDateLabel'),
      defaultValue: defaults.effectiveDate || new Date().toISOString().slice(0, 10),
      required: true,
      row: 'amountDate',
    },
    {
      key: 'notes',
      type: 'richText',
      minHeight: 110,
      label: t(locale, 'panel.compensation.notesLabel'),
      placeholder: t(locale, 'panel.compensation.notesPh'),
      defaultValue: defaults.notes || '',
    },
  ];

  const addEvent = async () => {
    const values = await promptForm({
      title: t(locale, 'panel.compensation.addTitle'),
      confirmLabel: t(locale, 'panel.compensation.save'),
      fields: formFields({
        eventType: COMPENSATION_EVENT_TYPE.HIRE,
      }),
    });
    if (!values) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/admin/candidates/${encodeURIComponent(candidateId)}/compensation`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            eventType: values.eventType,
            amount: stripSalary(values.amount),
            effectiveDate: values.effectiveDate,
            notes: values.notes,
          }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'save');
      setItems(Array.isArray(data.items) ? data.items : []);
      setCurrent(data.current || data.event || null);
      applyMarketPayload(data);
      toast(t(locale, 'panel.compensation.saved'), 'ok');
    } catch (e) {
      toast(e?.message || t(locale, 'panel.compensation.saveError'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const importOffer = async () => {
    const ok = await confirm({
      title: t(locale, 'panel.compensation.importOfferTitle'),
      message: t(locale, 'panel.compensation.importOfferHint', {
        amount: money(offerHint?.offerSalary),
        date: formatDate(offerHint?.offerStartDate, locale),
      }),
      confirmLabel: t(locale, 'panel.compensation.importOfferConfirm'),
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/admin/candidates/${encodeURIComponent(candidateId)}/compensation`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'importFromOffer' }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'import');
      setItems(Array.isArray(data.items) ? data.items : []);
      setCurrent(data.current || data.event || null);
      applyMarketPayload(data);
      setOfferHint(null);
      toast(t(locale, 'panel.compensation.importOfferOk'), 'ok');
    } catch (e) {
      toast(e?.message || t(locale, 'panel.compensation.importOfferError'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const editEvent = async (row) => {
    const values = await promptForm({
      title: t(locale, 'panel.compensation.editTitle'),
      confirmLabel: t(locale, 'panel.compensation.save'),
      fields: formFields({
        eventType: row.eventType,
        amount: row.amount,
        effectiveDate: row.effectiveDate,
        notes: row.notes,
      }),
    });
    if (!values) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/admin/candidates/${encodeURIComponent(candidateId)}/compensation/${encodeURIComponent(row.id)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            eventType: values.eventType,
            amount: stripSalary(values.amount),
            effectiveDate: values.effectiveDate,
            notes: values.notes,
          }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'save');
      setItems(Array.isArray(data.items) ? data.items : []);
      setCurrent(data.current || null);
      applyMarketPayload(data);
      toast(t(locale, 'panel.compensation.saved'), 'ok');
    } catch (e) {
      toast(e?.message || t(locale, 'panel.compensation.saveError'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const removeEvent = async (row) => {
    const ok = await confirm({
      title: t(locale, 'panel.compensation.deleteTitle'),
      message: t(locale, 'panel.compensation.deleteHint', {
        date: formatDate(row.effectiveDate, locale),
        amount: money(row.amount),
      }),
      confirmLabel: t(locale, 'panel.compensation.deleteConfirm'),
      tone: 'danger',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/admin/candidates/${encodeURIComponent(candidateId)}/compensation/${encodeURIComponent(row.id)}`,
        { method: 'DELETE' }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'delete');
      setItems(Array.isArray(data.items) ? data.items : []);
      setCurrent(data.current || null);
      applyMarketPayload(data);
      toast(t(locale, 'panel.compensation.deleted'), 'ok');
    } catch (e) {
      toast(e?.message || t(locale, 'panel.compensation.deleteError'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const setApproval = async (row, approvalStatus) => {
    if (approvalStatus === COMPENSATION_APPROVAL_STATUS.REJECTED) {
      const ok = await confirm({
        message: t(locale, 'panel.variablePay.rejectConfirm'),
        danger: true,
        confirmLabel: t(locale, 'panel.variablePay.rejectBtn'),
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      const res = await fetch(
        `/api/admin/candidates/${encodeURIComponent(candidateId)}/compensation/${encodeURIComponent(row.id)}/approval`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            companyId,
            approvalStatus,
          }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'approval');
      toast(
        approvalStatus === COMPENSATION_APPROVAL_STATUS.APPROVED
          ? t(locale, 'panel.variablePay.approved')
          : t(locale, 'panel.variablePay.rejected'),
        'ok'
      );
      await load();
    } catch (e) {
      toast(e?.message || t(locale, 'panel.variablePay.approvalError'), 'error');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <AppLoading variant="inline" />;

  return (
    <ContentEnter
      animKey={`comp|${candidateId}|${current?.id || 0}|${market?.jobRoleId || 0}|${market?.compare?.status || ''}`}
    >
    <section
      className="rounded-control border border-ink/12 bg-canvas/40 p-3.5"
      aria-labelledby="compensation-block-title"
    >
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <span id="compensation-block-title" className={cn(S.cardSection, 'mb-0 block')}>
            {t(locale, 'panel.compensation.title')}
          </span>
        </div>
        {!readOnly ? (
          <div className="flex flex-wrap gap-1.5">
            {offerHint?.offerSalary && items.length === 0 ? (
              <button
                type="button"
                disabled={busy}
                className={cn(S.btnGhost, 'min-h-touch text-xs')}
                onClick={() => void importOffer()}
              >
                {t(locale, 'panel.compensation.importOfferBtn')}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="mb-4 rounded-control border border-brand/20 bg-brand/[0.04] px-3 py-2.5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className={cn(S.faint, 'text-2xs uppercase tracking-wide')}>
              {t(locale, currentIsUpcoming ? 'panel.compensation.upcomingLabel' : 'panel.compensation.currentLabel')}
            </div>
            {current?.amount ? (
              <div className="mt-1 font-ui text-base font-medium tabular-nums text-ink">
                {money(current.amount)}
              </div>
            ) : (
              <div className={cn(S.muted, 'mt-1 text-sm')}>
                {t(locale, 'panel.compensation.noCurrent')}
              </div>
            )}
            {current?.effectiveDate ? (
              <div className="mt-1 font-mono text-2xs text-ink-muted">
                {t(locale, currentIsUpcoming ? 'panel.compensation.effectiveOn' : 'panel.compensation.since', {
                  date: formatDate(current.effectiveDate, locale),
                })}
                {' · '}
                {eventTypeLabel(locale, current.eventType)}
              </div>
            ) : null}
          </div>
          {currentIsUpcoming ? null : marketChip}
        </div>
      </div>

      <div className="mb-4 rounded-control border border-ink/10 bg-surface px-3 py-2.5">
        {canViewJobRoles ? <FormField label={t(locale, 'panel.compensation.jobRoleLabel')}>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <SelectField
              ref={jobRoleSelectRef}
              className={cn(fieldSelectClass, 'min-w-0 flex-1')}
              value={market?.jobRoleId != null ? String(market.jobRoleId) : ''}
              disabled={readOnly || busy || !companyId || (!rolesLoading && roles.length === 0)}
              onChange={(e) => void setJobRole(e.target.value)}
              aria-label={t(locale, 'panel.compensation.jobRoleLabel')}
            >
              <option value="">{t(locale, 'panel.compensation.jobRoleNone')}</option>
              {roles.map((role) => {
                const band = formatVacancySalaryRangeDisplay(
                  role.marketSalaryMin,
                  role.marketSalaryMax
                );
                return (
                  <option key={role.id} value={String(role.id)}>
                    {band ? `${role.name} (${band})` : role.name}
                  </option>
                );
              })}
            </SelectField>
            {!readOnly && !market?.jobRoleId && !rolesLoading ? (
              roles.length > 0 ? (
                <button
                  type="button"
                  className={cn(S.btnBrandSoft, 'min-h-touch shrink-0 text-xs')}
                  disabled={busy}
                  onClick={openJobRolePicker}
                >
                  {t(locale, 'panel.compensation.linkJobRole')}
                </button>
              ) : typeof navigateDashboard === 'function' ? (
                <button
                  type="button"
                  className={cn(S.btnBrandSoft, 'min-h-touch shrink-0 text-xs')}
                  onClick={() => navigateDashboard({ tab: 'job-roles' })}
                >
                  {t(locale, 'panel.compensation.createJobRole')}
                </button>
              ) : null
            ) : null}
          </div>
        </FormField> : null}
        {canViewJobRoles ? <p
          className={cn(
            'mb-0 mt-1.5 text-xs',
            !rolesLoading && roles.length === 0 ? 'text-info' : S.muted
          )}
        >
          {t(
            locale,
            !rolesLoading && roles.length === 0
              ? 'panel.compensation.jobRoleCatalogEmpty'
              : 'panel.compensation.jobRoleHint'
          )}
        </p> : null}
        {(market?.marketSalaryMin || market?.marketSalaryMax) ? (
          <div className="mt-2 font-mono text-2xs text-ink-muted">
            {t(locale, 'panel.compensation.marketBandLabel')}:{' '}
            {formatVacancySalaryRangeDisplay(
              market.marketSalaryMin,
              market.marketSalaryMax
            ) || t(locale, 'panel.common.notApplicable')}
          </div>
        ) : market?.jobRoleId ? (
          <p className={cn(S.faint, 'mb-0 mt-2 text-2xs')}>
            {t(locale, 'panel.compensation.marketBandEmpty')}
          </p>
        ) : null}
      </div>

      {market?.compare?.status === 'below' ? (
        <InlineCallout tone="warning" className="mb-4">
          {t(locale, 'panel.compensation.marketBelowHint')}
        </InlineCallout>
      ) : null}

      {proposedCount > 0 && !readOnly ? (
        <InlineCallout tone="warning" className="mb-4 text-xs">
          {t(locale, 'panel.variablePay.proposedQueue', { n: proposedCount })}
        </InlineCallout>
      ) : null}

      {readOnly ? (
        <p className={cn(S.muted, 'mb-3 text-xs')}>
          {t(
            locale,
            canManage ? 'panel.compensation.alumniReadOnly' : 'panel.compensation.permissionReadOnly'
          )}
        </p>
      ) : null}

      {sortedItems.length === 0 ? (
        <EmptyState
          title={t(locale, 'panel.compensation.emptyTitle')}
          message={t(locale, 'panel.compensation.emptyHint')}
        />
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {sortedItems.map((row) => (
            <li
              key={row.id}
              className={cn(
                'flex flex-wrap items-center justify-between gap-2 rounded-control border bg-surface px-3 py-2.5',
                row.approvalStatus === COMPENSATION_APPROVAL_STATUS.PROPOSED
                  ? 'border-warning/30'
                  : 'border-ink/10'
              )}
            >
              <div className="min-w-0">
                <div className="font-ui text-sm tabular-nums text-ink">{money(row.amount)}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-2xs text-ink-muted">
                  <span>{formatDate(row.effectiveDate, locale)}</span>
                  <span>{eventTypeLabel(locale, row.eventType)}</span>
                  {row.approvalStatus === COMPENSATION_APPROVAL_STATUS.PROPOSED ? (
                    <StatusToneChip tone="warning">
                      {t(locale, 'panel.variablePay.statusProposed')}
                    </StatusToneChip>
                  ) : row.approvalStatus === COMPENSATION_APPROVAL_STATUS.REJECTED ? (
                    <StatusToneChip tone="danger">
                      {t(locale, 'panel.variablePay.statusRejected')}
                    </StatusToneChip>
                  ) : null}
                </div>
                {!isRichTextEmpty(row.notes) ? (
                  <div className="mt-1">
                    <RichTextView
                      html={row.notes}
                      className="text-xs leading-snug text-ink-muted"
                    />
                  </div>
                ) : null}
              </div>
              {!readOnly ? (
                <div className="flex shrink-0 flex-wrap gap-1">
                  {row.approvalStatus === COMPENSATION_APPROVAL_STATUS.PROPOSED ? (
                    <>
                      <button
                        type="button"
                        disabled={busy}
                        className={cn(S.btnBrandSoft, 'min-h-touch text-sm')}
                        onClick={() =>
                          void setApproval(row, COMPENSATION_APPROVAL_STATUS.APPROVED)
                        }
                      >
                        {t(locale, 'panel.variablePay.approveBtn')}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        className={cn(S.btnGhost, 'min-h-touch text-sm text-danger')}
                        onClick={() =>
                          void setApproval(row, COMPENSATION_APPROVAL_STATUS.REJECTED)
                        }
                      >
                        {t(locale, 'panel.variablePay.rejectBtn')}
                      </button>
                    </>
                  ) : null}
                  <AdminEditButton
                    label={t(locale, 'panel.compensation.editBtn')}
                    onClick={() => void editEvent(row)}
                    disabled={busy}
                  />
                  <AdminDeleteButton
                    label={t(locale, 'panel.compensation.deleteBtn')}
                    onClick={() => void removeEvent(row)}
                    disabled={busy}
                  />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {!readOnly ? (
        <div className="mt-4 flex justify-end">
          <AdminCreateButton variant="secondary"
            label={t(locale, 'panel.compensation.addBtn')}
            onClick={() => void addEvent()}
            disabled={busy}
          />
        </div>
      ) : null}
    </section>
    </ContentEnter>
  );
}
