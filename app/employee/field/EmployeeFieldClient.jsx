'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '../../../lib/i18n';
import { cn } from '../../../lib/cn';
import { salaryToCentsDigits } from '../../../lib/br-masks';
import { FIELD_EXPENSE_CATEGORIES, FIELD_EXPENSE_STATUS, FIELD_VISIT_STATUS } from '../../../lib/domain-status.js';
import { formatDisplayDate } from '../../../lib/format-display-date';
import { S } from '../../dashboard/dashboard-shared';
import { AppLoading, ContentEnter } from '../../_components/AppLoading';
import { useAppFeedback } from '../../_components/AppFeedback';
import { EmployeeDedicatedShell } from '../../_components/EmployeeDedicatedShell';
import { EmptyState } from '../../_components/EmptyState';
import { InlineCallout } from '../../_components/InlineCallout';
import { StatusToneChip } from '../../_components/StatusToneChip';
import { osmLink } from '../../_components/PunchLocationMap';
import { useDeviceLocation } from '../../_components/useDeviceLocation';
import {
  fieldCategoryLabel,
  fieldExpenseStatusLabel,
  fieldExpenseTone,
  fieldVisitStatusLabel,
  fieldVisitTone,
  formatCents,
  formatClock,
  mapSearchLink,
  uploadFieldFile,
} from '../../_components/field-team-ui';

const API = '/api/employee/field';
const IMAGE_ACCEPT = 'image/jpeg,image/png';
const RECEIPT_ACCEPT = 'application/pdf,image/jpeg,image/png';
const linkClass = 'text-brand-600 underline-offset-2 hover:underline dark:text-brand-300';

/**
 * Collaborator field page: route of the day (check-in with location, optional photo,
 * complete) and reimbursement requests with receipt.
 */
