'use client';

import { SelectField } from '../../_components/SelectField';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getCompat } from '../../../lib/data';
import { t } from '../../../lib/i18n';
import { C } from '../../../lib/theme';
import { cn } from '../../../lib/cn';
import { buildNucleusCompositionAdvice } from '../../../lib/people/decision-brief';
import { useAppFeedback } from '../../_components/AppFeedback';
import { CompatBadge, S, TypeBadge } from '../dashboard-shared';
import { TeamPulseBlock } from '../../_components/TeamPulseBlock';
import { TeamTensionNarrativeBlock } from '../../_components/TeamTensionNarrativeBlock';
import { InlineCallout } from '../../_components/InlineCallout';
import { RosterEmptyHint } from '../../_components/RosterEmptyHint';
import { ContentEnter, Spinner } from '../../_components/AppLoading';
import { CollapsibleBlock } from '../../_components/CollapsibleBlock';
import { ROSTER_SCOPE } from '../../../lib/domain-status';
import { buildTeamBehavioralIntel } from '../../../lib/people/team-behavioral-intel';
import { StatusToneChip } from '../../_components/StatusToneChip';
import { EmptyState } from '../../_components/EmptyState';

/** Mesmo padrão visual dos cards de sugestão: emoji só no TypeBadge; nome ao lado; × no canto se onRemove. */
function PersonMini({ person, right, baseCompat = null, onRemove = null, locale }) {
  const showX = typeof onRemove === 'function';
  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-xl border border-ink/12 bg-ink/[0.03] px-3.5 py-3',
        showX ? 'relative pr-11' : null
      )}
    >
      {showX && (
        <button
          type="button"
          onClick={onRemove}
          title={t(locale, 'panel.group.removeFromGroup')}
          aria-label={t(locale, 'panel.group.removeFromGroup')}
          className="absolute right-2.5 top-2.5 inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-control border border-ink/12 bg-ink/[0.06] font-mono text-base leading-none text-ink-muted"
        >
          ×
        </button>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <TypeBadge type={person.topType} locale={locale} compact />
        <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-prose font-medium text-ink">
          {person.name}
        </span>
        {baseCompat ? (
          <>
            <CompatBadge level={baseCompat.level} locale={locale} />
            {baseCompat.level === 'tension' ? (
              <span className="rounded-full border border-danger/30 bg-danger/[0.09] px-2 py-0.5 font-mono text-2xs text-danger">
                {t(locale, 'panel.group.tensionWithBase')}
              </span>
            ) : null}
          </>
        ) : null}
        {!showX ? <div className="shrink-0">{right}</div> : null}
      </div>
      {(person.areaLabel || (person.areaFitScore010 != null)) ? (
        <div className="flex flex-wrap items-center gap-2">
          {person.areaLabel ? (
            <StatusToneChip tone="neutral">{person.areaLabel}</StatusToneChip>
          ) : null}
          {person.areaFitScore010 != null ? (
            <StatusToneChip tone="success">{person.areaFitScore010}/10</StatusToneChip>
          ) : null}
        </div>
      ) : null}
      {baseCompat ? (
        <div className="text-xs leading-snug text-ink-muted">
          {baseCompat.title ? (
            <span className="mb-1 block font-mono text-2xs text-ink-faint">{baseCompat.title}</span>
          ) : null}
          {baseCompat.desc || ''}
        </div>
      ) : null}
    </div>
  );
}

