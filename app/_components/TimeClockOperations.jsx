'use client';
import { useCallback, useEffect, useState } from 'react';
import { t } from '../../lib/i18n';
import { formatDisplayDateTime } from '../../lib/format-display-date.js';
import { S } from '../dashboard/dashboard-shared';
import { InlineCallout } from './InlineCallout';
import { AppLoading } from './AppLoading';
import { useAppFeedback } from './AppFeedback';
export function TimeClockOperations({ locale = 'pt-BR' }) {
  const [data, setData] = useState(null),
    [error, setError] = useState(false),
    [refreshing, setRefreshing] = useState(true),
    [busy, setBusy] = useState(false);
  const { toast } = useAppFeedback();
  const load = useCallback(async (signal) => {
    setError(false);
    setRefreshing(true);
    try {
      const r = await fetch('/api/admin/time-clock/operations', {
        cache: 'no-store',
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
          : AbortSignal.timeout(15000),
      });
      if (!r.ok) throw Error();
      const d = await r.json();
      if (!signal?.aborted) setData(d);
    } catch {
      if (!signal?.aborted) setError(true);
    } finally {
      if (!signal?.aborted) setRefreshing(false);
    }
  }, []);
  useEffect(() => {
    const c = new AbortController();
    void load(c.signal);
    return () => c.abort();
  }, [load]);
  async function retry(id) {
    setBusy(true);
    try {
      const r = await fetch('/api/admin/time-clock/operations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
        signal: AbortSignal.timeout(15000),
      });
      if (!r.ok) throw Error();
      toast(t(locale, 'timeOperations.queued'), 'ok');
      await load();
    } catch {
      toast(t(locale, 'rep.loadError'), 'error');
    } finally {
      setBusy(false);
    }
  }
  const expired =
    data?.certificate?.validTo &&
    Date.parse(data.certificate.validTo) - Date.now() <= 30 * 86400000;
  return (
    <section className={S.card} aria-busy={refreshing}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className={S.sectionTitle}>{t(locale, 'timeOperations.title')}</h3>
        <button
          type="button"
          className={S.btnGhost}
          onClick={() => void load()}
          disabled={busy || refreshing}
        >
          {t(
            locale,
            refreshing
              ? 'timeOperations.refreshing'
              : error
                ? 'common.retry'
                : 'timeOperations.refresh',
          )}
        </button>
      </div>
      <p className="my-3 text-sm text-ink-muted">
        {t(locale, 'timeOperations.help')}
      </p>
      {error ? (
        <InlineCallout tone="danger">
          {t(locale, 'rep.loadError')}
        </InlineCallout>
      ) : !data ? (
        <AppLoading variant="panel" />
      ) : (
        <div className="space-y-3">
          <InlineCallout
            tone={
              expired || !data.certificate || data.certificateUnavailable
                ? 'warning'
                : 'success'
            }
          >
            {t(locale, 'timeOperations.certificate', {
              date: data.certificate?.validTo
                ? formatDisplayDateTime(data.certificate.validTo, locale)
                : '—',
            })}
          </InlineCallout>
          <InlineCallout
            tone={
              data.clockStale || data.clockOutsideTolerance
                ? 'warning'
                : 'success'
            }
          >
            {t(
              locale,
              data.clockStale
                ? 'timeOperations.clockUnknown'
                : 'timeOperations.clock',
              { offset: data.clock?.offsetMs ?? '—' },
            )}
          </InlineCallout>
          <InlineCallout tone={data.pendingReceipts.n ? 'warning' : 'info'}>
            {t(locale, 'timeOperations.receipts', {
              count: data.pendingReceipts.n,
            })}
          </InlineCallout>
          <InlineCallout tone={data.signingFailures.n ? 'danger' : 'info'}>
            {t(locale, 'timeOperations.failures', {
              count: data.signingFailures.n,
            })}
          </InlineCallout>
          {data.unavailableServices > 0 ? (
            <InlineCallout tone="danger">
              {t(locale, 'timeOperations.unavailable', {
                count: data.unavailableServices,
              })}
            </InlineCallout>
          ) : null}
          <p>
            {t(locale, 'timeOperations.queue', {
              pending:
                (data.deliveries.pending || 0) + (data.deliveries.sending || 0),
              failed: data.deliveries.failed || 0,
              sent: data.deliveries.sent || 0,
            })}
          </p>
          {data.failedJobs.map((job) => (
            <div
              className="flex flex-wrap items-center justify-between gap-3 border-t border-line py-3"
              key={job.id}
            >
              <span>
                {t(locale, 'timeOperations.job', {
                  id: job.id,
                  company: job.companyId,
                  attempts: job.attempts,
                })}
              </span>
              <button
                type="button"
                className={S.btnGhost}
                disabled={busy || refreshing}
                onClick={() => void retry(job.id)}
              >
                {t(locale, 'timeOperations.retry')}
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
