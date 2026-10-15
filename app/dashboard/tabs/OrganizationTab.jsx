'use client';

import { useListUrlState } from '../hooks/useListUrlState';

import { useState } from 'react';
import { cn } from '../../../lib/cn';
import { t } from '../../../lib/i18n';
import { ORG_UNIT_TYPES } from '../../../lib/org-position-constants.js';
import { OrgHeadcountBlock } from '../OrgHeadcountBlock';
import { ORG_UNIT, orgUnitOptions } from '../../../lib/org-unit-constants.js';
import { AdminPageHeader, AdminCreateButton, AdminListPager, PanelSubNav, S } from '../dashboard-shared';
import { useOrgUnits, orgUnitRequest } from '../../_components/OrgUnitField';
import { EmptyState } from '../../_components/EmptyState';
import { InlineCallout } from '../../_components/InlineCallout';
import { AppLoading, ContentEnter } from '../../_components/AppLoading';
import { useAppFeedback } from '../../_components/AppFeedback';
import { OrgChartBlock } from '../../_components/OrgChartBlock';

const PAGE_SIZE = 20;
export function OrganizationTab({ companyId, locale, navigateDashboard, canManageVacancies = false }) {
  const { units, loading, error, reload } = useOrgUnits(companyId);
  const { confirm, toast, promptForm } = useAppFeedback();
  const [section,setSection]=useListUrlState('organization','section','structure');
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useListUrlState('organization', 'page', 1);
  const options = orgUnitOptions(units);
  const safePage = Math.min(page, Math.max(1, Math.ceil(options.length / PAGE_SIZE)));
  const listTitle = t(locale, 'panel.orgUnits.listTitle');
  async function edit(unit = {}) {
    const titleKey = unit.id ? 'panel.orgUnits.edit' : 'panel.orgUnits.create';
    const values = await promptForm({
      title: t(locale, titleKey),
      confirmLabel: t(locale, 'panel.orgUnits.save'),
      fields: [
        {key:'unitType',label:t(locale,'headcount.type'),type:'select',defaultValue:unit.unitType||'team',options:ORG_UNIT_TYPES.map(value=>({value,label:t(locale,`headcount.${value}`)}))},
        { key: 'name', label: t(locale, 'panel.orgUnits.name'), required: true, maxLength: ORG_UNIT.MAX_NAME, defaultValue: unit.name || '', row: 'unit' },
        {
          key: 'parentId',
          label: t(locale, 'panel.orgUnits.parent'),
          type: 'select',
          defaultValue: unit.parentId ? String(unit.parentId) : '',
          options: [
            { value: '', label: t(locale, 'panel.orgUnits.noParent') },
            ...options.filter((option) => option.id !== unit.id).map((option) => ({ value: String(option.id), label: option.label })),
          ],
          row: 'unit',
        },
      ],
      submit: (v) => orgUnitRequest(companyId, {
        method: unit.id ? 'PATCH' : 'POST',
        body: { id: unit.id, name: String(v.name || '').trim(), unitType:v.unitType, parentId: v.parentId ? Number(v.parentId) : null },
      }),
    });
    if (!values) return;
    reload(); toast(t(locale, 'panel.orgUnits.saved'), 'ok');
  }
  async function archive(unit) {
    if (!await confirm({ title: t(locale, 'panel.orgUnits.archive'), message: t(locale, 'panel.orgUnits.archiveConfirm', { name: unit.name }) })) return;
    setBusy(true);
    try {
      await orgUnitRequest(companyId, { method: 'PATCH', body: { id: unit.id, active: false } });
      reload(); toast(t(locale, 'panel.orgUnits.saved'), 'ok');
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  }
  if (!companyId) return <EmptyState title={t(locale, 'panel.orgUnits.chooseCompany')} />;
  return <div className="flex flex-col gap-4">
    <PanelSubNav locale={locale} ariaLabel={t(locale,'panel.orgUnits.title')} active={section} onChange={setSection} tabs={[{id:'structure',label:t(locale,'headcount.structure')},{id:'headcount',label:t(locale,'headcount.positions')}]}/>
    {section==='headcount'?<OrgHeadcountBlock key={companyId} companyId={companyId} locale={locale} navigateDashboard={navigateDashboard} canManageVacancies={canManageVacancies}/>:<>
    <OrgChartBlock key={companyId} locale={locale} companyId={companyId} navigateDashboard={navigateDashboard} />
    <AdminPageHeader title={listTitle} description={t(locale, 'panel.orgUnits.hint')}
      actions={<AdminCreateButton label={t(locale, units.length ? 'panel.orgUnits.create' : 'panel.orgUnits.firstCreate')} disabled={busy || loading || Boolean(error)} onClick={() => edit()} />} />
    {loading ? <AppLoading locale={locale} variant="panel" /> : error ? <InlineCallout tone="danger"><span role="alert">{error}</span><button type="button" className={S.btnGhost} onClick={reload}>{t(locale, 'panel.orgUnits.retry')}</button></InlineCallout> : !units.length ? <EmptyState title={t(locale, 'panel.orgUnits.empty')} description={t(locale, 'panel.orgUnits.emptyHint')} /> : <ContentEnter animKey={`units-${companyId}-${units.length}`}>
      <ul className="m-0 list-none space-y-3 p-0">{options.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE).map((unit) => <li key={unit.id} className={S.cardTight}>
        <div className="flex flex-col items-stretch justify-between gap-3 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <h2 className={`${S.cardTitle} break-words`}>{unit.name}</h2><span className={S.faint}>{t(locale,`headcount.${unit.unitType||'unit'}`)}</span>
            {unit.label && unit.label.trim().toLocaleLowerCase(locale) !== String(unit.name || '').trim().toLocaleLowerCase(locale) ? (
              <p className={`${S.faint} break-words`}>{unit.label}</p>
            ) : null}
            <p className={cn(S.muted, 'mb-0 mt-1.5')}>{t(locale, 'panel.orgUnits.people', { n: unit.peopleCount })}</p>
          </div>
          <div className="flex flex-wrap gap-2 sm:shrink-0">
            <button type="button" className={S.btnGhost} onClick={() => navigateDashboard({ tab: 'team', orgUnit: unit.id, roster: 'internal', teamPage: 1, search: '', area: 'all', vacancy: 'all', pipeline: 'all', filter: null, teamGroup: null, dateFrom: '', dateTo: '', enneagram: 'all' })}>{t(locale, 'panel.orgUnits.viewPeople')}</button>
            <button type="button" className={S.btnGhost} disabled={busy} onClick={() => edit(unit)}>{t(locale, 'panel.orgUnits.edit')}</button>
            <button type="button" className={S.btnGhost} disabled={busy} onClick={() => archive(unit)}>{t(locale, 'panel.orgUnits.archive')}</button>
          </div>
        </div>
      </li>)}</ul>
      <AdminListPager locale={locale} page={safePage} pageSize={PAGE_SIZE} pageSizeOptions={[PAGE_SIZE]} total={units.length} onPageChange={setPage} />
    </ContentEnter>}
    </>}
  </div>;
}
