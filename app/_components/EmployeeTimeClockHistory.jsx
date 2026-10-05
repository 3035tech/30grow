'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { t, localeHtmlLang } from '../../lib/i18n';
import { cn } from '../../lib/cn';
import {
  TIME_DAY_OCCURRENCE,
  TIME_PUNCH_KIND,
  TIME_PUNCH_SOURCE,
  TIME_REQUEST_EXCUSE_REASONS,
  TIME_REQUEST_KIND,
  TIME_REQUEST_STATUS,
} from '../../lib/domain-status.js';
import { DP_DOC_ALLOWED_MIMES, DP_DOC_MAX_BYTES } from '../../lib/dp-upload-validation.js';
import {
  TIME_ADJUST_MAX_ADD,
  TIME_ADJUST_MAX_VOID,
  formatMinutesClock,
  hmInZone,
  hmSpanMinutes,
  timeClockPeriodFor,
} from '../../lib/time-clock-format.js';
import { S } from '../dashboard/dashboard-shared';
import { AdminRichFormDrawer } from './AdminRichFormDrawer';
import { AppLoading, ContentEnter } from './AppLoading';
import { useAppFeedback } from './AppFeedback';
import { EmptyState } from './EmptyState';
import { FormField } from './FormField';
import { InlineCallout } from './InlineCallout';
import { SegmentedControl } from './SegmentedControl';
import { StatMetricTile } from './StatMetricTile';
import { StatusToneChip } from './StatusToneChip';
import {
  KR,
  TimeRequestCard,
  TimeRequestStatusChip,
  excuseReasonLabel,
  excuseSummary,
  punchKindLabel,
} from './TimeRequestParts';

const KM = 'panel.timeClockMgr';

const OCCURRENCE_TONE = {
  [TIME_DAY_OCCURRENCE.OK]: 'success',
  [TIME_DAY_OCCURRENCE.TODAY]: 'neutral',
  [TIME_DAY_OCCURRENCE.IN_PROGRESS]: 'info',
  [TIME_DAY_OCCURRENCE.ABSENCE]: 'danger',
  [TIME_DAY_OCCURRENCE.INCOMPLETE]: 'warning',
  [TIME_DAY_OCCURRENCE.REVIEW]: 'warning',
  [TIME_DAY_OCCURRENCE.MISSING]: 'warning',
  [TIME_DAY_OCCURRENCE.JUSTIFIED]: 'info',
  [TIME_DAY_OCCURRENCE.REST]: 'neutral',
  [TIME_DAY_OCCURRENCE.HOLIDAY]: 'info',
};

function dayLabel(iso, locale) {
  const d = new Date(`${iso}T12:00:00Z`);
  const lang = localeHtmlLang(locale);
  const wd = d.toLocaleDateString(lang, { weekday: 'short', timeZone: 'UTC' }).replace(/\.$/, '');
  const dm = d.toLocaleDateString(lang, { day: '2-digit', month: '2-digit', timeZone: 'UTC' });
  return `${wd.charAt(0).toLocaleUpperCase(lang)}${wd.slice(1)} ${dm}`;
}

function activePunches(day) {
  return (day.punches || []).filter((p) => !p.voidedAt);
}

/** Latest non-cancelled request decides the chip shown on the day row. */
function dayRequestStatus(day) {
  const reqs = day.requests || [];
  if (reqs.some((r) => r.status === TIME_REQUEST_STATUS.PENDING)) return TIME_REQUEST_STATUS.PENDING;
  return reqs[0]?.status || null;
}

async function sendJson(url, body, method = 'POST') {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || String(res.status));
  return data;
}

async function uploadProof(requestId, file) {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`/api/employee/time-clock/requests/${requestId}/file`, { method: 'POST', body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || String(res.status));
  return data;
}

function proofError(file, locale) {
  if (!file) return null;
  if (file.size > DP_DOC_MAX_BYTES) return t(locale, `${KR}.fileTooLarge`);
  if (file.type && !DP_DOC_ALLOWED_MIMES.includes(file.type)) return t(locale, `${KR}.fileType`);
  return null;
}

function PunchSequence({ day, tz, locale }) {
  const active = activePunches(day);
  if (!active.length) return <span className={S.faint}>{t(locale, `${KM}.noPunch`)}</span>;
  return (
    <span className="font-mono text-prose tabular-nums text-ink">
      {active.map((p) => hmInZone(p.punchedAt, tz)).join(' · ')}
    </span>
  );
}

