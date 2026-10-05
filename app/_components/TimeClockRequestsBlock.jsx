'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { t, localeHtmlLang } from '../../lib/i18n';
import { cn } from '../../lib/cn';
import {
  TIME_PUNCH_KIND,
  TIME_REQUEST_DECISION,
  TIME_REQUEST_KIND,
  TIME_REQUEST_PUNCH_ACTION,
  TIME_REQUEST_STATUS,
  TIME_REQUEST_STATUSES,
} from '../../lib/domain-status.js';
import { formatMinutesClock, hmInZone } from '../../lib/time-clock-format.js';
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
import { AdminListFilterSelect, AdminListFilters } from './AdminListFilters';
import { AdminRichFormDrawer } from './AdminRichFormDrawer';
import { AppLoading, ContentEnter } from './AppLoading';
import { useAppFeedback } from './AppFeedback';
import { EmptyState } from './EmptyState';
import { InlineCallout } from './InlineCallout';
import { StatMetricTile } from './StatMetricTile';
import { StatusToneChip } from './StatusToneChip';
import {
  KR,
  TimeRequestCard,
  TimeRequestStatusChip,
  excuseSummary,
  punchKindLabel,
  timeRequestKindLabel,
} from './TimeRequestParts';

const KM = 'panel.timeClockMgr';
const PAGE_SIZE = 20;
const WIDE_COL = 'hidden lg:table-cell';

function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

function dayLabel(iso, locale) {
  const d = new Date(`${iso}T12:00:00Z`);
  return d.toLocaleDateString(localeHtmlLang(locale), { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'UTC' });
}

function dateTimeOf(value, locale) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(localeHtmlLang(locale), { dateStyle: 'short', timeStyle: 'short' });
}

function requestSummary(item, locale) {
  if (item.kind === TIME_REQUEST_KIND.EXCUSE) return excuseSummary(locale, item);
  const adds = item.changes.filter((c) => c.action === TIME_REQUEST_PUNCH_ACTION.ADD).length;
  const voids = item.changes.length - adds;
  return t(locale, `${KR}.changesSummary`, { add: adds, void: voids });
}

/** Punch times after approval: active punches minus voids plus adds, sorted. */
function resultingSequence(day, request, tz) {
  const voided = new Set(request.changes.filter((c) => c.action === TIME_REQUEST_PUNCH_ACTION.VOID).map((c) => c.punchId));
  const kept = (day?.punches || [])
    .filter((p) => !p.voidedAt && !voided.has(p.id))
    .map((p) => ({ time: hmInZone(p.punchedAt, tz), kind: p.punchKind }));
  const added = request.changes
    .filter((c) => c.action === TIME_REQUEST_PUNCH_ACTION.ADD)
    .map((c) => ({ time: c.time, kind: c.kind }));
  return [...kept, ...added].sort((a, b) => a.time.localeCompare(b.time));
}

function PunchRow({ time, kind, locale, muted = false }) {
  return (
    <li className={cn('flex items-center gap-2 rounded-control border px-3 py-1.5', muted ? 'border-ink/8 bg-ink/[0.02]' : 'border-ink/10')}>
      <span className={cn('font-mono text-sm tabular-nums', muted ? 'text-ink-faint line-through' : 'text-ink')}>{time}</span>
      <StatusToneChip tone={kind === TIME_PUNCH_KIND.IN ? 'success' : 'info'}>{punchKindLabel(locale, kind)}</StatusToneChip>
    </li>
  );
}

