'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { t } from '../../lib/i18n';
import { ORG_UNIT, orgUnitOptions } from '../../lib/org-unit-constants.js';
import { FormField } from './FormField';
import { SelectField } from './SelectField';
import { InlineCallout } from './InlineCallout';
import { AppLoading } from './AppLoading';
import { CollapsibleBlock } from './CollapsibleBlock';
import { useAppFeedback } from './AppFeedback';
import { AdminCreateButton, S } from '../dashboard/dashboard-shared';
import { EntitySearchSelect } from './EntitySearchSelect';

export async function orgUnitRequest(companyId, { signal, method = 'GET', body, candidateId } = {}) {
  const params = new URLSearchParams({ companyId: String(companyId) });
  if (candidateId) params.set('candidateId', String(candidateId));
  const response = await fetch(`/api/admin/org-units?${params}`, {
    signal, method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, companyId: Number(companyId) }) } : {}),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || String(response.status));
  return data;
}

export function useOrgUnits(companyId) {
  const [version, setVersion] = useState(0);
  const [state, setState] = useState({ units: [], loading: true, error: '' });
  const reload = useCallback(() => setVersion((value) => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    setState({ units: [], loading: Boolean(companyId), error: '' });
    if (companyId) orgUnitRequest(companyId, { signal: controller.signal })
      .then((data) => setState({ units: data.units, loading: false, error: '' }))
      .catch((error) => { if (!controller.signal.aborted) setState({ units: [], loading: false, error: error.message }); });
    return () => controller.abort();
  }, [companyId, version]);
  return { ...state, reload };
}

export function OrgUnitSelect({ units, locale, value, onChange, disabled, filter = false }) {
  return <FormField label={t(locale, 'panel.orgUnits.unit')}>
    <SelectField value={value ?? ''} onChange={onChange} disabled={disabled} aria-label={t(locale, 'panel.orgUnits.unit')}>
      {filter ? <option value="">{t(locale, 'panel.orgUnits.all')}</option> : null}
      <option value={filter ? ORG_UNIT.FILTER_NONE : ''}>{t(locale, 'panel.orgUnits.none')}</option>
      {orgUnitOptions(units).map((unit) => <option key={unit.id} value={unit.id}>{unit.label}</option>)}
    </SelectField>
  </FormField>;
}

export function OrgUnitFilter({ companyId, locale, value, onChange }) {
  const { units, loading, error, reload } = useOrgUnits(companyId);
  if (!companyId) return null;
  return <div className="min-w-0 sm:min-w-56">
    <OrgUnitSelect units={units} locale={locale} value={value} onChange={(event) => onChange(event.target.value)} disabled={loading || Boolean(error)} filter />
    {error ? <div role="alert" className={S.faint}>{error} <button type="button" className={S.btnGhost} onClick={reload}>{t(locale, 'panel.orgUnits.retry')}</button></div> : null}
  </div>;
}

export function CandidateOrgUnit({ companyId, candidateId, locale, onSaved }) {
  const { units, loading, error: listError, reload } = useOrgUnits(companyId);
  const { toast, promptForm, confirm } = useAppFeedback();
  const [value, setValue] = useState('');
  const [initial, setInitial] = useState('');
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  const options = useMemo(() => orgUnitOptions(units), [units]);
  useEffect(() => {
    const controller = new AbortController();
    setReading(true); setLoaded(false); setError('');
    orgUnitRequest(companyId, { candidateId, signal: controller.signal }).then((data) => {
      const next = data.orgUnitId ? String(data.orgUnitId) : '';
      setValue(next); setInitial(next); setReading(false); setLoaded(true);
    }).catch((e) => { if (!controller.signal.aborted) { setError(e.message); setReading(false); } });
    return () => controller.abort();
  }, [companyId, candidateId, version]);
  async function save() {
    if (busy || !loaded || listError || value === initial) return;
    setBusy(true); setError('');
    try {
      if (!await confirm({ title: t(locale, 'panel.orgUnits.unit'), message: t(locale, 'panel.orgUnits.confirmChange', { name: units.find((unit) => String(unit.id) === value)?.name || t(locale, 'panel.orgUnits.none') }), confirmLabel: t(locale, 'panel.orgUnits.save') })) return;
      await orgUnitRequest(companyId, { method: 'PUT', body: { candidateId: Number(candidateId), orgUnitId: value ? Number(value) : null } });
      setInitial(value); toast(t(locale, 'panel.orgUnits.saved'), 'ok'); onSaved?.();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); setVersion((n) => n + 1); }
  }
  async function createAndAssign() {
    if (busy || !companyId) return;
    const values = await promptForm({
      title: t(locale, 'panel.orgUnits.create'),
      confirmLabel: t(locale, 'panel.orgUnits.create'),
      fields: [
        {
          key: 'name',
          label: t(locale, 'panel.orgUnits.name'),
          required: true,
          defaultValue: '',
        },
      ],
    });
    if (!values?.name) return;
    setBusy(true); setError('');
    try {
      const created = await orgUnitRequest(companyId, {
        method: 'POST',
        body: { name: String(values.name).trim(), parentId: null },
      });
      // Creating an option does not change the person's organizational link.
      setValue(String(created.id));
      reload();
      toast(t(locale, 'panel.orgUnits.created'), 'ok');
    } catch (e) {
      setError(e.message);
    } finally { setBusy(false); }
  }
  return <CollapsibleBlock locale={locale} title={t(locale, 'panel.orgUnits.unit')} defaultOpen={false} variant="card"
    collapsedHint={units.find((unit) => String(unit.id) === initial)?.name || t(locale, 'panel.orgUnits.none')}>
    {loading || reading ? <AppLoading variant="panel" /> : <div className="flex flex-col gap-3">
      {error || listError ? <InlineCallout tone="danger"><span role="alert">{error || listError}</span><button type="button" className={S.btnGhost} disabled={busy} onClick={() => { reload(); setVersion((v) => v + 1); }}>{t(locale, 'panel.orgUnits.retry')}</button></InlineCallout> : null}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <FormField label={t(locale, 'panel.orgUnits.unit')} hint={t(locale, 'panel.orgChart.currentManager', { name: units.find((unit) => String(unit.id) === initial)?.name || t(locale, 'panel.orgUnits.none') })}>
            <EntitySearchSelect key={version} locale={locale} options={options} minChars={0} value={value} onChange={(id) => setValue(id)} placeholder={t(locale, 'panel.orgUnits.search')} aria-label={t(locale, 'panel.orgUnits.unit')} disabled={busy || !loaded || Boolean(listError)} />
          </FormField>
        </div>
        <AdminCreateButton variant="secondary" label={t(locale, 'panel.orgUnits.create')} onClick={() => void createAndAssign()} disabled={busy || !loaded || Boolean(listError)} />
      </div>
      {value !== initial ? <p className={S.muted}>{t(locale, 'panel.orgUnits.pending', { name: units.find((unit) => String(unit.id) === value)?.name || t(locale, 'panel.orgUnits.none') })}</p> : null}
      <button type="button" className={S.btnPrimary} disabled={busy || !loaded || Boolean(listError) || value === initial} onClick={save}>{t(locale, busy ? 'panel.orgUnits.saving' : 'panel.orgUnits.save')}</button>
    </div>}
  </CollapsibleBlock>;
}
