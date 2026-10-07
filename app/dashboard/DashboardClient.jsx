'use client';

import { SelectField } from '../_components/SelectField';

import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter, useSearchParams } from 'next/navigation';
import { getCompat } from '../../lib/data';
import { getTypeData, localizeAreaLabel } from '../../lib/i18n-data';
import { typeHintTooltip } from '../../lib/type-en';
import { t } from '../../lib/i18n';
import { useLocale } from '../../lib/useLocale';
import { CAP, can, canAccessDashboardTab, isAdminRole, isSuperAdminPayload } from '../../lib/permissions';
import { VACANCY_STATUS, ROSTER_SCOPE } from '../../lib/domain-status.js';
import { cn } from '../../lib/cn';
import { managerLoginUrl } from '../../lib/manager-client-session';
import { BrandMark } from '../_components/BrandMark';
import { Icon } from '../_components/Icon';
import { DateField } from '../_components/DateField';
import { RosterEmptyHint } from '../_components/RosterEmptyHint';

import {
  PAGE_SIZE_OPTIONS,
  parseComparePagination,
  parseCompatTabPagination,
  parseDashboardTab,
  parseTeamSort,
} from '../../lib/assessment-filters';

import { DashboardBreadcrumb, DashboardPageTitleContext, getDashboardTabNav, S } from './dashboard-shared';
import { preloadDashboardTab } from './dashboard-tab-preload';
import { useDashboardNavigation } from './hooks/useDashboardNavigation';
import { PipelineExtrasProvider } from './PipelineExtrasContext';
import { AppFeedbackProvider, useAppFeedbackOptional } from '../_components/AppFeedback';
import { AppLoading, ContentEnter, NavLoadBar } from '../_components/AppLoading';
import { DashboardTopBarMenus } from '../_components/DashboardTopBarMenus';
import { HelpAssistantWidget } from './HelpAssistantWidget';
import { useKeyboardShortcuts, KeyboardShortcutsHelp, GModePending } from '../_components/KeyboardShortcuts';

const OnboardingTour = dynamic(() => import('../_components/OnboardingTour').then((mod) => mod.OnboardingTour), { ssr: false });
const OnboardingWizard = dynamic(() => import('../_components/OnboardingWizard'), { ssr: false });
const ONBOARDING_WIZARD_SESSION_KEY = 'team30_onboarding_wizard_done';
import { PersonaPlaybookCard } from '../_components/PersonaPlaybookCard';
import { FormField } from '../_components/FormField';
import {
  COHORT_TABS,
  COMPANY_SCOPE_TABS,
  resolveStickyCompanyPreference,
  writeStickyCompanyId,
} from '../../lib/dashboard-company-scope.js';
import {
  DASHBOARD_NAV_SECTION,
  DASHBOARD_NAV_SECTIONS,
  getDashboardSection,
} from '../../lib/dashboard-navigation.js';
import { SidebarNav, SidebarNavItem } from '../_components/SidebarNav';
import { helpMetaForTab } from '../../lib/help-screen-context.js';

function TabLoadingFallback() {
  return <AppLoading variant="panel" />;
}

const OrganizationTab = dynamic(
  () => import('./tabs/OrganizationTab').then((m) => ({ default: m.OrganizationTab })),
  { loading: () => <TabLoadingFallback /> }
);

const TeamTab = dynamic(
  () => import('./tabs/TeamTab').then((m) => ({ default: m.TeamTab })),
  { loading: () => <TabLoadingFallback /> }
);