export function EmployeeFieldClient({ locale = 'pt-BR' }) {
  const { promptForm, confirm, toast } = useAppFeedback();
  const { geo, freshFix } = useDeviceLocation(locale);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const fileRef = useRef(null);
  const uploadTarget = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(API);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || 'load');
      setData(json);
    } catch (e) {
      toast(e?.message || t(locale, 'panel.field.loadError'), 'error');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [locale, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const prev = document.title;
    document.title = t(locale, 'panel.field.employeeDocumentTitle');
    return () => {
      document.title = prev;
    };
  }, [locale]);

  const send = async (url, init, okKey) => {
    const res = await fetch(url, init);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error || 'request');
    if (okKey) toast(t(locale, okKey), 'ok');
    return json;
  };

  const checkIn = async (visit) => {
    setBusyId(`v${visit.id}`);
    try {
      const fix = await freshFix();
      await send(`${API}/visits/${visit.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'check_in', latitude: fix.latitude, longitude: fix.longitude, accuracy: fix.accuracy }),
      }, 'panel.field.checkedIn');
      await load();
    } catch (e) {
      if (!e?.geo) toast(e?.message || t(locale, 'panel.common.error'), 'error');
    } finally {
      setBusyId('');
    }
  };

  const complete = async (visit) => {
    const values = await promptForm({
      title: t(locale, 'panel.field.completeTitle'),
      message: visit.title,
      confirmLabel: t(locale, 'panel.field.complete'),
      fields: [{ key: 'note', type: 'textarea', rows: 3, maxLength: 1000, label: t(locale, 'panel.field.outcomeLabel'), help: t(locale, 'panel.field.outcomeHelp') }],
      submit: (v) => send(`${API}/visits/${visit.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'complete', note: v.note || '' }),
      }),
    });
    if (!values) return;
    toast(t(locale, 'panel.field.completed'), 'ok');
    void load();
  };

  const logVisit = async () => {
    const values = await promptForm({
      title: t(locale, 'panel.field.logVisit'),
      message: t(locale, 'panel.field.logVisitHint'),
      confirmLabel: t(locale, 'panel.field.save'),
      fields: [
        { key: 'title', label: t(locale, 'panel.field.visitTitleLabel'), required: true, maxLength: 200, row: 'who', rowWeight: 1.6 },
        { key: 'plannedTime', type: 'text', label: t(locale, 'panel.field.visitTimeLabel'), placeholder: '14:30', row: 'who' },
        { key: 'address', label: t(locale, 'panel.field.visitAddressLabel'), maxLength: 300 },
      ],
      submit: (v) => send(`${API}/visits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ day: data?.day, title: v.title, plannedTime: v.plannedTime || '', address: v.address || '' }),
      }),
    });
    if (!values) return;
    toast(t(locale, 'panel.field.visitLogged'), 'ok');
    void load();
  };

  const pickFile = (target) => {
    uploadTarget.current = target;
    if (fileRef.current) {
      fileRef.current.accept = target.kind === 'photo' ? IMAGE_ACCEPT : RECEIPT_ACCEPT;
      fileRef.current.value = '';
      fileRef.current.click();
    }
  };

  const onFile = async (event) => {
    const file = event.target.files?.[0];
    const target = uploadTarget.current;
    if (!file || !target) return;
    setBusyId(`${target.kind}${target.id}`);
    try {
      const url = target.kind === 'photo' ? `${API}/visits/${target.id}/photo` : `${API}/expenses/${target.id}/receipt`;
      await uploadFieldFile(url, file);
      toast(t(locale, target.kind === 'photo' ? 'panel.field.photoSaved' : 'panel.field.receiptSaved'), 'ok');
      await load();
    } catch (e) {
      toast(e?.message || t(locale, 'panel.common.error'), 'error');
    } finally {
      setBusyId('');
    }
  };

  const requestExpense = async () => {
    const visits = (data?.visits || []).filter((v) => v.status !== FIELD_VISIT_STATUS.CANCELLED);
    let created = null;
    const values = await promptForm({
      title: t(locale, 'panel.field.requestExpense'),
      message: t(locale, 'panel.field.requestExpenseHint'),
      confirmLabel: t(locale, 'panel.field.send'),
      size: 'wide',
      fields: [
        { key: 'day', type: 'date', label: t(locale, 'panel.field.expenseDayLabel'), defaultValue: data?.today || '', max: data?.today || undefined, required: true, row: 'what' },
        {
          key: 'category',
          type: 'select',
          label: t(locale, 'panel.field.expenseCategoryLabel'),
          required: true,
          defaultValue: FIELD_EXPENSE_CATEGORIES[0],
          options: FIELD_EXPENSE_CATEGORIES.map((c) => ({ value: c, label: fieldCategoryLabel(locale, c) })),
          row: 'what',
        },
        { key: 'amount', type: 'salary', label: t(locale, 'panel.field.expenseAmountLabel'), required: true, placeholder: 'R$ 0,00', row: 'what' },
        { key: 'description', type: 'textarea', rows: 2, maxLength: 500, label: t(locale, 'panel.field.expenseDescriptionLabel'), required: true },
        ...(visits.length
          ? [{
              key: 'visitId',
              type: 'select',
              label: t(locale, 'panel.field.expenseVisitLabel'),
              defaultValue: '',
              options: [{ value: '', label: t(locale, 'panel.field.expenseVisitNone') }, ...visits.map((v) => ({ value: String(v.id), label: v.title }))],
              row: 'proof',
            }]
          : []),
        { key: 'receipt', type: 'file', accept: RECEIPT_ACCEPT, label: t(locale, 'panel.field.expenseReceiptLabel'), uploadLabel: t(locale, 'panel.field.attachReceipt'), row: 'proof' },
      ],
      submit: async (v) => {
        const cents = Number(salaryToCentsDigits(v.amount) || 0);
        if (!cents) throw new Error(t(locale, 'panel.field.amountRequired'));
        if (!created) {
          const json = await send(`${API}/expenses`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              day: v.day,
              category: v.category,
              amountCents: cents,
              description: v.description,
              visitId: v.visitId ? Number(v.visitId) : null,
            }),
          });
          created = json.item;
        }
        return v;
      },
    });
    if (!values || !created) return;
    if (values.receipt) {
      try {
        await uploadFieldFile(`${API}/expenses/${created.id}/receipt`, values.receipt);
      } catch {
        toast(t(locale, 'panel.field.receiptFailed'), 'warning');
        void load();
        return;
      }
    }
    toast(t(locale, 'panel.field.expenseSent'), 'ok');
    void load();
  };

  const cancelExpense = async (row) => {
    const ok = await confirm({
      title: t(locale, 'panel.field.cancelExpense'),
      message: t(locale, 'panel.field.cancelExpenseConfirm'),
      confirmLabel: t(locale, 'panel.field.cancelExpense'),
      danger: true,
    });
    if (!ok) return;
    setBusyId(`e${row.id}`);
    try {
      await send(`${API}/expenses/${row.id}`, { method: 'DELETE' }, 'panel.field.expenseCancelled');
      await load();
    } catch (e) {
      toast(e?.message || t(locale, 'panel.common.error'), 'error');
    } finally {
      setBusyId('');
    }
  };

  const visits = data?.visits || [];
  const expenses = data?.expenses || [];

  return (
    <EmployeeDedicatedShell
      locale={locale}
      title={t(locale, 'panel.field.employeePageTitle')}
      hint={t(locale, 'panel.field.employeePageHint')}
    >
      <input ref={fileRef} type="file" className="hidden" onChange={(e) => void onFile(e)} aria-hidden="true" tabIndex={-1} />
      {loading && !data ? (
        <AppLoading variant="panel" locale={locale} />
      ) : !data ? (
        <div>
          <EmptyState title={t(locale, 'panel.field.loadError')} message={t(locale, 'panel.field.loadErrorHint')} />
          <button type="button" className={cn(S.btnGhost, 'min-h-touch')} onClick={() => void load()}>
            {t(locale, 'common.retry')}
          </button>
        </div>
      ) : (
        <ContentEnter animKey={`emp-field|${data.day}|${visits.length}|${expenses.length}`}>
          <section className="rounded-card border border-ink/12 bg-surface p-4 sm:p-5" aria-labelledby="emp-field-route">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 id="emp-field-route" className="m-0 font-ui text-base font-semibold text-ink">
                  {t(locale, 'panel.field.routeTitle', { date: formatDisplayDate(data.day, locale) })}
                </h2>
                <p className={cn(S.muted, 'm-0 mt-1 text-prose')}>{t(locale, 'panel.field.routeHint')}</p>
              </div>
              <button type="button" className={cn(S.btnGhost, 'min-h-touch shrink-0 text-sm')} onClick={() => void logVisit()}>
                {t(locale, 'panel.field.logVisit')}
              </button>
            </div>
            {geo.state === 'error' ? <InlineCallout tone="warning" className="mb-3">{geo.error}</InlineCallout> : null}
            {visits.length === 0 ? (
              <EmptyState title={t(locale, 'panel.field.routeEmptyTitle')} message={t(locale, 'panel.field.routeEmptyHint')} />
            ) : (
              <ol className="m-0 flex list-none flex-col gap-3 p-0">
                {visits.map((v) => (
                  <li key={v.id} className="rounded-card border border-ink/10 bg-canvas p-3 sm:p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="m-0 font-ui text-sm font-semibold text-ink">
                          {v.plannedTime ? <span className="mr-2 font-mono text-2xs text-ink-muted">{v.plannedTime}</span> : null}
                          {v.title}
                        </p>
                        {v.address ? (
                          <a href={mapSearchLink(v.address)} target="_blank" rel="noopener noreferrer" className={cn(linkClass, 'text-prose')}>
                            {v.address}
                          </a>
                        ) : null}
                        {v.notes ? <p className={cn(S.muted, 'm-0 mt-1 text-prose')}>{v.notes}</p> : null}
                      </div>
                      <StatusToneChip tone={fieldVisitTone(v.status)}>{fieldVisitStatusLabel(locale, v.status)}</StatusToneChip>
                    </div>
                    {v.checkinAt ? (
                      <p className="m-0 mt-2 font-mono text-2xs text-ink-muted">
                        {t(locale, 'panel.field.checkedInAt', { time: formatClock(v.checkinAt, locale) })}
                        {v.latitude != null ? (
                          <>
                            {' · '}
                            <a href={osmLink(v.latitude, v.longitude)} target="_blank" rel="noopener noreferrer" className={linkClass}>
                              {t(locale, 'panel.field.openMap')}
                            </a>
                          </>
                        ) : null}
                        {v.hasPhoto ? (
                          <>
                            {' · '}
                            <a href={`${API}/visits/${v.id}/photo`} target="_blank" rel="noopener noreferrer" className={linkClass}>
                              {t(locale, 'panel.field.viewPhoto')}
                            </a>
                          </>
                        ) : null}
                      </p>
                    ) : null}
                    {v.outcomeNote ? <p className={cn(S.muted, 'm-0 mt-1 text-prose')}>{v.outcomeNote}</p> : null}
                    <div className="mt-3 flex flex-wrap gap-2">
                      {v.status === FIELD_VISIT_STATUS.PLANNED ? (
                        <button type="button" disabled={busyId === `v${v.id}`} className={cn(S.btnBrandSoft, 'min-h-touch text-sm')} onClick={() => void checkIn(v)}>
                          {busyId === `v${v.id}` ? t(locale, 'employeeHome.timeClock.geoLocating') : t(locale, 'panel.field.checkIn')}
                        </button>
                      ) : null}
                      {v.status === FIELD_VISIT_STATUS.CHECKED_IN ? (
                        <button type="button" className={cn(S.btnBrandSoft, 'min-h-touch text-sm')} onClick={() => void complete(v)}>
                          {t(locale, 'panel.field.complete')}
                        </button>
                      ) : null}
                      {v.status === FIELD_VISIT_STATUS.CHECKED_IN || v.status === FIELD_VISIT_STATUS.DONE ? (
                        <button type="button" disabled={busyId === `photo${v.id}`} className={cn(S.btnGhost, 'min-h-touch text-sm')} onClick={() => pickFile({ kind: 'photo', id: v.id })}>
                          {busyId === `photo${v.id}` ? t(locale, 'panel.common.loading') : t(locale, v.hasPhoto ? 'panel.field.replacePhoto' : 'panel.field.addPhoto')}
                        </button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section id="expenses" className="mt-4 scroll-mt-20 rounded-card border border-ink/12 bg-surface p-4 sm:p-5" aria-labelledby="emp-field-expenses">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 id="emp-field-expenses" className="m-0 font-ui text-base font-semibold text-ink">{t(locale, 'panel.field.expensesTitle')}</h2>
                <p className={cn(S.muted, 'm-0 mt-1 text-prose')}>{t(locale, 'panel.field.expensesHint')}</p>
              </div>
              <button type="button" className={cn(S.btnPrimary, 'min-h-touch shrink-0')} onClick={() => void requestExpense()}>
                {t(locale, 'panel.field.requestExpense')}
              </button>
            </div>
            {expenses.length === 0 ? (
              <EmptyState title={t(locale, 'panel.field.expensesEmptyTitle')} message={t(locale, 'panel.field.expensesEmptyHint')} />
            ) : (
              <ul className="m-0 flex list-none flex-col divide-y divide-ink/[0.06] p-0">
                {expenses.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="m-0 font-ui text-sm font-semibold text-ink">
                        {formatCents(locale, e.amountCents, e.currency)}
                        <span className="ml-2 font-ui text-prose font-normal text-ink-muted">{fieldCategoryLabel(locale, e.category)} · {formatDisplayDate(e.day, locale)}</span>
                      </p>
                      <p className={cn(S.muted, 'm-0 mt-0.5 text-prose')}>{e.description}</p>
                      {e.decisionNote ? (
                        <p className="m-0 mt-0.5 font-ui text-xs text-ink-muted">{t(locale, 'panel.field.decisionNote', { note: e.decisionNote })}</p>
                      ) : null}
                      <div className="mt-1 flex flex-wrap items-center gap-3 text-prose">
                        {e.hasReceipt ? (
                          <a href={`${API}/expenses/${e.id}/receipt`} target="_blank" rel="noopener noreferrer" className={linkClass}>
                            {t(locale, 'panel.field.viewReceipt')}
                          </a>
                        ) : e.status === FIELD_EXPENSE_STATUS.PENDING ? (
                          <span className="text-warning">{t(locale, 'panel.field.receiptMissing')}</span>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <StatusToneChip tone={fieldExpenseTone(e.status)}>{fieldExpenseStatusLabel(locale, e.status)}</StatusToneChip>
                      {e.status === FIELD_EXPENSE_STATUS.PENDING ? (
                        <div className="flex flex-wrap justify-end gap-2">
                          <button type="button" disabled={busyId === `receipt${e.id}`} className={cn(S.btnGhost, 'min-h-touch text-sm')} onClick={() => pickFile({ kind: 'receipt', id: e.id })}>
                            {busyId === `receipt${e.id}` ? t(locale, 'panel.common.loading') : t(locale, e.hasReceipt ? 'panel.field.replaceReceipt' : 'panel.field.attachReceipt')}
                          </button>
                          <button type="button" disabled={busyId === `e${e.id}`} className={cn(S.btnGhost, 'min-h-touch text-sm')} onClick={() => void cancelExpense(e)}>
                            {t(locale, 'panel.field.cancelExpense')}
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </ContentEnter>
      )}
    </EmployeeDedicatedShell>
  );
}
