'use client';

import { useListUrlState } from '../hooks/useListUrlState';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { cn } from '../../../lib/cn';
import { t, localeHtmlLang } from '../../../lib/i18n';
import { ERR } from '../../../lib/api-error-codes';
import { motivatorDimensionLabel } from '../../../lib/ae/motivators-dimensions';
import { C } from '../../../lib/theme';
import { Bar, PanelSubNav, S, SortableTh, AdminListPager, AdminListSearch, AdminTableShell, AdminActionsCell, AdminActionsTh, AdminIconButton, AdminPageHeader, AdminCreateButton, AdminViewButton, AdminDeleteButton, clientSortNextDir } from '../dashboard-shared';
import { PAGE_SIZE_OPTIONS } from '../../../lib/assessment/assessment-filters';
import { SystemNoticeModal } from '../SystemNoticeModal';
import { useAppFeedback } from '../../_components/AppFeedback';
import { AppLoading, ContentEnter } from '../../_components/AppLoading';
import { CopyableLink } from '../../_components/CopyableLink';
import { formatDisplayDate } from '../../../lib/format-display-date.js';
import { StatusToneChip } from '../../_components/StatusToneChip';
import { InlineCallout } from '../../_components/InlineCallout';
import { MotivatorsRadarChart } from '../../_components/MotivatorsRadarChartLazy';
import { CollapsibleBlock } from '../../_components/CollapsibleBlock';
import { AdminListFilters, AdminListFilterSelect } from '../../_components/AdminListFilters';
import { EmptyState } from '../../_components/EmptyState';

function dateLocale(locale) {
  return localeHtmlLang(locale);
}

function MotivatorsDimensionBars({ ranking }) {
  return (ranking || []).map((dim) => (
    <div key={dim.key} className="mb-2 flex items-center gap-2.5 last:mb-0">
      <span
        className="w-[7.5rem] shrink-0 truncate text-2xs"
        style={{ color: dim.color }}
        title={dim.label}
      >
        {dim.label}
      </span>
      <div className="min-w-0 flex-1">
        <Bar value={dim.score} max={100} color={dim.color} h={6} />
      </div>
      <span className="w-7 shrink-0 text-right font-mono text-2xs text-ink-muted">
        {dim.score}
      </span>
    </div>
  ));
}

function getViews(locale) {
  return [
    { id: 'dashboard', label: t(locale, 'panel.motivatorsAdmin.tabs.dashboard') },
    { id: 'invites', label: t(locale, 'panel.motivatorsAdmin.tabs.invites') },
    { id: 'results', label: t(locale, 'panel.motivatorsAdmin.tabs.results') },
  ];
}

function inviteStatusLabel(locale, status) {
  const s = String(status || '').toLowerCase();
  if (s === 'opened') return t(locale, 'panel.motivatorsAdmin.invites.statusOpened');
  if (s === 'completed') return t(locale, 'panel.motivatorsAdmin.invites.statusCompleted');
  if (s === 'cancelled') return t(locale, 'panel.motivatorsAdmin.invites.statusCancelled');
  if (s === 'expired') return t(locale, 'panel.motivatorsAdmin.invites.statusExpired');
  if (s === 'sent') return t(locale, 'panel.motivatorsAdmin.invites.statusSent');
  return status;
}

function inviteStatusTone(status) {
  if (status === 'opened') return 'info';
  if (status === 'completed') return 'success';
  if (status === 'cancelled' || status === 'expired') return 'danger';
  return 'neutral';
}

function statusBadge(locale, status) {
  return (
    <StatusToneChip tone={inviteStatusTone(status)} bordered={false}>
      {inviteStatusLabel(locale, status)}
    </StatusToneChip>
  );
}