function RequestReview({ detail, companyId, locale }) {
  const { item, day, schedule } = detail;
  const tz = schedule?.timezone;
  const punches = [...(day?.punches || [])].sort((a, b) => new Date(a.punchedAt) - new Date(b.punchedAt));
  const after = item.kind === TIME_REQUEST_KIND.ADJUSTMENT ? resultingSequence(day, item, tz) : null;
  return (
    <div className="flex flex-col gap-5">
      <TimeRequestCard
        request={item}
        locale={locale}
        fileHref={`/api/admin/time-clock/requests/${item.id}/file?companyId=${encodeURIComponent(companyId)}`}
      />
      {day?.locked && item.status === TIME_REQUEST_STATUS.PENDING ? (
        <InlineCallout tone="warning">{t(locale, `${KR}.reviewLocked`)}</InlineCallout>
      ) : null}
      {day ? (
        <section className="flex flex-col gap-2">
          <h3 className={cn(S.label, 'm-0')}>{t(locale, `${KR}.reviewCurrent`)}</h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatMetricTile value={formatMinutesClock(day.workedMinutes)} label={t(locale, `${KM}.colWorked`)} />
            <StatMetricTile value={formatMinutesClock(day.expectedMinutes)} label={t(locale, `${KM}.expected`)} />
            <StatMetricTile value={formatMinutesClock(day.extraMinutes)} label={t(locale, `${KM}.colExtra`)} />
            <StatMetricTile value={formatMinutesClock(day.missingMinutes)} label={t(locale, `${KM}.colMissing`)} />
          </div>
          {punches.length === 0 ? (
            <p className={cn(S.muted, 'm-0 text-prose')}>{t(locale, `${KM}.noPunch`)}</p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
              {punches.map((p) => (
                <PunchRow key={p.id} time={hmInZone(p.punchedAt, tz)} kind={p.punchKind} locale={locale} muted={Boolean(p.voidedAt)} />
              ))}
            </ul>
          )}
          {day.justification ? (
            <p className={cn(S.faint, 'm-0')}>{t(locale, `${KR}.currentJustification`, { summary: excuseSummary(locale, day.justification) })}</p>
          ) : null}
        </section>
      ) : null}
      {after && item.status === TIME_REQUEST_STATUS.PENDING ? (
        <section className="flex flex-col gap-2">
          <h3 className={cn(S.label, 'm-0')}>{t(locale, `${KR}.reviewAfter`)}</h3>
          {after.length === 0 ? (
            <p className={cn(S.muted, 'm-0 text-prose')}>{t(locale, `${KM}.noPunch`)}</p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
              {after.map((p, i) => <PunchRow key={`${p.time}-${i}`} time={p.time} kind={p.kind} locale={locale} />)}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}

/**
 * DP › Ponto › Solicitações: collaborator adjustment/excuse requests with review and
 * approve/reject. Approval applies through the same path as a manager adjustment.
 */
export function TimeClockRequestsBlock({ locale = 'pt-BR', companyId, onChanged }) {
  const { toast, promptForm } = useAppFeedback();
  const [qDraft, setQDraft] = useState('');
  const q = useDebounced(qDraft);
  const [status, setStatus] = useState(TIME_REQUEST_STATUS.PENDING);
  const [page, setPage] = useState(1);
  const [list, setList] = useState({ items: [], total: 0, loading: true });
  const [reloadKey, setReloadKey] = useState(0);
  const [openId, setOpenId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => setPage(1), [q, status]);

  useEffect(() => {
    let alive = true;
    setList((s) => ({ ...s, loading: true }));
    const params = new URLSearchParams({
      companyId: String(companyId),
      status,
      page: String(page),
      pageSize: String(PAGE_SIZE),
      ...(q.trim() ? { q: q.trim() } : {}),
    });
    fetch(`/api/admin/time-clock/requests?${params}`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || String(res.status));
        if (alive) setList({ items: data.items || [], total: Number(data.total) || 0, loading: false });
      })
      .catch((e) => {
        if (!alive) return;
        toast(e?.message || t(locale, `${KR}.listError`), 'error');
        setList({ items: [], total: 0, loading: false });
      });
    return () => {
      alive = false;
    };
  }, [companyId, status, page, q, reloadKey, locale, toast]);

  const openIdRef = useRef(null);
  const close = useCallback(() => {
    openIdRef.current = null;
    setOpenId(null);
    setDetail(null);
  }, []);

  const loadDetail = useCallback(async (id) => {
    setDetail(null);
    try {
      const res = await fetch(`/api/admin/time-clock/requests/${id}?companyId=${encodeURIComponent(companyId)}`);
      const data = await res.json().catch(() => ({}));
      if (openIdRef.current !== id) return;
      if (!res.ok) throw new Error(data?.error || String(res.status));
      setDetail(data);
    } catch (e) {
      if (openIdRef.current !== id) return;
      toast(e?.message || t(locale, `${KR}.listError`), 'error');
      close();
    }
  }, [companyId, locale, toast, close]);

  const open = (id) => {
    openIdRef.current = id;
    setOpenId(id);
    void loadDetail(id);
  };

  const decide = async (decision, note = '') => {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/time-clock/requests/${openId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, decision, note }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || String(res.status));
      toast(t(locale, decision === TIME_REQUEST_DECISION.APPROVE ? `${KR}.approved` : `${KR}.rejected`), 'ok');
      close();
      setReloadKey((k) => k + 1);
      onChanged?.();
    } catch (e) {
      toast(e?.message || t(locale, `${KR}.decideError`), 'error');
      void loadDetail(openId);
    } finally {
      setBusy(false);
    }
  };

  const reject = async () => {
    await promptForm({
      title: t(locale, `${KR}.rejectTitle`),
      message: t(locale, `${KR}.rejectMessage`),
      confirmLabel: t(locale, `${KR}.reject`),
      fields: [{ key: 'note', type: 'textarea', label: t(locale, `${KR}.rejectNote`), defaultValue: '' }],
      submit: async (values) => {
        await decide(TIME_REQUEST_DECISION.REJECT, String(values.note || '').trim());
      },
    });
  };

  const pendingDetail = detail?.item?.status === TIME_REQUEST_STATUS.PENDING;
  const dirty = Boolean(qDraft.trim()) || status !== TIME_REQUEST_STATUS.PENDING;

  return (
    <div className="flex flex-col gap-3">
      <AdminListFilters
        aria-label={t(locale, `${KR}.filtersAria`)}
        locale={locale}
        clearEnabled={dirty}
        onClear={() => {
          setQDraft('');
          setStatus(TIME_REQUEST_STATUS.PENDING);
        }}
      >
        <AdminListSearch locale={locale} value={qDraft} onChange={setQDraft} placeholder={t(locale, `${KM}.searchPeople`)} />
        <AdminListFilterSelect label={t(locale, `${KR}.statusFilter`)} value={status} onChange={setStatus}>
          {TIME_REQUEST_STATUSES.map((s) => (
            <option key={s} value={s}>{t(locale, `${KR}.status.${s}`)}</option>
          ))}
          <option value="all">{t(locale, `${KR}.statusAll`)}</option>
        </AdminListFilterSelect>
      </AdminListFilters>

      {list.loading && list.items.length === 0 ? (
        <AppLoading variant="panel" />
      ) : list.items.length === 0 ? (
        <EmptyState
          title={t(locale, status === TIME_REQUEST_STATUS.PENDING && !qDraft.trim() ? `${KR}.emptyPending` : `${KR}.emptyFiltered`)}
          message={t(locale, `${KR}.emptyHint`)}
        />
      ) : (
        <>
          <AdminTableShell
            locale={locale}
            minWidth="420px"
            animKey={`tc-requests|${status}|${page}|${q}|${list.total}`}
            ariaLabel={t(locale, `${KR}.tableAria`)}
          >
            <thead>
              <tr>
                <AdminTh>{t(locale, `${KM}.colPerson`)}</AdminTh>
                <AdminTh>{t(locale, `${KR}.colDay`)}</AdminTh>
                <AdminTh className={WIDE_COL}>{t(locale, `${KR}.colRequest`)}</AdminTh>
                <AdminTh>{t(locale, `${KR}.colStatus`)}</AdminTh>
                <AdminTh className={WIDE_COL}>{t(locale, `${KR}.colSent`)}</AdminTh>
                <AdminActionsTh>{t(locale, `${KM}.colActions`)}</AdminActionsTh>
              </tr>
            </thead>
            <tbody>
              {list.items.map((item) => (
                <tr key={item.id} className="border-b border-ink/8 last:border-b-0">
                  <td className="max-w-[13rem] px-4 py-2.5 align-middle sm:max-w-[18rem]">
                    <button
                      type="button"
                      className="min-h-touch w-full rounded-control text-left hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/35"
                      onClick={() => open(item.id)}
                    >
                      <p className="m-0 truncate font-ui text-sm text-ink">{item.candidateName}</p>
                      <p className={cn(S.faint, 'm-0 truncate')}>{timeRequestKindLabel(locale, item.kind)}</p>
                    </button>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 align-middle font-ui text-sm capitalize text-ink">{dayLabel(item.day, locale)}</td>
                  <td className={cn(WIDE_COL, 'px-4 py-2.5 align-middle text-prose text-ink-muted')}>{requestSummary(item, locale)}</td>
                  <td className="px-4 py-2.5 align-middle"><TimeRequestStatusChip status={item.status} locale={locale} /></td>
                  <td className={cn(WIDE_COL, 'whitespace-nowrap px-4 py-2.5 align-middle text-prose text-ink-muted')}>{dateTimeOf(item.createdAt, locale)}</td>
                  <td className="px-4 py-2.5 text-right align-middle">
                    <AdminActionsCell>
                      <AdminIconButton
                        icon="eye"
                        label={t(locale, `${KR}.review`, { name: item.candidateName })}
                        onClick={() => open(item.id)}
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
            total={list.total}
            loading={list.loading}
            onPageChange={setPage}
            pageSizeOptions={[PAGE_SIZE]}
          />
        </>
      )}

      <AdminRichFormDrawer
        open={openId != null}
        locale={locale}
        title={t(locale, `${KR}.reviewTitle`)}
        eyebrow={detail?.item ? `${detail.item.candidateName} · ${dayLabel(detail.item.day, locale)}` : null}
        onClose={close}
        maxWidth="640px"
        footer={pendingDetail ? (
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className={cn(S.btnGhost, 'min-h-touch')} disabled={busy} onClick={() => void reject()}>
              {t(locale, `${KR}.reject`)}
            </button>
            <button
              type="button"
              className={cn(S.btnPrimary, 'min-h-touch')}
              disabled={busy || detail?.day?.locked}
              onClick={() => void decide(TIME_REQUEST_DECISION.APPROVE)}
            >
              {busy ? t(locale, 'panel.common.loading') : t(locale, `${KR}.approve`)}
            </button>
          </div>
        ) : null}
      >
        {openId != null && !detail ? <AppLoading variant="panel" /> : null}
        {detail ? (
          <ContentEnter animKey={`tc-request|${detail.item.id}|${detail.item.status}`}>
            <RequestReview detail={detail} companyId={companyId} locale={locale} />
          </ContentEnter>
        ) : null}
      </AdminRichFormDrawer>
    </div>
  );
}
