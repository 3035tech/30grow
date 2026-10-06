'use client';

import { useState, useTransition } from 'react';
import {
  PAGE_SIZE_OPTIONS,
  parseCompaniesPagination,
  parseCompaniesSort,
  parseCompatTabPagination,
  parseComparePagination,
  parseTeamPagination,
  parseTeamSort,
  parseUsersPagination,
  parseUsersSort,
  parseVacanciesPagination,
  parseVacanciesSort,
} from '../../../lib/assessment-filters';
import { VACANCY_LIST_FILTER, normalizeVacancyListFilter } from '../../../lib/domain-status.js';
import { canSwitchTabClientOnly } from '../../../lib/dashboard-company-scope.js';

// Must match the defaults of the parsers in lib/assessment-filters.js so omitting them is lossless.
const LIST_PREFIXES = ['team', 'vacancies', 'compare', 'compat', 'users', 'leads', 'fb', 'companies'];
const LIST_PARAM_DEFAULTS = {
  ...Object.fromEntries(LIST_PREFIXES.flatMap((k) => [[`${k}Page`, '1'], [`${k}PageSize`, '20']])),
  auditPage: '1',
  auditPageSize: '30',
  ...Object.fromEntries(['team', 'vacancies', 'users', 'companies'].flatMap((k) => [[`${k}Sort`, 'createdAt'], [`${k}SortDir`, 'desc']])),
};

/**
 * Centraliza montagem da query do dashboard (filtros, paginação por aba, ordenação).
 */
