'use client';

import { useCallback, useEffect, useState } from 'react';
import { t } from '../../lib/i18n';
import { cn } from '../../lib/cn';
import { formatMinutesClock } from '../../lib/time-clock-format.js';
import { TIME_CLOCK_REASON } from '../../lib/people/time-clock-eligibility.js';
import {
  S,
  AdminActionsCell,
  AdminActionsTh,
  AdminIconButton,
  AdminListPager,
  AdminListSearch,
  AdminTableShell,
  AdminTh,
} from '../dashboard/dashboard-shared';
import { AdminListFilters } from './AdminListFilters';
import { AppLoading } from './AppLoading';
import { useAppFeedback } from './AppFeedback';
import { EmptyState } from './EmptyState';
import { HourBankAdminBlock } from './HourBankAdminBlock';
import { OrgUnitFilter } from './OrgUnitField';
import { SegmentedControl } from './SegmentedControl';
import { StatusToneChip } from './StatusToneChip';
import { TimeClockAdminBlock } from './TimeClockAdminBlock';
import { TimeClockClosuresBlock } from './TimeClockClosuresBlock';
import { TimeClockHolidaysBlock } from './TimeClockHolidaysBlock';
import { TimeClockMirror } from './TimeClockMirror';
import { TimeClockRequestsBlock } from './TimeClockRequestsBlock';

const K = 'panel.timeClockMgr';
const PAGE_SIZE = 25;

function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