export function GroupTab({
  canViewOrganization = false,
  results,
  groupBase,
  setGroupBaseId,
  groupIds,
  setGroupIds,
  dismissedIds,
  setDismissedIds,
  suggestions,
  groupTensions,
  locale = 'pt-BR',
  companyId = null,
  roster = null,
  navigateDashboard = null,
}) {
  const { promptForm, confirm, toast } = useAppFeedback();
  const [search, setSearch] = useState('');
  const [baseSearch, setBaseSearch] = useState('');
  const [showAllBase, setShowAllBase] = useState(false);
  const [savedGroups, setSavedGroups] = useState([]);
  const [savedLoading, setSavedLoading] = useState(false);
  const [activeSavedId, setActiveSavedId] = useState(null);
  const [savedBusy, setSavedBusy] = useState(false);

  const resolvedCompanyId = useMemo(() => {
    if (companyId != null && companyId !== '' && companyId !== 'all') {
      const n = Number(companyId);
      return Number.isFinite(n) && n > 0 ? n : null;
    }
    const fromResults = (results || []).find((r) => r.companyId != null)?.companyId;
    const n = Number(fromResults);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [companyId, results]);

  const reloadSaved = useCallback(async () => {
    if (!resolvedCompanyId) {
      setSavedGroups([]);
      return;
    }
    setSavedLoading(true);
    try {
      const res = await fetch(
        `/api/admin/team-groups?companyId=${encodeURIComponent(resolvedCompanyId)}`
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || t(locale, 'panel.common.error'));
      setSavedGroups(Array.isArray(data.items) ? data.items : []);
    } catch {
      setSavedGroups([]);
    } finally {
      setSavedLoading(false);
    }
  }, [resolvedCompanyId, locale]);

  useEffect(() => {
    void reloadSaved();
  }, [reloadSaved]);

  // Lookup O(1) por assessmentId em vez de .find() dentro de .map() (n·m por render).
  const resultsById = useMemo(() => {
    const map = new Map();
    for (const r of results || []) {
      if (r?.assessmentId != null) map.set(String(r.assessmentId), r);
    }
    return map;
  }, [results]);

  const nucleusAdvice = useMemo(() => {
    if (!groupBase) return null;
    const members = (groupIds || [])
      .map((id) => resultsById.get(String(id)))
      .filter(Boolean);
    if (members.length < 1) return null;
    const nucleus = [
      {
        id: groupBase.assessmentId,
        name: groupBase.name,
        topType: groupBase.topType,
      },
      ...members.map((m) => ({
        id: m.assessmentId,
        name: m.name,
        topType: m.topType,
      })),
    ];
    const candidates = (results || [])
      .filter((r) => !dismissedIds.includes(String(r.assessmentId)))
      .map((r) => ({
        id: r.assessmentId,
        name: r.name,
        topType: r.topType,
      }));
    return buildNucleusCompositionAdvice({
      locale,
      nucleus,
      candidates,
      limitCompleters: 5,
      limitRisks: 3,
    });
  }, [groupBase, groupIds, results, resultsById, dismissedIds, locale]);

  const groupIntel = useMemo(() => {
    if (!groupBase) return null;
    const members = (groupIds || [])
      .map((id) => resultsById.get(String(id)))
      .filter(Boolean);
    const eneagramPeople = [
      { topType: groupBase.topType, scores: groupBase.scores || null },
      ...members.map((m) => ({ topType: m.topType, scores: m.scores || null })),
    ].filter((p) => Number.isInteger(Number(p.topType)));
    if (eneagramPeople.length < 2) return null;
    return buildTeamBehavioralIntel({
      eneagramPeople,
      motivatorAttempts: [],
      locale,
      cohort: { kind: 'team_group', teamGroupId: activeSavedId, teamGroupName: null },
    });
  }, [groupBase, groupIds, results, locale, activeSavedId]);

  const addToGroup = (assessmentId) => {
    const id = String(assessmentId);
    if (groupIds.includes(id)) return;
    setGroupIds([...groupIds, id]);
    setActiveSavedId(null);
  };
  const removeFromGroup = (assessmentId) => {
    const id = String(assessmentId);
    setGroupIds(groupIds.filter((x) => x !== id));
    setActiveSavedId(null);
  };
  const clearGroup = () => {
    setGroupBaseId(null);
    setGroupIds([]);
    setActiveSavedId(null);
  };

  const dismissSuggestion = (assessmentId) => {
    const id = String(assessmentId);
    if (dismissedIds.includes(id)) return;
    setDismissedIds([...dismissedIds, id]);
  };

  const loadSaved = (item) => {
    if (!item?.baseAssessmentId) return;
    setGroupBaseId(String(item.baseAssessmentId));
    setGroupIds((item.memberAssessmentIds || []).map(String));
    setActiveSavedId(item.id);
    setDismissedIds([]);
  };

  const saveCurrent = async ({ asUpdate = false } = {}) => {
    if (!resolvedCompanyId) {
      toast(t(locale, 'panel.group.saveNeedCompany'), 'error');
      return;
    }
    if (!groupBase || !(groupIds || []).length) {
      toast(t(locale, 'panel.group.saveNeedBase'), 'error');
      return;
    }

    let name = null;
    if (asUpdate && activeSavedId) {
      const current = savedGroups.find((g) => String(g.id) === String(activeSavedId));
      name = current?.name || null;
    }
    if (!name) {
      const values = await promptForm({
        title: t(locale, 'panel.group.saveCurrent'),
        fields: [
          {
            key: 'name',
            label: t(locale, 'panel.group.saveNameLabel'),
            placeholder: t(locale, 'panel.group.saveNamePh'),
            defaultValue: '',
          },
        ],
        confirmLabel: t(locale, 'panel.group.saveCurrent'),
      });
      if (!values) return;
      name = String(values.name || '').trim();
    }
    if (!name) return;

    setSavedBusy(true);
    try {
      const body = {
        companyId: resolvedCompanyId,
        name,
        baseAssessmentId: groupBase.assessmentId,
        memberAssessmentIds: groupIds,
      };
      let res;
      if (asUpdate && activeSavedId) {
        res = await fetch(`/api/admin/team-groups/${encodeURIComponent(activeSavedId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } else {
        res = await fetch('/api/admin/team-groups', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          data?.errorCode ? t(locale, `errors.${data.errorCode}`) : data?.error || t(locale, 'panel.common.error')
        );
      }
      if (data.item?.id) setActiveSavedId(data.item.id);
      toast(t(locale, asUpdate ? 'panel.group.saveUpdateOk' : 'panel.group.saveOk'), 'ok');
      await reloadSaved();
    } catch (e) {
      toast(e?.message || t(locale, 'panel.common.error'), 'error');
    } finally {
      setSavedBusy(false);
    }
  };

  const deleteSaved = async (item) => {
    const ok = await confirm({
      message: t(locale, 'panel.group.confirmDelete', { name: item.name }),
      danger: true,
      confirmLabel: t(locale, 'panel.group.deleteSaved'),
    });
    if (!ok) return;
    setSavedBusy(true);
    try {
      const res = await fetch(`/api/admin/team-groups/${encodeURIComponent(item.id)}`, {
        method: 'DELETE',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || t(locale, 'panel.common.error'));
      if (String(activeSavedId) === String(item.id)) setActiveSavedId(null);
      await reloadSaved();
    } catch (e) {
      toast(e?.message || t(locale, 'panel.common.error'), 'error');
    } finally {
      setSavedBusy(false);
    }
  };


  const organizationShortcut = canViewOrganization && resolvedCompanyId && typeof navigateDashboard === 'function' ? (
    <InlineCallout tone="info" action={
      <button type="button" className={S.btnGhost} onClick={() => navigateDashboard({ tab: 'organization' })}>
        {t(locale, 'betaWorkspace.openOrganization')}
      </button>
    }>{t(locale, 'betaWorkspace.groupsPurpose')}</InlineCallout>
  ) : null;

  if ((results || []).length === 0) {
    return (
      <div className="space-y-4">
        {organizationShortcut}
        <RosterEmptyHint
          locale={locale}
          roster={roster || ROSTER_SCOPE.INTERNAL}
          navigateDashboard={navigateDashboard}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {organizationShortcut}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <div className={S.card}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className={cn(S.label, 'mb-0')}>{t(locale, 'panel.group.title')}</span>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={savedBusy || !groupBase || !(groupIds || []).length}
              onClick={() => void saveCurrent({ asUpdate: false })}
              className={cn(
                S.btnBrandSoft,
                'px-3 py-2 font-mono text-2xs disabled:cursor-not-allowed disabled:opacity-50'
              )}
            >
              {t(locale, 'panel.group.saveCurrent')}
            </button>
            {activeSavedId ? (
              <button
                type="button"
                disabled={savedBusy}
                onClick={() => void saveCurrent({ asUpdate: true })}
                className="cursor-pointer rounded-control border border-ink/12 bg-ink/[0.07] px-3 py-2 font-mono text-2xs text-ink-muted disabled:opacity-50"
              >
                {t(locale, 'panel.group.overwrite')}
              </button>
            ) : null}
            <button
              type="button"
              onClick={clearGroup}
              className="cursor-pointer rounded-control border border-ink/12 bg-ink/[0.07] px-3 py-2 font-mono text-2xs text-ink-muted"
            >
              {t(locale, 'panel.group.clear')}
            </button>
          </div>
        </div>

        <p className="mt-2.5 text-xs leading-relaxed text-ink-faint">
          {t(locale, 'panel.group.intro')}
        </p>
        <p className="mt-1.5 text-xs leading-snug text-ink-faint">
          {t(locale, 'panel.group.whyTeam')}
        </p>

        <div className="mt-3.5 rounded-control border border-ink/10 bg-ink/[0.02] px-3 py-2.5">
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
            <span className={cn(S.label, 'mb-0')}>{t(locale, 'panel.group.savedTitle')}</span>
            {savedLoading ? <Spinner size={12} className="text-ink-faint" /> : null}
          </div>
          <p className="mb-2 mt-0 text-2xs leading-snug text-ink-faint">
            {t(locale, 'panel.group.savedHint')}
          </p>
          {!resolvedCompanyId ? (
            <p className="m-0 text-xs text-ink-muted">{t(locale, 'panel.group.saveNeedCompany')}</p>
          ) : savedGroups.length === 0 ? (
            <EmptyState
              className="px-3 py-5"
              message={t(locale, 'panel.group.savedEmpty')}
            />
          ) : (
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
              {savedGroups.map((g) => {
                const n = 1 + (g.memberAssessmentIds?.length || 0);
                const active = String(activeSavedId) === String(g.id);
                return (
                  <li
                    key={g.id}
                    className={cn(
                      'flex flex-wrap items-center justify-between gap-2 rounded-control border px-2.5 py-2',
                      active ? 'border-brand-500/35 bg-brand-500/[0.06]' : 'border-ink/10 bg-surface/70'
                    )}
                  >
                    <div className="min-w-0">
                      <div className="truncate text-prose font-medium text-ink">{g.name}</div>
                      <div className="font-mono text-2xs text-ink-faint">
                        {t(locale, 'panel.group.membersCount', { n })}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        type="button"
                        disabled={savedBusy}
                        onClick={() => loadSaved(g)}
                        className="cursor-pointer rounded-control border border-brand-500/35 bg-brand-500/[0.09] px-2.5 py-1.5 font-mono text-2xs text-brand-600"
                      >
                        {t(locale, 'panel.group.load')}
                      </button>
                      <button
                        type="button"
                        disabled={savedBusy}
                        onClick={() => void deleteSaved(g)}
                        className="cursor-pointer rounded-control border border-danger/25 bg-transparent px-2 py-1.5 font-mono text-2xs text-danger"
                        aria-label={t(locale, 'panel.group.deleteSaved')}
                        title={t(locale, 'panel.group.deleteSaved')}
                      >
                        ×
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {resolvedCompanyId && activeSavedId ? (
          <ContentEnter animKey={`saved-${activeSavedId}`}>
            <TeamPulseBlock
              locale={locale}
              companyId={resolvedCompanyId}
              teamGroupId={activeSavedId}
            />
          </ContentEnter>
        ) : null}

        {groupIntel ? (
          <ContentEnter animKey={`intel-${activeSavedId || groupBase?.assessmentId || 'x'}`} className="mt-3">
            <TeamTensionNarrativeBlock
              locale={locale}
              intel={groupIntel}
              companyId={resolvedCompanyId}
              teamGroupId={activeSavedId}
              navigateDashboard={navigateDashboard}
              dense
            />
          </ContentEnter>
        ) : null}

        <span className={cn(S.label, 'mt-[18px]')}>{t(locale, 'panel.group.basePerson')}</span>
        {groupBase ? (
          <PersonMini
            locale={locale}
            person={groupBase}
            right={
              <button
                type="button"
                onClick={() => {
                  setGroupBaseId(null);
                  setActiveSavedId(null);
                }}
                className="cursor-pointer rounded-control border border-ink/12 bg-transparent px-2.5 py-2 font-mono text-2xs text-ink-muted"
              >
                {t(locale, 'panel.group.swap')}
              </button>
            }
          />
        ) : (
          <div className="flex flex-col gap-2.5">
            <input
              type="search"
              value={baseSearch}
              onChange={(e)=>{ setBaseSearch(e.target.value); setShowAllBase(false); }}
              placeholder={t(locale, 'panel.group.searchBasePh')}
              aria-label={t(locale, 'panel.group.searchBasePh')}
              className={S.input}
            />
            {results
              .filter(r=>!baseSearch.trim() || r.name.toLowerCase().includes(baseSearch.trim().toLowerCase()))
              .slice(0, showAllBase ? 80 : 12)
              .map(r=>(
              <PersonMini
                locale={locale}
                key={r.assessmentId}
                person={r}
                right={
                  <button
                    type="button"
                    onClick={()=>{ setGroupBaseId(String(r.assessmentId)); setActiveSavedId(null); }}
                    className="cursor-pointer rounded-control border border-brand-500/40 bg-brand-500/[0.13] px-2.5 py-2 font-mono text-2xs text-brand-600"
                  >
                    {t(locale, 'panel.group.select')}
                  </button>
                }
              />
            ))}
            {results.filter(r=>!baseSearch.trim() || r.name.toLowerCase().includes(baseSearch.trim().toLowerCase())).length > (showAllBase ? 80 : 12) ? (
              <button
                type="button"
                onClick={() => setShowAllBase(true)}
                className="cursor-pointer rounded-control border border-ink/12 bg-transparent px-2.5 py-2 font-mono text-2xs text-ink-muted"
              >
                {t(locale, 'panel.group.showMore')}
              </button>
            ) : null}
            <div className="mt-1.5 font-mono text-2xs text-ink-faint">
              {t(locale, 'panel.group.filterHint')}
            </div>
          </div>
        )}
      </div>

      <div className={S.card}>
        <span className={S.label}>{t(locale, 'panel.group.suggestionsTitle')}</span>

        {!groupBase ? (
          <p className="text-prose italic text-ink-muted">
            {t(locale, 'panel.group.pickBaseFirst')}
          </p>
        ) : (
          <ContentEnter animKey={`base-${groupBase.assessmentId}`}>
            <div className="my-2.5 mb-3.5 flex flex-wrap gap-2.5">
              <input
                value={search}
                onChange={(e)=>setSearch(e.target.value)}
                placeholder={t(locale, 'panel.group.searchAddPh')}
                className="min-w-0 flex-[1_1_240px] rounded-control border border-ink/12 bg-ink/[0.07] px-3 py-2.5 font-mono text-xs text-ink"
              />
              <SelectField
                onChange={(e)=>{ const id=e.target.value; if(id) addToGroup(id); e.target.value=''; }}
                defaultValue=""
                className={cn(S.select, 'w-full max-w-full flex-[0_0_240px] font-mono text-xs sm:w-auto')}
              >
                <option value="">{t(locale, 'panel.group.addAnyone')}</option>
                {results
                  .filter(r=>String(r.assessmentId)!==String(groupBase.assessmentId))
                  .filter(r=>!groupIds.includes(String(r.assessmentId)))
                  .filter(r=>!search.trim() || r.name.toLowerCase().includes(search.trim().toLowerCase()))
                  .slice(0, 300)
                  .map(r=>{
                    const withBase = getCompat(groupBase.topType, r.topType, locale);
                    return (
                      <option key={r.assessmentId} value={String(r.assessmentId)}>
                        {r.name} (T{r.topType}) · {t(locale, `panel.compatLevel.${withBase.level}`)}
                      </option>
                    );
                  })}
              </SelectField>
            </div>

            <div className="mb-3.5 flex flex-wrap gap-2">
              <StatusToneChip tone="success">{t(locale, 'panel.group.synergy')}</StatusToneChip>
              <span className="rounded-full border border-soft/30 bg-soft/[0.09] px-2.5 py-0.5 font-mono text-2xs text-soft">
                {t(locale, 'panel.group.neutral')}
              </span>
              <StatusToneChip tone="danger">{t(locale, 'panel.group.tension')}</StatusToneChip>
            </div>

            {nucleusAdvice && !nucleusAdvice.empty ? (
              <ContentEnter
                animKey={`nucleus-${groupBase?.assessmentId || 'b'}-${(groupIds || []).join(',')}`}
                className="mb-4 rounded-xl border border-brand-500/20 bg-brand-500/[0.04] px-3.5 py-3"
              >
                <div className="mb-1 font-mono text-2xs uppercase tracking-wider text-brand-600">
                  {t(locale, 'panel.group.nucleusTitle')}
                </div>
                <p className="mb-3 mt-0 text-2xs leading-snug text-ink-faint">
                  {t(locale, 'panel.group.nucleusHint', { n: nucleusAdvice.nucleusSize })}
                </p>
                {nucleusAdvice.completers.length > 0 ? (
                  <div className="mb-3">
                    <div className="mb-1.5 text-xs font-semibold text-success">
                      {t(locale, 'panel.group.nucleusCompleters')}
                    </div>
                    <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                      {nucleusAdvice.completers.map((row) => {
                        const already = groupIds.includes(String(row.id));
                        return (
                          <li
                            key={`comp-${row.id}`}
                            className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-success/20 bg-surface/70 px-2.5 py-2"
                          >
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <TypeBadge type={row.topType} locale={locale} compact />
                                <span className="text-prose text-ink">{row.name}</span>
                              </div>
                              <p className="mb-0 mt-1 text-2xs leading-snug text-ink-muted">{row.summary}</p>
                            </div>
                            <button
                              type="button"
                              disabled={already}
                              onClick={() => addToGroup(row.id)}
                              className={cn(
                                'shrink-0 rounded-control border px-2.5 py-1.5 font-mono text-2xs',
                                already
                                  ? 'cursor-not-allowed border-ink/12 text-ink-faint'
                                  : 'cursor-pointer border-success/35 bg-success/[0.09] text-success'
                              )}
                            >
                              {already ? t(locale, 'panel.group.inGroup') : t(locale, 'panel.group.add')}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ) : null}
                {nucleusAdvice.risks.length > 0 ? (
                  <div>
                    <div className="mb-1.5 text-xs font-semibold text-warning">
                      {t(locale, 'panel.group.nucleusRisks')}
                    </div>
                    <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                      {nucleusAdvice.risks.map((row) => (
                        <li
                          key={`risk-${row.id}`}
                          className="rounded-control border border-warning/25 bg-warning/[0.06] px-2.5 py-2"
                        >
                          <div className="flex flex-wrap items-center gap-1.5">
                            <TypeBadge type={row.topType} locale={locale} compact />
                            <span className="text-prose text-ink">{row.name}</span>
                          </div>
                          <p className="mb-0 mt-1 text-2xs leading-snug text-ink-muted">{row.summary}</p>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </ContentEnter>
            ) : nucleusAdvice && groupIds.length > 0 ? (
              <p className="mb-3 mt-0 text-xs italic text-ink-faint">
                {t(locale, 'panel.group.nucleusEmpty')}
              </p>
            ) : null}

            <div className="mb-4 flex flex-col gap-2.5">
              {suggestions.slice(0, 10).map(({ person, compat }) => {
                const lc = { synergy:C.synergy, tension:C.tension, neutral:C.neutral }[compat.level];
                const already = groupIds.includes(String(person.assessmentId));
                return (
                  <div
                    key={person.assessmentId}
                    className="rounded-xl border bg-ink/[0.03] px-3.5 py-3"
                    style={{ borderColor: `${lc}30` }}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex min-w-0 flex-[1_1_180px] flex-wrap items-center gap-2">
                        <TypeBadge type={person.topType} locale={locale} compact />
                        <span className="text-prose text-ink">{person.name}</span>
                        <CompatBadge level={compat.level} locale={locale}/>
                        {compat.level==='tension' && (
                          <span className="rounded-full border border-danger/30 bg-danger/[0.09] px-2 py-0.5 font-mono text-2xs text-danger">
                            {t(locale, 'panel.group.tensionWithBase')}
                          </span>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          type="button"
                          disabled={already}
                          onClick={()=>addToGroup(person.assessmentId)}
                          className={cn(
                            'rounded-control border px-2.5 py-2 font-mono text-2xs',
                            already ? 'cursor-not-allowed' : 'cursor-pointer'
                          )}
                          style={{
                            background: already ? 'rgba(17,24,39,.04)' : `${lc}18`,
                            borderColor: already ? C.border : `${lc}55`,
                            color: already ? C.faint : lc,
                          }}
                        >
                          {already ? t(locale, 'panel.group.inGroup') : t(locale, 'panel.group.add')}
                        </button>
                        <button
                          type="button"
                          onClick={()=>dismissSuggestion(person.assessmentId)}
                          title={t(locale, 'panel.group.removeFromList')}
                          aria-label={t(locale, 'panel.group.removeFromList')}
                          className="inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-control border border-ink/12 bg-ink/[0.06] font-mono text-base leading-none text-ink-muted"
                        >
                          ×
                        </button>
                      </div>
                    </div>
                    <div className="mt-2 text-xs leading-snug text-ink-muted">
                      {compat.desc}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="border-t border-ink/12 pt-3.5">
              <span className={cn(S.label, 'mb-2.5')}>{t(locale, 'panel.group.currentGroup')}</span>
              {groupIds.length === 0 ? (
                <p className="text-xs italic text-ink-faint">{t(locale, 'panel.group.noneInGroup')}</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {groupIds.map(id => {
                    const p = resultsById.get(String(id));
                    if (!p) return null;
                    const baseCompat =
                      groupBase && String(p.assessmentId) !== String(groupBase.assessmentId)
                        ? getCompat(groupBase.topType, p.topType, locale)
                        : null;
                    return (
                      <PersonMini
                        locale={locale}
                        key={id}
                        person={p}
                        baseCompat={baseCompat}
                        onRemove={() => removeFromGroup(id)}
                      />
                    );
                  })}
                </div>
              )}

              <div className="mt-3.5">
                {groupTensions.length === 0 ? (
                  <>
                    <span className={cn(S.label, 'mb-1.5')}>{t(locale, 'panel.group.internalTensions')}</span>
                    <p className="text-xs italic text-ink-faint">{t(locale, 'panel.group.noTensions')}</p>
                  </>
                ) : groupTensions.length > 3 ? (
                  <CollapsibleBlock
                    locale={locale}
                    title={t(locale, 'panel.group.internalTensions')}
                    count={groupTensions.length}
                    defaultOpen={false}
                    variant="plain"
                  >
                    <div className="flex flex-col gap-2 pt-2">
                      {groupTensions.slice(0, 8).map((p, idx) => (
                        <div
                          key={idx}
                          className="rounded-control border border-danger/20 bg-danger/[0.06] px-3 py-2.5"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <TypeBadge type={p.a.topType} locale={locale} compact /><span className="text-xs text-ink-muted">{p.a.name.split(' ')[0]}</span>
                            <span className="text-ink-faint">×</span>
                            <TypeBadge type={p.b.topType} locale={locale} compact /><span className="text-xs text-ink-muted">{p.b.name.split(' ')[0]}</span>
                          </div>
                          <div className="mt-1.5 text-xs leading-snug text-ink-muted">
                            {p.compat.desc}
                          </div>
                        </div>
                      ))}
                    </div>
                  </CollapsibleBlock>
                ) : (
                  <>
                    <span className={cn(S.label, 'mb-1.5')}>{t(locale, 'panel.group.internalTensions')}</span>
                    <div className="flex flex-col gap-2">
                      {groupTensions.slice(0, 8).map((p, idx) => (
                        <div
                          key={idx}
                          className="rounded-control border border-danger/20 bg-danger/[0.06] px-3 py-2.5"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <TypeBadge type={p.a.topType} locale={locale} compact /><span className="text-xs text-ink-muted">{p.a.name.split(' ')[0]}</span>
                            <span className="text-ink-faint">×</span>
                            <TypeBadge type={p.b.topType} locale={locale} compact /><span className="text-xs text-ink-muted">{p.b.name.split(' ')[0]}</span>
                          </div>
                          <div className="mt-1.5 text-xs leading-snug text-ink-muted">
                            {p.compat.desc}
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
          </ContentEnter>
        )}
      </div>
    </div>
    </div>
  );
}