export function useDashboardNavigation({
  router,
  urlParams,
  area,
  vacancy,
  company,
  enneagram,
  pipeline,
  dateFrom,
  dateTo,
  search,
  isAdmin,
  companiesLoaded = false,
  teamPagination,
}) {
  const [navPending, startNavTransition] = useTransition();
  const [pendingTab, setPendingTab] = useState(null);
  const snapshot = () => Object.fromEntries(urlParams.entries());

  const buildDashboardUrl = (opts = {}) => {
    const p = new URLSearchParams();
    const nextCompany = opts.company !== undefined ? opts.company : company;
    const nextArea = opts.area !== undefined ? opts.area : area;
    const nextVacancy = opts.vacancy !== undefined ? opts.vacancy : vacancy;
    const nextEnneagram = opts.enneagram !== undefined ? opts.enneagram : enneagram;
    const nextDateFrom = opts.dateFrom !== undefined ? opts.dateFrom : dateFrom;
    const nextDateTo = opts.dateTo !== undefined ? opts.dateTo : dateTo;
    const nextSearch = opts.search !== undefined ? opts.search : search;

    if (isAdmin && nextCompany && nextCompany !== 'all') {
      p.set('company', String(nextCompany));
    }

    if (nextArea && nextArea !== 'all') p.set('area', nextArea);

    if (nextVacancy && nextVacancy !== 'all') p.set('vacancy', String(nextVacancy));

    const nextRoster = opts.roster !== undefined ? opts.roster : urlParams.get('roster') || 'internal';
    if (nextRoster && nextRoster !== 'internal') p.set('roster', String(nextRoster));
    // Default internal: omit from URL for cleaner links; still apply on server.

    const nextFilter = opts.filter !== undefined ? opts.filter : urlParams.get('filter');
    if (nextFilter) p.set('filter', String(nextFilter));

    if (nextEnneagram && nextEnneagram !== 'all') p.set('enneagram', nextEnneagram);

    if (nextDateFrom) p.set('dateFrom', nextDateFrom);
    if (nextDateTo) p.set('dateTo', nextDateTo);
    if (nextSearch) p.set('search', nextSearch);

    const nextTeamGroup =
      opts.teamGroup !== undefined ? opts.teamGroup : urlParams.get('teamGroup');
    if (nextTeamGroup) p.set('teamGroup', String(nextTeamGroup));

    const pipeResolved = opts.pipeline !== undefined ? opts.pipeline : pipeline;
    if (pipeResolved && pipeResolved !== 'all') p.set('pipeline', String(pipeResolved));

    // Detalhe individual da vaga (aba vacancies): /dashboard?tab=vacancies&vacancyDetail=<id>
    if (opts.vacancyDetail !== undefined) {
      if (opts.vacancyDetail) p.set('vacancyDetail', String(opts.vacancyDetail));
    } else {
      const curDetail = urlParams.get('vacancyDetail');
      if (curDetail) p.set('vacancyDetail', curDetail);
    }

    // Vacancy workspace section: keeps deep links and browser back/forward useful.
    if (opts.vacancySection !== undefined) {
      if (opts.vacancySection) p.set('vacancySection', String(opts.vacancySection));
    } else if ((opts.tab !== undefined ? opts.tab : urlParams.get('tab')) === 'vacancies') {
      const curSection = urlParams.get('vacancySection');
      if (curSection) p.set('vacancySection', curSection);
    }

    // Deep-link Equipe → pessoa: /dashboard?tab=team&candidate=<id>
    const nextTab = opts.tab !== undefined ? opts.tab : urlParams.get('tab') || 'overview';
    const pdiSearch = opts.pdiSearch !== undefined ? opts.pdiSearch : urlParams.get('pdiSearch');
    if (nextTab === 'pdi' && pdiSearch) p.set('pdiSearch', String(pdiSearch));
    const nextOrgUnit = opts.orgUnit !== undefined ? opts.orgUnit
      : opts.company !== undefined && String(opts.company) !== String(company) ? null : urlParams.get('orgUnit');
    if (nextTab === 'team' && nextOrgUnit) p.set('orgUnit', String(nextOrgUnit));
    const nextCreate = opts.create !== undefined ? opts.create : urlParams.get('create');
    if (nextTab === 'vacancies' && nextCreate === '1') p.set('create', '1');
    if (opts.candidate !== undefined) {
      if (opts.candidate) p.set('candidate', String(opts.candidate));
    } else if (nextTab === 'team') {
      const curCand = urlParams.get('candidate');
      if (curCand) p.set('candidate', curCand);
    }

    // Detalhe LMS: /dashboard?tab=lms&course=<id>
    if (opts.course !== undefined) {
      if (opts.course) p.set('course', String(opts.course));
    } else if (nextTab === 'lms') {
      const curCourse = urlParams.get('course');
      if (curCourse) p.set('course', curCourse);
    }

    if (opts.lmsSection !== undefined) {
      if (opts.lmsSection) p.set('lmsSection', String(opts.lmsSection));
    } else if (nextTab === 'lms') {
      const curLmsSection = urlParams.get('lmsSection');
      if (curLmsSection) p.set('lmsSection', curLmsSection);
    }

    if (opts.climateSection !== undefined) {
      if (opts.climateSection) p.set('climateSection', String(opts.climateSection));
    } else if (nextTab === 'climate') {
      const curClimateSection = urlParams.get('climateSection');
      if (curClimateSection) p.set('climateSection', curClimateSection);
    }

    if (opts.section !== undefined) {
      if (opts.section) p.set('section', String(opts.section));
    } else if (nextTab === 'team') {
      const curSection = urlParams.get('section');
      if (curSection) p.set('section', curSection);
    }

    // Contextual help deep-link: keeps the selected Guide article shareable
    // without carrying it into unrelated dashboard tabs.
    if (opts.helpSection !== undefined) {
      if (opts.helpSection) p.set('helpSection', String(opts.helpSection));
    } else if (nextTab === 'help') {
      const curHelpSection = urlParams.get('helpSection');
      if (curHelpSection) p.set('helpSection', curHelpSection);
    }

    const merged = { ...snapshot(), ...opts };
    const teamFrom = parseTeamPagination(merged);
    const teamSortSt = parseTeamSort(merged);
    p.set('teamSort', teamSortSt.sort);
    p.set('teamSortDir', teamSortSt.dir);
    const teamPg = opts.teamPage != null ? opts.teamPage : teamFrom.page;
    const teamPs = opts.teamPageSize != null ? opts.teamPageSize : teamFrom.pageSize;
    p.set('teamPage', String(Math.max(1, teamPg)));
    p.set('teamPageSize', String(teamPs));

    const vacLst = parseVacanciesPagination(merged);
    const vPg = opts.vacanciesPage != null ? opts.vacanciesPage : vacLst.page;
    const vPs = opts.vacanciesPageSize != null ? opts.vacanciesPageSize : vacLst.pageSize;
    p.set('vacanciesPage', String(Math.max(1, vPg)));
    p.set('vacanciesPageSize', String(vPs));

    const vacSortSt = parseVacanciesSort(merged, { isAdmin });
    p.set('vacanciesSort', vacSortSt.sort);
    p.set('vacanciesSortDir', vacSortSt.dir);
    const vacanciesQ = opts.vacanciesQ !== undefined ? opts.vacanciesQ : urlParams.get('vacanciesQ') || '';
    if (vacanciesQ) p.set('vacanciesQ', String(vacanciesQ));
    const vacanciesStatus = normalizeVacancyListFilter(
      opts.vacanciesStatus !== undefined ? opts.vacanciesStatus : urlParams.get('vacanciesStatus')
    );
    if (vacanciesStatus !== VACANCY_LIST_FILTER.ALL) p.set('vacanciesStatus', vacanciesStatus);

    const cmp = parseComparePagination(merged);
    const cPg = opts.comparePage != null ? opts.comparePage : cmp.page;
    const cPs = opts.comparePageSize != null ? opts.comparePageSize : cmp.pageSize;
    p.set('comparePage', String(Math.max(1, cPg)));
    p.set('comparePageSize', String(cPs));

    const compat = parseCompatTabPagination(merged);
    const compatPg = opts.compatPage != null ? opts.compatPage : compat.page;
    const compatPs = opts.compatPageSize != null ? opts.compatPageSize : compat.pageSize;
    p.set('compatPage', String(Math.max(1, compatPg)));
    p.set('compatPageSize', String(compatPs));

    const usrPgSt = parseUsersPagination(merged);
    const uPg = opts.usersPage != null ? opts.usersPage : usrPgSt.page;
    const uPs = opts.usersPageSize != null ? opts.usersPageSize : usrPgSt.pageSize;
    p.set('usersPage', String(Math.max(1, uPg)));
    p.set('usersPageSize', String(uPs));
    const usrSortSt = parseUsersSort(merged);
    p.set('usersSort', opts.usersSort != null ? opts.usersSort : usrSortSt.sort);
    p.set('usersSortDir', opts.usersSortDir != null ? opts.usersSortDir : usrSortSt.dir);
    const usersQ =
      opts.usersQ !== undefined ? opts.usersQ : urlParams.get('usersQ') || '';
    if (usersQ) p.set('usersQ', String(usersQ));
    const usersRole =
      opts.usersRole !== undefined ? opts.usersRole : urlParams.get('usersRole') || '';
    if (usersRole) p.set('usersRole', String(usersRole));
    const usersActive =
      opts.usersActive !== undefined ? opts.usersActive : urlParams.get('usersActive') || '';
    if (usersActive) p.set('usersActive', String(usersActive));
    const usersCompany =
      opts.usersCompany !== undefined ? opts.usersCompany : urlParams.get('usersCompany') || '';
    if (usersCompany) p.set('usersCompany', String(usersCompany));

    const leadsStatus =
      opts.leadsStatus !== undefined ? opts.leadsStatus : urlParams.get('leadsStatus') || 'all';
    if (leadsStatus && leadsStatus !== 'all') p.set('leadsStatus', String(leadsStatus));
    const leadsQ = opts.leadsQ !== undefined ? opts.leadsQ : urlParams.get('leadsQ') || '';
    if (leadsQ) p.set('leadsQ', String(leadsQ));
    const leadsPageRaw = opts.leadsPage != null ? opts.leadsPage : parseInt(urlParams.get('leadsPage') || '1', 10);
    const leadsPage = Number.isFinite(Number(leadsPageRaw)) && Number(leadsPageRaw) >= 1 ? Number(leadsPageRaw) : 1;
    p.set('leadsPage', String(leadsPage));
    const leadsPsRaw =
      opts.leadsPageSize != null ? opts.leadsPageSize : parseInt(urlParams.get('leadsPageSize') || '20', 10);
    const leadsPageSize = PAGE_SIZE_OPTIONS.includes(Number(leadsPsRaw)) ? Number(leadsPsRaw) : 20;
    p.set('leadsPageSize', String(leadsPageSize));

    const fbStatus =
      opts.fbStatus !== undefined ? opts.fbStatus : urlParams.get('fbStatus') || 'all';
    if (fbStatus && fbStatus !== 'all') p.set('fbStatus', String(fbStatus));
    const fbKind = opts.fbKind !== undefined ? opts.fbKind : urlParams.get('fbKind') || 'all';
    if (fbKind && fbKind !== 'all') p.set('fbKind', String(fbKind));
    const fbSeverity = opts.fbSeverity !== undefined ? opts.fbSeverity : urlParams.get('fbSeverity') || 'all';
    if (fbSeverity && fbSeverity !== 'all') p.set('fbSeverity', String(fbSeverity));
    const fbModule = opts.fbModule !== undefined ? opts.fbModule : urlParams.get('fbModule') || 'all';
    if (fbModule && fbModule !== 'all') p.set('fbModule', String(fbModule));
    const fbOverdue = opts.fbOverdue !== undefined ? opts.fbOverdue : urlParams.get('fbOverdue');
    if (fbOverdue === '1') p.set('fbOverdue', '1');
    const fbQ = opts.fbQ !== undefined ? opts.fbQ : urlParams.get('fbQ') || '';
    if (fbQ) p.set('fbQ', String(fbQ));
    const fbPageRaw = opts.fbPage != null ? opts.fbPage : parseInt(urlParams.get('fbPage') || '1', 10);
    const fbPage = Number.isFinite(Number(fbPageRaw)) && Number(fbPageRaw) >= 1 ? Number(fbPageRaw) : 1;
    p.set('fbPage', String(fbPage));
    const fbPsRaw =
      opts.fbPageSize != null ? opts.fbPageSize : parseInt(urlParams.get('fbPageSize') || '20', 10);
    const fbPageSize = PAGE_SIZE_OPTIONS.includes(Number(fbPsRaw)) ? Number(fbPsRaw) : 20;
    p.set('fbPageSize', String(fbPageSize));

    const auditActorKind =
      opts.auditActorKind !== undefined ? opts.auditActorKind : urlParams.get('auditActorKind') || 'all';
    if (auditActorKind && auditActorKind !== 'all') p.set('auditActorKind', String(auditActorKind));
    const auditCompanyId =
      opts.auditCompanyId !== undefined ? opts.auditCompanyId : urlParams.get('auditCompanyId') || '';
    if (auditCompanyId && auditCompanyId !== 'all') p.set('auditCompanyId', String(auditCompanyId));
    const auditAction =
      opts.auditAction !== undefined ? opts.auditAction : urlParams.get('auditAction') || '';
    if (auditAction) p.set('auditAction', String(auditAction));
    const auditQ = opts.auditQ !== undefined ? opts.auditQ : urlParams.get('auditQ') || '';
    if (auditQ) p.set('auditQ', String(auditQ));
    const auditPageRaw =
      opts.auditPage != null ? opts.auditPage : parseInt(urlParams.get('auditPage') || '1', 10);
    const auditPage = Number.isFinite(Number(auditPageRaw)) && Number(auditPageRaw) >= 1 ? Number(auditPageRaw) : 1;
    p.set('auditPage', String(auditPage));
    const auditPsRaw =
      opts.auditPageSize != null ? opts.auditPageSize : parseInt(urlParams.get('auditPageSize') || '30', 10);
    const auditPageSize = [20, 30, 50, 100].includes(Number(auditPsRaw)) ? Number(auditPsRaw) : 30;
    p.set('auditPageSize', String(auditPageSize));

    const coPgSt = parseCompaniesPagination(merged);
    const coPg = opts.companiesPage != null ? opts.companiesPage : coPgSt.page;
    const coPs = opts.companiesPageSize != null ? opts.companiesPageSize : coPgSt.pageSize;
    p.set('companiesPage', String(Math.max(1, coPg)));
    p.set('companiesPageSize', String(coPs));
    const coSortSt = parseCompaniesSort(merged);
    p.set('companiesSort', opts.companiesSort != null ? opts.companiesSort : coSortSt.sort);
    p.set('companiesSortDir', opts.companiesSortDir != null ? opts.companiesSortDir : coSortSt.dir);
    const companiesQ =
      opts.companiesQ !== undefined ? opts.companiesQ : urlParams.get('companiesQ') || '';
    if (companiesQ) p.set('companiesQ', String(companiesQ));
    const companiesActive =
      opts.companiesActive !== undefined
        ? opts.companiesActive
        : urlParams.get('companiesActive') || '';
    if (companiesActive) p.set('companiesActive', String(companiesActive));
    const companiesView =
      opts.companiesView !== undefined ? opts.companiesView : urlParams.get('companiesView') || '';
    if (companiesView) p.set('companiesView', String(companiesView));

    const resolvedTab =
      opts.tab !== undefined ? opts.tab : urlParams.get('tab') || 'overview';
    p.set('tab', resolvedTab);

    for (const [key, def] of Object.entries(LIST_PARAM_DEFAULTS)) {
      if (p.get(key) === def) p.delete(key);
    }

    return p;
  };

  const navigateWithOpts = (opts = {}) => {
    const scroll = opts.scroll !== false;
    const { scroll: _scrollOpt, clientOnly: _clientOnlyOpt, ...urlOpts } = opts;
    const href = `/dashboard?${buildDashboardUrl(urlOpts).toString()}`;
    if (opts.clientOnly && typeof window !== 'undefined') {
      // Keep tab state deep-linkable without requesting a new server page payload.
      window.history.pushState(null, '', href);
      return;
    }
    const currentTab = urlParams.get('tab') || 'overview';
    setPendingTab(urlOpts.tab !== undefined && urlOpts.tab !== currentTab ? urlOpts.tab : null);
    startNavTransition(() => {
      router.push(href, { scroll });
    });
  };

  const navigateToTab = (id) => {
    const currentTab = urlParams.get('tab') || 'overview';
    const clientOnly = id !== currentTab && canSwitchTabClientOnly(id, { isAdmin, companiesLoaded });
    navigateWithOpts({ tab: id, vacancyDetail: '', ...(clientOnly ? { clientOnly: true } : {}) });
    if (clientOnly) window.scrollTo(0, 0);
  };

  const pushFilters = (nextFilter) => {
    navigateWithOpts({
      ...(nextFilter?.tab != null ? { tab: nextFilter.tab } : {}),
      ...(nextFilter?.company != null ? { company: nextFilter.company } : {}),
      ...(nextFilter?.area != null ? { area: nextFilter.area } : {}),
      ...(nextFilter?.vacancy != null ? { vacancy: nextFilter.vacancy } : {}),
      ...(nextFilter?.enneagram != null ? { enneagram: nextFilter.enneagram } : {}),
      ...(nextFilter?.pipeline != null ? { pipeline: nextFilter.pipeline } : {}),
      ...(nextFilter?.roster != null ? { roster: nextFilter.roster } : {}),
      ...(nextFilter?.filter !== undefined ? { filter: nextFilter.filter } : {}),
      ...(nextFilter?.dateFrom !== undefined ? { dateFrom: nextFilter.dateFrom } : {}),
      ...(nextFilter?.dateTo !== undefined ? { dateTo: nextFilter.dateTo } : {}),
      ...(nextFilter?.search !== undefined ? { search: nextFilter.search } : {}),
      ...(nextFilter?.teamGroup !== undefined ? { teamGroup: nextFilter.teamGroup } : {}),
      ...(nextFilter?.orgUnit !== undefined ? { orgUnit: nextFilter.orgUnit } : {}),
      teamPage: 1,
      comparePage: 1,
      vacanciesPage: 1,
      compatPage: 1,
      usersPage: 1,
      companiesPage: 1,
    });
  };

  const pushTeamPagination = (opts) => {
    navigateWithOpts({
      teamPage: opts.teamPage ?? teamPagination.page,
      teamPageSize: opts.teamPageSize ?? teamPagination.pageSize,
    });
  };

  const pushTeamSort = (column) => {
    const cur = parseTeamSort(snapshot());
    const nextDir =
      cur.sort === column ? (cur.dir === 'asc' ? 'desc' : 'asc') : column === 'createdAt' ? 'desc' : 'asc';
    navigateWithOpts({
      teamSort: column,
      teamSortDir: nextDir,
      teamPage: 1,
    });
  };

  const pushComparePagination = (opts) => {
    const cmp = parseComparePagination(snapshot());
    navigateWithOpts({
      comparePage: opts.page ?? cmp.page,
      comparePageSize: opts.pageSize ?? cmp.pageSize,
    });
  };

  const pushCompatListPagination = (opts) => {
    const cx = parseCompatTabPagination(snapshot());
    navigateWithOpts({
      compatPage: opts.page ?? cx.page,
      compatPageSize: opts.pageSize ?? cx.pageSize,
    });
  };

  return {
    navPending,
    pendingTab: navPending ? pendingTab : null,
    snapshot,
    navigateWithOpts,
    navigateToTab,
    pushFilters,
    pushTeamPagination,
    pushTeamSort,
    pushComparePagination,
    pushCompatListPagination,
  };
}
