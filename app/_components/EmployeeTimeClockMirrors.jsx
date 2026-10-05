'use client';

import { useCallback, useEffect, useState } from 'react';
import { t } from '../../lib/i18n';
import { formatDisplayDate, formatDisplayDateTime } from '../../lib/format-display-date.js';
import { cn } from '../../lib/cn';
import { TIME_CLOCK_ACK_STATUS } from '../../lib/domain-status.js';
import { TIME_CLOCK_ACK_TONE as ACK_TONE, formatMinutesClock } from '../../lib/time-clock-format.js';
import { S } from '../dashboard/dashboard-shared';
import { ContentEnter } from './AppLoading';
import { useAppFeedback } from './AppFeedback';
import { StatMetricTile } from './StatMetricTile';
import { StatusToneChip } from './StatusToneChip';

const K = 'employeeHome.timeMirror';
const KM = 'panel.timeClockMgr';
const NAME_MIN = 3;
const NOTE_MIN = 10;

const dateBr = (v, locale) => formatDisplayDate(v, locale, { fallback: '' });
const dateTimeBr = (v, locale) => formatDisplayDateTime(v, locale, { fallback: '' });

async function postAck(closureId, body) {
  const res = await fetch(`/api/employee/time-clock/closures/${closureId}/ack`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || String(res.status));
  return data;
}

/**
 * Collaborator mirrors of concluded closures: frozen totals to sign (typed name + consent)
 * or dispute with a reason. Hidden while the person has no closed period yet.
 */
export function EmployeeTimeClockMirrors({ locale = 'pt-BR' }) {
  const { toast, promptForm } = useAppFeedback();
  const [state, setState] = useState({ items: [], loading: true });

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/employee/time-clock/closures');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || String(res.status));
      setState({ items: data.items || [], loading: false });
    } catch {
      setState({ items: [], loading: false });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const hasItems = state.items.length > 0;
  useEffect(() => {
    if (hasItems && window.location.hash === '#mirrors') {
      document.getElementById('mirrors')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [hasItems]);

  const period = (m) => ({ from: dateBr(m.periodStart, locale), to: dateBr(m.periodEnd, locale) });

  const sign = async (m) => {
    await promptForm({
      title: t(locale, `${K}.signTitle`, period(m)),
      message: t(locale, `${K}.signMessage`, {
        worked: formatMinutesClock(m.workedMinutes),
        expected: formatMinutesClock(m.expectedMinutes),
      }),
      confirmLabel: t(locale, `${K}.signConfirm`),
      fields: [
        {
          key: 'signerName',
          label: t(locale, `${K}.signerName`),
          required: true,
          help: t(locale, `${K}.signerNameHelp`),
          validate: (v) => (String(v || '').trim().length >= NAME_MIN ? null : t(locale, 'errors.DP_SIGNATURE_NAME_REQUIRED')),
        },
        { key: 'consent', type: 'boolean', required: true, label: t(locale, `${K}.consent`), defaultValue: false },
      ],
      submit: async (values) => {
        await postAck(m.closureId, {
          action: TIME_CLOCK_ACK_STATUS.SIGNED,
          signerName: String(values.signerName || '').trim(),
          consent: values.consent === true,
        });
        toast(t(locale, `${K}.signedOk`), 'ok');
        await load();
      },
    });
  };

  const dispute = async (m) => {
    await promptForm({
      title: t(locale, `${K}.disputeTitle`, period(m)),
      message: t(locale, `${K}.disputeMessage`),
      confirmLabel: t(locale, `${K}.disputeConfirm`),
      fields: [
        {
          key: 'note',
          type: 'textarea',
          label: t(locale, `${K}.disputeNote`),
          required: true,
          maxLength: 1000,
          validate: (v) => (String(v || '').trim().length >= NOTE_MIN ? null : t(locale, 'errors.TIME_CLOCK_DISPUTE_NOTE_REQUIRED')),
        },
      ],
      submit: async (values) => {
        await postAck(m.closureId, { action: TIME_CLOCK_ACK_STATUS.DISPUTED, note: String(values.note || '').trim() });
        toast(t(locale, `${K}.disputedOk`), 'ok');
        await load();
      },
    });
  };

  if (state.loading || !state.items.length) return null;

  return (
    <section
      id="mirrors"
      className="mt-4 scroll-mt-20 rounded-card border border-ink/12 bg-surface p-4 sm:p-5"
      aria-labelledby="emp-tc-mirrors-title"
    >
      <h2 id="emp-tc-mirrors-title" className="mb-1 mt-0 font-ui text-base font-semibold text-ink">
        {t(locale, `${K}.title`)}
      </h2>
      <p className="mb-3 mt-0 font-ui text-prose text-ink-muted">{t(locale, `${K}.hint`)}</p>
      <ContentEnter animKey={`emp-mirrors|${state.items.map((m) => `${m.closureId}:${m.ackStatus}`).join(',')}`}>
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {state.items.map((m) => {
            const canSign = m.ackStatus !== TIME_CLOCK_ACK_STATUS.SIGNED;
            const canDispute = m.ackStatus === TIME_CLOCK_ACK_STATUS.PENDING;
            return (
              <li key={m.closureId} className={cn(S.cardShell, 'flex flex-col gap-3 p-3 sm:p-4')}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="m-0 font-mono text-sm tabular-nums text-ink">
                    {t(locale, `${K}.period`, period(m))}
                  </p>
                  <StatusToneChip tone={ACK_TONE[m.ackStatus] || 'neutral'}>
                    {t(locale, `${KM}.ack.${m.ackStatus}`)}
                  </StatusToneChip>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                  <StatMetricTile value={formatMinutesClock(m.workedMinutes)} label={t(locale, `${KM}.colWorked`)} />
                  <StatMetricTile value={formatMinutesClock(m.expectedMinutes)} label={t(locale, `${KM}.expected`)} />
                  <StatMetricTile value={formatMinutesClock(m.extraMinutes)} label={t(locale, `${KM}.colExtra`)} />
                  <StatMetricTile value={formatMinutesClock(m.missingMinutes)} label={t(locale, `${KM}.colMissing`)} />
                  <StatMetricTile value={m.absenceDays} label={t(locale, `${KM}.colAbsences`)} />
                  <StatMetricTile
                    value={m.bankBalanceMinutes == null ? '·' : formatMinutesClock(m.bankBalanceMinutes)}
                    label={t(locale, `${KM}.colBank`)}
                  />
                </div>
                {m.ackStatus === TIME_CLOCK_ACK_STATUS.SIGNED ? (
                  <p className={cn(S.faint, 'm-0')}>
                    {t(locale, `${K}.signedBy`, { name: m.signerName, at: dateTimeBr(m.ackAt, locale) })}
                  </p>
                ) : null}
                {m.ackStatus === TIME_CLOCK_ACK_STATUS.DISPUTED ? (
                  <p className={cn(S.faint, 'm-0 whitespace-pre-wrap')}>
                    {t(locale, `${K}.disputedAt`, { at: dateTimeBr(m.ackAt, locale) })}
                    {': '}
                    {m.disputeNote}
                  </p>
                ) : null}
                {canSign ? (
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className={cn(S.btnPrimary, 'min-h-touch')} onClick={() => void sign(m)}>
                      {t(locale, `${K}.signAction`)}
                    </button>
                    {canDispute ? (
                      <button type="button" className={cn(S.btnGhost, 'min-h-touch')} onClick={() => void dispute(m)}>
                        {t(locale, `${K}.disputeAction`)}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </ContentEnter>
    </section>
  );
}
