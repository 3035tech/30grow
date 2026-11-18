'use client';

import { useCallback, useMemo, useState } from 'react';
import { getCompat } from '../../../lib/data';
import { CAP, can } from '../../../lib/identity/permissions';
import { t } from '../../../lib/i18n';
import { cn } from '../../../lib/cn';
import { personListName } from '../../../lib/person-name';
import { S, TypeBadge } from '../dashboard-shared';
import { CompatTab } from './CompatTab';
import { CompareTabLoader } from './CompareTabLoader';

export function ProfileAnalysisTab({
  sessionAuth,
  initialMode = 'compatibility',
  tensions,
  synergies,
  pairs,
  pairTotals,
  needsCompanyScope,
  compatPage,
  compatPageSize,
  onCompatPagination,
  filterQueryString,
  comparePage,
  comparePageSize,
  onComparePagination,
  locale,
  search,
  onSearch,
  roster,
  navigateDashboard,
  onModeChange,
}) {
  const canCompatibility = can(sessionAuth, CAP.COMPATIBILITY_VIEW);
  const canCompare = can(sessionAuth, CAP.COMPARE_VIEW);
  const mode = !canCompatibility
    ? 'compare'
    : !canCompare
      ? 'compatibility'
      : initialMode === 'compare'
        ? 'compare'
        : 'compatibility';
  const [selectedPeople, setSelectedPeople] = useState([]);
  const onSelectionChange = useCallback((people) => setSelectedPeople(people), []);
  const removeSelectedPerson = useCallback((assessmentId) => {
    setSelectedPeople((current) => current.filter((person) => String(person.assessmentId) !== String(assessmentId)));
  }, []);

  const selectedPairs = useMemo(() => {
    const result = { tensions: [], synergies: [], pairs: [] };
    for (let i = 0; i < selectedPeople.length; i += 1) {
      for (let j = i + 1; j < selectedPeople.length; j += 1) {
        const a = selectedPeople[i];
        const b = selectedPeople[j];
        const row = { a, b, compat: getCompat(a.topType, b.topType, locale) };
        result.pairs.push(row);
        if (row.compat.level === 'tension') result.tensions.push(row);
        if (row.compat.level === 'synergy') result.synergies.push(row);
      }
    }
    return result;
  }, [selectedPeople, locale]);

  const changeMode = (next) => {
    onModeChange?.(next);
  };

  return (
    <div className="flex flex-col gap-3.5">
      {canCompatibility && canCompare ? (
        <div
          className={cn(S.card, 'flex flex-wrap items-center gap-2 p-2')}
          role="tablist"
          aria-label={t(locale, 'dashboard.profileAnalysis')}
        >
          {[
            ['compare', 'dashboard.compare'],
            ['compatibility', 'dashboard.compatibility'],
          ].map(([id, labelKey]) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`profile-analysis-tab-${id}`}
              aria-controls={`profile-analysis-panel-${id}`}
              aria-selected={mode === id}
              onClick={() => changeMode(id)}
              className={cn(
                'min-h-touch rounded-control px-4 py-2 text-sm font-medium transition-colors',
                mode === id ? 'bg-brand-500 text-white' : 'text-ink-muted hover:bg-ink/[0.05]',
              )}
            >
              {t(locale, labelKey)}
            </button>
          ))}
        </div>
      ) : null}

      {selectedPeople.length > 0 ? (
        <section
          className={cn(S.card, 'flex flex-wrap items-center gap-2.5 px-4 py-3')}
          aria-label={t(locale, 'dashboard.selectedProfileCount', { n: selectedPeople.length })}
          aria-live="polite"
        >
          <span className="mr-1 text-xs font-medium text-ink-muted">
            {t(locale, 'dashboard.selectedProfileCount', { n: selectedPeople.length })}
          </span>
          {selectedPeople.map((person) => (
            <span
              key={person.assessmentId}
              className="inline-flex max-w-full items-center gap-2 rounded-full border border-brand-500/25 bg-brand-500/[0.06] py-1 pl-2.5 pr-1.5 text-xs text-ink"
              title={person.name}
            >
              <span className="max-w-[180px] overflow-hidden text-ellipsis whitespace-nowrap">
                {personListName(person.name)}
              </span>
              <TypeBadge type={person.topType} locale={locale} compact />
              <button
                type="button"
                onClick={() => removeSelectedPerson(person.assessmentId)}
                aria-label={t(locale, 'dashboard.removeProfileSelection', { name: personListName(person.name) })}
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ink-muted hover:bg-ink/[0.08] hover:text-ink"
              >
                <span aria-hidden="true">×</span>
              </button>
            </span>
          ))}
          <button
            type="button"
            onClick={() => setSelectedPeople([])}
            className="ml-auto min-h-[36px] rounded-control px-2.5 text-xs text-ink-muted underline decoration-ink/25 underline-offset-2 hover:text-ink"
          >
            {t(locale, 'panel.compare.clearSelection')}
          </button>
        </section>
      ) : null}

      <div
        id="profile-analysis-panel-compare"
        role={canCompatibility && canCompare ? 'tabpanel' : undefined}
        aria-labelledby={canCompatibility && canCompare ? 'profile-analysis-tab-compare' : undefined}
        hidden={mode !== 'compare'}
      >
        {canCompare ? (
          <CompareTabLoader
            filterQueryString={filterQueryString}
            comparePage={comparePage}
            comparePageSize={comparePageSize}
            onComparePagination={onComparePagination}
            locale={locale}
            search={search}
            onSearch={onSearch}
            roster={roster}
            navigateDashboard={navigateDashboard}
            selectedProfiles={selectedPeople}
            onSelectionChange={onSelectionChange}
          />
        ) : null}
      </div>

      <div
        id="profile-analysis-panel-compatibility"
        role={canCompatibility && canCompare ? 'tabpanel' : undefined}
        aria-labelledby={canCompatibility && canCompare ? 'profile-analysis-tab-compatibility' : undefined}
        hidden={mode !== 'compatibility'}
      >
        {canCompatibility ? (
          <>
            {selectedPeople.length === 1 ? (
              <div className={cn(S.card, 'p-5')}>
                <p className="m-0 text-sm text-ink-muted">{t(locale, 'dashboard.selectProfilesForCompatibility')}</p>
              </div>
            ) : selectedPeople.length > 1 ? (
              <p className="mb-0 rounded-xl border border-brand-500/20 bg-brand-500/[0.06] px-4 py-3 text-sm text-ink-muted">
                {t(locale, 'dashboard.profileAnalysisSelection', { n: selectedPeople.length })}
              </p>
            ) : null}
            {selectedPeople.length !== 1 ? (
              <CompatTab
                tensions={selectedPeople.length ? selectedPairs.tensions : tensions}
                synergies={selectedPeople.length ? selectedPairs.synergies : synergies}
                pairs={selectedPeople.length ? selectedPairs.pairs : pairs}
                pairTotals={selectedPeople.length ? {
                  pairs: selectedPairs.pairs.length,
                  tensions: selectedPairs.tensions.length,
                  synergies: selectedPairs.synergies.length,
                } : pairTotals}
                needsCompanyScope={needsCompanyScope}
                compatPage={compatPage}
                compatPageSize={compatPageSize}
                onCompatPagination={onCompatPagination}
                locale={locale}
              />
            ) : null}
          </>
        ) : (
          <div className={cn(S.card, 'p-5')}>
            <p className="m-0 text-sm text-ink-muted">{t(locale, 'dashboard.selectProfilesForCompatibility')}</p>
          </div>
        )}
      </div>
    </div>
  );
}
