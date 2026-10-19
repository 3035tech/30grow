'use client';
import { useCallback, useEffect, useState } from 'react';
import { t, localeHtmlLang } from '../../lib/i18n';
import { S } from '../dashboard/dashboard-shared';
import { useAppFeedback } from './AppFeedback';

const ESTABLISHMENT_FIELDS = [
  'employerDocument',
  'employerName',
  'complementaryDocument',
  'workplace',
  'registration',
  'responsibleCpf',
  'timezone',
];
const WORKER_FIELDS = [
  'establishmentId',
  'candidateId',
  'cpf',
  'workerName',
  'weeklyRestDay',
  'responsibleCpf',
];
export function RepAdminSettings({ companyId, locale }) {
  const [state, setState] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const { toast } = useAppFeedback();
  const load = useCallback(
    async (signal) => {
      try {
        const res = await fetch(
          `/api/admin/time-clock/rep?companyId=${companyId}`,
          {
            signal: signal
              ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
              : AbortSignal.timeout(15000),
            cache: 'no-store',
          },
        );
        if (!res.ok) throw Error();
        const data = await res.json();
        if (signal?.aborted) return;
        setState(data);
        setLoadError(false);
      } catch {
        if (!signal?.aborted) setLoadError(true);
      }
    },
    [companyId],
  );
  useEffect(() => {
    const controller = new AbortController();
    setState(null);
    setLoadError(false);
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  const save = async (event, action) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    const form = event.currentTarget;
    try {
      const data = Object.fromEntries(new FormData(form));
      const res = await fetch('/api/admin/time-clock/rep', {
        method: 'POST',
        signal: AbortSignal.timeout(30000),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, companyId, action }),
      });
      if (!res.ok)
        throw Error(
          res.status === 409 || res.status === 400 ? 'invalid' : 'save',
        );
      form.reset();
      toast(t(locale, 'rep.saved'), 'success');
      await load();
    } catch (error) {
      toast(
        t(
          locale,
          error.message === 'invalid' ? 'rep.invalidData' : 'rep.saveError',
        ),
        'error',
      );
    } finally {
      setBusy(false);
    }
  };
  const download = async (event) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const data = Object.fromEntries(new FormData(event.currentTarget));
      const res = await fetch(
        `/api/admin/time-clock/rep/export?${new URLSearchParams({ ...data, companyId: String(companyId) })}`,
        { cache: 'no-store', signal: AbortSignal.timeout(60000) },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw Object.assign(
          Error(
            res.status === 409 || res.status === 503 ? 'notReady' : 'download',
          ),
          { displayMessage: body?.error },
        );
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `ponto-${data.format}-${data.from}-${data.to}.zip`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      toast(
        error.displayMessage ||
          t(
            locale,
            error.message === 'notReady' ? 'rep.notReady' : 'rep.downloadError',
          ),
        'error',
      );
    } finally {
      setBusy(false);
    }
  };
  const input = (name, defaultValue = '') => {
    if (name === 'establishmentId' || name === 'weeklyRestDay') {
      const establishments = name === 'establishmentId';
      return (
        <label key={name} className="flex flex-col gap-1 text-sm">
          <span>{t(locale, `rep.${name}`)}</span>
          <select
            name={name}
            required
            defaultValue={establishments ? '' : '0'}
            disabled={establishments && !state?.establishments.length}
            className="min-h-11 rounded-control border border-ink/20 bg-canvas px-3 text-ink"
          >
            {establishments ? (
              <>
                <option value="" disabled>
                  {t(locale, 'rep.selectEstablishment')}
                </option>
                {state?.establishments.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.employer_name} · {e.employer_document}
                  </option>
                ))}
              </>
            ) : (
              Array.from({ length: 7 }, (_, day) => (
                <option key={day} value={day}>
                  {new Intl.DateTimeFormat(localeHtmlLang(locale), {
                    weekday: 'long',
                    timeZone: 'UTC',
                  }).format(new Date(Date.UTC(2026, 0, 4 + day)))}
                </option>
              ))
            )}
          </select>
        </label>
      );
    }
    return (
      <label key={name} className="flex flex-col gap-1 text-sm">
        <span>{t(locale, `rep.${name}`)}</span>
        <input
          name={name}
          required={name !== 'complementaryDocument'}
          defaultValue={defaultValue}
          type={name === 'candidateId' ? 'number' : 'text'}
          min={name === 'candidateId' ? 1 : undefined}
          step={name === 'candidateId' ? 1 : undefined}
          inputMode={
            [
              'cpf',
              'responsibleCpf',
              'registration',
              'complementaryDocument',
            ].includes(name)
              ? 'numeric'
              : undefined
          }
          pattern={
            ['cpf', 'responsibleCpf'].includes(name)
              ? '[0-9]{11}'
              : name === 'registration'
                ? '[0-9]{1,17}'
                : name === 'complementaryDocument'
                  ? '([0-9]{12}|[0-9]{14})?'
                  : undefined
          }
          maxLength={
            {
              employerName: 150,
              workplace: 100,
              workerName: 52,
              cpf: 11,
              responsibleCpf: 11,
              registration: 17,
              complementaryDocument: 14,
              timezone: 64,
            }[name]
          }
          className="min-h-11 rounded-control border border-ink/20 bg-canvas px-3 text-ink"
        />
      </label>
    );
  };
  return (
    <details className="rounded-card border border-ink/10 bg-canvas p-4">
      <summary className="cursor-pointer font-semibold">
        {t(locale, 'rep.repTitle')}
      </summary>
      <p className="my-3 text-sm text-ink-muted">
        {t(locale, 'rep.repPending')}
      </p>
      {state ? (
        <>
          <p className="text-sm">
            {t(locale, 'rep.certificate')}:{' '}
            {t(locale, state.signingConfigured ? 'rep.yes' : 'rep.no')} ·{' '}
            {t(locale, 'rep.pendingWorkers')}: {state.unregisteredWorkers}
          </p>
          <ul className="my-3 text-sm">
            {state.establishments.map((e) => (
              <li key={e.id}>
                {e.employer_name} · {e.employer_document} · NSR {e.last_nsr}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p role="status" className="my-3 text-sm text-ink-muted">
          {t(locale, loadError ? 'rep.loadError' : 'rep.loading')}
          {loadError ? (
            <button
              type="button"
              className={S.btnGhost}
              onClick={() => {
                setLoadError(false);
                void load();
              }}
            >
              {t(locale, 'rep.retry')}
            </button>
          ) : null}
        </p>
      )}
      <form
        onSubmit={(e) => void save(e, 'establishment')}
        className="mt-4 grid gap-3 sm:grid-cols-2"
      >
        <h4 className="font-semibold sm:col-span-2">
          {t(locale, 'rep.setup')}
        </h4>
        {ESTABLISHMENT_FIELDS.map((name) =>
          input(name, name === 'timezone' ? 'America/Sao_Paulo' : ''),
        )}
        <button className={S.btnGhost} disabled={busy || !state} type="submit">
          {t(locale, 'rep.save')}
        </button>
      </form>
      <form
        onSubmit={(e) => void save(e, 'worker')}
        className="mt-6 grid gap-3 sm:grid-cols-2"
      >
        <h4 className="font-semibold sm:col-span-2">
          {t(locale, 'rep.workers')}
        </h4>
        {WORKER_FIELDS.map((name) =>
          input(name, name === 'weeklyRestDay' ? '0' : ''),
        )}
        <button className={S.btnGhost} disabled={busy || !state} type="submit">
          {t(locale, 'rep.save')}
        </button>
      </form>
      <form
        onSubmit={(e) => void download(e)}
        className="mt-6 grid gap-3 sm:grid-cols-2"
      >
        <h4 className="font-semibold sm:col-span-2">
          {t(locale, 'rep.export')}
        </h4>
        {input('establishmentId')}
        <label className="flex flex-col gap-1 text-sm">
          {t(locale, 'rep.format')}
          <select
            name="format"
            className="min-h-11 rounded-control border border-ink/20 bg-canvas px-3"
          >
            <option value="afd">AFD</option>
            <option value="aej">AEJ</option>
          </select>
        </label>
        {['from', 'to'].map((name) => (
          <label key={name} className="flex flex-col gap-1 text-sm">
            {t(locale, `rep.${name}`)}
            <input
              required
              type="date"
              name={name}
              className="min-h-11 rounded-control border border-ink/20 bg-canvas px-3"
            />
          </label>
        ))}
        <button className={S.btnGhost} disabled={busy || !state} type="submit">
          {t(locale, 'rep.export')}
        </button>
      </form>
    </details>
  );
}