function ProofPicker({ file, onChange, locale, disabled }) {
  const inputRef = useRef(null);
  const error = proofError(file, locale);
  return (
    <FormField as="div" label={t(locale, `${KR}.proofLabel`)} hint={t(locale, `${KR}.proofHint`)}>
      <input
        ref={inputRef}
        type="file"
        accept={DP_DOC_ALLOWED_MIMES.join(',')}
        className="hidden"
        onChange={(e) => {
          onChange(e.target.files?.[0] || null);
          e.target.value = '';
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={cn(S.btnGhost, 'min-h-touch')} disabled={disabled} onClick={() => inputRef.current?.click()}>
          {t(locale, file ? `${KR}.proofReplace` : `${KR}.proofPick`)}
        </button>
        {file ? (
          <>
            <span className="min-w-0 break-all text-prose text-ink">{file.name}</span>
            <button type="button" className={cn(S.btnGhost, 'min-h-touch')} disabled={disabled} onClick={() => onChange(null)}>
              {t(locale, `${KR}.proofRemove`)}
            </button>
          </>
        ) : null}
      </div>
      {error ? <p className="m-0 mt-1 text-prose text-danger">{error}</p> : null}
    </FormField>
  );
}

function initialRows(day, tz) {
  return activePunches(day).map((p) => ({
    key: `p${p.id}`,
    punchId: p.id,
    time: hmInZone(p.punchedAt, tz),
    kind: p.punchKind,
    removed: false,
  }));
}

/** Diff between the edited rows and the recorded punches (void changed/removed, add new/changed). */
function adjustmentDiff(rows, day, tz) {
  const originals = new Map(activePunches(day).map((p) => [p.id, { time: hmInZone(p.punchedAt, tz), kind: p.punchKind }]));
  const voidPunchIds = [];
  const add = [];
  for (const r of rows) {
    const orig = r.punchId ? originals.get(r.punchId) : null;
    const changed = orig && (r.time !== orig.time || r.kind !== orig.kind);
    if (orig && (r.removed || changed)) voidPunchIds.push(r.punchId);
    if (!r.removed && (!orig || changed) && r.time) add.push({ time: r.time, kind: r.kind });
  }
  return { voidPunchIds, add };
}

function alternates(rows) {
  const seq = rows.filter((r) => !r.removed && r.time).sort((a, b) => a.time.localeCompare(b.time));
  return seq.every((r, i) => r.kind === (i % 2 === 0 ? TIME_PUNCH_KIND.IN : TIME_PUNCH_KIND.OUT));
}

function AdjustForm({ day, tz, locale, onCancel, onSubmitted }) {
  const { toast } = useAppFeedback();
  const [rows, setRows] = useState(() => initialRows(day, tz));
  const [justification, setJustification] = useState('');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const nextKey = useRef(0);

  const diff = useMemo(() => adjustmentDiff(rows, day, tz), [rows, day, tz]);
  const ordered = alternates(rows);
  const update = (key, patch) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const addRow = () => {
    const live = rows.filter((r) => !r.removed).length;
    nextKey.current += 1;
    setRows((rs) => [...rs, {
      key: `n${nextKey.current}`,
      punchId: null,
      time: '',
      kind: live % 2 === 0 ? TIME_PUNCH_KIND.IN : TIME_PUNCH_KIND.OUT,
      removed: false,
    }]);
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (rows.some((r) => !r.removed && !r.time)) return setError(t(locale, `${KR}.timeMissing`));
    if (!diff.voidPunchIds.length && !diff.add.length) return setError(t(locale, `${KR}.nothingChanged`));
    if (diff.add.length > TIME_ADJUST_MAX_ADD) return setError(t(locale, `${KR}.tooManyChanges`, { max: TIME_ADJUST_MAX_ADD }));
    if (diff.voidPunchIds.length > TIME_ADJUST_MAX_VOID) return setError(t(locale, `${KR}.tooManyChanges`, { max: TIME_ADJUST_MAX_VOID }));
    if (justification.trim().length < 3) return setError(t(locale, `${KR}.justificationShort`));
    if (proofError(file, locale)) return setError(proofError(file, locale));
    setBusy(true);
    try {
      const { item } = await sendJson('/api/employee/time-clock/requests', {
        kind: TIME_REQUEST_KIND.ADJUSTMENT,
        day: day.day,
        justification: justification.trim(),
        voidPunchIds: diff.voidPunchIds,
        add: diff.add,
      });
      if (file) {
        try {
          await uploadProof(item.id, file);
        } catch {
          toast(t(locale, `${KR}.sentFileFailed`), 'warning');
          return onSubmitted();
        }
      }
      toast(t(locale, `${KR}.sent`), 'ok');
      onSubmitted();
    } catch (err) {
      setError(err?.message || t(locale, `${KR}.sendError`));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
      <p className={cn(S.muted, 'm-0 text-prose')}>{t(locale, `${KR}.adjustIntro`)}</p>
      <section className="flex flex-col gap-2">
        <h3 className={cn(S.label, 'm-0')}>{t(locale, `${KR}.punchesLabel`)}</h3>
        {rows.length === 0 ? <p className={cn(S.faint, 'm-0')}>{t(locale, `${KM}.noPunch`)}</p> : null}
        {rows.map((r) => (
          <div key={r.key} className={cn('flex flex-wrap items-start gap-2 rounded-control border px-3 py-2', r.removed ? 'border-ink/8 bg-ink/[0.02]' : 'border-ink/10')}>
            <FormField label={t(locale, `${KR}.timeLabel`)} className="w-[8.5rem]">
              <input
                type="time"
                className={cn(S.input, r.removed && 'line-through opacity-60')}
                value={r.time}
                disabled={r.removed || busy}
                onChange={(e) => update(r.key, { time: e.target.value })}
                aria-label={t(locale, `${KR}.timeLabel`)}
              />
            </FormField>
            <FormField label={t(locale, `${KR}.kindLabel`)} className="w-[9rem]">
              <select
                className={S.select}
                value={r.kind}
                disabled={r.removed || busy}
                onChange={(e) => update(r.key, { kind: e.target.value })}
              >
                <option value={TIME_PUNCH_KIND.IN}>{punchKindLabel(locale, TIME_PUNCH_KIND.IN)}</option>
                <option value={TIME_PUNCH_KIND.OUT}>{punchKindLabel(locale, TIME_PUNCH_KIND.OUT)}</option>
              </select>
            </FormField>
            <div className="flex min-h-touch items-end self-end">
              {r.punchId ? (
                <button type="button" className={cn(S.btnGhost, 'min-h-touch')} disabled={busy} onClick={() => update(r.key, { removed: !r.removed })}>
                  {t(locale, r.removed ? `${KR}.undoRemove` : `${KR}.removePunch`)}
                </button>
              ) : (
                <button type="button" className={cn(S.btnGhost, 'min-h-touch')} disabled={busy} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>
                  {t(locale, `${KR}.removePunch`)}
                </button>
              )}
            </div>
          </div>
        ))}
        <button type="button" className={cn(S.btnGhost, 'min-h-touch self-start')} disabled={busy} onClick={addRow}>
          {t(locale, `${KR}.addPunch`)}
        </button>
        {!ordered ? <InlineCallout tone="warning">{t(locale, `${KR}.sequenceWarning`)}</InlineCallout> : null}
      </section>
      <FormField label={t(locale, `${KR}.justificationLabel`)}>
        <textarea
          className={S.textarea}
          rows={3}
          maxLength={1000}
          value={justification}
          disabled={busy}
          onChange={(e) => setJustification(e.target.value)}
          placeholder={t(locale, `${KR}.justificationPlaceholder`)}
        />
      </FormField>
      <ProofPicker file={file} onChange={setFile} locale={locale} disabled={busy} />
      {error ? <InlineCallout tone="danger">{error}</InlineCallout> : null}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={cn(S.btnPrimary, 'min-h-touch')} disabled={busy}>
          {busy ? t(locale, 'panel.common.loading') : t(locale, `${KR}.submit`)}
        </button>
        <button type="button" className={cn(S.btnGhost, 'min-h-touch')} disabled={busy} onClick={onCancel}>
          {t(locale, `${KR}.back`)}
        </button>
      </div>
    </form>
  );
}

function ExcuseForm({ day, locale, onCancel, onSubmitted }) {
  const { toast } = useAppFeedback();
  const [reason, setReason] = useState(TIME_REQUEST_EXCUSE_REASONS[0]);
  const [scope, setScope] = useState('day');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [justification, setJustification] = useState('');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const span = scope === 'interval' ? hmSpanMinutes(start, end) : 0;

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (scope === 'interval' && span <= 0) return setError(t(locale, `${KR}.intervalInvalid`));
    if (justification.trim().length < 3) return setError(t(locale, `${KR}.justificationShort`));
    if (proofError(file, locale)) return setError(proofError(file, locale));
    setBusy(true);
    try {
      const { item } = await sendJson('/api/employee/time-clock/requests', {
        kind: TIME_REQUEST_KIND.EXCUSE,
        day: day.day,
        justification: justification.trim(),
        excuseReason: reason,
        excuseStart: scope === 'interval' ? start : null,
        excuseEnd: scope === 'interval' ? end : null,
      });
      if (file) {
        try {
          await uploadProof(item.id, file);
        } catch {
          toast(t(locale, `${KR}.sentFileFailed`), 'warning');
          return onSubmitted();
        }
      }
      toast(t(locale, `${KR}.sent`), 'ok');
      onSubmitted();
    } catch (err) {
      setError(err?.message || t(locale, `${KR}.sendError`));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
      <p className={cn(S.muted, 'm-0 text-prose')}>{t(locale, `${KR}.excuseIntro`)}</p>
      <FormField label={t(locale, `${KR}.reasonLabel`)}>
        <select className={S.select} value={reason} disabled={busy} onChange={(e) => setReason(e.target.value)}>
          {TIME_REQUEST_EXCUSE_REASONS.map((r) => (
            <option key={r} value={r}>{excuseReasonLabel(locale, r)}</option>
          ))}
        </select>
      </FormField>
      <FormField as="div" label={t(locale, `${KR}.periodLabel`)}>
        <SegmentedControl
          aria-label={t(locale, `${KR}.periodLabel`)}
          value={scope}
          onChange={setScope}
          options={[
            { id: 'day', label: t(locale, `${KR}.wholeDay`) },
            { id: 'interval', label: t(locale, `${KR}.interval`) },
          ]}
        />
      </FormField>
      {scope === 'interval' ? (
        <div className={cn(S.fieldRow, 'items-start')}>
          <FormField label={t(locale, `${KR}.intervalStart`)} className="w-[8.5rem]">
            <input type="time" className={S.input} value={start} disabled={busy} onChange={(e) => setStart(e.target.value)} />
          </FormField>
          <FormField label={t(locale, `${KR}.intervalEnd`)} className="w-[8.5rem]">
            <input type="time" className={S.input} value={end} disabled={busy} onChange={(e) => setEnd(e.target.value)} />
          </FormField>
          <FormField as="div" label={t(locale, `${KR}.intervalTotal`)} className="w-[7rem]">
            <span className="flex min-h-touch items-center font-mono tabular-nums text-ink">{formatMinutesClock(span)}</span>
          </FormField>
        </div>
      ) : (
        <p className={cn(S.faint, 'm-0')}>
          {t(locale, `${KR}.wholeDayHint`, { expected: formatMinutesClock(day.expectedMinutes) })}
        </p>
      )}
      <FormField label={t(locale, `${KR}.justificationLabel`)}>
        <textarea
          className={S.textarea}
          rows={3}
          maxLength={1000}
          value={justification}
          disabled={busy}
          onChange={(e) => setJustification(e.target.value)}
          placeholder={t(locale, `${KR}.justificationPlaceholder`)}
        />
      </FormField>
      <ProofPicker file={file} onChange={setFile} locale={locale} disabled={busy} />
      {error ? <InlineCallout tone="danger">{error}</InlineCallout> : null}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={cn(S.btnPrimary, 'min-h-touch')} disabled={busy}>
          {busy ? t(locale, 'panel.common.loading') : t(locale, `${KR}.submit`)}
        </button>
        <button type="button" className={cn(S.btnGhost, 'min-h-touch')} disabled={busy} onClick={onCancel}>
          {t(locale, `${KR}.back`)}
        </button>
      </div>
    </form>
  );
}

function DayPanel({ day, tz, locale, onChanged }) {
  const { toast, confirm } = useAppFeedback();
  const [mode, setMode] = useState('view');
  const [busyId, setBusyId] = useState(null);
  const attachRef = useRef(null);
  const attachFor = useRef(null);
  const pending = (kind) => (day.requests || []).some((r) => r.kind === kind && r.status === TIME_REQUEST_STATUS.PENDING);
  const pendingAdjust = pending(TIME_REQUEST_KIND.ADJUSTMENT);
  const pendingExcuse = pending(TIME_REQUEST_KIND.EXCUSE);
  const noExpected = !day.expectedMinutes;

  const done = () => {
    setMode('view');
    onChanged();
  };

  const cancelRequest = async (req) => {
    const ok = await confirm({
      title: t(locale, `${KR}.cancelTitle`),
      message: t(locale, `${KR}.cancelConfirm`),
      confirmLabel: t(locale, `${KR}.cancelRequest`),
      danger: true,
    });
    if (!ok) return;
    setBusyId(req.id);
    try {
      await sendJson(`/api/employee/time-clock/requests/${req.id}`, null, 'DELETE');
      toast(t(locale, `${KR}.cancelled`), 'ok');
      onChanged();
    } catch (err) {
      toast(err?.message || t(locale, `${KR}.sendError`), 'error');
    } finally {
      setBusyId(null);
    }
  };

  const onAttachPicked = async (file) => {
    const req = attachFor.current;
    if (!file || !req) return;
    const err = proofError(file, locale);
    if (err) return toast(err, 'error');
    setBusyId(req.id);
    try {
      await uploadProof(req.id, file);
      toast(t(locale, `${KR}.proofSaved`), 'ok');
      onChanged();
    } catch (e) {
      toast(e?.message || t(locale, `${KR}.sendError`), 'error');
    } finally {
      setBusyId(null);
    }
  };

  if (mode === 'adjust') {
    return <AdjustForm day={day} tz={tz} locale={locale} onCancel={() => setMode('view')} onSubmitted={done} />;
  }
  if (mode === 'excuse') {
    return <ExcuseForm day={day} locale={locale} onCancel={() => setMode('view')} onSubmitted={done} />;
  }

  const punches = [...(day.punches || [])].sort((a, b) => new Date(a.punchedAt) - new Date(b.punchedAt));
  return (
    <div className="flex flex-col gap-5">
      <input
        ref={attachRef}
        type="file"
        accept={DP_DOC_ALLOWED_MIMES.join(',')}
        className="hidden"
        onChange={(e) => {
          void onAttachPicked(e.target.files?.[0] || null);
          e.target.value = '';
        }}
      />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatMetricTile value={formatMinutesClock(day.workedMinutes)} label={t(locale, `${KM}.colWorked`)} />
        <StatMetricTile value={formatMinutesClock(day.expectedMinutes)} label={t(locale, `${KM}.expected`)} />
        <StatMetricTile value={formatMinutesClock(day.extraMinutes)} label={t(locale, `${KM}.colExtra`)} />
        <StatMetricTile value={formatMinutesClock(day.missingMinutes)} label={t(locale, `${KM}.colMissing`)} />
      </div>

      {day.locked ? (
        <InlineCallout tone="info">{t(locale, `${KR}.lockedHint`)}</InlineCallout>
      ) : (
        <section className="flex flex-col gap-2">
          <h3 className={cn(S.label, 'm-0')}>{t(locale, `${KR}.actionsTitle`)}</h3>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={cn(S.btnPrimary, 'min-h-touch')} disabled={pendingAdjust} onClick={() => setMode('adjust')}>
              {t(locale, `${KR}.requestAdjust`)}
            </button>
            <button type="button" className={cn(S.btnGhost, 'min-h-touch')} disabled={pendingExcuse || noExpected} onClick={() => setMode('excuse')}>
              {t(locale, `${KR}.requestExcuse`)}
            </button>
          </div>
          {pendingAdjust || pendingExcuse ? (
            <p className={cn(S.faint, 'm-0')}>{t(locale, `${KR}.pendingHint`)}</p>
          ) : null}
          {noExpected ? <p className={cn(S.faint, 'm-0')}>{t(locale, `${KR}.noExpectedHint`)}</p> : null}
        </section>
      )}

      {day.justification ? (
        <section>
          <h3 className={cn(S.label, 'mb-2')}>{t(locale, `${KM}.justificationTitle`)}</h3>
          <p className="m-0 font-ui text-sm text-ink">{excuseSummary(locale, day.justification)}</p>
          {day.justification.note ? <p className={cn(S.muted, 'm-0 mt-1 text-prose')}>{day.justification.note}</p> : null}
        </section>
      ) : null}

      <section>
        <h3 className={cn(S.label, 'mb-2')}>{t(locale, `${KM}.punchesTitle`)}</h3>
        {punches.length === 0 ? (
          <p className={cn(S.muted, 'm-0 text-prose')}>{t(locale, `${KM}.noPunch`)}</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {punches.map((p) => (
              <li key={p.id} className={cn('flex flex-wrap items-center gap-2 rounded-control border px-3 py-2', p.voidedAt ? 'border-ink/8 bg-ink/[0.02]' : 'border-ink/10')}>
                <span className={cn('font-mono text-sm tabular-nums', p.voidedAt ? 'text-ink-faint line-through' : 'text-ink')}>
                  {hmInZone(p.punchedAt, tz)}
                </span>
                <StatusToneChip tone={p.punchKind === TIME_PUNCH_KIND.IN ? 'success' : 'info'}>{punchKindLabel(locale, p.punchKind)}</StatusToneChip>
                {p.source === TIME_PUNCH_SOURCE.MANAGER ? <span className={S.faint}>{t(locale, `${KR}.punchByManager`)}</span> : null}
                {p.voidedAt ? <StatusToneChip tone="neutral">{t(locale, `${KM}.voided`)}</StatusToneChip> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className={cn(S.label, 'mb-2')}>{t(locale, `${KR}.requestsTitle`)}</h3>
        {(day.requests || []).length === 0 ? (
          <p className={cn(S.muted, 'm-0 text-prose')}>{t(locale, `${KR}.requestsEmpty`)}</p>
        ) : (
          <div className="flex flex-col gap-2">
            {day.requests.map((req) => (
              <TimeRequestCard
                key={req.id}
                request={req}
                locale={locale}
                showDecider={false}
                fileHref={`/api/employee/time-clock/requests/${req.id}/file`}
                actions={req.status === TIME_REQUEST_STATUS.PENDING ? (
                  <>
                    <button
                      type="button"
                      className={cn(S.btnGhost, 'min-h-touch')}
                      disabled={busyId === req.id}
                      onClick={() => {
                        attachFor.current = req;
                        attachRef.current?.click();
                      }}
                    >
                      {t(locale, req.hasFile ? `${KR}.proofReplace` : `${KR}.proofPick`)}
                    </button>
                    <button type="button" className={cn(S.btnGhost, 'min-h-touch')} disabled={busyId === req.id} onClick={() => void cancelRequest(req)}>
                      {t(locale, `${KR}.cancelRequest`)}
                    </button>
                  </>
                ) : null}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/**
 * Collaborator time history: period totals, one row per day with request status,
 * and a day panel to request an adjustment or an excuse (pending HR approval).
 */
export function EmployeeTimeClockHistory({ locale = 'pt-BR', reloadKey = 0 }) {
  const [preset, setPreset] = useState('30');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [openIso, setOpenIso] = useState(null);

  const loadSeq = useRef(0);
  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    setLoading(true);
    setFailed(false);
    try {
      const range = timeClockPeriodFor(preset);
      const res = await fetch(`/api/employee/time-clock/history?${new URLSearchParams(range)}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || String(res.status));
      if (seq === loadSeq.current) setData(json);
    } catch {
      if (seq === loadSeq.current) setFailed(true);
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [preset]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  const tz = data?.schedule?.timezone;
  const days = useMemo(() => [...(data?.days || [])].reverse(), [data]);
  const openDay = openIso ? (data?.days || []).find((d) => d.day === openIso) || null : null;
  const totals = data?.totals;

  return (
    <div className="flex flex-col gap-4">
      <FormField label={t(locale, `${KM}.periodLabel`)}>
        <SegmentedControl
          aria-label={t(locale, `${KM}.periodLabel`)}
          value={preset}
          onChange={setPreset}
          options={[
            { id: '7', label: t(locale, `${KM}.period7`) },
            { id: '30', label: t(locale, `${KM}.period30`) },
            { id: 'month', label: t(locale, `${KM}.periodMonth`) },
            { id: 'prevMonth', label: t(locale, `${KM}.periodPrevMonth`) },
          ]}
        />
      </FormField>

      {loading && !data ? (
        <AppLoading variant="panel" />
      ) : failed && !data ? (
        <InlineCallout
          tone="danger"
          role="alert"
          action={(
            <button type="button" className={cn(S.btnGhost, 'min-h-touch')} onClick={() => void load()}>
              {t(locale, 'common.retry')}
            </button>
          )}
        >
          {t(locale, `${KR}.historyError`)}
        </InlineCallout>
      ) : (
        <ContentEnter animKey={`emp-tc-history|${data.from}|${data.to}|${totals.pendingRequests}`}>
          {failed ? (
            <InlineCallout
              tone="danger" className="mb-4"
              role="alert"
              action={(
                <button type="button" className={cn(S.btnGhost, 'min-h-touch')} onClick={() => void load()}>
                  {t(locale, 'common.retry')}
                </button>
              )}
            >
              {t(locale, `${KR}.historyError`)}
            </InlineCallout>
          ) : null}
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatMetricTile value={formatMinutesClock(totals.workedMinutes)} label={t(locale, `${KM}.totalWorked`)} />
            <StatMetricTile value={formatMinutesClock(totals.extraMinutes)} label={t(locale, `${KM}.colExtra`)} />
            <StatMetricTile value={formatMinutesClock(totals.missingMinutes)} label={t(locale, `${KM}.colMissing`)} />
            {data.schedule.hourBankEnabled ? (
              <StatMetricTile value={formatMinutesClock(totals.bankBalanceMinutes)} label={t(locale, `${KM}.colBank`)} />
            ) : (
              <StatMetricTile value={totals.pendingRequests} label={t(locale, `${KR}.pendingTotal`)} />
            )}
          </div>
          {days.length === 0 ? (
            <EmptyState title={t(locale, `${KR}.historyEmpty`)} message={t(locale, `${KR}.historyEmptyHint`)} />
          ) : (
            <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label={t(locale, `${KR}.historyAria`)}>
              {days.map((day) => {
                const reqStatus = dayRequestStatus(day);
                return (
                  <li key={day.day}>
                    <button
                      type="button"
                      onClick={() => setOpenIso(day.day)}
                      className={cn(
                        'grid min-h-touch w-full grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 rounded-control border px-3 py-2.5 text-left',
                        'hover:border-brand-500/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/35',
                        day.isWorkday ? 'border-ink/10 bg-surface' : 'border-ink/8 bg-ink/[0.015]'
                      )}
                      aria-label={t(locale, `${KR}.openDay`, { day: dayLabel(day.day, locale) })}
                    >
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-ui text-sm font-medium text-ink">{dayLabel(day.day, locale)}</span>
                        <StatusToneChip tone={OCCURRENCE_TONE[day.occurrence] || 'neutral'}>
                          {t(locale, `${KM}.occ.${day.occurrence}`)}
                        </StatusToneChip>
                        {reqStatus ? <TimeRequestStatusChip status={reqStatus} locale={locale} /> : null}
                        {day.holiday ? <span className={S.faint}>{day.holiday.name}</span> : null}
                      </span>
                      <span className="text-right font-mono text-prose tabular-nums text-ink">
                        {formatMinutesClock(day.workedMinutes)}
                      </span>
                      <PunchSequence day={day} tz={tz} locale={locale} />
                      <span className="text-right text-xs tabular-nums">
                        {day.extraMinutes > 0 ? (
                          <span className="font-mono text-green-800 dark:text-success">+{formatMinutesClock(day.extraMinutes)}</span>
                        ) : day.missingMinutes > 0 ? (
                          <span className="font-mono text-red-800 dark:text-danger">-{formatMinutesClock(day.missingMinutes)}</span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <p className={cn(S.faint, 'm-0 mt-2')}>{t(locale, `${KR}.historyFootnote`)}</p>
        </ContentEnter>
      )}

      <AdminRichFormDrawer
        open={Boolean(openDay)}
        locale={locale}
        title={openDay ? dayLabel(openDay.day, locale) : ''}
        eyebrow={t(locale, `${KR}.myTimeClock`)}
        onClose={() => setOpenIso(null)}
        maxWidth="640px"
      >
        {openDay ? <DayPanel key={openDay.day} day={openDay} tz={tz} locale={locale} onChanged={() => void load()} /> : null}
      </AdminRichFormDrawer>
    </div>
  );
}