function usePagedList(url, params, deps) {
  const { toast } = useAppFeedback();
  const [state, setState] = useState({ items: [], total: 0, loading: true });
  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }));
    try {
      const res = await fetch(`${url}?${new URLSearchParams(params)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || String(res.status));
      setState({ items: data.items || [], total: Number(data.total) || 0, loading: false });
    } catch (e) {
      toast(e?.message || String(e), 'error');
      setState({ items: [], total: 0, loading: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    void load();
  }, [load]);
  return { ...state, reload: load };
}

const WIDE_COL = 'hidden xl:table-cell';
const ACTIONS_COL = 'hidden sm:table-cell';

function PersonCell({ name, email, meta }) {
  return (
    <div className="min-w-0">
      <p className="m-0 truncate font-ui text-sm text-ink">{name}</p>
      {email ? <p className={cn(S.faint, 'm-0 truncate')}>{email}</p> : null}
      {meta ? <p className={cn(S.faint, 'm-0 truncate xl:hidden')}>{meta}</p> : null}
    </div>
  );
}

function PersonButton({ onClick, children }) {
  return (
    <button
      type="button"
      className="min-h-touch w-full rounded-control text-left hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/35"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function personMeta(row, locale) {
  return [row.jobRoleName, row.orgUnitPath || t(locale, 'panel.orgUnits.none')].filter(Boolean).join(' · ');
}

function PeopleList({ locale, companyId, onOpen, reloadKey }) {
  const [qDraft, setQDraft] = useState('');
  const q = useDebounced(qDraft);
  const [orgUnit, setOrgUnit] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [q, orgUnit]);
  const params = {
    companyId: String(companyId),
    page: String(page),
    pageSize: String(PAGE_SIZE),
    ...(q.trim() ? { q: q.trim() } : {}),
    ...(orgUnit ? { orgUnit } : {}),
  };
  const { items, total, loading } = usePagedList(
    '/api/admin/time-clock/people',
    params,
    [companyId, page, q, orgUnit, reloadKey]
  );
  const dirty = Boolean(qDraft.trim() || orgUnit);

  return (
    <div className="flex flex-col gap-3">
      <AdminListFilters
        aria-label={t(locale, `${K}.peopleFilters`)}
        locale={locale}
        clearEnabled={dirty}
        onClear={() => {
          setQDraft('');
          setOrgUnit('');
        }}
      >
        <AdminListSearch
          locale={locale}
          value={qDraft}
          onChange={setQDraft}
          placeholder={t(locale, `${K}.searchPeople`)}
        />
        <OrgUnitFilter companyId={companyId} locale={locale} value={orgUnit} onChange={setOrgUnit} />
      </AdminListFilters>

      {loading && items.length === 0 ? (
        <AppLoading variant="panel" />
      ) : items.length === 0 ? (
        <EmptyState
          title={t(locale, dirty ? `${K}.peopleEmptyFiltered` : `${K}.peopleEmpty`)}
          message={t(locale, `${K}.peopleEmptyHint`)}
        />
      ) : (
        <>
          <AdminTableShell
            locale={locale}
            minWidth="360px"
            animKey={`tc-people|${page}|${q}|${orgUnit}|${total}`}
            ariaLabel={t(locale, `${K}.peopleAria`)}
          >
            <thead>
              <tr>
                <AdminTh>{t(locale, `${K}.colPerson`)}</AdminTh>
                <AdminTh className={WIDE_COL}>{t(locale, `${K}.colRole`)}</AdminTh>
                <AdminTh className={WIDE_COL}>{t(locale, `${K}.colUnit`)}</AdminTh>
                <AdminTh>{t(locale, `${K}.colPending`)}</AdminTh>
                <AdminActionsTh className={ACTIONS_COL}>{t(locale, `${K}.colActions`)}</AdminActionsTh>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.candidateId} className="border-b border-ink/8 last:border-b-0">
                  <td className="max-w-[13rem] px-4 py-2.5 align-middle sm:max-w-[18rem]">
                    <PersonButton onClick={() => onOpen(row.candidateId)}>
                      <PersonCell name={row.fullName} email={row.email} meta={personMeta(row, locale)} />
                    </PersonButton>
                  </td>
                  <td className={cn(WIDE_COL, 'px-4 py-2.5 align-middle text-ink-muted')}>{row.jobRoleName || '·'}</td>
                  <td className={cn(WIDE_COL, 'px-4 py-2.5 align-middle text-ink-muted')}>{row.orgUnitPath || t(locale, 'panel.orgUnits.none')}</td>
                  <td className="px-4 py-2.5 align-middle">
                    {row.timeClockEnabled === false ? (
                      <StatusToneChip tone="neutral" title={t(locale, row.timeClockReason === TIME_CLOCK_REASON.OVERRIDE ? `${K}.noTimeClockOverride` : `${K}.noTimeClockWorkFormat`)}>
                        {t(locale, `${K}.noTimeClock`)}
                      </StatusToneChip>
                    ) : row.flaggedCount > 0 ? (
                      <StatusToneChip tone="warning">
                        {t(locale, `${K}.flaggedChip`, { n: row.flaggedCount })}
                      </StatusToneChip>
                    ) : (
                      <span className={S.faint}>{t(locale, `${K}.noPending`)}</span>
                    )}
                  </td>
                  <td className={cn(ACTIONS_COL, 'px-4 py-2.5 text-right align-middle')}>
                    <AdminActionsCell>
                      <AdminIconButton
                        icon="clock"
                        label={t(locale, `${K}.openMirror`, { name: row.fullName })}
                        onClick={() => onOpen(row.candidateId)}
                      />
                    </AdminActionsCell>
                  </td>
                </tr>
              ))}
            </tbody>
          </AdminTableShell>
          <AdminListPager
            locale={locale}
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            loading={loading}
            onPageChange={setPage}
            pageSizeOptions={[PAGE_SIZE]}
          />
        </>
      )}
    </div>
  );
}

function BankBalances({ locale, companyId, onOpen, reloadKey }) {
  const [qDraft, setQDraft] = useState('');
  const q = useDebounced(qDraft);
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [q]);
  const params = {
    companyId: String(companyId),
    mode: 'balances',
    limit: String(PAGE_SIZE),
    offset: String((page - 1) * PAGE_SIZE),
    ...(q.trim() ? { q: q.trim() } : {}),
  };
  const { items, total, loading } = usePagedList(
    '/api/admin/hour-bank',
    params,
    [companyId, page, q, reloadKey]
  );

  return (
    <div className="flex flex-col gap-3">
      <AdminListFilters
        aria-label={t(locale, `${K}.bankFilters`)}
        locale={locale}
        clearEnabled={Boolean(qDraft.trim())}
        onClear={() => setQDraft('')}
      >
        <AdminListSearch
          locale={locale}
          value={qDraft}
          onChange={setQDraft}
          placeholder={t(locale, `${K}.searchPeople`)}
        />
      </AdminListFilters>
      {loading && items.length === 0 ? (
        <AppLoading variant="panel" />
      ) : items.length === 0 ? (
        <EmptyState title={t(locale, `${K}.peopleEmptyFiltered`)} message={t(locale, `${K}.peopleEmptyHint`)} />
      ) : (
        <>
          <AdminTableShell
            locale={locale}
            minWidth="400px"
            animKey={`tc-bank|${page}|${q}|${total}`}
            ariaLabel={t(locale, `${K}.bankAria`)}
          >
            <thead>
              <tr>
                <AdminTh>{t(locale, `${K}.colPerson`)}</AdminTh>
                <AdminTh className={WIDE_COL}>{t(locale, `${K}.colRole`)}</AdminTh>
                <AdminTh className={WIDE_COL}>{t(locale, `${K}.colUnit`)}</AdminTh>
                <AdminTh align="right">{t(locale, `${K}.colBalance`)}</AdminTh>
                <AdminTh>{t(locale, `${K}.colPending`)}</AdminTh>
                <AdminActionsTh className={ACTIONS_COL}>{t(locale, `${K}.colActions`)}</AdminActionsTh>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.candidateId} className="border-b border-ink/8 last:border-b-0">
                  <td className="max-w-[13rem] px-4 py-2.5 align-middle sm:max-w-[18rem]">
                    <PersonButton onClick={() => onOpen(row.candidateId)}>
                      <PersonCell name={row.candidateName} email={row.candidateEmail} meta={personMeta(row, locale)} />
                    </PersonButton>
                  </td>
                  <td className={cn(WIDE_COL, 'px-4 py-2.5 align-middle text-ink-muted')}>{row.jobRoleName || '·'}</td>
                  <td className={cn(WIDE_COL, 'px-4 py-2.5 align-middle text-ink-muted')}>{row.orgUnitPath || t(locale, 'panel.orgUnits.none')}</td>
                  <td className="px-4 py-2.5 text-right align-middle">
                    <StatusToneChip tone={row.balanceMinutes < 0 ? 'danger' : row.balanceMinutes > 0 ? 'success' : 'neutral'}>
                      <span className="font-mono tabular-nums">{formatMinutesClock(row.balanceMinutes)}</span>
                    </StatusToneChip>
                  </td>
                  <td className="px-4 py-2.5 align-middle">
                    {row.pendingCount > 0 ? (
                      <StatusToneChip tone="warning">
                        {t(locale, 'panel.hourBank.pendingChip', { n: row.pendingCount })}
                      </StatusToneChip>
                    ) : (
                      <span className={S.faint}>{t(locale, `${K}.noPending`)}</span>
                    )}
                  </td>
                  <td className={cn(ACTIONS_COL, 'px-4 py-2.5 text-right align-middle')}>
                    <AdminActionsCell>
                      <AdminIconButton
                        icon="clock"
                        label={t(locale, `${K}.openMirror`, { name: row.candidateName })}
                        onClick={() => onOpen(row.candidateId)}
                      />
                    </AdminActionsCell>
                  </td>
                </tr>
              ))}
            </tbody>
          </AdminTableShell>
          <AdminListPager
            locale={locale}
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            loading={loading}
            onPageChange={setPage}
            pageSizeOptions={[PAGE_SIZE]}
          />
        </>
      )}
    </div>
  );
}

const VIEWS = ['control', 'requests', 'bank', 'holidays', 'closing'];

/**
 * DP › Ponto: manager workspace with Controle de ponto (people → mirror),
 * Solicitações (collaborator requests), Banco de horas (balances + approvals),
 * Feriados (company / unit calendar) and Fechamento (period closures).
 */
export function TimeClockWorkspace({ locale = 'pt-BR', companyId, navigateDashboard, initialView = '', onViewChange, onRequestsChanged }) {
  const [view, setViewState] = useState(() => (VIEWS.includes(initialView) ? initialView : 'control'));
  const setView = (id) => {
    setViewState(id);
    onViewChange?.(id);
  };
  const [personId, setPersonId] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const bump = useCallback(() => setReloadKey((n) => n + 1), []);

  if (!companyId) return null;

  const openPerson = (id) => {
    setPersonId(id);
    setView('control');
  };

  return (
    <div className="flex flex-col gap-4">
      <SegmentedControl
        aria-label={t(locale, `${K}.viewsAria`)}
        value={view}
        onChange={(id) => {
          setView(id);
          if (id !== 'control') setPersonId(null);
        }}
        options={[
          { id: 'control', label: t(locale, `${K}.viewControl`) },
          { id: 'requests', label: t(locale, `${K}.viewRequests`) },
          { id: 'bank', label: t(locale, `${K}.viewBank`) },
          { id: 'holidays', label: t(locale, `${K}.viewHolidays`) },
          { id: 'closing', label: t(locale, `${K}.viewClosing`) },
        ]}
        className="self-start"
      />

      {view === 'control' && personId ? (
        <TimeClockMirror
          key={personId}
          locale={locale}
          companyId={companyId}
          candidateId={personId}
          onBack={() => setPersonId(null)}
          onChanged={bump}
        />
      ) : null}

      {view === 'control' && !personId ? (
        <>
          <PeopleList locale={locale} companyId={companyId} onOpen={openPerson} reloadKey={reloadKey} />
          <TimeClockAdminBlock
            locale={locale}
            companyId={companyId}
            navigateDashboard={navigateDashboard}
            title={t(locale, `${K}.dayViewTitle`)}
          />
        </>
      ) : null}

      {view === 'bank' ? (
        <>
          <BankBalances locale={locale} companyId={companyId} onOpen={openPerson} reloadKey={reloadKey} />
          <HourBankAdminBlock
            locale={locale}
            companyId={companyId}
            navigateDashboard={navigateDashboard}
            showBalances={false}
            title={t(locale, `${K}.bankEntriesTitle`)}
            reloadKey={reloadKey}
            onChanged={bump}
          />
        </>
      ) : null}

      {view === 'requests' ? (
        <TimeClockRequestsBlock
          locale={locale}
          companyId={companyId}
          onChanged={() => {
            bump();
            onRequestsChanged?.();
          }}
        />
      ) : null}

      {view === 'holidays' ? <TimeClockHolidaysBlock locale={locale} companyId={companyId} onChanged={bump} /> : null}

      {view === 'closing' ? <TimeClockClosuresBlock locale={locale} companyId={companyId} /> : null}
    </div>
  );
}
