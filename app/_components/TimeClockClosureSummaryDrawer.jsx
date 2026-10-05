'use client';

import { useCallback, useEffect, useState } from 'react';
import { t } from '../../lib/i18n';
import { formatDisplayDate, formatDisplayDateTime } from '../../lib/format-display-date.js';
import { cn } from '../../lib/cn';
import {
  TIME_CLOCK_ACK_STATUS,
  TIME_CLOCK_ACK_STATUSES,
  TIME_CLOCK_CLOSURE_STATUS,
} from '../../lib/domain-status.js';
import { TIME_CLOCK_ACK_TONE as ACK_TONE, formatMinutesClock } from '../../lib/time-clock-format.js';
import {
  S,
  AdminListPager,
  AdminListSearch,
  AdminTableShell,
  AdminTh,
} from '../dashboard/dashboard-shared';
import { AdminListFilters } from './AdminListFilters';
import { AdminRichFormDrawer } from './AdminRichFormDrawer';
import { AppLoading, ContentEnter } from './AppLoading';
import { useAppFeedback } from './AppFeedback';
import { EmptyState } from './EmptyState';
import { InlineCallout } from './InlineCallout';
import { StatMetricTile } from './StatMetricTile';
import { StatusToneChip } from './StatusToneChip';

const K = 'panel.timeClockMgr';
const PAGE_SIZE = 25;

const dateBr = (v, locale) => formatDisplayDate(v, locale, { fallback: '' });
const dateTimeBr = (v, locale) => formatDisplayDateTime(v, locale, { fallback: '' });

