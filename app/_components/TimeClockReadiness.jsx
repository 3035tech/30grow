'use client';
import { useCallback, useEffect, useState } from 'react';
import { t } from '../../lib/i18n';
import { formatDisplayDate } from '../../lib/format-display-date.js';
import {
  formatMinutesClock,
  localIsoToday,
} from '../../lib/time-clock-format.js';
import {
  S,
  AdminListPager,
  AdminTableShell,
  AdminTh,
} from '../dashboard/dashboard-shared';
import { AdminListFilters } from './AdminListFilters';
import { OrgUnitFilter } from './OrgUnitField';
import { InlineCallout } from './InlineCallout';
import { AppLoading } from './AppLoading';
import { ListLoadError } from './ListLoadError';
import { useAppFeedback } from './AppFeedback';
const PAGE_SIZE = 25;
export function TimeClockReadiness({
  locale,
  companyId,
  period,
  onPeriodChange,
  onOpen,
  reloadKey,
}) {
  const [draft, setDraft] = useState(period),
    [page, setPage] = useState(1),
    [state, setState] = useState({ loading: true, data: null, error: false });
  const [sending, setSending] = useState(false);
  const [checkVersion, setCheckVersion] = useState(0);
  useEffect(() => {
    setDraft({
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      orgUnitId: period.orgUnitId,
    });
    setPage(1);
  }, [period.periodStart, period.periodEnd, period.orgUnitId]);
  const { toast, promptForm } = useAppFeedback();
  const load = useCallback(
    async (signal) => {
      setState((old) => ({ ...old, loading: true, error: false }));
      try {
        const params = new URLSearchParams({
          companyId: String(companyId),
          periodStart: period.periodStart,
          periodEnd: period.periodEnd,
          page: String(page),
          pageSize: String(PAGE_SIZE),
          ...(period.orgUnitId ? { orgUnitId: period.orgUnitId } : {}),
        });
        const res = await fetch(`/api/admin/time-clock/readiness?${params}`, {
          cache: 'no-store',
          signal: signal
            ? AbortSignal.any([signal, AbortSignal.timeout(30000)])
            : AbortSignal.timeout(30000),
        });
        const data = await res.json();
        if (!res.ok) throw Error(data?.error);
        if (!signal?.aborted) setState({ loading: false, data, error: false });
      } catch (error) {
        if (!signal?.aborted)
          setState({
            loading: false,
            data: null,
            error: error.message || t(locale, 'rep.loadError'),
          });
      }
    },
    [
      companyId,
      period.periodStart,
      period.periodEnd,
      period.orgUnitId,
      page,
      locale,
      reloadKey,
      checkVersion,
    ],
  );
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  async function remind() {
    await promptForm({
      title: t(locale, 'timeClosing.remind'),
      message: t(locale, 'timeClosing.remindHelp'),
      confirmLabel: t(locale, 'timeClosing.remind'),
      fields: [
        {
          key: 'deadline',
          type: 'date',
          label: t(locale, 'timeClosing.deadline'),
          defaultValue: localIsoToday(),
          required: true,
        },
      ],
      submit: async (values) => {
        setSending(true);
        try {
          const res = await fetch('/api/admin/time-clock/reminders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...period,
              companyId,
              orgUnitId: period.orgUnitId ? Number(period.orgUnitId) : null,
              deadline: values.deadline,
            }),
            signal: AbortSignal.timeout(60000),
          });
          const data = await res.json();
          if (!res.ok) throw Error(data?.error);
          toast(
            t(locale, 'timeClosing.reminded', { count: data.inserted }),
            'ok',
          );
        } finally {
          setSending(false);
        }
      },
    });
  }
  const data = state.data;
  return (
    <section className={S.card}>
      <h3 className={S.sectionTitle}>{t(locale, 'timeClosing.title')}</h3>
      <p className="mt-2 text-sm text-ink-muted">
        {t(locale, 'timeClosing.intro')}
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setPage(1);
          onPeriodChange({ ...draft });
          setCheckVersion((value) => value + 1);
        }}
      >
        <AdminListFilters locale={locale}>
          {['periodStart', 'periodEnd'].map((name) => (
            <label key={name} className="flex flex-col gap-1 text-sm">
              {t(locale, name === 'periodStart' ? 'rep.from' : 'rep.to')}
              <input
                type="date"
                name={name}
                required
                value={draft[name]}
                onChange={(event) =>
                  setDraft((old) => ({ ...old, [name]: event.target.value }))
                }
                className={S.input}
              />
            </label>
          ))}
          <OrgUnitFilter
            includeNone={false}
            companyId={companyId}
            locale={locale}
            value={draft.orgUnitId}
            onChange={(orgUnitId) => setDraft((old) => ({ ...old, orgUnitId }))}
          />
          <button
            type="submit"
            disabled={state.loading}
            className={S.btnBrandSoft}
          >
            {t(locale, 'timeClosing.check')}
          </button>
        </AdminListFilters>
      </form>
      <div className="mt-4 space-y-3">
        {state.loading ? (
          <AppLoading variant="panel" />
        ) : state.error ? (
          <ListLoadError
            locale={locale}
            message={state.error}
            onRetry={() => void load()}
          />
        ) : data ? (
          <>
            <InlineCallout
              tone={data.closed ? 'info' : data.ready ? 'success' : 'warning'}
            >
              {t(
                locale,
                data.closed
                  ? 'timeClosing.alreadyClosed'
                  : data.ready
                    ? 'timeClosing.ready'
                    : 'timeClosing.blocked',
              )}
            </InlineCallout>
            {!data.closed ? (
              <>
                <p className="text-sm text-ink-muted">
                  {t(locale, 'timeClosing.overview', {
                    people: data.totals.people,
                    blocked: data.totals.blockedPeople,
                  })}
                </p>
                <p className="text-sm text-ink-muted">
                  {t(locale, 'timeClosing.warningHelp')}
                </p>
                <button
                  type="button"
                  className={S.btnGhost}
                  disabled={sending || !data.total}
                  onClick={() => void remind()}
                >
                  {t(locale, 'timeClosing.remind')}
                </button>
                <AdminTableShell
                  locale={locale}
                  minWidth="720px"
                  ariaLabel={t(locale, 'timeClosing.title')}
                >
                  <thead>
                    <tr>
                      {[
                        'person',
                        'incomplete',
                        'review',
                        'requests',
                        'missing',
                        'extra',
                      ].map((key) => (
                        <AdminTh key={key}>
                          {t(locale, `timeClosing.${key}`)}
                        </AdminTh>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((person) => (
                      <tr
                        key={person.candidateId}
                        className="border-b border-line"
                      >
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => onOpen?.(person.candidateId)}
                            className="min-h-touch text-left font-semibold text-brand-600"
                          >
                            {person.fullName}
                          </button>
                          {person.scheduleReviewDays ? (
                            <p className="text-xs text-danger">
                              {t(locale, 'timeClosing.scheduleReview')}
                            </p>
                          ) : null}
                          {person.days.length ? (
                            <p className="text-xs text-ink-muted">
                              {person.days
                                .map((day) =>
                                  formatDisplayDate(day.day, locale),
                                )
                                .join(' · ')}
                            </p>
                          ) : null}
                        </td>
                        <td className="px-4 py-3">{person.incompleteDays}</td>
                        <td className="px-4 py-3">
                          {person.reviewDays + person.scheduleReviewDays}
                        </td>
                        <td className="px-4 py-3">
                          {person.pendingRequests + person.pendingBank}
                        </td>
                        <td className="px-4 py-3 font-mono">
                          {formatMinutesClock(person.missingMinutes)}
                        </td>
                        <td className="px-4 py-3 font-mono">
                          {formatMinutesClock(person.extraMinutes)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </AdminTableShell>
                <AdminListPager
                  locale={locale}
                  page={page}
                  pageSize={PAGE_SIZE}
                  total={data.total}
                  onPageChange={setPage}
                  loading={state.loading}
                  pageSizeOptions={[PAGE_SIZE]}
                />
              </>
            ) : null}
          </>
        ) : null}
      </div>
    </section>
  );
}
