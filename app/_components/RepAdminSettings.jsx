'use client';
import { useCallback, useEffect, useState } from 'react';
import { t, localeHtmlLang } from '../../lib/i18n';
import { validateFormElementValues } from '../../lib/form-validation';
import { digitsOnly, formatCpfBr, formatCpfCnpjBr, stripCpf, stripCpfCnpjBr } from '../../lib/br-masks.js';
import { AdminListPager, AdminListSearch, PanelSubNav, S } from '../dashboard/dashboard-shared';
import { useAppFeedback } from './AppFeedback';
import { EntitySearchSelect } from './EntitySearchSelect';
import { FormField } from './FormField';

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
const REP_SECTIONS = ['establishment', 'workers', 'export'];
const WORKER_PAGE_SIZE = 10;
export function RepAdminSettings({ companyId, locale }) {
  const [state, setState] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formValues, setFormValues] = useState({});
  const [selectedWorker, setSelectedWorker] = useState(null);
  const [section, setSection] = useState('establishment');
  const [workerSearch, setWorkerSearch] = useState('');
  const [workerPage, setWorkerPage] = useState(1);
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
    setSelectedWorker(null);
    setSection('establishment');
    setWorkerSearch('');
    setWorkerPage(1);
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  const save = async (event, action) => {
    event.preventDefault();
    if (busy) return;
    if (action === 'worker' && !formValues.worker?.candidateId) {
      toast(t(locale, 'rep.selectWorker'), 'error');
      return;
    }
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
      if (action === 'worker') setSelectedWorker(null);
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
    if (name === 'candidateId') return null;
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
  const workerItems = (state?.workers || []).filter((worker) => {
    const search = workerSearch.trim().toLocaleLowerCase(localeHtmlLang(locale));
    if (!search) return true;
    const language = localeHtmlLang(locale);
    return [worker.workerName, worker.cpf, worker.employerName]
      .some((value) => String(value || '').toLocaleLowerCase(language).includes(search));
  });
  const workerTotalPages = Math.max(1, Math.ceil(workerItems.length / WORKER_PAGE_SIZE));
  const safeWorkerPage = Math.min(workerPage, workerTotalPages);
  const visibleWorkers = workerItems.slice(
    (safeWorkerPage - 1) * WORKER_PAGE_SIZE,
    safeWorkerPage * WORKER_PAGE_SIZE,
  );
  return (
    <section className="rounded-card border border-ink/10 bg-canvas p-4">
      <header>
        <h2 className="m-0 font-ui text-lg font-semibold text-ink">
          {t(locale, 'rep.repTitle')}
        </h2>
      </header>
      <p className="my-3 text-sm text-ink-muted">
        {t(locale, 'rep.repPending')}
      </p>
      {state ? (
        <section className="my-4 rounded-control border border-ink/10 bg-surface p-4" aria-labelledby="rep-readiness-title">
          <h3 id="rep-readiness-title" className="m-0 font-ui text-sm font-semibold text-ink">
            {t(locale, 'rep.readinessTitle')}
          </h3>
          <ul className="mb-0 mt-3 grid gap-2 pl-5 text-sm">
            <li className={state.establishments.length ? 'text-success' : 'text-warning'}>
              {t(locale, 'rep.setup')}: {t(locale, state.establishments.length ? 'rep.stepReady' : 'rep.stepPending')}
              {!state.establishments.length ? ` — ${t(locale, 'rep.establishmentNeeded')}` : ''}
            </li>
            <li className={state.signingConfigured ? 'text-success' : 'text-warning'}>
              {t(locale, 'rep.certificate')}: {t(locale, state.signingConfigured ? 'rep.stepReady' : 'rep.stepPending')}
            </li>
            <li className={state.unregisteredWorkers === 0 ? 'text-success' : 'text-warning'}>
              {t(locale, 'rep.pendingWorkers')}: {state.unregisteredWorkers === 0
                ? t(locale, 'rep.stepReady')
                : t(locale, 'rep.workersPendingCount', { count: state.unregisteredWorkers })}
            </li>
          </ul>
          <p className="mb-0 mt-3 text-xs leading-5 text-ink-muted">{t(locale, 'rep.readinessHelp')}</p>
        </section>
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
      {state ? (
        <PanelSubNav
          ariaLabel={t(locale, 'rep.sectionsAria')}
          active={section}
          onChange={(id) => {
            if (REP_SECTIONS.includes(id)) setSection(id);
          }}
          variant="pill"
          className="mb-0"
          tabs={[
            {
              id: 'establishment',
              label: t(locale, 'rep.setup'),
              tabId: 'rep-config-tab-establishment',
              panelId: 'rep-config-panel-establishment',
            },
            {
              id: 'workers',
              label: t(locale, 'rep.workers'),
              badge: state.unregisteredWorkers || undefined,
              tabId: 'rep-config-tab-workers',
              panelId: 'rep-config-panel-workers',
            },
            {
              id: 'export',
              label: t(locale, 'rep.export'),
              tabId: 'rep-config-tab-export',
              panelId: 'rep-config-panel-export',
            },
          ]}
        />
      ) : null}
      {state && section === 'establishment' ? (
        <section id="rep-config-panel-establishment" role="tabpanel" tabIndex={0} aria-labelledby="rep-config-tab-establishment" className="min-w-0 pt-4">
          {state.establishments.length ? (
            <ul className="mb-4 mt-0 space-y-1 text-sm">
              {state.establishments.map((e) => (
                <li key={e.id}>{e.employer_name} · {e.employer_document} · NSR {e.last_nsr}</li>
              ))}
            </ul>
          ) : null}
          <form noValidate onSubmit={(e) => void save(e, 'establishment')} className="grid gap-3 sm:grid-cols-2">
            {ESTABLISHMENT_FIELDS.map((name) =>
              input(name, name === 'timezone' ? 'America/Sao_Paulo' : '', 'establishment'),
            )}
            <button className={S.btnGhost} disabled={busy || !state} type="submit">{t(locale, 'rep.save')}</button>
          </form>
        </section>
      ) : null}
      {state && section === 'workers' ? (
        <section id="rep-config-panel-workers" role="tabpanel" tabIndex={0} aria-labelledby="rep-config-tab-workers" className="min-w-0 pt-4">
          <form noValidate onSubmit={(e) => void save(e, 'worker')} className="grid gap-3 sm:grid-cols-2">
            <FormField as="div" label={t(locale, 'rep.candidateId')} required className="sm:col-span-2">
              <EntitySearchSelect
                value={formValues.worker?.candidateId || ''}
                onChange={(id, item) => {
                  setSelectedWorker(item || null);
                  setFormValues((current) => ({
                    ...current,
                    worker: {
                      ...current.worker,
                      candidateId: id,
                      cpf: item?.cpf ? formatCpfBr(item.cpf) : '',
                      workerName: item?.label || '',
                    },
                  }));
                }}
                searchUrl={`/api/admin/time-clock/rep/candidates?companyId=${encodeURIComponent(companyId)}`}
                initialSelection={selectedWorker}
                locale={locale}
                placeholder={t(locale, 'rep.searchWorker')}
                minChars={2}
                required
                disabled={busy || !state.establishments.length}
              />
              <input type="hidden" name="candidateId" value={formValues.worker?.candidateId || ''} />
              {selectedWorker && !selectedWorker.cpf ? (
                <p className="mb-0 mt-1 text-xs text-warning">{t(locale, 'rep.workerCpfMissing')}</p>
              ) : null}
            </FormField>
            {WORKER_FIELDS.map((name) =>
              input(name, name === 'weeklyRestDay' ? '0' : '', 'worker'),
            )}
            <button className={S.btnGhost} disabled={busy || !state.establishments.length} type="submit">{t(locale, 'rep.save')}</button>
          </form>
          <div className="mt-6">
            <AdminListSearch
              locale={locale}
              value={workerSearch}
              onChange={(value) => { setWorkerSearch(value); setWorkerPage(1); }}
              label={t(locale, 'rep.searchRegisteredWorker')}
              placeholder={t(locale, 'rep.searchRegisteredWorker')}
            />
            {visibleWorkers.length ? (
              <ul className="my-2 divide-y divide-ink/10 rounded-control border border-ink/10">
                {visibleWorkers.map((worker) => (
                  <li key={worker.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                    <span className="min-w-0">
                      <strong>{worker.workerName}</strong> · {formatCpfBr(worker.cpf)} · {worker.employerName}
                      <span className="ml-2 text-ink-muted">{t(locale, worker.active ? 'rep.active' : 'rep.excluded')}</span>
                    </span>
                    <button type="button" className={S.btnGhost} disabled={busy} onClick={() => void changeWorkerStatus(worker)}>
                      {t(locale, worker.active ? 'rep.workerDeactivate' : 'rep.workerReactivate')}
                    </button>
                  </li>
                ))}
              </ul>
            ) : <p className="m-0 mt-3 text-sm text-ink-muted">{t(locale, workerSearch ? 'rep.noWorkerMatch' : 'rep.noRegisteredWorkers')}</p>}
            <AdminListPager
              locale={locale}
              page={safeWorkerPage}
              pageSize={WORKER_PAGE_SIZE}
              total={workerItems.length}
              onPageChange={setWorkerPage}
              pageSizeOptions={[WORKER_PAGE_SIZE]}
            />
          </div>
        </section>
      ) : null}
      {state && section === 'export' ? (
        <section id="rep-config-panel-export" role="tabpanel" tabIndex={0} aria-labelledby="rep-config-tab-export" className="min-w-0 pt-4">
          <form noValidate onSubmit={(e) => void download(e)} className="grid gap-3 sm:grid-cols-2">
            {input('establishmentId', '', 'export')}
            <label className="flex flex-col gap-1 text-sm">
              {t(locale, 'rep.format')}
              <select name="format" className="min-h-11 rounded-control border border-ink/20 bg-canvas px-3">
                <option value="afd">AFD</option>
                <option value="aej">AEJ</option>
              </select>
            </label>
            {['from', 'to'].map((name) => (
              <label key={name} className="flex flex-col gap-1 text-sm">
                {t(locale, `rep.${name}`)}
                <input required type="date" name={name} className="min-h-11 rounded-control border border-ink/20 bg-canvas px-3" />
              </label>
            ))}
            <button className={S.btnGhost} disabled={busy || !state.establishments.length} type="submit">
              {t(locale, 'rep.export')}
            </button>
          </form>
        </section>
      ) : null}
    </section>
  );
}
