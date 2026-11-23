'use client';
import { useCallback, useEffect, useState } from 'react';
import { t, localeHtmlLang } from '../../lib/i18n';
import { cn } from '../../lib/cn';
import { validateFormElementValues } from '../../lib/form-validation';
import { digitsOnly, formatCpfBr, formatCpfCnpjBr, stripCpf, stripCpfCnpjBr } from '../../lib/br-masks.js';
import { AdminListPager, AdminListSearch, PanelSubNav, S } from '../dashboard/dashboard-shared';
import { AdminRichFormDrawer, dialogBtnGhostClass, dialogBtnPrimaryClass } from './AdminRichFormDrawer';
import { useAppFeedback } from './AppFeedback';
import { EntitySearchSelect } from './EntitySearchSelect';
import { FormField } from './FormField';
import { StatusToneChip } from './StatusToneChip';

const ESTABLISHMENT_FIELDS = [
  'employerDocument',
  'employerName',
  'complementaryDocument',
  'workplace',
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
export function RepAdminSettings({ companyId, locale, onOpenSchedule, onOpenEmployeeData }) {
  const [state, setState] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formValues, setFormValues] = useState({});
  const [selectedWorker, setSelectedWorker] = useState(null);
  const [section, setSection] = useState('establishment');
  const [workerSearch, setWorkerSearch] = useState('');
  const [workerPage, setWorkerPage] = useState(1);
  const [formDialog, setFormDialog] = useState(null);
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
    setFormDialog(null);
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
      setFormDialog(null);
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
    const isMasked = ['employerDocument', 'cpf', 'responsibleCpf', 'complementaryDocument'].includes(name);
    const initialValue = name === 'employerDocument'
      ? formatCpfCnpjBr(defaultValue)
      : ['cpf', 'responsibleCpf'].includes(name)
        ? formatCpfBr(defaultValue)
        : digitsOnly(defaultValue).slice(0, 14);
    const value = formValues[formKey]?.[name] ?? initialValue;
    const pattern = name === 'employerDocument'
      ? '(?:\\d{11}|\\d{3}\\.\\d{3}\\.\\d{3}-\\d{2}|[A-Z0-9]{12}\\d{2}|[A-Z0-9]{2}\\.[A-Z0-9]{3}\\.[A-Z0-9]{3}/[A-Z0-9]{4}-\\d{2})'
      : ['cpf', 'responsibleCpf'].includes(name)
        ? '(?:\\d{11}|\\d{3}\\.\\d{3}\\.\\d{3}-\\d{2})'
      : name === 'complementaryDocument'
            ? '([0-9]{12}|[0-9]{14})?'
            : undefined;
    if (name === 'establishmentId' || name === 'weeklyRestDay') {
      const establishments = name === 'establishmentId';
      return (
        <label key={name} className="flex flex-col gap-1 text-sm">
          <span>{t(locale, `rep.${name}`)} <span className="text-danger" aria-hidden="true">*</span></span>
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
        <span>{t(locale, `rep.${name}`)}{required ? <> <span className="text-danger" aria-hidden="true">*</span></> : null}</span>
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
                  : digitsOnly(raw).slice(0, 14);
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
  const establishmentReady = Boolean(state?.establishments.length) && state.establishments.every((item) => item.setupValid === true);
  const missingEstablishments = (state?.establishments || []).map((item) => ({
    ...item,
    missingFields: item.setupIssues || [],
  })).filter((item) => !item.setupValid);
  const missingFieldLabels = {
    employer_name: 'employerName', employer_document: 'employerDocument',
    complementary_document: 'complementaryDocument', responsible_cpf: 'responsibleCpf', timezone: 'timezone', workplace: 'workplace',
    admission: 'admissionDate', jobRole: 'jobRole', repLink: 'workers',
  };
  const issuePeople = state?.candidateIssues || [];
  const unregisteredPeople = issuePeople.filter((person) => person.missingRepLink);
  const incompleteProfilePeople = issuePeople.filter((person) => !person.missingRepLink && person.missingFields.length > 0);
  const openSection = (next) => {
    setSection(next);
    document.getElementById(`rep-config-tab-${next}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };
  const workerStepReady = state?.unregisteredWorkers === 0 && state?.incompleteWorkerProfiles === 0;
  const setupSteps = state ? [
    {
      id: 'establishment',
      title: t(locale, 'rep.setup'),
      ready: establishmentReady,
      detail: t(locale, establishmentReady ? 'rep.establishmentReadyHelp' : state.establishments.length ? 'rep.establishmentIncomplete' : 'rep.establishmentNeeded'),
      items: missingEstablishments.map((item) => ({
        label: item.employer_name || item.employer_document,
        detail: item.missingFields.map((field) => t(locale, `rep.${missingFieldLabels[field]}`)).join(', '),
      })),
      action: { label: t(locale, 'rep.fixStep'), onClick: () => setFormDialog('establishment') },
    },
    {
      id: 'schedule',
      title: t(locale, 'rep.companySchedule'),
      ready: state.scheduleConfigured,
      detail: t(locale, state.scheduleConfigured ? 'rep.scheduleReadyHelp' : 'rep.companyScheduleHelp'),
      action: { label: t(locale, 'rep.configureStep'), onClick: onOpenSchedule },
    },
    {
      id: 'workers',
      title: t(locale, 'rep.pendingWorkers'),
      ready: workerStepReady,
      detail: [
        state.unregisteredWorkers > 0 ? t(locale, 'rep.workersPendingCount', { count: state.unregisteredWorkers }) : '',
        state.incompleteWorkerProfiles > 0 ? t(locale, 'rep.workerProfilesIncomplete', { count: state.incompleteWorkerProfiles }) : '',
        workerStepReady ? t(locale, 'rep.workersReadyHelp') : '',
      ].filter(Boolean).join(' '),
      items: [
        ...unregisteredPeople.map((person) => ({
          label: person.candidateName,
          detail: t(locale, 'rep.workersNeedLink'),
          onClick: () => openSection('workers'),
        })),
        ...incompleteProfilePeople.map((person) => ({
          label: person.candidateName,
          detail: person.missingFields.map((field) => t(locale, `rep.${missingFieldLabels[field]}`)).join(', '),
          onClick: () => onOpenEmployeeData?.(person.candidateId),
        })),
      ],
      actions: [
        ...(!workerStepReady ? [{ label: t(locale, 'rep.fixStep'), onClick: () => setFormDialog('worker') }] : []),
        ...(state.incompleteWorkerProfiles > 0 ? [{ label: t(locale, 'rep.openEmployeeRecords'), onClick: onOpenEmployeeData }] : []),
      ],
    },
  ] : [];
  const progressSteps = setupSteps.filter((step) => step.countInProgress !== false);
  const readySteps = progressSteps.filter((step) => step.ready).length;
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
          <p className="mb-3 mt-2 text-sm text-ink-muted">{t(locale, 'rep.setupProgress', { ready: readySteps, total: progressSteps.length })}</p>
          <ol className="m-0 grid list-none gap-0 p-0">
            {setupSteps.map((step, index) => (
              <li key={step.id} className="grid gap-3 border-t border-ink/8 py-4 first:border-t-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <div className="flex min-w-0 items-start gap-3">
                    <span aria-hidden="true" className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-semibold ${step.ready ? 'bg-success/10 text-success' : step.statusTone === 'info' ? 'bg-info/10 text-info' : 'bg-warning/12 text-warning'}`}>{String(index + 1).padStart(2, '0')}</span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="m-0 font-ui text-sm font-semibold text-ink">{step.title}</h4>
                      <StatusToneChip tone={step.statusTone || (step.ready ? 'success' : 'warning')}>{step.statusLabel || t(locale, step.ready ? 'rep.stepReady' : 'rep.stepPending')}</StatusToneChip>
                    </div>
                    <p className="mb-0 mt-1 max-w-[68ch] text-sm leading-5 text-ink-muted">{step.detail}</p>
                    {step.items?.length ? <ul className="mb-0 mt-3 grid gap-2 p-0">{step.items.map((item, itemIndex) => <li key={`${item.label}-${itemIndex}`} className="flex flex-col gap-2 rounded-control border border-ink/8 bg-canvas px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><span className="block break-words text-sm font-medium text-ink">{item.label}</span><span className="mt-0.5 block text-xs leading-5 text-ink-muted">{item.detail}</span></div>{item.onClick ? <button type="button" className="min-h-10 shrink-0 text-left text-sm font-semibold text-brand-dark underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500" onClick={item.onClick}>{t(locale, 'rep.fixStep')}</button> : null}</li>)}</ul> : null}
                    {step.id === 'workers' && issuePeople.length > 0 && (state.unregisteredWorkers + state.incompleteWorkerProfiles) > issuePeople.length ? <p className="mb-0 mt-1 text-xs text-ink-muted">{t(locale, 'rep.morePeopleNeedAttention', { count: state.unregisteredWorkers + state.incompleteWorkerProfiles - issuePeople.length })}</p> : null}
                  </div>
                </div>
                {(step.action || step.actions?.length) ? <div className="flex flex-wrap gap-2 pl-10 sm:pl-0">{[...(step.action ? [step.action] : []), ...(step.actions || [])].map((action) => <button key={action.label} type="button" className={cn(S.btnGhost, 'min-h-touch')} onClick={action.onClick}>{action.label}</button>)}</div> : null}
              </li>
            ))}
          </ol>
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
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="m-0 font-ui text-sm font-semibold text-ink">{t(locale, 'rep.setup')}</h3>
              <p className="mb-0 mt-1 text-sm text-ink-muted">{t(locale, state.establishments.length ? 'rep.establishmentReadyHelp' : 'rep.establishmentNeeded')}</p>
            </div>
            <button type="button" className={cn(S.btnPrimary, 'min-h-touch shrink-0')} disabled={busy} onClick={() => setFormDialog('establishment')}>
              {t(locale, 'rep.setup')}
            </button>
          </div>
          {state.establishments.length ? (
            <ul className="mb-0 mt-4 divide-y divide-ink/10 rounded-control border border-ink/10">
              {state.establishments.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                  <span className="min-w-0 break-words font-medium text-ink">{e.employer_name} <span className="font-normal text-ink-muted">· {e.employer_document}</span></span>
                  <span className="text-ink-muted">NSR {e.last_nsr}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
      {state && section === 'workers' ? (
        <section id="rep-config-panel-workers" role="tabpanel" tabIndex={0} aria-labelledby="rep-config-tab-workers" className="min-w-0 pt-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="m-0 font-ui text-sm font-semibold text-ink">{t(locale, 'rep.workers')}</h3>
              <p className="mb-0 mt-1 text-sm text-ink-muted">{t(locale, 'rep.workersPendingCount', { count: state.unregisteredWorkers || 0 })}</p>
            </div>
            <button type="button" className={cn(S.btnPrimary, 'min-h-touch shrink-0')} disabled={busy || !state.establishments.length} onClick={() => setFormDialog('worker')}>
              {t(locale, 'rep.workers')}
            </button>
          </div>
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
      <AdminRichFormDrawer
        open={Boolean(formDialog)}
        title={t(locale, formDialog === 'worker' ? 'rep.workers' : 'rep.setup')}
        locale={locale}
        onClose={() => { if (!busy) setFormDialog(null); }}
        busy={busy}
        footer={(
          <>
            <button type="button" className={dialogBtnGhostClass} disabled={busy} onClick={() => setFormDialog(null)}>{t(locale, 'panel.common.cancel')}</button>
            <button type="submit" form={`rep-${formDialog}-form`} className={dialogBtnPrimaryClass} disabled={busy}>{t(locale, 'rep.save')}</button>
          </>
        )}
      >
        {formDialog === 'establishment' ? (
          <form id="rep-establishment-form" noValidate onSubmit={(e) => void save(e, 'establishment')} className="grid items-start gap-4 sm:grid-cols-2">
            {ESTABLISHMENT_FIELDS.map((name) => input(name, name === 'timezone' ? 'America/Sao_Paulo' : '', 'establishment'))}
          </form>
        ) : null}
        {formDialog === 'worker' ? (
          <form id="rep-worker-form" noValidate onSubmit={(e) => void save(e, 'worker')} className="grid items-start gap-4 sm:grid-cols-2">
            <FormField as="div" label={t(locale, 'rep.candidateId')} required className="sm:col-span-2">
              <EntitySearchSelect
                value={formValues.worker?.candidateId || ''}
                onChange={(id, item) => {
                  setSelectedWorker(item || null);
                  setFormValues((current) => ({ ...current, worker: { ...current.worker, candidateId: id, cpf: item?.cpf ? formatCpfBr(item.cpf) : '', workerName: item?.label || '' } }));
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
              {selectedWorker && !selectedWorker.cpf ? <p className="mb-0 mt-1 text-xs text-warning">{t(locale, 'rep.workerCpfMissing')}</p> : null}
            </FormField>
            {WORKER_FIELDS.map((name) => input(name, name === 'weeklyRestDay' ? '0' : '', 'worker'))}
          </form>
        ) : null}
      </AdminRichFormDrawer>
    </section>
  );
}
