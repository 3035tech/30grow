'use client';
import { useCallback, useEffect, useState } from 'react';
import { t, localeHtmlLang } from '../../lib/i18n';
import { validateFormElementValues } from '../../lib/form-validation';
import { digitsOnly, formatCpfBr, formatCpfCnpjBr, stripCpf, stripCpfCnpjBr } from '../../lib/br-masks.js';
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
  const [formValues, setFormValues] = useState({});
  const { toast, confirm, promptForm } = useAppFeedback();
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
    setFormValues({});
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  const save = async (event, action) => {
    event.preventDefault();
    if (busy) return;
    const validationError = validateFormElementValues(event.currentTarget, locale);
    if (validationError) {
      toast(validationError, 'error');
      return;
    }
    setBusy(true);
    const form = event.currentTarget;
    try {
      const data = Object.fromEntries(new FormData(form));
      if (action === 'establishment') {
        data.employerDocument = stripCpfCnpjBr(data.employerDocument) || '';
        data.complementaryDocument = digitsOnly(data.complementaryDocument).slice(0, 14);
        data.registration = digitsOnly(data.registration).slice(0, 17);
        data.responsibleCpf = stripCpf(data.responsibleCpf) || '';
      } else {
        data.cpf = stripCpf(data.cpf) || '';
        data.responsibleCpf = stripCpf(data.responsibleCpf) || '';
      }
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
      setFormValues((current) => ({ ...current, [action]: {} }));
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
  const changeWorkerStatus = async (worker) => {
    if (busy) return;
    const active = !worker.active;
    const accepted = await confirm({
      title: t(locale, 'rep.workerStatusTitle'),
      message: t(locale, 'rep.workerStatusMessage', {
        name: worker.workerName,
        action: t(locale, active ? 'rep.workerReactivate' : 'rep.workerDeactivate'),
      }),
      confirmLabel: t(locale, active ? 'rep.workerReactivate' : 'rep.workerDeactivate'),
      danger: !active,
    });
    if (!accepted) return;
    const values = await promptForm({
      title: t(locale, 'rep.workerResponsibleTitle'),
      confirmLabel: t(locale, 'rep.save'),
      fields: [{
        key: 'responsibleCpf',
        type: 'text',
        label: t(locale, 'rep.responsibleCpf'),
        required: true,
        inputMode: 'numeric',
        maxLength: 14,
        validate: (value) => digitsOnly(value).length === 11 ? null : t(locale, 'rep.invalidData'),
      }],
    });
    if (!values) return;
    setBusy(true);
    try {
      const res = await fetch('/api/admin/time-clock/rep', {
        method: 'POST',
        signal: AbortSignal.timeout(30000),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          action: 'workerStatus',
          candidateId: worker.candidateId,
          active,
          responsibleCpf: digitsOnly(values.responsibleCpf),
        }),
      });
      if (!res.ok) throw new Error(res.status === 409 || res.status === 400 ? 'invalid' : 'save');
      toast(t(locale, active ? 'rep.workerReactivated' : 'rep.workerDeactivated'), 'success');
      await load();
    } catch (error) {
      toast(t(locale, error.message === 'invalid' ? 'rep.invalidData' : 'rep.workerStatusError'), 'error');
    } finally {
      setBusy(false);
    }
  };
  const download = async (event) => {
    event.preventDefault();
    if (busy) return;
    const validationError = validateFormElementValues(event.currentTarget, locale);
    if (validationError) {
      toast(validationError, 'error');
      return;
    }
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
  const input = (name, defaultValue = '', formKey = '') => {
    const required = name !== 'complementaryDocument';
    const isMasked = ['employerDocument', 'cpf', 'responsibleCpf', 'registration', 'complementaryDocument'].includes(name);
    const initialValue = name === 'employerDocument'
      ? formatCpfCnpjBr(defaultValue)
      : ['cpf', 'responsibleCpf'].includes(name)
        ? formatCpfBr(defaultValue)
        : digitsOnly(defaultValue).slice(0, name === 'registration' ? 17 : 14);
    const value = formValues[formKey]?.[name] ?? initialValue;
    const pattern = name === 'employerDocument'
      ? '(?:\\d{11}|\\d{3}\\.\\d{3}\\.\\d{3}-\\d{2}|[A-Z0-9]{12}\\d{2}|[A-Z0-9]{2}\\.[A-Z0-9]{3}\\.[A-Z0-9]{3}/[A-Z0-9]{4}-\\d{2})'
      : ['cpf', 'responsibleCpf'].includes(name)
        ? '(?:\\d{11}|\\d{3}\\.\\d{3}\\.\\d{3}-\\d{2})'
        : name === 'registration'
          ? '[0-9]{1,17}'
          : name === 'complementaryDocument'
            ? '([0-9]{12}|[0-9]{14})?'
            : undefined;
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
          required={required}
          {...(isMasked ? {
            value,
            onChange: (event) => {
              const raw = event.target.value;
              const next = name === 'employerDocument'
                ? formatCpfCnpjBr(raw)
                : ['cpf', 'responsibleCpf'].includes(name)
                  ? formatCpfBr(raw)
                  : digitsOnly(raw).slice(0, name === 'registration' ? 17 : 14);
              setFormValues((current) => ({
                ...current,
                [formKey]: { ...current[formKey], [name]: next },
              }));
            },
          } : { defaultValue })}
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
          pattern={pattern}
          maxLength={
            {
              employerDocument: 18,
              employerName: 150,
              workplace: 100,
              workerName: 52,
              cpf: 14,
              responsibleCpf: 14,
              registration: 17,
              complementaryDocument: 14,
              timezone: 64,
            }[name]
          }
          placeholder={name === 'employerDocument' ? t(locale, 'rep.employerDocumentPlaceholder') : undefined}
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
          <h4 className="mb-2 mt-5 font-semibold">{t(locale, 'rep.workers')}</h4>
          {state.workers?.length ? (
            <ul className="my-2 divide-y divide-ink/10 rounded-control border border-ink/10">
              {state.workers.map((worker) => (
                <li key={worker.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                  <span>
                    <strong>{worker.workerName}</strong> · {formatCpfBr(worker.cpf)} · {worker.employerName}
                    <span className="ml-2 text-ink-muted">{t(locale, worker.active ? 'rep.active' : 'rep.excluded')}</span>
                  </span>
                  <button
                    type="button"
                    className={S.btnGhost}
                    disabled={busy}
                    onClick={() => void changeWorkerStatus(worker)}
                  >
                    {t(locale, worker.active ? 'rep.workerDeactivate' : 'rep.workerReactivate')}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
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
        noValidate
        onSubmit={(e) => void save(e, 'establishment')}
        className="mt-4 grid gap-3 sm:grid-cols-2"
      >
        <h4 className="font-semibold sm:col-span-2">
          {t(locale, 'rep.setup')}
        </h4>
        {ESTABLISHMENT_FIELDS.map((name) =>
          input(name, name === 'timezone' ? 'America/Sao_Paulo' : '', 'establishment'),
        )}
        <button className={S.btnGhost} disabled={busy || !state} type="submit">
          {t(locale, 'rep.save')}
        </button>
      </form>
      <form
        noValidate
        onSubmit={(e) => void save(e, 'worker')}
        className="mt-6 grid gap-3 sm:grid-cols-2"
      >
        <h4 className="font-semibold sm:col-span-2">
          {t(locale, 'rep.workers')}
        </h4>
        {WORKER_FIELDS.map((name) =>
          input(name, name === 'weeklyRestDay' ? '0' : '', 'worker'),
        )}
        <button className={S.btnGhost} disabled={busy || !state} type="submit">
          {t(locale, 'rep.save')}
        </button>
      </form>
      <form
        noValidate
        onSubmit={(e) => void download(e)}
        className="mt-6 grid gap-3 sm:grid-cols-2"
      >
        <h4 className="font-semibold sm:col-span-2">
          {t(locale, 'rep.export')}
        </h4>
        {input('establishmentId', '', 'export')}
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
