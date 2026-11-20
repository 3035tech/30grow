'use client';

import { cn } from '../../../lib/cn';
import { t } from '../../../lib/i18n';
import { AdminListFilters } from '../../_components/AdminListFilters';
import { OrgUnitFilter } from '../../_components/OrgUnitField';
import { SelectField } from '../../_components/SelectField';
import { InlineCallout } from '../../_components/InlineCallout';
import { AdminListSearch, S } from '../dashboard-shared';

const SORT_COLUMNS = [
  { key: 'createdAt', label: 'panel.team.sortDate' },
  { key: 'name', label: 'panel.team.sortName' },
  { key: 'area', label: 'panel.team.sortArea' },
  { key: 'type', label: 'panel.team.sortProfileType' },
  { key: 'vacancy', label: 'panel.team.sortVacancy' },
  { key: 'pipeline', label: 'recruiting.pipelineShort' },
];

/** Search, organization, selection and ordering controls for the team roster. */
export function TeamRosterControls({
  locale,
  companyId,
  peopleRoster,
  searchDraft,
  setSearchDraft,
  commitSearch,
  orgUnitFilter,
  navigateDashboard,
  activeSearch,
  listTotal,
  listFilter,
  onClearListFilter,
  allSelected,
  toggleSelectAll,
  sortKey,
  sortDir,
  onSort,
}) {
  const sortColumns = SORT_COLUMNS.filter(({ key }) => !peopleRoster || key === 'name');

  return (
    <div className="flex flex-col gap-3">
      <AdminListFilters
        locale={locale}
        aria-label={t(locale, 'panel.team.searchAriaLabel')}
        onClear={() => {
          setSearchDraft('');
          navigateDashboard?.({ search: '', orgUnit: null, teamPage: 1 });
        }}
        clearEnabled={Boolean(orgUnitFilter || activeSearch || String(searchDraft || '').trim())}
      >
        <AdminListSearch
          locale={locale}
          value={searchDraft}
          onChange={setSearchDraft}
          onSubmit={commitSearch}
          placeholder={t(locale, peopleRoster ? 'betaPeople.search' : 'dashboard.searchPlaceholder')}
          label={t(locale, 'panel.team.searchAriaLabel')}
          className="min-w-[12rem] max-w-none grow"
        />
        <OrgUnitFilter
          key={companyId}
          companyId={companyId}
          locale={locale}
          value={orgUnitFilter}
          onChange={(orgUnit) => navigateDashboard?.({ orgUnit: orgUnit || null, teamPage: 1 })}
        />
        {activeSearch ? (
          <span className="mb-2.5 self-end font-ui text-prose text-ink/75">
            {t(locale, 'panel.team.searchResultsTotal', { n: listTotal })}
          </span>
        ) : null}
      </AdminListFilters>

      {listFilter === 'turnover_risk' ? (
        <InlineCallout
          tone="warning"
          className="text-sm text-ink"
          action={typeof onClearListFilter === 'function' ? (
            <button type="button" onClick={onClearListFilter} className={cn(S.btnGhost, 'ml-2')}>
              {t(locale, 'panel.team.clearListFilter')}
            </button>
          ) : null}
        >
          {t(locale, 'panel.team.filterTurnoverRisk')}
        </InlineCallout>
      ) : null}

      <div
        role="group"
        aria-label={t(locale, 'panel.team.sortAria')}
        className="flex flex-wrap items-center gap-2 rounded-control border border-ink/10 bg-ink/[0.02] px-3.5 py-2"
      >
        {!peopleRoster ? (
          <label className="flex cursor-pointer items-center gap-1.5 font-ui text-prose text-ink-muted">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleSelectAll}
              aria-label={t(locale, 'panel.team.selectAllPage')}
              className="h-3.5 w-3.5 accent-brand-500"
            />
            {t(locale, 'panel.team.all')}
          </label>
        ) : null}
        <label className="sr-only" htmlFor="team-sort-field">{t(locale, 'panel.team.sortBy')}</label>
        <SelectField
          id="team-sort-field"
          value={sortKey}
          onChange={(event) => onSort(event.target.value)}
          className={cn(S.select, 'min-h-9 w-auto min-w-[10rem] bg-transparent py-1.5 text-prose')}
        >
          {sortColumns.map(({ key, label }) => <option key={key} value={key}>{t(locale, label)}</option>)}
        </SelectField>
        <button
          type="button"
          onClick={() => onSort(sortKey)}
          aria-label={`${t(locale, 'panel.team.sortBy')}: ${sortDir === 'asc' ? '↑' : '↓'}`}
          title={`${t(locale, 'panel.team.sortBy')}: ${sortDir === 'asc' ? '↑' : '↓'}`}
          className="min-h-touch min-w-touch cursor-pointer rounded-control border border-ink/12 bg-transparent px-3 py-1.5 font-ui text-prose text-ink-muted transition-colors hover:bg-ink/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/35"
        >
          {sortDir === 'asc' ? '↑' : '↓'}
        </button>
      </div>
    </div>
  );
}