function InviteForm({ locale, isAdmin, companies, companyId, onSent, onActionsReady }) {
  const { promptForm, confirm, toast } = useAppFeedback();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const defaultCompanyId = (() => {
    if (companyId && companyId !== 'all') return String(companyId);
    if (isAdmin && companies.length === 1) return String(companies[0].id);
    return '';
  })();

  const openInvite = async () => {
    setErr('');
    setMsg('');
    const fields = [
      {
        key: 'name',
        label: t(locale, 'panel.motivatorsAdmin.invite.namePh'),
        placeholder: t(locale, 'panel.motivatorsAdmin.invite.namePh'),
        defaultValue: '',
      },
      {
        key: 'email',
        type: 'email',
        label: t(locale, 'panel.motivatorsAdmin.invite.emailPh'),
        placeholder: t(locale, 'panel.motivatorsAdmin.invite.emailPh'),
        help: t(locale, 'panel.motivatorsAdmin.invite.newPersonHelp'),
        defaultValue: '',
      },
    ];
    if (isAdmin) {
      fields.unshift({
        key: 'companyId',
        type: 'select',
        label: t(locale, 'panel.motivatorsAdmin.invite.companyPh'),
        options: [
          { value: '', label: t(locale, 'panel.motivatorsAdmin.invite.companyPh') },
          ...companies.map((c) => ({ value: String(c.id), label: c.name })),
        ],
        defaultValue: defaultCompanyId,
      });
    }

    const values = await promptForm({
      title: t(locale, 'panel.motivatorsAdmin.invite.newInvite'),
      confirmLabel: t(locale, 'panel.motivatorsAdmin.invite.send'),
      fields,
    });
    if (!values) return;

    const name = String(values.name || '').trim();
    const email = String(values.email || '').trim().toLowerCase();
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    const company = isAdmin ? String(values.companyId || '') : '';
    const companyOk = !isAdmin || (company !== '' && Number.isFinite(Number(company)));

    if (!name) {
      setErr(t(locale, 'panel.motivatorsAdmin.invite.needName'));
      return;
    }
    if (!emailOk) {
      setErr(t(locale, 'panel.motivatorsAdmin.invite.needEmail'));
      return;
    }
    if (isAdmin && !companyOk) {
      setErr(t(locale, 'panel.motivatorsAdmin.invite.needCompany'));
      return;
    }

    setBusy(true);
    try {
      const body = { candidateName: name, candidateEmail: email };
      if (isAdmin) body.companyId = Number(company);
      let res = await fetch('/api/admin/ae/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      let data = await res.json().catch(() => ({}));
      if (res.status === 409 && data.errorCode === ERR.POSSIBLE_DUPLICATE_PERSON) {
        const differentPerson = await confirm({
          message: t(locale, 'panel.motivatorsAdmin.invite.sameNameConfirm'),
        });
        if (!differentPerson) {
          setErr(data.error || t(locale, 'panel.motivatorsAdmin.invite.sendError'));
          return;
        }
        res = await fetch('/api/admin/ae/invites', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...body, confirmedDifferentPerson: true }),
        });
        data = await res.json().catch(() => ({}));
      }
      if (!res.ok) throw new Error(data.error || t(locale, 'panel.motivatorsAdmin.invite.sendError'));
      setMsg(t(locale, 'panel.motivatorsAdmin.invite.sendOk', { email: data.sentTo }));
      onSent?.();
      setTimeout(() => setMsg(''), 8000);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const openBatchInvite = async () => {
    setErr('');
    setMsg('');

    let targetCompanyId = !isAdmin ? null : defaultCompanyId;
    if (isAdmin && !targetCompanyId) {
      const companyPick = await promptForm({
        title: t(locale, 'panel.motivatorsAdmin.invite.batchTitle'),
        confirmLabel: t(locale, 'panel.motivatorsAdmin.invite.batchContinue'),
        fields: [
          {
            key: 'companyId',
            type: 'select',
            label: t(locale, 'panel.motivatorsAdmin.invite.companyPh'),
            options: [
              { value: '', label: t(locale, 'panel.motivatorsAdmin.invite.companyPh') },
              ...companies.map((c) => ({ value: String(c.id), label: c.name })),
            ],
            defaultValue: '',
          },
        ],
      });
      if (!companyPick) return;
      targetCompanyId = String(companyPick.companyId || '');
      if (!targetCompanyId || !Number.isFinite(Number(targetCompanyId))) {
        setErr(t(locale, 'panel.motivatorsAdmin.invite.needCompany'));
        return;
      }
    }

    setBusy(true);
    try {
      const q = new URLSearchParams();
      if (isAdmin && targetCompanyId) q.set('companyId', String(targetCompanyId));
      const res = await fetch(`/api/admin/ae/invites/batch?${q}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || t(locale, 'panel.motivatorsAdmin.invite.batchLoadError'));

      const eligible = Array.isArray(data.eligible) ? data.eligible : [];
      const cap = Number(data.cap) || 25;
      if (eligible.length === 0) {
        setErr(t(locale, 'panel.motivatorsAdmin.invite.batchEmpty', {
          total: data.total || 0,
        }));
        return;
      }

      const values = await promptForm({
        title: t(locale, 'panel.motivatorsAdmin.invite.batchTitle'),
        confirmLabel: t(locale, 'panel.motivatorsAdmin.invite.batchSend'),
        fields: [
          {
            key: 'people',
            type: 'checkboxGroup',
            label: t(locale, 'panel.motivatorsAdmin.invite.batchPickLabel', {
              n: eligible.length,
              cap,
              skipped: Math.max(0, (data.total || 0) - eligible.length),
            }),
            options: eligible.map((p) => ({
              value: String(p.candidateId),
              label: `${p.name || '—'} · ${p.email}`,
            })),
            defaultValue: [],
          },
        ],
      });
      if (!values) return;

      const selected = (Array.isArray(values.people) ? values.people : [])
        .map((x) => Number(x))
        .filter((n) => Number.isFinite(n));
      if (selected.length === 0) {
        setErr(t(locale, 'panel.motivatorsAdmin.invite.batchNeedPeople'));
        return;
      }

      const body = { candidateIds: selected.slice(0, cap) };
      if (isAdmin && targetCompanyId) body.companyId = Number(targetCompanyId);

      const sendRes = await fetch('/api/admin/ae/invites/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const sendData = await sendRes.json().catch(() => ({}));
      if (!sendRes.ok) {
        throw new Error(sendData.error || t(locale, 'panel.motivatorsAdmin.invite.batchSendError'));
      }

      const summary = t(locale, 'panel.motivatorsAdmin.invite.batchSendOk', {
        sent: sendData.sentCount || 0,
        skipped: sendData.skippedCount || 0,
        failed: sendData.failedCount || 0,
      });
      setMsg(summary);
      toast(summary, sendData.failedCount > 0 ? 'error' : 'ok');
      onSent?.();
      setTimeout(() => setMsg(''), 10000);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const openInviteRef = useRef(openInvite);
  openInviteRef.current = openInvite;
  const openBatchInviteRef = useRef(openBatchInvite);
  openBatchInviteRef.current = openBatchInvite;

  useEffect(() => {
    onActionsReady?.({
      openInvite: (...args) => openInviteRef.current(...args),
      openBatchInvite: (...args) => openBatchInviteRef.current(...args),
      busy,
    });
  }, [onActionsReady, busy]);

  if (!err && !msg) return null;

  return (
    <div className={cn(S.card, 'mb-5')}>
      {err ? <p className="m-0 text-xs text-danger">{err}</p> : null}
      {msg ? <p className={cn('m-0 text-xs text-success', err && 'mt-2')}>{msg}</p> : null}
    </div>
  );
}

function InvitesList({ locale, refreshKey, isAdmin, companyFilter, onCreateInvite }) {
  const { confirm } = useAppFeedback();
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('all');
  const [page, setPage] = useListUrlState('motivatorsInvites', 'page', 1);
  const [pageSize, setPageSize] = useListUrlState('motivatorsInvites', 'pageSize', 20);
  const [sort, setSort] = useListUrlState('motivatorsInvites', 'sort', 'createdAt');
  const [sortDir, setSortDir] = useListUrlState('motivatorsInvites', 'sortDir', 'desc');
  const [notice, setNotice] = useState(null);
  const appUrl =
    (typeof window !== 'undefined' && window.location?.origin) ? window.location.origin : '';

  const load = useCallback(async () => {
    setLoading(true);
    const p = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      sort,
      sortDir,
    });
    if (status !== 'all') p.set('status', status);
    if (isAdmin && companyFilter && companyFilter !== 'all') p.set('company', companyFilter);
    const res = await fetch(`/api/admin/ae/invites?${p}`);
    const data = await res.json().catch(() => ({}));
    setItems(data.items || []);
    setTotal(Number(data.total) || 0);
    setLoading(false);
  }, [status, isAdmin, companyFilter, refreshKey, page, pageSize, sort, sortDir]);

  useEffect(() => { load(); }, [load]);

  const toggleSort = (columnKey) => {
    const nextDir = clientSortNextDir(columnKey, sort, sortDir);
    setSort(columnKey);
    setSortDir(nextDir);
    setPage(1);
  };

  const cancel = async (id) => {
    const ok = await confirm({
      message: t(locale, 'panel.motivatorsAdmin.invites.cancelConfirm'),
      danger: true,
    });
    if (!ok) return;
    await fetch(`/api/admin/ae/invites/${id}`, { method: 'DELETE' });
    load();
  };

  const remind = async (id) => {
    try {
      const res = await fetch(`/api/admin/ae/invites/${id}/remind`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || t(locale, 'panel.common.error'));
      setNotice({
        tone: 'ok',
        title: t(locale, 'panel.common.successTitle'),
        message: t(locale, 'panel.motivatorsAdmin.invites.reminderSent'),
      });
      load();
    } catch (e) {
      setNotice({
        tone: 'error',
        title: t(locale, 'panel.common.error'),
        message: e?.message || t(locale, 'panel.common.error'),
      });
    }
  };

  return (
    <div className={S.card}>
      <SystemNoticeModal
        open={Boolean(notice)}
        locale={locale}
        tone={notice?.tone || 'info'}
        title={notice?.title}
        message={notice?.message || ''}
        onClose={() => setNotice(null)}
      />
      <span className={S.label}>{t(locale, 'panel.motivatorsAdmin.invites.title')}</span>
      <AdminListFilters
        aria-label={t(locale, 'panel.motivatorsAdmin.invites.title')}
        locale={locale}
        onClear={() => {
          setStatus('all');
          setPage(1);
        }}
        clearEnabled={status !== 'all'}
      >
        <AdminListFilterSelect
          label={t(locale, 'panel.motivatorsAdmin.invites.colStatus')}
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
        >
          <option value="all">{t(locale, 'panel.motivatorsAdmin.invites.allStatuses')}</option>
          <option value="sent">{t(locale, 'panel.motivatorsAdmin.invites.statusSent')}</option>
          <option value="opened">{t(locale, 'panel.motivatorsAdmin.invites.statusOpened')}</option>
          <option value="completed">{t(locale, 'panel.motivatorsAdmin.invites.statusCompleted')}</option>
          <option value="cancelled">{t(locale, 'panel.motivatorsAdmin.invites.statusCancelled')}</option>
        </AdminListFilterSelect>
      </AdminListFilters>
      {loading ? (
        <AppLoading variant="panel" label={t(locale, 'panel.motivatorsAdmin.invites.loading')} />
      ) : items.length === 0 ? (
        <ContentEnter animKey={`invites-empty|${status}`}>
          <EmptyState
            message={t(locale, 'panel.motivatorsAdmin.invites.empty')}
            actionLabel={
              typeof onCreateInvite === 'function'
                ? t(locale, 'panel.motivatorsAdmin.invite.openInviteBtn')
                : undefined
            }
            onAction={typeof onCreateInvite === 'function' ? onCreateInvite : undefined}
          />
        </ContentEnter>
      ) : (
        <>
          <AdminTableShell locale={locale} minWidth="640px" animKey={`${status}|${page}|${pageSize}`}>
          <thead>
            <tr className="bg-ink/[0.02]">
              <SortableTh columnKey="candidateName" sortKey={sort} dir={sortDir} onSort={toggleSort}>
                {t(locale, 'panel.motivatorsAdmin.invites.colEmployee')}
              </SortableTh>
              <SortableTh columnKey="status" sortKey={sort} dir={sortDir} onSort={toggleSort}>
                {t(locale, 'panel.motivatorsAdmin.invites.colStatus')}
              </SortableTh>
              <SortableTh columnKey="sentAt" sortKey={sort} dir={sortDir} onSort={toggleSort}>
                {t(locale, 'panel.motivatorsAdmin.invites.colSent')}
              </SortableTh>
              <SortableTh columnKey="expiresAt" sortKey={sort} dir={sortDir} onSort={toggleSort}>
                {t(locale, 'panel.motivatorsAdmin.invites.colExpires')}
              </SortableTh>
              <AdminActionsTh />
            </tr>
          </thead>
          <tbody>
            {items.map((row) => {
              const inviteUrl =
                row.token && appUrl ? `${appUrl}/assessment/motivators/${row.token}` : '';
              const canShareLink = ['sent', 'opened'].includes(row.status) && Boolean(inviteUrl);
              return (
              <tr key={row.id} className="border-t border-ink/12">
                <td className="px-4 py-2.5">
                  <div>{row.candidateName}</div>
                  <div className="text-2xs text-ink-muted">{row.candidateEmail}</div>
                  {canShareLink ? (
                    <div className="mt-1">
                      <CopyableLink
                        url={inviteUrl}
                        locale={locale}
                        compact
                        iconOnly
                        label={t(locale, 'panel.motivatorsAdmin.invites.assessmentLink')}
                      />
                    </div>
                  ) : null}
                </td>
                <td className="px-4 py-2.5">{statusBadge(locale, row.status)}</td>
                <td className="px-4 py-2.5 text-ink-muted">
                  {formatDisplayDate(row.sentAt, locale, { fallback: t(locale, 'panel.common.notApplicable') })}
                </td>
                <td className="px-4 py-2.5 text-ink-muted">
                  {formatDisplayDate(row.expiresAt, locale, { fallback: t(locale, 'panel.common.notApplicable') })}
                </td>
                <td className="px-4 py-2.5 text-right">
                  {['sent', 'opened'].includes(row.status) ? (
                    <AdminActionsCell>
                      <AdminIconButton
                        label={t(locale, 'panel.motivatorsAdmin.invites.resend')}
                        icon="refresh"
                        tint="brand"
                        onClick={() => remind(row.id)}
                      />
                      <AdminDeleteButton
                        label={t(locale, 'panel.motivatorsAdmin.invites.cancel')}
                        onClick={() => cancel(row.id)}
                      />
                    </AdminActionsCell>
                  ) : null}
                </td>
              </tr>
              );
            })}
          </tbody>
          </AdminTableShell>
          <AdminListPager
            locale={locale}
            page={page}
            pageSize={pageSize}
            total={total}
            loading={loading}
            pageSizeOptions={PAGE_SIZE_OPTIONS}
            onPageChange={setPage}
            onPageSizeChange={(ps) => {
              setPageSize(ps);
              setPage(1);
            }}
          />
        </>
      )}
    </div>
  );
}

function ResultsList({ locale, isAdmin, companyFilter, focusAttemptId = null }) {
  const { confirm } = useAppFeedback();
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useListUrlState('motivatorsResults', 'page', 1);
  const [pageSize, setPageSize] = useListUrlState('motivatorsResults', 'pageSize', 20);
  const [sort, setSort] = useListUrlState('motivatorsResults', 'sort', 'completedAt');
  const [sortDir, setSortDir] = useListUrlState('motivatorsResults', 'sortDir', 'desc');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [searchDraft, setSearchDraft] = useState('');
  const [q, setQ] = useListUrlState('motivatorsResults', 'q', '');
  const [loadError, setLoadError] = useState('');
  const [detailError, setDetailError] = useState('');
  const loadSeqRef = useRef(0);
  const focusId = Number(focusAttemptId) || null;

  useEffect(() => {
    const next = searchDraft.trim();
    if (next === q) return undefined;
    const timer = window.setTimeout(() => {
      setQ(next);
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchDraft, q]);

  const load = useCallback(() => {
    loadSeqRef.current += 1;
    const seq = loadSeqRef.current;
    setLoading(true);
    setLoadError('');
    const p = new URLSearchParams({
      status: 'completed',
      page: String(page),
      pageSize: String(pageSize),
      sort,
      sortDir,
    });
    if (q) p.set('q', q);
    if (isAdmin && companyFilter && companyFilter !== 'all') p.set('company', companyFilter);
    fetch(`/api/admin/ae/attempts?${p}`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || '');
        return d;
      })
      .then((d) => {
        if (seq !== loadSeqRef.current) return;
        const nextItems = d.items || [];
        setItems(nextItems);
        setTotal(Number(d.total) || 0);
        setSelected((cur) => {
          if (cur && (cur === focusId || nextItems.some((row) => row.id === cur))) return cur;
          return nextItems[0]?.id ?? null;
        });
      })
      .catch((e) => {
        if (seq !== loadSeqRef.current) return;
        setLoadError((e instanceof TypeError ? '' : e?.message) || t(locale, 'panel.motivatorsAdmin.results.loadError'));
      })
      .finally(() => {
        if (seq === loadSeqRef.current) setLoading(false);
      });
  }, [isAdmin, companyFilter, page, pageSize, sort, sortDir, q, focusId, locale]);

  useEffect(() => { load(); }, [load]);

  const toggleSort = (columnKey) => {
    const nextDir = clientSortNextDir(columnKey, sort, sortDir);
    setSort(columnKey);
    setSortDir(nextDir);
    setPage(1);
  };

  useEffect(() => {
    if (!focusAttemptId) return;
    const id = Number(focusAttemptId);
    if (!Number.isFinite(id)) return;
    setSelected(id);
  }, [focusAttemptId]);

  const fetchDetail = useCallback(
    (id, isCancelled = () => false) => {
      setDetailError('');
      return fetch(`/api/admin/ae/attempts/${id}`)
        .then(async (r) => {
          const d = await r.json().catch(() => ({}));
          if (!r.ok || !d?.attempt) throw new Error(d.error || '');
          return d;
        })
        .then((d) => {
          if (!isCancelled()) setDetail(d);
        })
        .catch((e) => {
          if (isCancelled()) return;
          setDetail(null);
          setDetailError((e instanceof TypeError ? '' : e?.message) || t(locale, 'panel.motivatorsAdmin.results.loadError'));
        });
    },
    [locale]
  );

  useEffect(() => {
    if (!selected) { setDetail(null); setDetailError(''); return undefined; }
    let cancelled = false;
    fetchDetail(selected, () => cancelled);
    return () => { cancelled = true; };
  }, [selected, fetchDetail]);

  const reloadDetail = () => {
    if (selected) fetchDetail(selected);
  };

  const rescoreAttempt = async (id) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/ae/attempts/${id}`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || t(locale, 'panel.motivatorsAdmin.results.rescoreError'));
      reloadDetail();
      load();
    } catch (e) {
      setNotice({
        tone: 'error',
        title: t(locale, 'panel.common.error'),
        message: e.message || t(locale, 'panel.motivatorsAdmin.results.rescoreError'),
      });
    } finally {
      setBusy(false);
    }
  };

  const allScoresZero = detail?.attempt?.ranking?.length
    ? detail.attempt.ranking.every((d) => !d.score)
    : false;

  const removeAttempt = async (id) => {
    const ok = await confirm({
      message: t(locale, 'panel.motivatorsAdmin.results.deleteConfirm'),
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/ae/attempts/${id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || t(locale, 'panel.motivatorsAdmin.results.deleteError'));
      if (selected === id) {
        setSelected(null);
        setDetail(null);
      }
      load();
    } catch (e) {
      setNotice({
        tone: 'error',
        title: t(locale, 'panel.common.error'),
        message: e.message || t(locale, 'panel.motivatorsAdmin.results.deleteError'),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cn('grid items-start gap-5', selected || detail ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1')}>
      <SystemNoticeModal
        open={Boolean(notice)}
        locale={locale}
        tone={notice?.tone || 'info'}
        title={notice?.title}
        message={notice?.message || ''}
        onClose={() => setNotice(null)}
      />
      <div className={S.card}>
        <span className={S.label}>{t(locale, 'panel.motivatorsAdmin.results.title')}</span>
        <AdminListFilters
          aria-label={t(locale, 'panel.motivatorsAdmin.results.title')}
          locale={locale}
          className="mt-2"
          onClear={() => setSearchDraft('')}
          clearEnabled={searchDraft.trim().length > 0}
        >
          <AdminListSearch
            locale={locale}
            value={searchDraft}
            onChange={setSearchDraft}
            onSubmit={(v) => {
              setQ(String(v || '').trim());
              setPage(1);
            }}
            placeholder={t(locale, 'panel.motivatorsAdmin.results.searchPh')}
          />
        </AdminListFilters>
        {loading ? <AppLoading variant="panel" label={t(locale, 'panel.common.loading')} /> : null}
        {!loading && loadError ? (
          <EmptyState message={loadError} actionLabel={t(locale, 'panel.common.retry')} onAction={load} />
        ) : !loading && items.length === 0 ? (
          <EmptyState
            message={
              q
                ? t(locale, 'panel.motivatorsAdmin.results.emptySearch', { q })
                : t(locale, 'panel.motivatorsAdmin.results.empty')
            }
          />
        ) : (
        <AdminTableShell locale={locale} minWidth="480px" animKey={`ae-results-${q}-${page}`}>
          <thead>
            <tr className="bg-ink/[0.02]">
              <SortableTh columnKey="candidateName" sortKey={sort} dir={sortDir} onSort={toggleSort}>
                {t(locale, 'panel.motivatorsAdmin.results.colEmployee')}
              </SortableTh>
              <SortableTh columnKey="completedAt" sortKey={sort} dir={sortDir} onSort={toggleSort}>
                {t(locale, 'panel.motivatorsAdmin.results.colDate')}
              </SortableTh>
              <AdminActionsTh />
            </tr>
          </thead>
            <tbody>
              {items.map((row) => (
                <tr
                  key={row.id}
                  aria-current={row.id === selected ? 'true' : undefined}
                  onClick={() => setSelected(row.id)}
                  className={cn(
                    'cursor-pointer border-t border-ink/12 transition-colors',
                    row.id === selected ? 'bg-ink/[0.05]' : 'hover:bg-ink/[0.025]'
                  )}
                >
                  <td className={cn('border-l-[3px] px-4 py-2.5', row.id === selected ? 'border-l-brand-500' : 'border-l-transparent')}>
                    <div className={cn(row.id === selected && 'font-semibold')}>{row.candidateName}</div>
                    <div className="text-2xs text-ink-muted">{row.areaLabel || t(locale, 'panel.common.notApplicable')}</div>
                  </td>
                  <td className="px-4 py-2.5 text-ink-muted">
                    {formatDisplayDate(row.completedAt, locale, { fallback: t(locale, 'panel.common.notApplicable') })}
                  </td>
                  <td className="px-4 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                    <AdminActionsCell>
                      <AdminViewButton
                        label={t(locale, 'panel.motivatorsAdmin.results.view')}
                        onClick={() => setSelected(row.id)}
                      />
                      <AdminDeleteButton
                        label={t(locale, 'panel.motivatorsAdmin.results.delete')}
                        onClick={() => removeAttempt(row.id)}
                        disabled={busy}
                      />
                    </AdminActionsCell>
                  </td>
                </tr>
              ))}
            </tbody>
        </AdminTableShell>
        )}
          <AdminListPager
            locale={locale}
            page={page}
            pageSize={pageSize}
            total={total}
            loading={loading}
            pageSizeOptions={PAGE_SIZE_OPTIONS}
            onPageChange={setPage}
            onPageSizeChange={(ps) => {
              setPageSize(ps);
              setPage(1);
            }}
          />
      </div>
      {selected && !detail?.attempt ? (
        <div className={S.card}>
          {detailError ? (
            <EmptyState message={detailError} actionLabel={t(locale, 'panel.common.retry')} onAction={reloadDetail} />
          ) : (
            <AppLoading variant="panel" locale={locale} label={t(locale, 'panel.common.loading')} />
          )}
        </div>
      ) : null}
      {detail?.attempt ? (
        <ContentEnter animKey={`ae-result-${detail.attempt.id}`}>
        <div className={S.card}>
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <span className={S.label}>{t(locale, 'panel.motivatorsAdmin.results.profileTitle')}</span>
              <div className="mt-1 text-lg text-ink">{detail.attempt.candidateName}</div>
              <div className="mt-1.5 text-xs leading-snug text-ink-muted">
                {detail.attempt.candidateEmail}
                {detail.attempt.areaLabel ? ` · ${detail.attempt.areaLabel}` : ''}
                {detail.attempt.companyName ? ` · ${detail.attempt.companyName}` : ''}
              </div>
              <div className="mt-1 font-mono text-2xs text-ink-faint">
                {t(locale, 'panel.motivatorsAdmin.results.completedAt', {
                  date: detail.attempt.completedAt
                    ? new Date(detail.attempt.completedAt).toLocaleString(dateLocale(locale))
                    : t(locale, 'panel.common.notApplicable'),
                })}
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              {allScoresZero ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => rescoreAttempt(detail.attempt.id)}
                  className={cn(
                    'rounded-lg border border-brand-500/25 bg-brand-500/10 px-2.5 py-1 text-2xs text-brand-500',
                    busy ? 'cursor-not-allowed' : 'cursor-pointer'
                  )}
                >
                  {t(locale, 'panel.motivatorsAdmin.results.rescore')}
                </button>
              ) : null}
              <button
                type="button"
                disabled={busy}
                onClick={() => removeAttempt(detail.attempt.id)}
                className={cn(
                  'rounded-lg border border-danger/25 bg-danger/10 px-2.5 py-1 text-2xs text-danger',
                  busy ? 'cursor-not-allowed' : 'cursor-pointer'
                )}
              >
                {t(locale, 'panel.motivatorsAdmin.results.deleteResult')}
              </button>
            </div>
          </div>

          {detail.rescore?.ok === false && detail.rescore.error ? (
            <div className="mb-3.5 rounded-control border border-danger/20 bg-danger/10 px-3 py-2.5 text-xs text-danger">
              <div>{detail.rescore.error}</div>
              {detail.rescore.diagnostics ? (
                <div className="mt-2 font-mono text-2xs leading-snug text-ink-muted">
                  {t(locale, 'panel.motivatorsAdmin.results.rescoreDiag', {
                    loaded: detail.rescore.diagnostics.questionsLoaded,
                    answers: detail.rescore.diagnostics.answersCount,
                    fc: detail.rescore.diagnostics.fcWithoutWeights,
                    likert: detail.rescore.diagnostics.likertWithoutWeights,
                  })}
                </div>
              ) : null}
            </div>
          ) : null}

          {detail.hrInsights?.topMotivators?.length > 0 ? (
            <InlineCallout tone="brand" className="mb-5 p-3.5">
              <div className="mb-2.5 font-mono text-2xs text-brand-500">{t(locale, 'panel.motivatorsAdmin.results.topMotivators')}</div>
              <div className="mb-2.5 flex flex-wrap gap-2">
                {detail.hrInsights.topMotivators.map((d) => (
                  <span
                    key={d.key}
                    className="rounded-full px-3 py-1.5 text-xs"
                    style={{ background: `${d.color || C.purple}18`, color: d.color || C.purple }}
                  >
                    {d.label} · {d.score}
                  </span>
                ))}
              </div>
              {detail.hrInsights.summaryNote ? (
                <p className="m-0 text-prose leading-relaxed text-ink-muted">{detail.hrInsights.summaryNote}</p>
              ) : null}
            </InlineCallout>
          ) : null}

          <p className="mb-4 text-sm leading-relaxed text-ink">{detail.attempt.profileSummary}</p>

          {detail.attempt.dimensionScores || (detail.attempt.ranking || []).length > 0 ? (
            <div className="mb-1 border-t border-ink/12 pt-4">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-mono text-2xs text-ink-muted">
                  {t(locale, 'panel.motivatorsAdmin.results.dimensionsSection')}
                </span>
                <span className="font-mono text-2xs text-ink-faint">
                  {t(locale, 'panel.motivatorsAdmin.results.radarHint')}
                </span>
              </div>
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 xl:items-start">
                <div className="min-w-0">
                  <div className="mb-1.5 font-mono text-2xs text-ink-faint">
                    {t(locale, 'panel.motivatorsAdmin.results.radarTitle')}
                  </div>
                  <MotivatorsRadarChart
                    locale={locale}
                    dimensionScores={detail.attempt.dimensionScores}
                    dimensions={detail.attempt.ranking}
                    showPeaks={false}
                    hideHeader
                    embedded
                    compact
                  />
                </div>
                <div className="min-w-0">
                  <div className="mb-1.5 hidden font-mono text-2xs text-ink-faint xl:block">
                    {t(locale, 'panel.motivatorsAdmin.results.allDimensions')}
                  </div>
                  <div className="hidden xl:block">
                    <MotivatorsDimensionBars ranking={detail.attempt.ranking} />
                  </div>
                  <div className="xl:hidden">
                    <CollapsibleBlock
                      locale={locale}
                      title={t(locale, 'panel.motivatorsAdmin.results.allDimensions')}
                      defaultOpen={false}
                      count={(detail.attempt.ranking || []).length || null}
                      variant="card"
                    >
                      <MotivatorsDimensionBars ranking={detail.attempt.ranking} />
                    </CollapsibleBlock>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {detail.hrInsights?.suggestedActions?.do?.length > 0 ? (
            <div className="mt-5 grid grid-cols-1 gap-4 border-t border-ink/12 pt-4 sm:grid-cols-2">
              <InlineCallout tone="success" className="p-3.5">
                <div className="mb-2.5 font-mono text-2xs text-success">{t(locale, 'panel.motivatorsAdmin.results.actionsDo')}</div>
                <ul className="m-0 list-none p-0 text-xs leading-relaxed text-ink-muted">
                  {detail.hrInsights.suggestedActions.do.map((item) => (
                    <li key={item.dimensionKey} className="mb-2.5">
                      <span className="font-mono text-2xs text-success">{item.dimension}</span>
                      <div className="mt-0.5">{item.text}</div>
                    </li>
                  ))}
                </ul>
              </InlineCallout>
              <InlineCallout tone="danger" className="p-3.5">
                <div className="mb-2.5 font-mono text-2xs text-danger">{t(locale, 'panel.motivatorsAdmin.results.actionsAvoid')}</div>
                <ul className="m-0 list-none p-0 text-xs leading-relaxed text-ink-muted">
                  {detail.hrInsights.suggestedActions.avoid.map((item) => (
                    <li key={item.dimensionKey} className="mb-2.5">
                      <span className="font-mono text-2xs text-danger">{item.dimension}</span>
                      <div className="mt-0.5">{item.text}</div>
                    </li>
                  ))}
                </ul>
              </InlineCallout>
            </div>
          ) : null}

          {detail.history?.length > 1 ? (
            <div className="mt-5 border-t border-ink/12 pt-4">
              <div className="mb-2 font-mono text-2xs text-ink-muted">{t(locale, 'panel.motivatorsAdmin.results.evolution', { count: detail.history.length })}</div>
              {detail.history.map((h) => (
                <div key={h.id} className="mb-1 text-xs text-ink-muted">
                  {t(locale, 'panel.motivatorsAdmin.results.historyTop', {
                    date: h.completedAt
                      ? new Date(h.completedAt).toLocaleDateString(dateLocale(locale))
                      : t(locale, 'panel.common.notApplicable'),
                    top: Array.isArray(h.ranking) ? h.ranking.slice(0, 2).join(', ') : t(locale, 'panel.common.notApplicable'),
                  })}
                </div>
              ))}
            </div>
          ) : null}
        </div>
        </ContentEnter>
      ) : null}
    </div>
  );
}

function AnalyticsPanel({ locale, isAdmin, companyFilter }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    const p = new URLSearchParams();
    if (isAdmin && companyFilter && companyFilter !== 'all') p.set('company', companyFilter);
    fetch(`/api/admin/ae/analytics?${p}`)
      .then((r) => r.json())
      .then(setData);
  }, [isAdmin, companyFilter]);

  if (!data) {
    return (
      <div className={S.card}>
        <AppLoading variant="panel" label={t(locale, 'panel.motivatorsAdmin.analytics.loading')} />
      </div>
    );
  }

  const maxAvg = Math.max(...(data.distribution || []).map((d) => d.average), 1);

  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-[repeat(auto-fit,minmax(280px,1fr))]">
      <div className={S.card}>
        <span className={S.label}>{t(locale, 'panel.motivatorsAdmin.analytics.avgDistribution')}</span>
        <p className="mb-4 text-xs text-ink-muted">{t(locale, 'panel.motivatorsAdmin.analytics.completedCount', { count: data.totalAttempts })}</p>
        {(data.distribution || []).slice(0, 8).map((d) => (
          <div key={d.key} className="mb-2.5 flex items-center gap-2.5">
            <span className="w-[100px] font-mono text-2xs">{motivatorDimensionLabel(d.key, locale)}</span>
            <div className="flex-1"><Bar value={d.average} max={maxAvg} color={C.purple} h={6} /></div>
            <span className="text-2xs text-ink-muted">{d.average}</span>
          </div>
        ))}
      </div>
      <div className={S.card}>
        <span className={S.label}>{t(locale, 'panel.motivatorsAdmin.analytics.topMotivators')}</span>
        {(data.topMotivators || []).slice(0, 6).map((row) => (
          <div key={row.key} className="mb-2.5 flex justify-between text-prose">
            <span>{motivatorDimensionLabel(row.key, locale)}</span>
            <span className="text-ink-muted">{row.pct}% ({row.count})</span>
          </div>
        ))}
      </div>
      <div className={S.card}>
        <span className={S.label}>{t(locale, 'panel.motivatorsAdmin.analytics.invitesByStatus')}</span>
        {(data.inviteStats || []).map((s) => (
          <div key={s.status} className="mb-2 flex justify-between text-prose">
            <span>{statusBadge(locale, s.status)}</span>
            <span>{s.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function MotivatorsAdminTab({ isAdmin, companies = [], locale }) {
  const searchParams = useSearchParams();
  const requestedView = searchParams.get('motivatorsView');
  const view = getViews(locale).some((v) => v.id === requestedView)
    ? requestedView
    : searchParams.get('attempt') ? 'results' : 'dashboard';
  const companyFilter = searchParams.get('company') || 'all';
  const focusAttemptId = searchParams.get('attempt') || null;
  const [refreshKey, setRefreshKey] = useState(0);
  const [moduleStatus, setModuleStatus] = useState(null);
  const [setupBusy, setSetupBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [inviteActions, setInviteActions] = useState(null);

  const handleInviteActionsReady = useCallback((actions) => {
    setInviteActions(actions);
  }, []);

  useEffect(() => {
    fetch('/api/admin/ae/status')
      .then((r) => r.json())
      .then(setModuleStatus)
      .catch(() => {});
  }, [refreshKey]);

  useEffect(() => {
    if (view !== 'invites') setInviteActions(null);
  }, [view]);

  const runSetup = async () => {
    setSetupBusy(true);
    try {
      const res = await fetch('/api/admin/ae/setup', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || t(locale, 'panel.motivatorsAdmin.setup.initFailed'));
      setRefreshKey((k) => k + 1);
      setNotice({
        tone: 'ok',
        title: t(locale, 'panel.common.successTitle'),
        message: t(locale, 'panel.motivatorsAdmin.setup.initOk'),
      });
    } catch (e) {
      setNotice({
        tone: 'error',
        title: t(locale, 'panel.common.error'),
        message: e.message || t(locale, 'panel.common.error'),
      });
    } finally {
      setSetupBusy(false);
    }
  };

  const setView = (id) => {
    const p = new URLSearchParams(searchParams.toString());
    p.set('tab', 'motivators');
    p.set('motivatorsView', id);
    const url = new URL(window.location.href);
    url.search = p.toString();
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  };

  const visibleViews = getViews(locale);
  const inviteBusy = Boolean(inviteActions?.busy);

  return (
    <div>
      <SystemNoticeModal
        open={Boolean(notice)}
        locale={locale}
        tone={notice?.tone || 'info'}
        title={notice?.title}
        message={notice?.message || ''}
        onClose={() => setNotice(null)}
      />
      <AdminPageHeader
        title={t(locale, 'panel.motivatorsAdmin.title')}
        subtitle={t(locale, 'panel.motivatorsAdmin.intro')}
        actions={
          view === 'invites' ? (
            <>
              <button
                type="button"
                onClick={() => inviteActions?.openBatchInvite?.()}
                disabled={!inviteActions || inviteBusy}
                className={cn(S.btnBrandSoft, 'min-h-touch disabled:cursor-not-allowed disabled:opacity-50')}
              >
                {inviteBusy
                  ? t(locale, 'panel.motivatorsAdmin.invite.sending')
                  : t(locale, 'panel.motivatorsAdmin.invite.batchOpenBtn')}
              </button>
              <AdminCreateButton
                label={
                  inviteBusy
                    ? t(locale, 'panel.motivatorsAdmin.invite.sending')
                    : t(locale, 'panel.motivatorsAdmin.invite.openInviteBtn')
                }
                onClick={() => inviteActions?.openInvite?.()}
                disabled={!inviteActions || inviteBusy}
              />
            </>
          ) : null
        }
      />

      {moduleStatus && !moduleStatus.ready ? (
        <div className={cn(S.card, 'mb-5 border-danger/25 bg-danger/[0.03]')}>
          <span className={cn(S.label, 'text-danger')}>{t(locale, 'panel.motivatorsAdmin.setup.pendingTitle')}</span>
          <p className="mb-3 mt-0 text-prose leading-relaxed text-ink-muted">
            {moduleStatus.reason === 'schema_missing'
              ? t(locale, 'panel.motivatorsAdmin.setup.schemaMissing')
              : t(locale, 'panel.motivatorsAdmin.setup.notInitialized')}
          </p>
          {moduleStatus.reason !== 'schema_missing' ? (
            <button type="button" disabled={setupBusy} onClick={runSetup} className="cursor-pointer rounded-lg border-none bg-action px-4 py-2 text-action-ink disabled:cursor-not-allowed">
              {setupBusy ? t(locale, 'panel.motivatorsAdmin.setup.initializing') : t(locale, 'panel.motivatorsAdmin.setup.initializeNow')}
            </button>
          ) : null}
        </div>
      ) : null}

      <PanelSubNav
        ariaLabel={t(locale, 'panel.motivatorsAdmin.tabsAria')}
        active={view}
        onChange={setView}
        tabs={visibleViews.map((v) => ({ id: v.id, label: v.label }))}
      />

      <ContentEnter animKey={view}>
        {view === 'dashboard' ? <AnalyticsPanel locale={locale} isAdmin={isAdmin} companyFilter={companyFilter} /> : null}
        {view === 'invites' ? (
          <>
            <InviteForm
              locale={locale}
              isAdmin={isAdmin}
              companies={companies}
              companyId={companyFilter !== 'all' ? companyFilter : ''}
              onSent={() => setRefreshKey((k) => k + 1)}
              onActionsReady={handleInviteActionsReady}
            />
            <InvitesList
              locale={locale}
              refreshKey={refreshKey}
              isAdmin={isAdmin}
              companyFilter={companyFilter}
              onCreateInvite={() => inviteActions?.openInvite?.()}
            />
          </>
        ) : null}
        {view === 'results' ? (
          <ResultsList
            locale={locale}
            isAdmin={isAdmin}
            companyFilter={companyFilter}
            focusAttemptId={focusAttemptId}
          />
        ) : null}
      </ContentEnter>
    </div>
  );
}