/** Per-person summary of one closure: totals, bank balance and mirror acknowledgment. */
export function TimeClockClosureSummaryDrawer({ locale = 'pt-BR', companyId, closure, onClose, onChanged }) {
  const { toast } = useAppFeedback();
  const [qDraft, setQDraft] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [generating, setGenerating] = useState(false);
  const [state, setState] = useState({ items: [], total: 0, counts: null, loading: true });
  const closureId = closure?.id;

  useEffect(() => {
    const id = setTimeout(() => setQ(qDraft.trim()), 300);
    return () => clearTimeout(id);
  }, [qDraft]);
  useEffect(() => setPage(1), [q, status]);

  const base = `/api/admin/time-clock/closures/${closureId}/people`;

  const load = useCallback(async () => {
    if (!closureId) return;
    setState((s) => ({ ...s, loading: true }));
    try {
      const params = new URLSearchParams({
        companyId: String(companyId),
        page: String(page),
        pageSize: String(PAGE_SIZE),
        ...(q ? { q } : {}),
        ...(status ? { status } : {}),
      });
      const res = await fetch(`${base}?${params}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || String(res.status));
      setState({ items: data.items || [], total: Number(data.total) || 0, counts: data.counts || null, loading: false });
    } catch (e) {
      toast(e?.message || t(locale, `${K}.loadError`), 'error');
      setState({ items: [], total: 0, counts: null, loading: false });
    }
  }, [base, closureId, companyId, page, q, status, locale, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const generate = async () => {
    setGenerating(true);
    try {
      const res = await fetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || String(res.status));
      toast(t(locale, `${K}.summaryGenerated`, { n: data.count || 0 }), 'ok');
      await load();
      onChanged?.();
    } catch (e) {
      toast(e?.message || t(locale, `${K}.loadError`), 'error');
    } finally {
      setGenerating(false);
    }
  };

  const counts = state.counts;
  const hasRows = Boolean(counts?.total);
  const isClosed = closure?.status === TIME_CLOCK_CLOSURE_STATUS.CLOSED;
  const csvHref = `${base}?${new URLSearchParams({ companyId: String(companyId), format: 'csv' })}`;
  const dirty = Boolean(qDraft.trim() || status);

  return (
    <AdminRichFormDrawer
      open={Boolean(closure)}
      locale={locale}
      onClose={onClose}
      maxWidth="1040px"
      eyebrow={t(locale, `${K}.summaryEyebrow`)}
      title={t(locale, `${K}.summaryTitle`, {
        from: dateBr(closure?.periodStart, locale),
        to: dateBr(closure?.periodEnd, locale),
      })}
      headerActions={hasRows ? (
        <a className={cn(S.btnGhost, 'inline-flex min-h-touch items-center')} href={csvHref} download>
          {t(locale, `${K}.summaryCsv`)}
        </a>
      ) : null}
    >
      <div className="flex flex-col gap-3">
        <p className={cn(S.muted, 'm-0 max-w-[70ch] text-prose')}>{t(locale, `${K}.summaryIntro`)}</p>
        {hasRows && !isClosed ? (
          <InlineCallout tone="warning">{t(locale, `${K}.summaryCancelledNote`)}</InlineCallout>
        ) : null}

        {state.loading && !counts ? (
          <AppLoading variant="panel" />
        ) : !hasRows ? (
          <EmptyState
            title={t(locale, `${K}.summaryEmpty`)}
            message={t(locale, isClosed ? `${K}.summaryEmptyHint` : `${K}.summaryEmptyCancelled`)}
            actionLabel={isClosed ? t(locale, `${K}.summaryGenerate`) : undefined}
            onAction={isClosed ? () => void generate() : undefined}
            actionDisabled={generating}
          />
        ) : (
          <ContentEnter animKey={`tc-summary|${closureId}`}>
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <StatMetricTile
                  value={counts.total}
                  label={t(locale, `${K}.ackAll`)}
                  onClick={() => setStatus('')}
                  pressed={!status}
                />
                {TIME_CLOCK_ACK_STATUSES.map((s) => (
                  <StatMetricTile
                    key={s}
                    value={counts[s] || 0}
                    label={t(locale, `${K}.ack.${s}`)}
                    onClick={() => setStatus(status === s ? '' : s)}
                    pressed={status === s}
                  />
                ))}
              </div>

              <AdminListFilters
                aria-label={t(locale, `${K}.summaryFilters`)}
                locale={locale}
                clearEnabled={dirty}
                onClear={() => {
                  setQDraft('');
                  setStatus('');
                }}
              >
                <AdminListSearch
                  locale={locale}
                  value={qDraft}
                  onChange={setQDraft}
                  placeholder={t(locale, `${K}.searchPeople`)}
                />
              </AdminListFilters>

              {state.items.length === 0 ? (
                <EmptyState title={t(locale, `${K}.summaryEmptyFiltered`)} />
              ) : (
                <>
                  <AdminTableShell
                    locale={locale}
                    minWidth="900px"
                    animKey={`tc-summary-rows|${page}|${q}|${status}|${state.total}`}
                    ariaLabel={t(locale, `${K}.summaryAria`)}
                  >
                    <thead>
                      <tr>
                        <AdminTh>{t(locale, `${K}.colPerson`)}</AdminTh>
                        <AdminTh>{t(locale, `${K}.colWorkdays`)}</AdminTh>
                        <AdminTh>{t(locale, `${K}.colWorked`)}</AdminTh>
                        <AdminTh>{t(locale, `${K}.expected`)}</AdminTh>
                        <AdminTh>{t(locale, `${K}.colExtra`)}</AdminTh>
                        <AdminTh>{t(locale, `${K}.colMissing`)}</AdminTh>
                        <AdminTh>{t(locale, `${K}.colAbsences`)}</AdminTh>
                        <AdminTh>{t(locale, `${K}.colBank`)}</AdminTh>
                        <AdminTh>{t(locale, `${K}.colAck`)}</AdminTh>
                      </tr>
                    </thead>
                    <tbody>
                      {state.items.map((p) => (
                        <tr key={p.candidateId} className="border-b border-ink/8 align-top last:border-b-0">
                          <td className="px-4 py-2.5">
                            <p className="m-0 font-ui text-sm text-ink">{p.fullName}</p>
                            <p className={cn(S.faint, 'm-0')}>{p.jobRoleName || p.email}</p>
                          </td>
                          <td className="px-4 py-2.5 font-mono tabular-nums text-ink">{p.workdays}</td>
                          <td className="px-4 py-2.5 font-mono tabular-nums text-ink">{formatMinutesClock(p.workedMinutes)}</td>
                          <td className="px-4 py-2.5 font-mono tabular-nums text-ink-muted">{formatMinutesClock(p.expectedMinutes)}</td>
                          <td className="px-4 py-2.5 font-mono tabular-nums text-ink">{formatMinutesClock(p.extraMinutes)}</td>
                          <td className="px-4 py-2.5 font-mono tabular-nums text-ink">{formatMinutesClock(p.missingMinutes)}</td>
                          <td className="px-4 py-2.5 font-mono tabular-nums text-ink">{p.absenceDays}</td>
                          <td className="px-4 py-2.5 font-mono tabular-nums text-ink">
                            {p.bankBalanceMinutes == null ? <span className={S.faint}>·</span> : formatMinutesClock(p.bankBalanceMinutes)}
                          </td>
                          <td className="px-4 py-2.5">
                            <StatusToneChip tone={ACK_TONE[p.ackStatus] || 'neutral'}>
                              {t(locale, `${K}.ack.${p.ackStatus}`)}
                            </StatusToneChip>
                            {p.ackAt ? <p className={cn(S.faint, 'm-0 mt-1')}>{dateTimeBr(p.ackAt, locale)}</p> : null}
                            {p.ackStatus === TIME_CLOCK_ACK_STATUS.DISPUTED && p.disputeNote ? (
                              <p className={cn(S.faint, 'm-0 mt-1 max-w-[18rem] whitespace-pre-wrap')}>{p.disputeNote}</p>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </AdminTableShell>
                  <AdminListPager
                    locale={locale}
                    page={page}
                    pageSize={PAGE_SIZE}
                    total={state.total}
                    loading={state.loading}
                    onPageChange={setPage}
                    pageSizeOptions={[PAGE_SIZE]}
                  />
                </>
              )}
            </div>
          </ContentEnter>
        )}
      </div>
    </AdminRichFormDrawer>
  );
}