function ExportCsvButton({ href, locale }) {
  const fb = useAppFeedbackOptional();
  const [busy, setBusy] = useState(false);

  const onExport = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(href);
      if (!res.ok) throw new Error('export_failed');
      const truncated = res.headers.get('X-Export-Truncated') === '1';
      const maxRows = parseInt(res.headers.get('X-Export-Max-Rows') || '', 10);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `candidatos_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      if (truncated) {
        fb?.toast?.(
          t(locale, 'dashboard.exportTruncated', {
            n: Number.isFinite(maxRows) ? maxRows : 10000,
          }),
          'info'
        );
      }
    } catch {
      fb?.toast?.(t(locale, 'dashboard.exportFailed'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={onExport}
      disabled={busy}
      className={cn(S.btnGhost, 'whitespace-nowrap text-prose', busy && 'cursor-wait opacity-70')}
    >
      <Icon name="download" className="h-3.5 w-3.5 shrink-0" aria-hidden />
      {t(locale, 'dashboard.exportCsv')}
    </button>
  );
}

const CompareTabLoader = dynamic(
  () => import('./tabs/CompareTabLoader').then((m) => ({ default: m.CompareTabLoader })),
  { loading: () => <TabLoadingFallback /> }
);
const CompatTab = dynamic(
  () => import('./tabs/CompatTab').then((m) => ({ default: m.CompatTab })),
  { loading: () => <TabLoadingFallback /> }
);
const CompaniesAdminTab = dynamic(
  () => import('./tabs/CompaniesAdminTab').then((m) => ({ default: m.CompaniesAdminTab })),
  { loading: () => <TabLoadingFallback /> }
);
const GroupTab = dynamic(
  () => import('./tabs/GroupTab').then((m) => ({ default: m.GroupTab })),
  { loading: () => <TabLoadingFallback /> }
);
const LeadershipTab = dynamic(
  () => import('./tabs/LeadershipTab').then((m) => ({ default: m.LeadershipTab })),
  { loading: () => <TabLoadingFallback /> }
);
const OverviewTab = dynamic(
  () => import('./tabs/OverviewTab').then((m) => ({ default: m.OverviewTab })),
  { loading: () => <TabLoadingFallback /> }
);
const AnalyticsTab = dynamic(
  () => import('./tabs/AnalyticsTab').then((m) => ({ default: m.AnalyticsTab })),
  { loading: () => <TabLoadingFallback /> }
);
const UsersAdminTab = dynamic(
  () => import('./tabs/UsersAdminTab').then((m) => ({ default: m.UsersAdminTab })),
  { loading: () => <TabLoadingFallback /> }
);
const JobRolesAdminTab = dynamic(
  () => import('./tabs/JobRolesAdminTab').then((m) => ({ default: m.JobRolesAdminTab })),
  { loading: () => <TabLoadingFallback /> }
);
const PerformanceReviewsAdminTab = dynamic(
  () => import('./tabs/PerformanceReviewsAdminTab').then((m) => ({ default: m.PerformanceReviewsAdminTab })),
  { loading: () => <TabLoadingFallback /> }
);
const PdiAdminTab = dynamic(
  () => import('./tabs/PdiAdminTab').then((m) => ({ default: m.PdiAdminTab })),
  { loading: () => <TabLoadingFallback /> }
);
const OkrAdminTab = dynamic(
  () => import('./tabs/OkrAdminTab').then((m) => ({ default: m.OkrAdminTab })),
  { loading: () => <TabLoadingFallback /> }
);
const SuccessionAdminTab = dynamic(
  () => import('./tabs/SuccessionAdminTab').then((m) => ({ default: m.SuccessionAdminTab })),
  { loading: () => <TabLoadingFallback /> }
);
const ExitAnalysisAdminTab = dynamic(
  () => import('./tabs/ExitAnalysisAdminTab').then((m) => ({ default: m.ExitAnalysisAdminTab })),
  { loading: () => <TabLoadingFallback /> }
);
const LearningResourcesAdminTab = dynamic(
  () => import('./tabs/LearningResourcesAdminTab').then((m) => ({ default: m.LearningResourcesAdminTab })),
  { loading: () => <TabLoadingFallback /> }
);
const LmsAdminTab = dynamic(
  () => import('./tabs/LmsAdminTab').then((m) => ({ default: m.LmsAdminTab })),
  { loading: () => <TabLoadingFallback /> }
);
const CompanyBenefitsAdminTab = dynamic(
  () => import('./tabs/CompanyBenefitsAdminTab').then((m) => ({ default: m.CompanyBenefitsAdminTab })),
  { loading: () => <TabLoadingFallback /> }
);
const CompanyFeedAdminTab = dynamic(
  () => import('./tabs/CompanyFeedAdminTab').then((m) => ({ default: m.CompanyFeedAdminTab })),
  { loading: () => <TabLoadingFallback /> }
);
const DpAdminTab = dynamic(
  () => import('./tabs/DpAdminTab').then((m) => ({ default: m.DpAdminTab })),
  { loading: () => <TabLoadingFallback /> }
);
const CompensationAdminTab = dynamic(
  () => import('./tabs/CompensationAdminTab').then((m) => ({ default: m.CompensationAdminTab })),
  { loading: () => <TabLoadingFallback /> }
);
const LeadsAdminTab = dynamic(
  () => import('./tabs/LeadsAdminTab').then((m) => ({ default: m.LeadsAdminTab })),
  { loading: () => <TabLoadingFallback /> }
);
const ProductFeedbackAdminTab = dynamic(
  () =>
    import('./tabs/ProductFeedbackAdminTab').then((m) => ({
      default: m.ProductFeedbackAdminTab,
    })),
  { loading: () => <TabLoadingFallback /> }
);
const AuditAdminTab = dynamic(
  () => import('./tabs/AuditAdminTab').then((m) => ({ default: m.AuditAdminTab })),
  { loading: () => <TabLoadingFallback /> }
);
const VacanciesAdminTab = dynamic(
  () => import('./tabs/VacanciesAdminTab').then((m) => ({ default: m.VacanciesAdminTab })),
  { loading: () => <TabLoadingFallback /> }
);
const TalentBankAdminTab = dynamic(
  () => import('./tabs/TalentBankAdminTab').then((m) => ({ default: m.TalentBankAdminTab })),
  { loading: () => <TabLoadingFallback /> }
);
const MotivatorsAdminTab = dynamic(() => import('./tabs/MotivatorsAdminTab'), {
  loading: () => <TabLoadingFallback />,
});
const ClimateTab = dynamic(
  () => import('./tabs/ClimateTab').then((m) => ({ default: m.ClimateTab })),
  { loading: () => <TabLoadingFallback /> }
);
const WhistleblowingAdminTab = dynamic(
  () =>
    import('./tabs/WhistleblowingAdminTab').then((m) => ({
      default: m.WhistleblowingAdminTab,
    })),
  { loading: () => <TabLoadingFallback /> }
);
const HelpTab = dynamic(
  () => import('./tabs/HelpTab').then((m) => ({ default: m.HelpTab })),
  { loading: () => <TabLoadingFallback /> }
);
const ProfileTab = dynamic(
  () => import('../_components/ProfileTab').then((m) => ({ default: m.ProfileTab })),
  { loading: () => <TabLoadingFallback /> }
);

const SIDEBAR_COLLAPSED_KEY = '30team_sidebar_collapsed';
export default function DashboardClient(props) {
  const [locale, setLocale] = useLocale(props.auth?.locale || props.initialLocale || 'pt-BR', {
    fromAccount: Boolean(props.auth?.locale),
  });
  return (
    <AppFeedbackProvider locale={locale}>
      <DashboardClientContent {...props} locale={locale} setLocale={setLocale} />
    </AppFeedbackProvider>
  );
}

function DashboardClientContent({
  results,
  areas = [],
  companies = [],
  counts = [],
  vacancies = [],
  selectedArea = 'all',
  selectedVacancy = 'all',
  selectedPipeline = 'all',
  selectedRoster = 'internal',
  selectedListFilter = null,
  selectedCompany = 'all',
  selectedDateFrom = null,
  selectedDateTo = null,
  selectedSearch = '',
  pagination = { page: 1, pageSize: 20, total: 0, totalPages: 1 },
  compatMetrics = {
    pairs: [],
    tensions: [],
    synergies: [],
    typeCount: {},
    total: 0,
  },
  interactionPeople = [],
  selectedEnneagram = 'all',
  analytics = null,
  overviewMetrics = null,
  onboardingProgress = null,
  auth = null,
  locale,
  setLocale,
  /** Shell-only paint while tab queries stream (B-201). */
  panelLoading = false,
}) {
  const router = useRouter();
  const urlParams = useSearchParams();
  const feedback = useAppFeedbackOptional();
  const initialTabRef = useRef(parseDashboardTab(urlParams, auth));

  // Keyboard shortcuts
  const { showHelp, setShowHelp, gPressed } = useKeyboardShortcuts({
    onNavigateToTab: (tabName) => navigateToTab(tabName),
  });

  const [area, setArea] = useState(selectedArea);
  const [vacancy, setVacancy] = useState(selectedVacancy);
  const [company, setCompany] = useState(selectedCompany);
  /** After admin clears company, do not immediately re-apply sticky from localStorage. */
  const skipStickyCompanyRestoreRef = useRef(false);
  const [enneagram, setEnneagram] = useState(selectedEnneagram);
  const [pipeline, setPipeline] = useState(selectedPipeline);
  const [roster, setRoster] = useState(selectedRoster);
  const [dateFrom, setDateFrom] = useState(selectedDateFrom || '');
  const [dateTo, setDateTo] = useState(selectedDateTo || '');
  const [search, setSearch] = useState(selectedSearch || '');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const sidebarNavRef = useRef(null);
  const sidebarRef = useRef(null);
  const menuButtonRef = useRef(null);
  /** Section picked on the rail; only valid while the tab it was picked on stays active. */
  const [filtersOpen, setFiltersOpen] = useState(null);
  const [isDesktop, setIsDesktop] = useState(true);
  const [newCandidates, setNewCandidates] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const logoutConfirmPendingRef = useRef(false);
  const [groupBaseId, setGroupBaseId] = useState(null);
  const [groupIds, setGroupIds] = useState([]);
  const [dismissedIds, setDismissedIds] = useState([]);
  const typeData = getTypeData(locale);
  const [sessionAuth, setSessionAuth] = useState(auth);

  useEffect(() => {
    setSessionAuth(auth);
  }, [auth]);

  // onboardingProgress only ships with the Overview payload; keep the tour mounted while it moves across tabs.
  const [tourEligible, setTourEligible] = useState(false);
  const [wizardShownThisVisit, setWizardShownThisVisit] = useState(() => Boolean(auth?.showOnboardingWizard));
  useEffect(() => {
    if (onboardingProgress && onboardingProgress.progress < 100) setTourEligible(true);
  }, [onboardingProgress]);
  useEffect(() => {
    try {
      if (sessionStorage.getItem(ONBOARDING_WIZARD_SESSION_KEY) === '1') setWizardShownThisVisit(true);
    } catch {
      /* ignore */
    }
  }, []);
  const showOnboardingTour = tourEligible && !wizardShownThisVisit && !sessionAuth?.showOnboardingWizard;

  const logout = async () => {
    if (loggingOut || logoutConfirmPendingRef.current) return;
    logoutConfirmPendingRef.current = true;
    setSidebarOpen(false);
    try {
      const confirmed = await feedback?.confirm?.({
        title: t(locale, 'dashboard.logoutConfirmTitle'),
        message: t(locale, 'dashboard.logoutConfirmBody'),
        confirmLabel: t(locale, 'dashboard.logoutConfirmAction'),
        danger: true,
      });
      if (!confirmed) return;
      setLoggingOut(true);
      try {
        await fetch('/api/auth/logout', { method: 'POST' });
      } finally {
        router.push(managerLoginUrl({ reason: 'logout' }));
      }
    } finally {
      logoutConfirmPendingRef.current = false;
    }
  };

  const isAdmin = isAdminRole(sessionAuth);
  /** Admin without company on the user row: use the panel company filter (not "all"). */
  const scopedCompanyId =
    company && company !== 'all'
      ? Number(company)
      : (sessionAuth?.companyId ?? null);
  const showLeads = isSuperAdminPayload(sessionAuth);
  const showProductFeedback = isSuperAdminPayload(sessionAuth);
  const showAudit = canAccessDashboardTab(sessionAuth, 'audit');
  const tab = parseDashboardTab(urlParams, sessionAuth);
  const contextualHelpSection = helpMetaForTab(tab)?.guideSections?.[0] || null;
  const isPersonFocus = tab === 'team' && Boolean(urlParams.get('candidate'));
  const isVacancyDetail = tab === 'vacancies' && Boolean(urlParams.get('vacancyDetail'));
  const showsCohortChrome = COHORT_TABS.has(tab) && !isPersonFocus;
  /** Super admin: company picker on cohort chrome or company-scoped People/catalog tabs. */
  const showsCompanyPicker =
    isAdmin &&
    companies.length > 0 &&
    (showsCohortChrome || COMPANY_SCOPE_TABS.has(tab));
  /** Global search duplicates TeamTab; Leadership is chart-first — hide there. */
  const showGlobalSearch = showsCohortChrome && tab !== 'team' && tab !== 'leadership';
  const showVacancies = can(sessionAuth, CAP.VACANCIES_VIEW);
  const showMotivators = can(sessionAuth, CAP.MOTIVATORS_VIEW);
  const showClimate = can(sessionAuth, CAP.CLIMATE_VIEW);
  const showWhistleblowing = can(sessionAuth, CAP.WHISTLEBLOWING_VIEW);
  const showCompanies = can(sessionAuth, CAP.COMPANIES_MANAGE);
  const showUsers = can(sessionAuth, CAP.USERS_MANAGE);
  const showJobRoles = can(sessionAuth, CAP.JOB_ROLES_VIEW);
  const canViewJobRoles = showJobRoles || can(sessionAuth, CAP.VACANCIES_MANAGE);
  const showPerformance = can(sessionAuth, CAP.PERFORMANCE_VIEW);
  const showPdi = can(sessionAuth, CAP.TEAM_VIEW);
  const showSuccession = can(sessionAuth, CAP.SUCCESSION_VIEW);
  const showExitAnalysis = can(sessionAuth, CAP.EXIT_ANALYSIS_VIEW);
  const showLearning = can(sessionAuth, CAP.LEARNING_VIEW);
  const showBenefits = can(sessionAuth, CAP.BENEFITS_VIEW);
  const showCompanyFeed = can(sessionAuth, CAP.COMPANY_FEED_VIEW);
  const showDp = can(sessionAuth, CAP.DP_VIEW);
  const showCompensation = can(sessionAuth, CAP.COMPENSATION_VIEW);
  const manageCompensation = can(sessionAuth, CAP.COMPENSATION_MANAGE);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const orig = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const res = await orig(...args);
      try {
        const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
        if (
          res.status === 401 &&
          (String(url).includes('/api/admin') || String(url).includes('/api/me'))
        ) {
          const next = `${window.location.pathname}${window.location.search || ''}`;
          window.location.assign(managerLoginUrl({ reason: 'expired', redirect: next }));
        }
      } catch {
        /* ignore */
      }
      return res;
    };
    return () => {
      window.fetch = orig;
    };
  }, []);

  useEffect(() => {
    setArea(selectedArea);
  }, [selectedArea]);
  useEffect(() => {
    setVacancy(selectedVacancy);
  }, [selectedVacancy]);
  useEffect(() => {
    setCompany(selectedCompany);
  }, [selectedCompany]);
  useEffect(() => {
    setEnneagram(selectedEnneagram);
  }, [selectedEnneagram]);
  useEffect(() => {
    setPipeline(selectedPipeline);
  }, [selectedPipeline]);
  useEffect(() => {
    setRoster(selectedRoster);
  }, [selectedRoster]);
  useEffect(() => { setDateFrom(selectedDateFrom || ''); }, [selectedDateFrom]);
  useEffect(() => { setDateTo(selectedDateTo || ''); }, [selectedDateTo]);
  useEffect(() => { setSearch(selectedSearch || ''); }, [selectedSearch]);

  useEffect(() => {
    try {
      setSidebarCollapsed(localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1');
    } catch {}
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mq = window.matchMedia('(min-width: 769px)');
    const apply = () => setIsDesktop(mq.matches);
    apply();
    if (mq.addEventListener) mq.addEventListener('change', apply);
    else mq.addListener(apply);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', apply);
      else mq.removeListener(apply);
    };
  }, []);

  useEffect(() => {
    if (!sidebarOpen || isDesktop) {
      document.body.classList.remove('sidebar-open');
      return undefined;
    }
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.body.classList.add('sidebar-open');
    const sidebar = sidebarRef.current;
    const focusable = () => [...sidebar.querySelectorAll('a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')]
      .filter(element => element.getClientRects().length > 0 && !element.closest('[inert]'));
    const frame = requestAnimationFrame(() => focusable()[0]?.focus());
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); setSidebarOpen(false); return; }
      if (e.key !== 'Tab') return;
      const elements = focusable(), first = elements[0], last = elements.at(-1);
      if (!first) { e.preventDefault(); return; }
      if (!sidebar.contains(document.activeElement) || (e.shiftKey && document.activeElement === first)) {
        e.preventDefault(); (e.shiftKey ? last : first).focus();
      } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(frame);
      menuButtonRef.current?.focus({ preventScroll: true });
      document.body.style.overflow = prevOverflow;
      document.body.classList.remove('sidebar-open');
      window.removeEventListener('keydown', onKey);
    };
  }, [sidebarOpen, isDesktop]);

  useEffect(() => {
    if (isDesktop) setSidebarOpen(false);
  }, [isDesktop]);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const tabKey = `dashboard.${tab}`;
    const tabLabel = t(locale, tabKey);
    const label =
      tabLabel && tabLabel !== tabKey ? tabLabel : t(locale, 'dashboard.panel');
    const prev = document.title;
    document.title = t(locale, 'dashboard.documentTitle', { tab: label });
    return () => {
      document.title = prev;
    };
  }, [locale, tab]);

  const navCollapsed = sidebarCollapsed && isDesktop;

  const toggleSidebarCollapsed = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? '1' : '0');
      } catch {}
      return next;
    });
  };


  // Keep the active destination visible inside the sidebar without moving the page content.
  useEffect(() => {
    const container = sidebarNavRef.current;
    if (!container || navCollapsed) return undefined;
    const frame = window.requestAnimationFrame(() => {
      const item = document.getElementById(`${tab}-tab`);
      if (!item || !container.contains(item)) return;
      const containerRect = container.getBoundingClientRect();
      const itemRect = item.getBoundingClientRect();
      const safeGap = 12;
      if (itemRect.top < containerRect.top + safeGap) {
        container.scrollTop += itemRect.top - containerRect.top - safeGap;
      } else if (itemRect.bottom > containerRect.bottom - safeGap) {
        container.scrollTop += itemRect.bottom - containerRect.bottom + safeGap;
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [tab, navCollapsed]);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('30team_group') || '{}');
      if (saved.baseId != null) setGroupBaseId(saved.baseId);
      if (Array.isArray(saved.ids)) setGroupIds(saved.ids);
      if (Array.isArray(saved.dismissed)) setDismissedIds(saved.dismissed);
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('30team_group', JSON.stringify({
        baseId: groupBaseId,
        ids: groupIds,
        dismissed: dismissedIds,
      }));
    } catch {}
  }, [groupBaseId, groupIds, dismissedIds]);

  const listTotal = compatMetrics.total ?? 0;
  /**
   * Bolinha em Equipe: heurística local (não é a notificação do sino).
   * Qualquer role com empresa; super admin (admin sem company_id) não usa.
   */
  const teamBadgeScopeRef = useRef(null);
  useEffect(() => {
    const homeCompanyId = sessionAuth?.companyId;
    const isSuperAdmin = isAdmin && (homeCompanyId == null || homeCompanyId === '');
    if (isSuperAdmin) {
      setNewCandidates(false);
      teamBadgeScopeRef.current = null;
      return;
    }
    const scope = `u:${sessionAuth?.userId != null ? sessionAuth.userId : 'me'}:c:${homeCompanyId}`;
    try {
      const key = `30team_lastTotal:${scope}`;
      if (teamBadgeScopeRef.current !== scope) {
        const prev = parseInt(localStorage.getItem(key) || '0', 10);
        if (prev > 0 && listTotal > prev) setNewCandidates(true);
        else setNewCandidates(false);
        localStorage.setItem(key, String(listTotal));
        teamBadgeScopeRef.current = scope;
      }
    } catch {
      /* ignore */
    }
  }, [isAdmin, sessionAuth?.userId, sessionAuth?.companyId, listTotal]);

  const {
    navPending,
    pendingTab,
    snapshot,
    navigateWithOpts,
    navigateToTab,
    pushFilters,
    pushTeamPagination,
    pushTeamSort,
    pushComparePagination,
    pushCompatListPagination,
  } = useDashboardNavigation({
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
    companiesLoaded: companies.length > 0,
    teamPagination: pagination,
  });
  const navTab = pendingTab || tab;
  const showPanelLoading = panelLoading || Boolean(pendingTab);

  const applyCompanyFilter = (nextCompany, extraFilters = {}) => {
    const v = nextCompany == null || nextCompany === '' ? 'all' : String(nextCompany);
    setCompany(v);
    if (v === 'all') {
      skipStickyCompanyRestoreRef.current = true;
      writeStickyCompanyId(null);
    } else {
      skipStickyCompanyRestoreRef.current = false;
      writeStickyCompanyId(v);
    }
    pushFilters({ company: v, ...extraFilters });
  };

  const companyFilterAllLabel = COMPANY_SCOPE_TABS.has(tab)
    ? t(locale, 'dashboard.companyFilterPick')
    : t(locale, 'dashboard.allCompanies');

  const companyFilterControl = (extraFilters = {}) => (
    <FormField
      as="div"
      label={t(locale, 'dashboard.companyFilterLabel')}
      className="w-auto min-w-[10rem] max-w-[18rem] shrink-0"
    >
      <SelectField
        value={company}
        onChange={(e) => {
          const v = e.target.value;
          if (extraFilters.pipeline === 'all') setPipeline('all');
          applyCompanyFilter(v, extraFilters);
        }}
        className={cn(S.select, 'w-full min-w-[10rem]')}
        aria-label={t(locale, 'dashboard.companyFilterLabel')}
      >
        <option value="all">{companyFilterAllLabel}</option>
        {companies.map((co) => (
          <option key={co.id} value={String(co.id)}>
            {co.name}
          </option>
        ))}
      </SelectField>
    </FormField>
  );

  useEffect(() => {
    if (!isAdmin || panelLoading || !companies.length) return;
    if (company && company !== 'all') {
      writeStickyCompanyId(company);
      skipStickyCompanyRestoreRef.current = false;
      return;
    }
    if (skipStickyCompanyRestoreRef.current) return;
    const wantsScope =
      COMPANY_SCOPE_TABS.has(tab) || showsCohortChrome || tab === 'audit';
    if (!wantsScope) return;
    const preferred = resolveStickyCompanyPreference({ urlCompany: 'all', companies });
    if (!preferred) return;
    writeStickyCompanyId(preferred);
    pushFilters({ company: preferred });
  }, [
    isAdmin,
    panelLoading,
    companies,
    company,
    tab,
    showsCohortChrome,
    pushFilters,
  ]);

  const pairs = compatMetrics.pairs || [];
  const tensions = compatMetrics.tensions || [];
  const synergies = compatMetrics.synergies || [];
  const pairTotals = compatMetrics.pairTotals || null;
  const typeCount = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0 };
  Object.assign(typeCount, compatMetrics.typeCount || {});
  const maxCount = Math.max(...Object.values(typeCount), 1);

  const { groupBase, suggestions, groupTensions } = useMemo(() => {
    if (tab !== 'group') return { groupBase: null, suggestions: [], groupTensions: [] };
    const byAssessmentId = new Map(interactionPeople.map((r) => [String(r.assessmentId), r]));
    const base = groupBaseId ? byAssessmentId.get(String(groupBaseId)) || null : null;
    const members = groupIds.map((id) => byAssessmentId.get(String(id))).filter(Boolean);
    const dismissed = new Set(dismissedIds.map(String));
    const order = { synergy: 0, neutral: 1, tension: 2 };
    const nextSuggestions = base
      ? interactionPeople
          .filter((r) => String(r.assessmentId) !== String(base.assessmentId) && !dismissed.has(String(r.assessmentId)))
          .map((r) => ({ person: r, compat: getCompat(base.topType, r.topType, locale) }))
          .sort((x, y) => (order[x.compat.level] ?? 9) - (order[y.compat.level] ?? 9))
      : [];
    const tensions = [];
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const compat = getCompat(members[i].topType, members[j].topType, locale);
        if (compat.level === 'tension') tensions.push({ a: members[i], b: members[j], compat });
      }
    }
    return { groupBase: base, suggestions: nextSuggestions, groupTensions: tensions };
  }, [tab, interactionPeople, groupBaseId, groupIds, dismissedIds, locale]);

  const compareQueryString = useMemo(() => {
    const sp = new URLSearchParams();
    if (isAdmin && company && company !== 'all') sp.set('company', company);
    if (area && area !== 'all') sp.set('area', area);
    if (vacancy && vacancy !== 'all') sp.set('vacancy', vacancy);
    if (enneagram && enneagram !== 'all') sp.set('enneagram', enneagram);
    if (roster && roster !== 'internal') sp.set('roster', roster);
    return sp.toString();
  }, [isAdmin, company, area, vacancy, enneagram, roster]);

  const comparePagSnap = parseComparePagination(snapshot());
  const compatListPagination = parseCompatTabPagination(snapshot());
  const teamQuerySort = parseTeamSort(snapshot());

  const clearAllFilters = () => {
    setArea('all');
    setVacancy('all');
    setPipeline('all');
    setRoster('internal');
    setEnneagram('all');
    setDateFrom('');
    setDateTo('');
    setSearch('');
    if (isAdmin) {
      skipStickyCompanyRestoreRef.current = true;
      writeStickyCompanyId(null);
      setCompany('all');
    }
    pushFilters({
      area: 'all', vacancy: 'all', pipeline: 'all', roster: 'internal', enneagram: 'all',
      dateFrom: null, dateTo: null, search: null, filter: null, orgUnit: null,
      ...(isAdmin ? { company: 'all' } : {}),
    });
  };

  const _pipelineChipLabels = {
    new: t(locale, 'recruiting.pipelineNew'),
    interview: t(locale, 'recruiting.pipelineInterview'),
    test_completed: t(locale, 'recruiting.pipelineTestCompleted'),
    screening: t(locale, 'recruiting.pipelineScreening'),
    approved: t(locale, 'recruiting.pipelineApproved'),
    rejected: t(locale, 'recruiting.pipelineRejected'),
    archived: t(locale, 'recruiting.pipelineArchived'),
  };
  const activeChips = [];
  if (isAdmin && company !== 'all') {
    const co = companies.find((c) => String(c.id) === company);
    activeChips.push({ key: 'company', label: co?.name || company,
      onRemove: () => { applyCompanyFilter('all', { vacancy: 'all', pipeline: 'all' }); } });
  }
  if (area !== 'all') {
    const ar = areas.find((a) => a.key === area);
    activeChips.push({ key: 'area', label: localizeAreaLabel(ar, locale) || area,
      onRemove: () => { setArea('all'); setPipeline('all'); pushFilters({ area: 'all', pipeline: 'all' }); } });
  }
  if (vacancy !== 'all') {
    const vac = vacancies.find((v) => String(v.id) === vacancy);
    activeChips.push({ key: 'vacancy', label: vac?.title || vacancy,
      onRemove: () => { setVacancy('all'); setPipeline('all'); pushFilters({ vacancy: 'all', pipeline: 'all' }); } });
  }
  if (enneagram !== 'all') {
    activeChips.push({
      key: 'enneagram',
      label: `T${enneagram}`,
      title: typeHintTooltip(Number(enneagram), locale),
      onRemove: () => { setEnneagram('all'); pushFilters({ enneagram: 'all' }); },
    });
  }
  if (pipeline !== 'all' && tab !== 'overview') {
    activeChips.push({ key: 'pipeline', label: _pipelineChipLabels[pipeline] || pipeline,
      onRemove: () => { setPipeline('all'); pushFilters({ pipeline: 'all' }); } });
  }
  if (roster !== 'internal') {
    activeChips.push({
      key: 'roster',
      label: roster === 'recruiting'
        ? t(locale, 'dashboard.rosterRecruiting')
        : roster === ROSTER_SCOPE.ALUMNI
          ? t(locale, 'dashboard.rosterAlumni')
          : t(locale, 'dashboard.rosterAll'),
      onRemove: () => { setRoster('internal'); pushFilters({ roster: 'internal' }); },
    });
  }
  if (dateFrom) {
    activeChips.push({ key: 'dateFrom', label: t(locale, 'dashboard.dateFromChip', { date: dateFrom }),
      onRemove: () => { setDateFrom(''); pushFilters({ dateFrom: null, dateTo: dateTo || null }); } });
  }
  if (dateTo) {
    activeChips.push({ key: 'dateTo', label: t(locale, 'dashboard.dateToChip', { date: dateTo }),
      onRemove: () => { setDateTo(''); pushFilters({ dateFrom: dateFrom || null, dateTo: null }); } });
  }
  if (selectedSearch) {
    activeChips.push({ key: 'search', label: `"${selectedSearch}"`,
      onRemove: () => { setSearch(''); pushFilters({ search: null }); } });
  }

  /**
   * Leadership task is reading charts, not filtering people — stay collapsed by default.
   * Other tabs auto-expand advanced filters only when non-essential chips exist
   * (roster/vacancy stay in the always-visible essentials row).
   */
  const advancedChipCount = activeChips.filter((c) =>
    ['area', 'enneagram', 'pipeline', 'dateFrom', 'dateTo', 'search'].includes(c.key)
  ).length;
  const filtersExpanded = filtersOpen ?? (tab === 'leadership' ? false : advancedChipCount > 0);

  const exportUrl = `/api/admin/export?area=${encodeURIComponent(area)}${
    isAdmin && company !== 'all' ? `&company=${encodeURIComponent(company)}` : ''
  }${vacancy && vacancy !== 'all' ? `&vacancy=${encodeURIComponent(vacancy)}` : ''}${
    roster && roster !== 'internal' ? `&roster=${encodeURIComponent(roster)}` : ''
  }${
    pipeline && pipeline !== 'all' ? `&pipeline=${encodeURIComponent(pipeline)}` : ''
  }${dateFrom ? `&dateFrom=${encodeURIComponent(dateFrom)}` : ''}${
    dateTo ? `&dateTo=${encodeURIComponent(dateTo)}` : ''
  }${selectedSearch ? `&search=${encodeURIComponent(selectedSearch)}` : ''}`;

  const navItem = ({ id, label, badge, icon }) => ({
    id,
    domId: `${id}-tab`,
    label,
    icon,
    badge,
    active: navTab === id,
    onIntent: () => preloadDashboardTab(id),
    onClick: () => { navigateToTab(id); setSidebarOpen(false); if (id === 'team') setNewCandidates(false); },
  });

  const canSee = (cap) => can(sessionAuth, cap);
  const navLinksBySection = {
    [DASHBOARD_NAV_SECTION.HOME]: [
      canSee(CAP.OVERVIEW_VIEW) && { id: 'overview', icon: 'overview', label: t(locale, 'dashboard.overview') },
      canSee(CAP.OVERVIEW_VIEW) && { id: 'analytics', icon: 'chart', label: t(locale, 'dashboard.analytics') },
    ],
    [DASHBOARD_NAV_SECTION.PEOPLE]: [
      canSee(CAP.TEAM_VIEW) && { id: 'team', icon: 'team', label: t(locale, 'dashboard.team'), badge: newCandidates && tab !== 'team' },
      canSee(CAP.TEAM_VIEW) && { id: 'organization', icon: 'building', label: t(locale, 'panel.orgUnits.title') },
      showCompensation && { id: 'compensation', icon: 'salary', label: t(locale, 'dashboard.compensation') },
      showDp && { id: 'dp', icon: 'dp', label: t(locale, 'dashboard.dp') },
      showBenefits && { id: 'company-benefits', icon: 'gift', label: t(locale, 'dashboard.companyBenefits') },
    ],
    [DASHBOARD_NAV_SECTION.RECRUITING]: [
      showVacancies && { id: 'vacancies', icon: 'vacancies', label: t(locale, 'dashboard.vacancies') },
      showVacancies && { id: 'talent-bank', icon: 'team', label: t(locale, 'dashboard.talentBank') },
      showJobRoles && { id: 'job-roles', icon: 'briefcase', label: t(locale, 'jobRoles.title') },
    ],
    [DASHBOARD_NAV_SECTION.DEVELOPMENT]: [
      showPdi && { id: 'pdi', icon: 'clipboard', label: t(locale, 'dashboard.pdi') },
      showPerformance && { id: 'performance-reviews', icon: 'clipboard', label: t(locale, 'dashboard.performanceReviews') },
      showPerformance && { id: 'okr', icon: 'okr', label: t(locale, 'dashboard.okr') },
      showSuccession && { id: 'succession', icon: 'succession', label: t(locale, 'succession.title') },
      showLearning && { id: 'learning-resources', icon: 'book', label: t(locale, 'dashboard.learningResources') },
      showLearning && { id: 'lms', icon: 'book', label: t(locale, 'dashboard.lms') },
    ],
    [DASHBOARD_NAV_SECTION.CULTURE_HR]: [
      canSee(CAP.COMPATIBILITY_VIEW) && { id: 'compatibility', icon: 'compatibility', label: t(locale, 'dashboard.compatibility') },
      canSee(CAP.COMPARE_VIEW) && { id: 'compare', icon: 'compare', label: t(locale, 'dashboard.compare') },
      canSee(CAP.GROUP_VIEW) && { id: 'group', icon: 'group', label: t(locale, 'dashboard.group') },
      canSee(CAP.LEADERSHIP_VIEW) && { id: 'leadership', icon: 'leadership', label: t(locale, 'dashboard.leadership') },
      showMotivators && { id: 'motivators', icon: 'motivators', label: t(locale, 'dashboard.motivators') },
      showClimate && { id: 'climate', icon: 'climate', label: t(locale, 'dashboard.climate') },
      showCompanyFeed && { id: 'company-feed', icon: 'list', label: t(locale, 'dashboard.companyFeed') },
      showExitAnalysis && { id: 'exit-analysis', icon: 'exit', label: t(locale, 'dashboard.exitAnalysis') },
      showWhistleblowing && { id: 'whistleblowing', icon: 'feedbackInfo', label: t(locale, 'dashboard.whistleblowing') },
    ],
    [DASHBOARD_NAV_SECTION.ADMINISTRATION]: [
      showUsers && { id: 'users', icon: 'users', label: t(locale, 'dashboard.users') },
      showCompanies && { id: 'companies', icon: 'companies', label: t(locale, 'dashboard.companies') },
      showLeads && { id: 'leads', icon: 'users', label: t(locale, 'dashboard.leads') },
      showProductFeedback && { id: 'product-feedback', icon: 'feedbackInfo', label: t(locale, 'dashboard.productFeedback') },
      showAudit && { id: 'audit', icon: 'list', label: t(locale, 'dashboard.audit') },
    ],
  };
  const navSections = DASHBOARD_NAV_SECTIONS.map((section) => ({
    ...section,
    label: t(locale, section.labelKey),
    links: (navLinksBySection[section.id] || []).filter(Boolean),
  })).filter((section) => section.links.length > 0);
  const sidebarGroups = navSections.map((section) => ({
    id: section.id,
    label: section.label,
    items: section.links.map(navItem),
  }));
  const sidebarFooterItems = [
    can(sessionAuth, CAP.HELP_VIEW) && {
      id: 'help', domId: 'help-tab', icon: 'help', label: t(locale, 'dashboard.help'), active: navTab === 'help',
      onIntent: () => preloadDashboardTab('help'),
      onClick: () => { navigateToTab('help'); setSidebarOpen(false); },
    },
    can(sessionAuth, CAP.PROFILE_SELF) && {
      id: 'profile', icon: 'user', label: t(locale, 'dashboard.profile'), active: navTab === 'profile',
      onIntent: () => preloadDashboardTab('profile'),
      onClick: () => { navigateToTab('profile'); setSidebarOpen(false); },
    },
    {
      id: 'logout', icon: 'logout', tone: 'danger', label: t(locale, 'dashboard.logout'), disabled: loggingOut,
      onClick: () => void logout(),
    },
  ].filter(Boolean);

  return (
    <PipelineExtrasProvider>
    <div className="relative min-h-screen bg-canvas font-ui text-ink">
      {/* Onboarding Tour */}
      {showOnboardingTour ? <OnboardingTour auth={sessionAuth} /> : null}

      {/* Keyboard Shortcuts Help Modal */}
      <KeyboardShortcutsHelp isOpen={showHelp} onClose={() => setShowHelp(false)} locale={locale} />
      <GModePending isActive={gPressed} locale={locale} />

      <button
        type="button"
        ref={menuButtonRef}
        inert={sidebarOpen && !isDesktop || undefined}
        className={cn('db-hamburger', sidebarOpen && !isDesktop && 'invisible')}
        onClick={() => setSidebarOpen(true)}
        aria-label={t(locale, 'common.openMenu')}
        aria-expanded={sidebarOpen}
        aria-controls="dashboard-sidebar"
      >
        <Icon name="menu" />
      </button>
      <div
        className={`db-overlay${sidebarOpen ? ' db-overlay-visible' : ''}`}
        onClick={() => setSidebarOpen(false)}
        aria-hidden={!sidebarOpen}
      />
      <div className="relative flex min-h-screen">
        <SidebarNav
          id="dashboard-sidebar"
          locale={locale}
          ariaLabel={t(locale, 'dashboard.sectionsNavAria')}
          storageKey="30team_nav_closed_groups"
          collapsed={navCollapsed}
          onToggleCollapsed={toggleSidebarCollapsed}
          open={sidebarOpen}
          onCloseMobile={() => setSidebarOpen(false)}
          navRef={sidebarNavRef}
          sidebarRef={sidebarRef}
          mobileModal
          groups={sidebarGroups}
          brand={(iconOnly) => (
            <BrandMark
              size={26}
              withWordmark={!iconOnly}
              onClick={() => {
                navigateToTab('overview');
                setSidebarOpen(false);
              }}
              title={t(locale, 'dashboard.homeAria')}
              aria-label={t(locale, 'dashboard.homeAria')}
            />
          )}
          footer={(iconOnly) => sidebarFooterItems.map((item) => (
            <SidebarNavItem key={item.id} item={item} collapsed={iconOnly} />
          ))}
        />

        <main inert={sidebarOpen && !isDesktop || undefined} className="db-main relative mx-auto min-w-0 max-w-[1600px] flex-1 px-6 pb-24 pt-7">
          <DashboardPageTitleContext.Provider value={isPersonFocus || isVacancyDetail ? null : t(locale, getDashboardTabNav(tab).labelKey)}>
          <NavLoadBar active={panelLoading || navPending} />

          <div className="db-top-row mb-4 flex flex-wrap items-start gap-3">
          {showGlobalSearch ? (
          <div className="relative min-w-0 flex-[1_1_280px] max-sm:order-last max-sm:-ml-14 max-sm:basis-[calc(100%+3.5rem)]">
            <input
              type="search"
              id="dashboard-global-search"
              name="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const trimmed = search.trim();
                  // Overview has no person list: name search opens Equipe with the same filter.
                  pushFilters({
                    search: trimmed || null,
                    ...(tab === 'overview' && trimmed ? { tab: 'team' } : {}),
                  });
                }
              }}
              onBlur={() => {
                const trimmed = search.trim();
                if (trimmed !== (selectedSearch || '').trim()) {
                  pushFilters({
                    search: trimmed || null,
                    ...(tab === 'overview' && trimmed ? { tab: 'team' } : {}),
                  });
                }
              }}
              placeholder={t(locale, 'dashboard.searchPlaceholder')}
              aria-label={t(locale, 'dashboard.searchAriaLabel')}
              className="box-border w-full rounded-control border border-ink/12 bg-ink/[0.03] py-3 pl-[42px] pr-4 font-ui text-sm text-ink"
            />
            <span className="pointer-events-none absolute left-[15px] top-1/2 inline-flex -translate-y-1/2 text-ink-faint"><Icon name="search" /></span>
            {selectedSearch && (
              <button
                type="button"
                onClick={() => { setSearch(''); pushFilters({ search: null }); }}
                className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer border-none bg-transparent font-mono text-prose text-ink-muted"
              >
                {t(locale, 'common.clearSearch')}
              </button>
            )}
          </div>
          ) : (
            <div className="min-w-0 flex-[1_1_120px]" aria-hidden />
          )}
          <DashboardTopBarMenus
            locale={locale}
            auth={sessionAuth}
            navigateToTab={navigateToTab}
            onLogout={logout}
            onNavigateHref={(href) => {
              try {
                const u = new URL(href, typeof window !== 'undefined' ? window.location.origin : 'http://local');
                router.push(`${u.pathname}${u.search}`);
              } catch {
                router.push(href);
              }
            }}
          />
          </div>

          {/* Title row */}
          {!isPersonFocus ? <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="mb-1.5">
                <DashboardBreadcrumb
                  locale={locale}
                  tab={navTab}
                  onHome={() => navigateToTab('overview')}
                />
              </div>
              {!isVacancyDetail ? <h1 className={cn("db-page-title mb-1", S.pageTitle)}>
                {t(locale, getDashboardTabNav(navTab).labelKey)}
              </h1> : null}
              {!isVacancyDetail ? <span className="text-prose text-ink-muted">
                {showPanelLoading ? (
                  t(locale, 'dashboard.loadingPanel')
                ) : showsCohortChrome && ['overview', 'team', 'compatibility'].includes(tab) ? (
                  <>
                    {listTotal}{' '}
                    {listTotal === 1
                      ? t(locale, 'dashboard.assessmentSingular')
                      : t(locale, 'dashboard.assessmentPlural')}
                    {pagination.total > 0 && tab === 'team' ? (
                      <span className="text-ink-faint">
                        {' '}
                        ·{' '}
                        {t(locale, 'dashboard.pageInfo', {
                          page: pagination.page,
                          totalPages: pagination.totalPages,
                          pageSize: pagination.pageSize,
                        })}
                      </span>
                    ) : null}
                  </>
                ) : null}
              </span> : null}
            </div>
            <div className="flex flex-wrap items-center gap-2 self-end">
              {tab !== 'help' && contextualHelpSection && can(sessionAuth, CAP.HELP_VIEW) ? (
                <button
                  type="button"
                  onClick={() => navigateWithOpts({ tab: 'help', helpSection: contextualHelpSection })}
                  className={cn(S.btnGhost, 'min-h-touch gap-2 px-3.5')}
                  aria-label={t(locale, 'dashboard.contextHelpAria', {
                    tab: t(locale, getDashboardTabNav(tab).labelKey),
                  })}
                >
                  <Icon name="help" className="h-4 w-4" />
                  {t(locale, 'dashboard.contextHelp')}
                </button>
              ) : null}
              {showsCohortChrome && !showPanelLoading ? (
                <button
                  type="button"
                  onClick={() => setFiltersOpen(!filtersExpanded)}
                  aria-expanded={filtersExpanded}
                  aria-label={t(locale, 'dashboard.filtersToggleAria')}
                  className={cn(
                    'min-h-touch cursor-pointer rounded-control border px-3.5 py-2.5 font-mono text-prose',
                    filtersExpanded
                      ? 'border-brand-500/25 bg-brand-500/10 text-brand-500'
                      : 'border-ink/12 bg-transparent text-ink-muted'
                  )}
                >
                  {filtersExpanded
                    ? t(locale, 'dashboard.hideFilters')
                    : t(locale, 'dashboard.showFilters')}
                  {!filtersExpanded && advancedChipCount > 0
                    ? ` · ${advancedChipCount}`
                    : ''}
                </button>
              ) : null}
              {showsCohortChrome && !showPanelLoading ? (
              <ExportCsvButton href={exportUrl} locale={locale} />
              ) : null}
            </div>
          </div> : null}

          {showPanelLoading ? (
            <AppLoading
              locale={locale}
              variant="panel"
              label={t(locale, 'dashboard.loadingPanel')}
            />
          ) : (
          <ContentEnter animKey={tab}>
          <>
          {/* Filter row — essentials always on; advanced behind disclosure */}
          {showsCohortChrome ? (
          <>
          <div
            className={cn(
              'db-filters flex flex-wrap items-end gap-2',
              filtersExpanded ? 'mb-2' : 'mb-2.5'
            )}
            role="group"
            aria-label={t(locale, 'dashboard.filtersEssentialsAria')}
          >
            {showsCompanyPicker ? companyFilterControl({ vacancy: 'all', pipeline: 'all' }) : null}
            <SelectField
              value={roster}
              onChange={(e) => {
                const v = e.target.value;
                setRoster(v);
                pushFilters({ roster: v });
              }}
              className={S.select}
              title={t(locale, 'dashboard.rosterHint')}
            >
              <option value="internal">{t(locale, 'dashboard.rosterInternal')}</option>
              <option value="recruiting">{t(locale, 'dashboard.rosterRecruiting')}</option>
              <option value={ROSTER_SCOPE.ALUMNI}>{t(locale, 'dashboard.rosterAlumni')}</option>
              <option value="all">{t(locale, 'dashboard.rosterAll')}</option>
            </SelectField>
            <SelectField
              value={vacancy}
              onChange={(e) => {
                const v = e.target.value;
                setVacancy(v);
                setPipeline('all');
                if (isAdmin && v !== 'all') {
                  const hit = vacancies.find((x) => String(x.id) === v);
                  if (hit != null && hit.companyId != null) {
                    setPipeline('all');
                    applyCompanyFilter(String(hit.companyId), { vacancy: v, pipeline: 'all' });
                    return;
                  }
                }
                pushFilters({ vacancy: v, pipeline: 'all' });
              }}
              className={S.select}
            >
              <option value="all">{t(locale, 'dashboard.allVacancies')}</option>
              {vacancies.map((v) => (
                <option key={v.id} value={String(v.id)}>
                  {v.title} {v.status === VACANCY_STATUS.CLOSED ? t(locale, 'dashboard.closed') : ''}
                </option>
              ))}
            </SelectField>
          </div>

          {filtersExpanded ? (
          <div
            className="db-filters mb-2.5 flex flex-wrap items-center gap-2"
            role="group"
            aria-label={t(locale, 'dashboard.filtersAdvancedAria')}
          >
            <SelectField value={area} onChange={(e) => { const v = e.target.value; setArea(v); setPipeline('all'); pushFilters({ area: v, pipeline: 'all' }); }} className={S.select}>
              <option value="all">{t(locale, 'dashboard.allAreas')}</option>
              {areas.map((a) => (
                <option key={a.key} value={a.key}>
                  {localizeAreaLabel(a, locale)} ({counts.find((c) => c.key === a.key)?.count ?? 0})
                </option>
              ))}
            </SelectField>
            <SelectField value={enneagram} onChange={(e) => { const v = e.target.value; setEnneagram(v); pushFilters({ enneagram: v }); }} className={S.select}>
              <option value="all">{t(locale, 'dashboard.allProfiles')}</option>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((t) => (
                <option key={t} value={String(t)} title={typeHintTooltip(t, locale)}>
                  T{t} · {typeData[t].short}
                </option>
              ))}
            </SelectField>
            {tab !== 'overview' ? (
            <SelectField value={pipeline} onChange={(e) => { const v = e.target.value; setPipeline(v); pushFilters({ pipeline: v }); }} className={S.select} aria-label={t(locale, 'recruiting.pipelineAll')}>
              <option value="all">{t(locale, 'recruiting.pipelineAll')}</option>
              <option value="new">{t(locale, 'recruiting.pipelineNew')}</option>
              <option value="interview">{t(locale, 'recruiting.pipelineInterview')}</option>
              <option value="test_completed">{t(locale, 'recruiting.pipelineTestCompleted')}</option>
              <option value="screening">{t(locale, 'recruiting.pipelineScreening')}</option>
              <option value="approved">{t(locale, 'recruiting.pipelineApproved')}</option>
              <option value="rejected">{t(locale, 'recruiting.pipelineRejected')}</option>
              <option value="archived">{t(locale, 'recruiting.pipelineArchived')}</option>
            </SelectField>
            ) : null}
            <div className="inline-flex h-[38px] items-center gap-1.5 rounded-control border border-ink/12 bg-ink/[0.05] px-3">
              <span className="whitespace-nowrap font-ui text-prose text-ink/75">{t(locale, 'dashboard.dateFromLabel')}</span>
              <DateField
                bare
                value={dateFrom}
                onChange={(e) => { const v = e.target.value; setDateFrom(v); pushFilters({ dateFrom: v || null, dateTo: dateTo || null }); }}
                aria-label={t(locale, 'dashboard.dateFromLabel')}
                className="min-w-[120px]"
              />
              <span className="whitespace-nowrap font-ui text-prose text-ink/75">{t(locale, 'dashboard.dateToLabel')}</span>
              <DateField
                bare
                value={dateTo}
                onChange={(e) => { const v = e.target.value; setDateTo(v); pushFilters({ dateFrom: dateFrom || null, dateTo: v || null }); }}
                aria-label={t(locale, 'dashboard.dateToLabel')}
                className="min-w-[120px]"
              />
            </div>
          </div>
          ) : null}

          {/* Active filter chips — always visible when set */}
          {activeChips.length > 0 ? (
            <div className="mb-5 flex flex-wrap items-center gap-1.5">
              {activeChips.map((chip) => (
                <span key={chip.key} className={S.filterChip} title={chip.title}>
                  {chip.label}
                  <button
                    type="button"
                    onClick={chip.onRemove}
                    aria-label={chip.title || chip.label}
                    className="inline-flex cursor-pointer items-center border-none bg-transparent p-0 pl-0.5 leading-none text-brand-600"
                  >
                    <Icon name="clear" />
                  </button>
                </span>
              ))}
              <button
                type="button"
                onClick={clearAllFilters}
                className="cursor-pointer rounded-full border border-ink/12 bg-transparent px-2.5 py-1 font-ui text-prose text-ink/75"
              >
                {t(locale, 'common.clearAll')}
              </button>
            </div>
          ) : (
            <div className="mb-4" />
          )}
          </>
          ) : showsCompanyPicker ? (
            <div
              className="db-filters mb-2.5 flex flex-wrap items-end gap-2"
              role="group"
              aria-label={t(locale, 'dashboard.companyFilterLabel')}
            >
              {companyFilterControl()}
            </div>
          ) : (
            <div className="mb-3" />
          )}

          {/* Empty moon only when SSR counted the cohort (team / compatibility).
              Compare / group / leadership skip that COUNT on purpose and have their own empty UI. */}
          {showsCohortChrome &&
          compatMetrics.total === 0 &&
          (tab === 'team' || tab === 'compatibility') ? (
            <RosterEmptyHint
              locale={locale}
              roster={roster || ROSTER_SCOPE.INTERNAL}
              navigateDashboard={navigateWithOpts}
            />
          ) : (
            <>
              <PersonaPlaybookCard
                tab={tab}
                role={sessionAuth?.role || 'hr'}
                locale={locale}
              />
              {tab === 'leadership' && can(sessionAuth, CAP.LEADERSHIP_VIEW) && (
                <LeadershipTab
                  analytics={analytics}
                  locale={locale}
                  roster={roster}
                  navigateDashboard={navigateWithOpts}
                />
              )}
              {tab === 'overview' && can(sessionAuth, CAP.OVERVIEW_VIEW) && (
                <OverviewTab
                  overview={overviewMetrics}
                  locale={locale}
                  companyId={scopedCompanyId}
                  onboardingProgress={onboardingProgress}
                  canOpenTab={(id) => canAccessDashboardTab(sessionAuth, id)}
                  filters={{
                    companyLabel:
                      isAdmin && company !== 'all'
                        ? (companies.find((c) => String(c.id) === String(company))?.name || company)
                        : null,
                    area,
                    areaLabel: areas.find((a) => a.key === area)?.label,
                    vacancy,
                    vacancyLabel: vacancies.find((v) => String(v.id) === String(vacancy))?.title,
                    dateFrom: dateFrom || null,
                    dateTo: dateTo || null,
    search: selectedSearch || null,
                  }}
                  navigateDashboard={(opts) => {
                    if (opts.pipeline != null) setPipeline(opts.pipeline);
                    if (opts.search != null) setSearch(opts.search || '');
                    navigateWithOpts({
                      ...opts,
                      teamPage: 1,
                      ...(opts.search !== undefined ? { search: opts.search } : {}),
                    });
                  }}
                />
              )}
              {tab === 'analytics' && can(sessionAuth, CAP.OVERVIEW_VIEW) && (
                <AnalyticsTab
                  companyId={scopedCompanyId}
                  locale={locale}
                  navigateDashboard={navigateWithOpts}
                />
              )}
              {tab === 'organization' && can(sessionAuth, CAP.TEAM_VIEW) && <OrganizationTab key={scopedCompanyId} locale={locale} companyId={scopedCompanyId} navigateDashboard={navigateWithOpts} />}
              {tab === 'team' && can(sessionAuth, CAP.TEAM_VIEW) && (
                <>
                  <TeamTab
                    results={results}
                    sortKey={teamQuerySort.sort}
                    sortDir={teamQuerySort.dir}
                    onSort={pushTeamSort}
                    locale={locale}
                    isAdmin={isAdmin}
                    companyId={scopedCompanyId}
                    search={selectedSearch}
                    orgUnitFilter={urlParams.get('orgUnit') || ''}
                    listTotal={listTotal}
                    focusCandidateId={urlParams.get('candidate')}
                    focusSection={urlParams.get('section')}
                    listFilter={selectedListFilter || urlParams.get('filter')}
                    onClearListFilter={() => pushFilters({ filter: null })}
                    navigateDashboard={navigateWithOpts}
                    roster={roster || ROSTER_SCOPE.INTERNAL}
                    pipelineFilter={pipeline && pipeline !== 'all' ? pipeline : null}
                    canViewCompensation={showCompensation}
                    canManageCompensation={manageCompensation}
                    canViewJobRoles={canViewJobRoles}
                    canRehire={can(sessionAuth, CAP.EXIT_ANALYSIS_VIEW)}
                    onSearch={(value) => {
                      setSearch(value || '');
                      pushFilters({ search: value });
                    }}
                  />
                  {!isPersonFocus && listTotal > 0 ? (
                    <div className={cn(S.card, 'mt-[18px] flex flex-wrap items-center justify-between gap-3 px-[22px] py-4')}>
                      <span className="font-mono text-prose text-ink-muted">
                        {t(locale, 'dashboard.itemsPerPageTeam')}
                      </span>
                      <div className="flex flex-wrap items-center gap-2.5">
                        <SelectField
                          value={String(pagination.pageSize)}
                          onChange={(e) => {
                            const ps = parseInt(e.target.value, 10);
                            pushTeamPagination({ teamPage: 1, teamPageSize: ps });
                          }}
                          className={S.selectCompact}
                        >
                          {PAGE_SIZE_OPTIONS.map((n) => (
                            <option key={n} value={String(n)}>{t(locale, 'dashboard.perPage', { n })}</option>
                          ))}
                        </SelectField>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={pagination.page <= 1}
                            onClick={() => pushTeamPagination({ teamPage: pagination.page - 1 })}
                            className={cn(
                              'rounded-control border border-ink/12 bg-transparent px-3.5 py-2 font-mono text-prose',
                              pagination.page <= 1
                                ? 'cursor-default text-ink-faint'
                                : 'cursor-pointer text-ink-muted'
                            )}
                          >
                            {t(locale, 'dashboard.previous')}
                          </button>
                          <span className="min-w-[100px] text-center font-mono text-prose text-ink-muted">
                            {pagination.page} / {pagination.totalPages}
                          </span>
                          <button
                            type="button"
                            disabled={pagination.page >= pagination.totalPages}
                            onClick={() => pushTeamPagination({ teamPage: pagination.page + 1 })}
                            className={cn(
                              'rounded-control border border-ink/12 bg-transparent px-3.5 py-2 font-mono text-prose',
                              pagination.page >= pagination.totalPages
                                ? 'cursor-default text-ink-faint'
                                : 'cursor-pointer text-ink-muted'
                            )}
                          >
                            {t(locale, 'dashboard.next')}
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </>
              )}
              {tab === 'compatibility' && can(sessionAuth, CAP.COMPATIBILITY_VIEW) && (
                <CompatTab
                  tensions={tensions}
                  synergies={synergies}
                  pairs={pairs}
                  pairTotals={pairTotals}
                  needsCompanyScope={Boolean(compatMetrics.needsCompanyScope)}
                  compatPage={compatListPagination.page}
                  compatPageSize={compatListPagination.pageSize}
                  onCompatPagination={pushCompatListPagination}
                  locale={locale}
                />
              )}
              {tab === 'compare' && can(sessionAuth, CAP.COMPARE_VIEW) && (
                <CompareTabLoader
                  filterQueryString={compareQueryString}
                  comparePage={comparePagSnap.page}
                  comparePageSize={comparePagSnap.pageSize}
                  onComparePagination={pushComparePagination}
                  locale={locale}
                  search={selectedSearch}
                  roster={roster}
                  navigateDashboard={navigateWithOpts}
                  onSearch={(value) => {
                    setSearch(value || '');
                    pushFilters({ search: value });
                  }}
                />
              )}
              {tab === 'vacancies' && showVacancies && <VacanciesAdminTab isAdmin={isAdmin} navigateDashboard={navigateWithOpts} locale={locale} />}
              {tab === 'talent-bank' && showVacancies && (
                <TalentBankAdminTab locale={locale} companyId={scopedCompanyId} />
              )}
              {tab === 'motivators' && showMotivators && (
                <MotivatorsAdminTab isAdmin={isAdmin} companies={companies} locale={locale} />
              )}
              {tab === 'climate' && showClimate && (
                <ClimateTab
                  isAdmin={isAdmin}
                  companies={companies}
                  locale={locale}
                  section={urlParams.get('climateSection') || null}
                  navigateDashboard={navigateWithOpts}
                />
              )}
              {tab === 'whistleblowing' && showWhistleblowing && (
                <WhistleblowingAdminTab locale={locale} companyId={scopedCompanyId} />
              )}
              {tab === 'companies' && showCompanies && (
                <CompaniesAdminTab
                  navigateDashboard={navigateWithOpts}
                  locale={locale}
                  isSuperAdmin={isSuperAdminPayload(sessionAuth)}
                />
              )}
              {tab === 'users' && showUsers && (
                <UsersAdminTab
                  navigateDashboard={navigateWithOpts}
                  locale={locale}
                  canManageAllCompanies={can(sessionAuth, CAP.COMPANIES_MANAGE)}
                  currentUserId={sessionAuth?.userId ?? null}
                />
              )}
              {tab === 'job-roles' && showJobRoles && <JobRolesAdminTab locale={locale} companyId={scopedCompanyId} />}
              {tab === 'performance-reviews' && showPerformance && <PerformanceReviewsAdminTab locale={locale} companyId={scopedCompanyId} isAdmin={isAdmin} />}
              {tab === 'pdi' && showPdi && (
                <PdiAdminTab locale={locale} companyId={scopedCompanyId} navigateDashboard={navigateWithOpts} initialSearch={urlParams.get('pdiSearch') || ''} />
              )}
              {tab === 'okr' && showPerformance && (
                <OkrAdminTab locale={locale} companyId={scopedCompanyId} />
              )}
              {tab === 'succession' && showSuccession && <SuccessionAdminTab locale={locale} companyId={scopedCompanyId} isAdmin={isAdmin} />}
              {tab === 'exit-analysis' && showExitAnalysis && <ExitAnalysisAdminTab locale={locale} companyId={scopedCompanyId} isAdmin={isAdmin} />}
              {tab === 'dp' && showDp && (
                <DpAdminTab
                  locale={locale}
                  companyId={scopedCompanyId}
                  navigateDashboard={navigateWithOpts}
                  initialSection={urlParams.get('dpSection') || ''}
                  initialTimeView={urlParams.get('timeView') || ''}
                />
              )}
              {tab === 'learning-resources' && showLearning && <LearningResourcesAdminTab locale={locale} companyId={scopedCompanyId} />}
              {tab === 'lms' && showLearning && (
                <LmsAdminTab
                  locale={locale}
                  companyId={scopedCompanyId}
                  courseId={urlParams.get('course') || null}
                  courseSection={urlParams.get('lmsSection') || null}
                  navigateDashboard={navigateWithOpts}
                />
              )}
              {tab === 'company-benefits' && showBenefits && <CompanyBenefitsAdminTab locale={locale} companyId={scopedCompanyId} />}
              {tab === 'company-feed' && showCompanyFeed && (
                <CompanyFeedAdminTab locale={locale} companyId={scopedCompanyId} />
              )}
              {tab === 'compensation' && showCompensation && (
                <CompensationAdminTab
                  locale={locale}
                  companyId={scopedCompanyId}
                  navigateDashboard={navigateWithOpts}
                  canManage={manageCompensation}
                  canViewJobRoles={canViewJobRoles}
                />
              )}
              {tab === 'leads' && showLeads && <LeadsAdminTab navigateDashboard={navigateWithOpts} locale={locale} />}
              {tab === 'product-feedback' && showProductFeedback && (
                <ProductFeedbackAdminTab navigateDashboard={navigateWithOpts} locale={locale} />
              )}
              {tab === 'audit' && showAudit && (
                <AuditAdminTab
                  tenantOnly={!isSuperAdminPayload(sessionAuth)}
                  navigateDashboard={navigateWithOpts}
                  locale={locale}
                  companies={companies}
                  panelCompanyId={scopedCompanyId}
                />
              )}
              {tab === 'help' && can(sessionAuth, CAP.HELP_VIEW) && <HelpTab locale={locale} navigateDashboard={navigateWithOpts} initialSection={urlParams.get('helpSection') || 'welcome'} />}
              {tab === 'profile' && can(sessionAuth, CAP.PROFILE_SELF) && (
                <ProfileTab
                  locale={locale}
                  onLocaleChange={setLocale}
                  onProfileSaved={(user) => {
                    if (!user) return;
                    setSessionAuth((prev) => ({
                      ...(prev || {}),
                      displayName: user.displayName != null ? user.displayName : prev?.displayName,
                      email: user.email || prev?.email,
                      locale: user.locale || prev?.locale,
                    }));
                  }}
                />
              )}
              {tab === 'group' && can(sessionAuth, CAP.GROUP_VIEW) && (
                <GroupTab
                  results={interactionPeople}
                  groupBase={groupBase}
                  setGroupBaseId={setGroupBaseId}
                  groupIds={groupIds}
                  setGroupIds={setGroupIds}
                  dismissedIds={dismissedIds}
                  setDismissedIds={setDismissedIds}
                  suggestions={suggestions}
                  groupTensions={groupTensions}
                  locale={locale}
                  roster={roster}
                  navigateDashboard={navigateWithOpts}
                  companyId={
                    isAdmin
                      ? (company !== 'all' ? company : null)
                      : (sessionAuth?.companyId ?? null)
                  }
                />
              )}
            </>
          )}
          </>
          </ContentEnter>
          )}
          </DashboardPageTitleContext.Provider>
        </main>
      </div>
    </div>
    <div inert={sidebarOpen && !isDesktop || undefined}>
    {can(sessionAuth, CAP.HELP_VIEW) ? (
      <HelpAssistantWidget
        locale={locale}
        navigateDashboard={navigateWithOpts}
        activeTab={tab}
        activeSection={urlParams.get('section')}
      />
    ) : null}
    {sessionAuth?.showOnboardingWizard ? (
      <OnboardingWizard
        locale={locale}
        userName={sessionAuth?.displayName || sessionAuth?.signupFirstName || ''}
        auth={sessionAuth}
        onComplete={() => {
          try {
            sessionStorage.setItem(ONBOARDING_WIZARD_SESSION_KEY, '1');
          } catch {
            /* ignore */
          }
          setSessionAuth((prev) => ({
            ...(prev || {}),
            onboardingCompleted: true,
            showOnboardingWizard: false,
          }));
        }}
      />
    ) : null}
    </div>
    </PipelineExtrasProvider>
  );
}
