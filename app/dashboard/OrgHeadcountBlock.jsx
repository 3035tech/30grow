'use client';

import { useEffect, useState } from 'react';
import { formatDisplayDate } from '../../lib/format-display-date.js';
import { t } from '../../lib/i18n';
import { positionStatus, POSITION_TRANSITIONS } from '../../lib/org-position-constants.js';
import { orgUnitOptions } from '../../lib/org-unit-constants.js';
import { useListUrlState, useListSearchDraft } from './hooks/useListUrlState';
import {
  S,
  AdminPageHeader,
  AdminCreateButton,
  AdminTableShell,
  AdminTh,
  AdminListPager,
  AdminListSearch,
} from './dashboard-shared';
import { AdminListFilters, AdminListFilterSelect } from '../_components/AdminListFilters';
import { AdminRichFormDrawer } from '../_components/AdminRichFormDrawer';
import { FormField } from '../_components/FormField';
import { SelectField } from '../_components/SelectField';
import { EntitySearchSelect } from '../_components/EntitySearchSelect';
import { EmptyState } from '../_components/EmptyState';
import { ListLoadError } from '../_components/ListLoadError';
import { AppLoading } from '../_components/AppLoading';
import { useAppFeedback } from '../_components/AppFeedback';

export async function headcountRequest(
  companyId,
  { method = 'GET', body, params = {}, signal } = {},
) {
  const qs = new URLSearchParams({
    companyId: String(companyId),
    ...Object.fromEntries(
      Object.entries(params).filter(([, value]) => value !== '' && value != null),
    ),
  });
  const response = await fetch(`/api/admin/org-positions?${qs}`, {
    method,
    signal,
    ...(body
      ? {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...body, companyId: Number(companyId) }),
        }
      : {}),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || String(response.status));
  return data;
}
function PositionBadge({ position, locale, filled = false }) {
  const status = filled ? 'filled' : positionStatus(position);
  const tone =
    {
      occupied: 'bg-brand-500/10 text-brand-600',
      filled: 'bg-brand-500/10 text-brand-600',
      open: 'bg-success/10 text-success',
      frozen: 'bg-warning/10 text-warning',
    }[status] || 'bg-ink/[0.06] text-ink-muted';
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${tone}`}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
      {t(locale, `headcount.${status === 'filled' ? 'filled' : `state_${status}`}`)}
    </span>
  );
}
const today = () => new Date().toISOString().slice(0, 10);
export function OrgHeadcountBlock({
  companyId,
  locale = 'pt-BR',
  navigateDashboard,
  canManageVacancies = false,
}) {
  const msg = (key, values) => t(locale, `headcount.${key}`, values);
  const { toast, confirm } = useAppFeedback();
  const [q, setQ] = useListUrlState('headcount', 'q', '');
  const [qDraft, setQDraft] = useListSearchDraft(q);
  const [status, setStatus] = useListUrlState('headcount', 'status', '');
  const [unit, setUnit] = useListUrlState('headcount', 'unit', '');
  const [role, setRole] = useListUrlState('headcount', 'role', '');
  const [page, setPage] = useListUrlState('headcount', 'page', 1);
  const [version, setVersion] = useState(0);
  const [state, setState] = useState({ loading: true, error: '', data: null });
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [draft, setDraft] = useState({});
  const [history, setHistory] = useState(null);
  const requestKey = JSON.stringify([companyId, q, status, unit, role, page, version]);
  const loading = state.loading || state.key !== requestKey;
  useEffect(() => {
    const controller = new AbortController();
    headcountRequest(companyId, {
      params: { q, status, orgUnitId: unit, jobRoleId: role, page, pageSize: 20, options: '1' },
      signal: controller.signal,
    })
      .then((data) => {
        if (!controller.signal.aborted)
          setState({ loading: false, error: '', data, key: requestKey });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setState((previous) => ({
            ...previous,
            key: requestKey,
            loading: false,
            error: error.message,
          }));
      });
    return () => controller.abort();
  }, [companyId, q, status, unit, role, page, version, requestKey]);
  const reload = () => {
    setState((previous) => ({ ...previous, loading: true }));
    setVersion((value) => value + 1);
  };
  const update = async (body, method = 'PATCH') => {
    await headcountRequest(companyId, { method, body });
    reload();
    toast(msg('saved'));
  };
  const open = (mode, position = {}) => {
    setFormError('');
    setDialog({ mode, position });
    setDraft(
      mode === 'plan'
        ? {
            code: position.code || '',
            title: position.title || '',
            orgUnitId: position.orgUnitId || '',
            jobRoleId: position.jobRoleId || '',
            fte: position.fte ?? 1,
            effectiveFrom: position.effectiveFrom || today(),
            effectiveTo: position.effectiveTo || '',
          }
        : { candidateId: '', vacancyId: '', date: today(), reason: '' },
    );
  };
  const field = (key, value) => setDraft((previous) => ({ ...previous, [key]: value }));
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setFormError('');
    try {
      const { mode, position } = dialog;
      if (mode === 'plan')
        await update(
          {
            ...draft,
            id: position.id,
            version: position.version,
            orgUnitId: Number(draft.orgUnitId),
            jobRoleId: Number(draft.jobRoleId),
            fte: Number(draft.fte),
            effectiveTo: draft.effectiveTo || null,
          },
          'POST',
        );
      else if (mode === 'assign')
        await update({
          action: 'assign',
          positionId: Number(position.id),
          candidateId: Number(draft.candidateId),
          startedOn: draft.date,
          reason: draft.reason,
        });
      else if (mode === 'release')
        await update({
          action: 'release',
          assignmentId: Number(position.assignmentId),
          positionId: Number(position.id),
          endedOn: draft.date,
          reason: draft.reason,
        });
      else
        await update({
          action: 'link',
          positionId: Number(position.id),
          vacancyId: Number(draft.vacancyId),
        });
      setDialog(null);
    } catch (error) {
      setFormError(error.message);
    } finally {
      setBusy(false);
    }
  };
  const changeStatus = async (position, next) => {
    if (
      !(await confirm({
        title: msg(
          {
            approved: position.status === 'frozen' ? 'reopen' : 'approve',
            frozen: 'freeze',
            closed: 'close',
          }[next],
        ),
        message: msg(
          next === 'frozen'
            ? 'confirmFrozen'
            : next === 'closed'
              ? 'confirmClosed'
              : 'confirmStatus',
          { code: position.code },
        ),
      }))
    )
      return;
    setBusy(true);
    try {
      await update({
        action: 'status',
        positionId: Number(position.id),
        version: position.version,
        status: next,
      });
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  const unlink = async (position) => {
    if (!(await confirm({ title: msg('unlink'), message: msg('unlinkConfirm') }))) return;
    setBusy(true);
    try {
      await update({
        action: 'link',
        positionId: Number(position.id),
        recruitmentId: Number(position.recruitmentId),
        vacancyId: null,
      });
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  const showHistory = async (position) => {
    setBusy(true);
    try {
      const data = await headcountRequest(companyId, { params: { historyId: position.id } });
      setHistory({ ...data, position });
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  const data = state.data;
  const units = orgUnitOptions(data?.units || []);
  const roles = data?.roles || [];
  const modes = {
    plan: dialog?.position.id ? 'edit' : 'create',
    assign: 'assign',
    release: 'release',
    link: 'link',
  };
  return (
    <section className="space-y-4">
      <AdminPageHeader
        title={msg('title')}
        description={msg('hint')}
        actions={
          <AdminCreateButton
            label={msg('create')}
            onClick={() => open('plan')}
            disabled={busy || !units.length || !roles.length || loading}
          />
        }
      />
      {data ? (
        <>
          <dl className="m-0 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {['approved', 'occupied', 'available', 'unallocated'].map((key) => (
              <div key={key} className="space-y-3 rounded-control border border-ink/10 p-4">
                <dt className="text-xs text-ink-muted">{msg(key)}</dt>
                <dd className="m-0 mt-1 text-2xl font-semibold tabular-nums">
                  {data.summary[key] ?? 0}
                </dd>
              </div>
            ))}
          </dl>
          <dl className="m-0 flex flex-wrap gap-x-5 gap-y-2 text-xs text-ink-muted">
            {['planned', 'frozen', 'approvedFte', 'occupiedFte'].map((key) => (
              <div key={key} className="flex gap-1">
                <dt>{msg(key)}:</dt>
                <dd className="m-0 font-medium tabular-nums">{data.summary[key] ?? 0}</dd>
              </div>
            ))}
          </dl>
          <p className="text-xs text-ink-muted">{msg('summaryHint')}</p>
        </>
      ) : null}
      {!loading && (!units.length || !roles.length) ? (
        <p className="text-sm text-warning">{msg('unitRoleRequired')}</p>
      ) : null}
      <AdminListFilters
        locale={locale}
        clearEnabled={Boolean(q || status || unit || role)}
        onClear={() => {
          setQ('');
          setQDraft('');
          setStatus('');
          setUnit('');
          setRole('');
          setPage(1);
        }}
      >
        <AdminListSearch
          locale={locale}
          value={qDraft}
          onChange={setQDraft}
          onSubmit={(value) => {
            setQ(value.trim());
            setPage(1);
          }}
          placeholder={msg('search')}
        />
        <AdminListFilterSelect
          label={msg('status')}
          value={status}
          onChange={(value) => {
            setStatus(value);
            setPage(1);
          }}
        >
          <option value="">{msg('all')}</option>
          {['planned', 'open', 'occupied', 'frozen', 'closed'].map((key) => (
            <option key={key} value={key}>
              {msg(key)}
            </option>
          ))}
        </AdminListFilterSelect>
        <AdminListFilterSelect
          label={msg('unit')}
          value={unit}
          onChange={(value) => {
            setUnit(value);
            setPage(1);
          }}
        >
          <option value="">{msg('all')}</option>
          {units.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </AdminListFilterSelect>
        <AdminListFilterSelect
          label={msg('role')}
          value={role}
          onChange={(value) => {
            setRole(value);
            setPage(1);
          }}
        >
          <option value="">{msg('all')}</option>
          {roles.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </AdminListFilterSelect>
        <button type="button" onClick={reload} disabled={loading} className={S.btnGhost}>
          {msg('refresh')}
        </button>
      </AdminListFilters>
      {state.error ? (
        <ListLoadError locale={locale} message={state.error} onRetry={reload} />
      ) : null}
      {loading ? (
        <AppLoading locale={locale} variant="panel" />
      ) : state.error ? null : !data?.items.length ? (
        <EmptyState
          title={msg('empty')}
          description={msg(q || status || unit || role ? 'filteredEmptyHint' : 'emptyHint')}
        />
      ) : (
        <>
          <AdminTableShell locale={locale} minWidth="920px" ariaLabel={msg('title')}>
            <thead>
              <tr>
                {['positionTitle', 'unit', 'role', 'status', 'candidate', 'vacancy', 'actions'].map(
                  (key) => (
                    <AdminTh key={key}>{msg(key)}</AdminTh>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {data.items.map((position) => (
                <tr key={position.id} className="border-t border-ink/10 align-top">
                  <td className="p-3">
                    <span className="text-xs text-ink-muted">{position.code}</span>
                    <div className="font-medium">{position.title}</div>
                    <div className="mt-1 text-xs text-ink-muted">
                      FTE {position.fte} · {formatDisplayDate(position.effectiveFrom, locale)}
                    </div>
                  </td>
                  <td className="p-3 text-sm">{position.unitName}</td>
                  <td className="p-3 text-sm">{position.roleName}</td>
                  <td className="p-3 text-sm">
                    <PositionBadge position={position} locale={locale} />
                  </td>
                  <td className="p-3 text-sm">
                    {position.candidateId ? (
                      <button
                        className="text-brand-600 underline"
                        type="button"
                        onClick={() =>
                          navigateDashboard?.({
                            tab: 'team',
                            candidate: position.candidateId,
                            section: 'profile',
                            returnTab: 'organization',
                            clientOnly: true,
                          })
                        }
                      >
                        {position.candidateName}
                      </button>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="p-3 text-sm">
                    {position.vacancyId ? (
                      <button
                        type="button"
                        className="text-brand-600 underline"
                        onClick={() =>
                          navigateDashboard?.({
                            tab: 'vacancies',
                            vacancyDetail: position.vacancyId,
                            vacancySection: 'pipeline',
                          })
                        }
                      >
                        {position.vacancyTitle}
                      </button>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="p-3">
                    <div className="flex flex-wrap gap-2">
                      {position.status === 'planned' ? (
                        <>
                          <button
                            type="button"
                            disabled={busy}
                            className={S.btnBrandSoft}
                            onClick={() => changeStatus(position, 'approved')}
                          >
                            {msg('approve')}
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            className={S.btnGhost}
                            onClick={() => open('plan', position)}
                          >
                            {msg('edit')}
                          </button>
                        </>
                      ) : null}
                      {position.status === 'approved' &&
                      !position.candidateId &&
                      !position.vacancyId ? (
                        <>
                          <button
                            type="button"
                            disabled={busy}
                            className={S.btnBrandSoft}
                            onClick={() => open('assign', position)}
                          >
                            {msg('assign')}
                          </button>
                          {canManageVacancies ? (
                            <button
                              type="button"
                              disabled={busy}
                              className={S.btnGhost}
                              onClick={() => open('link', position)}
                            >
                              {msg('link')}
                            </button>
                          ) : null}
                        </>
                      ) : null}
                      {position.candidateId ? (
                        <button
                          type="button"
                          disabled={busy}
                          className={S.btnGhost}
                          onClick={() => open('release', position)}
                        >
                          {msg('release')}
                        </button>
                      ) : null}
                      {position.vacancyId && canManageVacancies ? (
                        <button
                          type="button"
                          disabled={busy}
                          className={S.btnGhost}
                          onClick={() => unlink(position)}
                        >
                          {msg('unlink')}
                        </button>
                      ) : null}
                      <details className="relative">
                        <summary className={S.btnGhost}>{msg('more')}</summary>
                        <div className="mt-1 flex flex-col gap-2 rounded-control border border-ink/10 bg-surface p-2">
                          <button
                            type="button"
                            disabled={busy}
                            className={S.btnGhost}
                            onClick={() => showHistory(position)}
                          >
                            {msg('history')}
                          </button>
                          {(POSITION_TRANSITIONS[position.status] || [])
                            .filter((next) => next !== 'approved' || position.status === 'frozen')
                            .map((next) => (
                              <button
                                type="button"
                                key={next}
                                disabled={
                                  busy || Boolean(position.candidateId || position.vacancyId)
                                }
                                className={S.btnGhost}
                                onClick={() => changeStatus(position, next)}
                              >
                                {msg(
                                  { approved: 'reopen', frozen: 'freeze', closed: 'close' }[next],
                                )}
                              </button>
                            ))}
                        </div>
                      </details>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </AdminTableShell>
          <AdminListPager
            locale={locale}
            page={page}
            pageSize={20}
            total={data.total}
            onPageChange={setPage}
            pageSizeOptions={[20]}
          />
        </>
      )}
      <AdminRichFormDrawer
        open={Boolean(dialog)}
        title={msg(modes[dialog?.mode] || 'create')}
        locale={locale}
        onClose={() => {
          if (!busy) setDialog(null);
        }}
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              disabled={busy}
              className={S.btnGhost}
              onClick={() => setDialog(null)}
            >
              {t(locale, 'panel.common.cancel')}
            </button>
            <button
              type="submit"
              form="org-position-form"
              className={S.btnPrimary}
              disabled={
                busy ||
                (dialog?.mode === 'assign' && !draft.candidateId) ||
                (dialog?.mode === 'link' && !draft.vacancyId)
              }
            >
              {busy
                ? t(locale, 'panel.common.loading')
                : msg(
                    dialog?.mode === 'plan' ? 'save' : dialog?.mode === 'link' ? 'link' : 'apply',
                  )}
            </button>
          </div>
        }
      >
        {dialog ? (
          <form id="org-position-form" onSubmit={submit} className="space-y-4" aria-busy={busy}>
            {formError ? (
              <p role="alert" className="text-sm text-danger">
                {formError}
              </p>
            ) : null}
            {dialog.mode !== 'plan' ? (
              <div className="rounded-control border border-ink/10 bg-ink/[0.025] p-3">
                <p className="m-0 text-xs text-ink-muted">{dialog.position.code}</p>
                <p className="m-0 mt-1 font-semibold">{dialog.position.title}</p>
                <p className="m-0 mt-1 text-sm text-ink-muted">
                  {dialog.position.unitName} · {dialog.position.roleName}
                </p>
                {dialog.mode === 'release' ? (
                  <p className="m-0 mt-2 text-sm">
                    {msg('candidate')}: {dialog.position.candidateName}
                  </p>
                ) : null}
              </div>
            ) : null}
            {dialog.mode === 'plan' ? (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  {['code', 'title'].map((key) => (
                    <FormField key={key} label={msg(key === 'title' ? 'positionTitle' : key)}>
                      <input
                        className={`${S.input} w-full`}
                        required
                        maxLength={key === 'code' ? 60 : 160}
                        value={draft[key]}
                        onChange={(e) => field(key, e.target.value)}
                      />
                    </FormField>
                  ))}
                </div>
                <FormField label={msg('unit')}>
                  <SelectField
                    required
                    aria-label={msg('unit')}
                    value={draft.orgUnitId}
                    onChange={(e) => field('orgUnitId', e.target.value)}
                  >
                    <option value="">—</option>
                    {units.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                  </SelectField>
                </FormField>
                <FormField label={msg('role')}>
                  <SelectField
                    required
                    aria-label={msg('role')}
                    value={draft.jobRoleId}
                    onChange={(e) => field('jobRoleId', e.target.value)}
                  >
                    <option value="">—</option>
                    {roles.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </SelectField>
                </FormField>
                <FormField label={msg('fte')}>
                  <input
                    className={`${S.input} w-full`}
                    type="number"
                    min="0.01"
                    max="1"
                    step="0.01"
                    required
                    value={draft.fte}
                    onChange={(e) => field('fte', e.target.value)}
                  />
                </FormField>
                <div className="grid gap-3 sm:grid-cols-2">
                  <FormField label={msg('effectiveFrom')}>
                    <input
                      type="date"
                      className={`${S.input} w-full`}
                      required
                      value={draft.effectiveFrom}
                      onChange={(e) => field('effectiveFrom', e.target.value)}
                    />
                  </FormField>
                  <FormField label={msg('effectiveTo')}>
                    <input
                      type="date"
                      className={`${S.input} w-full`}
                      min={draft.effectiveFrom}
                      value={draft.effectiveTo}
                      onChange={(e) => field('effectiveTo', e.target.value)}
                    />
                  </FormField>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-ink-muted">{msg(`${dialog.mode}Hint`)}</p>
                {dialog.mode === 'assign' ? (
                  <FormField label={msg('candidate')}>
                    <EntitySearchSelect
                      locale={locale}
                      aria-label={msg('candidate')}
                      searchUrl={`/api/admin/employees/search?companyId=${companyId}`}
                      value={draft.candidateId}
                      onChange={(value) => field('candidateId', value)}
                    />
                  </FormField>
                ) : null}
                {dialog.mode === 'link' ? (
                  <FormField label={msg('vacancy')}>
                    <EntitySearchSelect
                      locale={locale}
                      aria-label={msg('vacancy')}
                      searchUrl={`/api/admin/vacancies/search?companyId=${companyId}`}
                      value={draft.vacancyId}
                      onChange={(value) => field('vacancyId', value)}
                    />
                  </FormField>
                ) : (
                  <>
                    <FormField label={msg('date')}>
                      <input
                        type="date"
                        required
                        className={`${S.input} w-full`}
                        value={draft.date}
                        onChange={(e) => field('date', e.target.value)}
                      />
                    </FormField>
                    <FormField label={msg('reason')}>
                      <textarea
                        required
                        maxLength={1000}
                        className={S.textarea}
                        value={draft.reason}
                        onChange={(e) => field('reason', e.target.value)}
                      />
                    </FormField>
                  </>
                )}
              </>
            )}
          </form>
        ) : null}
      </AdminRichFormDrawer>
      <AdminRichFormDrawer
        open={Boolean(history)}
        title={`${msg('history')} · ${history?.position.code || ''}`}
        locale={locale}
        onClose={() => setHistory(null)}
      >
        {history?.items.length ? (
          <ol className="space-y-3">
            {history.items.map((item) => (
              <li key={item.id} className="border-b border-ink/10 pb-3">
                <strong>{item.candidateName}</strong>
                <p className="text-sm">
                  {formatDisplayDate(item.startedOn, locale)} →{' '}
                  {item.endedOn ? formatDisplayDate(item.endedOn, locale) : msg('current')}
                </p>
                <p className="whitespace-pre-wrap text-sm text-ink-muted">
                  {['vacancy_hire', 'employment_exit'].includes(item.reason)
                    ? msg(item.reason)
                    : item.reason}
                  {item.endedReason
                    ? ` · ${['vacancy_hire', 'employment_exit'].includes(item.endedReason) ? msg(item.endedReason) : item.endedReason}`
                    : ''}
                </p>
              </li>
            ))}
          </ol>
        ) : (
          <p>{msg('noHistory')}</p>
        )}
        {history?.truncated ? <p>{msg('historyCap')}</p> : null}
      </AdminRichFormDrawer>
    </section>
  );
}

export function VacancyPositions({ companyId, vacancyId, locale = 'pt-BR', navigateDashboard }) {
  const [state, setState] = useState({ items: [], error: '', key: '' });
  const [retry, setRetry] = useState(0);
  const requestKey = JSON.stringify([companyId, vacancyId, retry]);
  const loading = state.key !== requestKey;
  useEffect(() => {
    const controller = new AbortController();
    headcountRequest(companyId, { params: { vacancyId, pageSize: 100 }, signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setState({ items: data.items, error: '', key: requestKey });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setState({ items: [], error: error.message, key: requestKey });
      });
    return () => controller.abort();
  }, [companyId, vacancyId, retry, requestKey]);
  const msg = (key) => t(locale, `headcount.${key}`);
  return (
    <section className="space-y-3 rounded-control border border-ink/10 p-4">
      <h3 className="m-0 text-sm font-semibold">{msg('vacancyTitle')}</h3>
      {loading ? (
        <p role="status" className="text-sm text-ink-muted">
          {t(locale, 'panel.common.loading')}
        </p>
      ) : state.error ? (
        <ListLoadError
          locale={locale}
          message={state.error}
          onRetry={() => setRetry((value) => value + 1)}
        />
      ) : state.items.length ? (
        <ul className="m-0 list-none divide-y divide-ink/10 p-0 text-sm">
          {state.items.map((p) => (
            <li
              key={p.id}
              className="flex flex-wrap items-center justify-between gap-2 py-2 first:pt-0 last:pb-0"
            >
              <div className="min-w-0">
                <span className="text-xs text-ink-muted">{p.code}</span>
                <p className="m-0 font-medium">{p.title}</p>
                <p className="m-0 text-xs text-ink-muted">
                  {p.unitName} · {p.roleName}
                </p>
              </div>
              <PositionBadge position={p} locale={locale} filled={Boolean(p.filledAssignmentId)} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-ink-muted">{msg('vacancyEmpty')}</p>
      )}
      <button
        type="button"
        className={S.btnGhost}
        onClick={() =>
          navigateDashboard?.({
            tab: 'organization',
            'list.organization.section': JSON.stringify('headcount'),
          })
        }
      >
        {msg('manage')}
      </button>
    </section>
  );
}
