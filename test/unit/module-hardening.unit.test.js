import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

function source(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

describe('module hardening', () => {
  it('audits tenant-sensitive mutations and keeps canonical entities on soft delete', () => {
    const companyModules = source('app/api/admin/company-modules/route.js');
    assert.match(companyModules, /auditFromRequest\(request/);
    assert.match(companyModules, /companyId,/);
    assert.match(companyModules, /company_modules_set/);

    const users = source('lib/users-admin.js');
    for (const action of ['user.create', 'user.update', 'user.deactivate']) {
      assert.match(users, new RegExp(action.replace('.', '\\.')));
    }
    assert.match(users, /UPDATE users SET deleted = TRUE, active = FALSE/);

    const vacancies = source('app/api/admin/vacancies/[id]/route.js');
    assert.match(vacancies, /recruiting\.vacancy\.updated/);
    assert.match(vacancies, /recruiting\.vacancy\.soft_deleted/);
    assert.match(source('lib/vacancies-admin.js'), /UPDATE vacancies SET deleted = TRUE/);

    const pipeline = source('app/api/admin/vacancies/[id]/candidates/[candidateId]/route.js');
    assert.match(pipeline, /recruiting\.candidate\.hired/);

    const dpProfile = source('app/api/admin/candidates/[id]/dp/route.js');
    const dpFile = source('app/api/admin/candidates/[id]/dp/documents/[docKey]/file/route.js');
    assert.match(dpProfile, /dp\.profile\.updated/);
    assert.match(dpFile, /dp\.document\.file_uploaded/);
    assert.match(dpFile, /dp\.document\.file_removed/);

    const companies = source('app/api/admin/companies/[id]/route.js');
    assert.match(companies, /UPDATE companies SET deleted = TRUE, active = FALSE/);
    assert.match(companies, /company\.soft_delete/);
  });

  it('gates compensation surfaces with dedicated capabilities', () => {
    assert.match(source('app/api/admin/compensation/route.js'), /CAP\.COMPENSATION_VIEW/);
    assert.match(source('app/api/admin/candidates/[id]/compensation/route.js'), /CAP\.COMPENSATION_MANAGE/);
    assert.doesNotMatch(source('app/api/admin/compensation/route.js'), /CAP\.TEAM_VIEW/);
  });

  it('keeps authenticated capability denials distinct from expired sessions', () => {
    const wrapper = source('lib/admin-api.js');
    assert.match(wrapper, /if \(!payload\)[\s\S]*ERR\.UNAUTHORIZED, 401/);
    assert.match(wrapper, /ERR\.FORBIDDEN, 403/);
    assert.match(source('lib/api-error-codes.js'), /FORBIDDEN: 'FORBIDDEN'/);
  });

  it('keeps DP document upload routes tenant-scoped and private', () => {
    const employeeFile = source('app/api/employee/dp/documents/[docKey]/file/route.js');
    const adminFile = source('app/api/admin/candidates/[id]/dp/documents/[docKey]/file/route.js');
    for (const route of [employeeFile, adminFile]) {
      assert.match(route, /DP_DOCUMENT_KEYS/);
      assert.match(route, /uploadDpDocumentFile/);
      assert.match(route, /downloadDpDocumentFile/);
      assert.match(route, /Cache-Control.*no-store/);
      assert.doesNotMatch(route, /S3_ACCESS|S3_SECRET|publicBaseUrl/);
    }
    assert.match(employeeFile, /getEmployeeSessionPayload/);
    assert.match(adminFile, /getManagerScope/);
    assert.match(adminFile, /dp\.document\.file_uploaded/);
  });

  it('includes schema, Redis and object storage in authenticated health checks', () => {
    const health = source('lib/health-status.js');
    assert.match(health, /checkSchema/);
    assert.match(health, /getSharedRedisClient/);
    assert.match(health, /checkObjectStorage/);
    assert.match(health, /requiredDown = \[postgres, schema\]/);
  });

  it('passes tenant module entitlements to the dashboard client auth snapshot', () => {
    const auth = source('app/dashboard/resolve-dashboard-auth.js');
    assert.match(auth, /companyModules: Array\.isArray\(payload\?\.companyModules\)/);
  });

  it('scopes global search categories to enabled capabilities', () => {
    const search = source('app/api/admin/search/route.js');
    assert.match(search, /requireAnyCapability\(payload/);
    assert.match(search, /canSearchCandidates/);
    assert.match(search, /canSearchVacancies/);
    assert.match(search, /canSearchGroups/);
  });

  it('guards cohort tab rendering with the same capabilities as navigation', () => {
    const dashboard = source('app/dashboard/DashboardClient.jsx');
    for (const cap of [
      'LEADERSHIP_VIEW',
      'OVERVIEW_VIEW',
      'TEAM_VIEW',
      'COMPATIBILITY_VIEW',
      'COMPARE_VIEW',
      'GROUP_VIEW',
    ]) {
      assert.match(dashboard, new RegExp(`can\\(sessionAuth, CAP\\.${cap}\\)`));
    }
  });

  it('uses the canonical admin API wrapper on the migrated performance route', () => {
    const route = source('app/api/admin/performance-reviews/route.js');
    assert.match(route, /withAdminApi/);
    assert.match(route, /companyFrom: 'query'/);
    assert.match(route, /companyFrom: 'body'/);
  });

  it('ships the compatibility migration and template management endpoint', () => {
    assert.match(source('migrations/112_compensation_module_entitlement.sql'), /array_append/);
    const route = source('app/api/admin/pipeline-templates/[id]/route.js');
    assert.match(route, /export const PATCH/);
    assert.match(route, /export const DELETE/);
  });

  it('lets tenant managers use pipeline templates without a client-supplied company id', () => {
    const manager = source('app/dashboard/vacancies/PipelineTemplatesManager.jsx');
    assert.doesNotMatch(manager, /if \(!companyId \|\| !template\?\.id\)/);
    assert.match(manager, /companyId \? \{ companyId: Number\(companyId\) \} : \{\}/);
  });

  it('keeps recruiting UX telemetry tenant-scoped and free of vacancy copy', () => {
    const route = source('app/api/admin/recruiting-ux-event/route.js');
    assert.match(route, /CAP\.VACANCIES_MANAGE/);
    assert.match(route, /companyFrom: 'body'/);
    assert.doesNotMatch(route, /description|salary|candidate/i);
  });

  it('ships tenant-scoped recruiting ownership and saved views', () => {
    const migration = source('migrations/113_recruiting_workspace.sql');
    assert.match(migration, /owner_user_id/);
    assert.match(migration, /recruiting_candidate_assignments/);
    assert.match(migration, /recruiting_saved_views/);
    const route = source('app/api/admin/recruiting-workspace/route.js');
    assert.match(route, /withAdminApi/);
    assert.match(route, /CAP\.VACANCIES_MANAGE/);
  });

  it('keeps logout available in the fixed sidebar footer', () => {
    const dashboard = source('app/dashboard/DashboardClient.jsx');
    const nav = source('app/_components/SidebarNav.jsx');
    assert.match(nav, /\{footer \? \(\s*<div className=\{cn\('db-sidebar-foot flex flex-shrink-0/);
    assert.match(dashboard, /id: 'logout', icon: 'logout', tone: 'danger', label: t\(locale, 'dashboard\.logout'\)[\s\S]*onClick: \(\) => void logout\(\)/);
  });

  it('renders one sidebar column with collapsible groups in dashboard and employee portal', () => {
    const nav = source('app/_components/SidebarNav.jsx');
    const employee = source('app/_components/EmployeeSidebar.jsx');
    assert.match(nav, /aria-expanded=\{open\}/);
    assert.match(nav, /<DisclosureToggle/);
    assert.match(nav, /bg-brand-50 text-brand-800/);
    assert.match(nav, /collapsed && isDesktop/);
    assert.match(employee, /<SidebarNav\b/);
    assert.doesNotMatch(employee, /SidebarRail\b(?!Button)/);
  });

  it('keeps the sidebar focused on destinations and utility actions', () => {
    const dashboard = source('app/dashboard/DashboardClient.jsx');
    assert.doesNotMatch(dashboard, /dashboard\.workShortcuts/);
    assert.match(dashboard, /id: 'help', domId: 'help-tab', icon: 'help', label: t\(locale, 'dashboard\.help'\)/);
    assert.match(dashboard, /DASHBOARD_NAV_SECTION\.DEVELOPMENT/);
    assert.match(dashboard, /DASHBOARD_NAV_SECTION\.CULTURE_HR/);
    assert.match(dashboard, /const sidebarGroups = navSections\.map/);
    assert.match(dashboard, /<SidebarNav\b[\s\S]*groups=\{sidebarGroups\}/);
    assert.doesNotMatch(dashboard, /SidebarRail\b/);
  });

  it('organizes the vacancy workspace around recruiter tasks', () => {
    const vacancies = source('app/dashboard/tabs/VacanciesAdminTab.jsx');
    const navigation = source('app/dashboard/hooks/useDashboardNavigation.js');
    for (const section of ['pipeline', 'candidates', 'information', 'distribution', 'settings']) {
      assert.match(vacancies, new RegExp(`id: '${section}'`));
    }
    assert.doesNotMatch(vacancies, /detailSection === '(fit|analytics|referral|report)'/);
    assert.match(vacancies, /normalizeVacancyDetailSection/);
    assert.match(navigation, /vacancySection/);
  });

  it('keeps the team person workspace deep-linkable and destructive actions secondary', () => {
    const team = source('app/dashboard/tabs/TeamTab.jsx');
    assert.match(team, /personNavigationFromSection/);
    assert.match(team, /candidate: null, section: null/);
    assert.match(team, /section,\s*scroll: false/);
    assert.match(team, /const isPersonPage = Boolean\(focusCandidateId\)/);
    assert.match(team, /!isPersonPage \? \(/);
    assert.match(team, /fullPage=\{isPersonPage\}/);
    assert.match(team, /panel\.team\.moreActions/);
    assert.match(team, /StatusToneChip tone="info"/);
    assert.match(team, /aria-label=\{`\$\{t\(locale, 'panel\.team\.openDetail'\)\}/);
    assert.match(team, /<RowActionsMenu\s+label=\{t\(locale, 'panel\.team\.moreActions'\)\}/);
  });

  it('updates route-backed tabs without rerunning the full dashboard navigation', () => {
    const navigation = source('app/dashboard/hooks/useDashboardNavigation.js');
    const team = source('app/dashboard/tabs/TeamTab.jsx');
    assert.match(navigation, /if \(opts\.clientOnly && typeof window !== 'undefined'\)[\s\S]*?window\.history\.pushState/);
    assert.match(team, /loadDetail\(cid\);\s*\}, \[focusCandidateId\]/);
    assert.match(team, /section,\s*scroll: false,\s*clientOnly: true/);
    assert.match(team, /candidate: String\(row\.candidateId\),\s*section,\s*scroll: false,\s*clientOnly: true/);
    assert.match(source('app/dashboard/tabs/VacanciesAdminTab.jsx'), /vacancySection: next,[\s\S]*?clientOnly: true/);
    assert.match(source('app/dashboard/tabs/LmsAdminTab.jsx'), /lmsSection: next, scroll: false, clientOnly: true/);
    assert.match(source('app/dashboard/tabs/ClimateTab.jsx'), /climateSection: next, scroll: false, clientOnly: true/);
  });

  it('keeps analytics and motivators tabs in place while their panel changes', () => {
    const analytics = source('app/dashboard/tabs/AnalyticsTab.jsx');
    const motivators = source('app/dashboard/tabs/MotivatorsAdminTab.jsx');
    assert.doesNotMatch(analytics, /if \(loading\)\s*\{\s*return <AppLoading/);
    assert.ok(analytics.indexOf('<PanelSubNav') < analytics.indexOf('{loading ?'));
    assert.match(motivators, /window\.history\.replaceState/);
    assert.doesNotMatch(motivators, /router\.replace\(/);
  });

  it('keeps canonical admin chrome responsive and avoids nested DP tables', () => {
    const shared = source('app/dashboard/dashboard-shared.jsx');
    const filters = source('app/_components/AdminListFilters.jsx');
    const dp = source('app/dashboard/tabs/DpAdminTab.jsx');
    assert.match(shared, /sm:flex-row sm:items-start/);
    assert.match(shared, /overscroll-x-contain/);
    assert.match(shared, /role="region"/);
    assert.match(shared, /panel\.common\.dataTable/);
    assert.match(shared, /focus-visible:ring-2/);
    assert.match(filters, /font-ui text-sm/);
    assert.doesNotMatch(dp, /<AdminTableShell[^>]*>\s*<table/);
  });

  it('keeps the LMS course workspace task-focused and deep-linkable', () => {
    const lms = source('app/dashboard/tabs/LmsAdminTab.jsx');
    const dashboard = source('app/dashboard/DashboardClient.jsx');
    const navigation = source('app/dashboard/hooks/useDashboardNavigation.js');
    for (const section of ['content', 'enrollments', 'tracking']) {
      assert.match(lms, new RegExp(`'${section}'`));
    }
    assert.match(lms, /normalizeLmsDetailSection/);
    assert.match(lms, /lessonType/);
    assert.match(lms, /pdfFile/);
    assert.match(dashboard, /courseSection=\{urlParams\.get\('lmsSection'\)/);
    assert.match(navigation, /lmsSection/);
  });

  it('separates climate campaign work and keeps motivators navigation contextual', () => {
    const climate = source('app/dashboard/tabs/ClimateTab.jsx');
    const motivators = source('app/dashboard/tabs/MotivatorsAdminTab.jsx');
    for (const section of ['overview', 'distribution', 'questionnaire']) {
      assert.match(climate, new RegExp(`'${section}'`));
    }
    assert.match(climate, /<PanelSubNav/);
    assert.match(climate, /normalizeClimateDetailSection/);
    assert.match(climate, /detailSection === 'distribution'.*createInvite/s);
    assert.match(climate, /detailSection === 'questionnaire'.*addQuestion/s);
    assert.match(source('app/dashboard/hooks/useDashboardNavigation.js'), /climateSection/);
    assert.match(motivators, /motivatorsView/);
    assert.match(motivators, /view === 'invites'/);
  });

  it('separates HR operations, compensation, and profile settings by task', () => {
    const dp = source('app/dashboard/tabs/DpAdminTab.jsx');
    const compensation = source('app/dashboard/tabs/CompensationAdminTab.jsx');
    const profile = source('app/_components/ProfileTab.jsx');
    for (const section of ['pending', 'leaves', 'documents', 'time', 'onboarding']) {
      assert.match(dp, new RegExp(`'${section}'`));
    }
    assert.match(dp, /<PanelSubNav/);
    assert.match(dp, /<StatMetricTile/);
    assert.doesNotMatch(dp, /firstPendingDocCandidateId/);
    assert.match(compensation, /workspaceSection === 'people'/);
    assert.match(compensation, /workspaceSection === 'insights'/);
    assert.match(compensation, /ContentEnter animKey=\{workspaceSection\}/);
    for (const section of ['account', 'modules', 'security']) {
      assert.match(profile, new RegExp(`'${section}'`));
    }
    assert.match(profile, /profileSection === 'account'/);
    assert.match(profile, /profileSection === 'security'/);
    assert.match(profile, /maxHeightClass="max-h-none"/);
    assert.match(profile, /className=\{cn\(dashS\.btnPrimary, 'w-full sm:w-auto'\)\}/);
  });

  it('keeps benefit management available to every manager with the module capability', () => {
    const benefits = source('app/dashboard/tabs/CompanyBenefitsAdminTab.jsx');
    const dashboard = source('app/dashboard/DashboardClient.jsx');
    assert.match(benefits, /actions=\{\s*<>[\s\S]*?<AdminCreateButton label=\{t\('create'\)\} onClick=\{handleCreate\}/);
    assert.match(benefits, /actionLabel=\{t\('create'\)\}/);
    assert.doesNotMatch(benefits, /\bisAdmin\b/);
    assert.doesNotMatch(dashboard, /<CompanyBenefitsAdminTab[^>]*isAdmin=/);
  });

  it('keeps Academy creation capability-based and distinguishes review from OKR cycles', () => {
    const academy = source('app/dashboard/tabs/LearningResourcesAdminTab.jsx');
    const reviews = source('app/dashboard/tabs/PerformanceReviewsAdminTab.jsx');
    const messages = source('lib/i18n/catalogs/pt-BR.js') + source('lib/i18n/catalogs/en-US.js');
    assert.match(academy, /actions=\{<AdminCreateButton label=\{t\('create'\)\}/);
    assert.match(academy, /actionLabel=\{hasActiveFilters \? undefined : t\('create'\)\}/);
    assert.doesNotMatch(academy, /\bisAdmin\b/);
    assert.match(academy, /loading && resources\.length === 0/);
    assert.match(academy, /sortedResources\.length === 0/);
    assert.match(academy, /const hasActiveFilters = Boolean/);
    assert.match(reviews, /adminModules\.performanceReviews\./);
    assert.match(messages, /Novo ciclo de avaliação/);
    assert.match(messages, /New review cycle/);
    assert.match(messages, /Novo ciclo de OKRs/);
    assert.match(messages, /New OKR cycle/);
  });

  it('keeps the active dashboard destination visible inside the sidebar scroll area', () => {
    const dashboard = source('app/dashboard/DashboardClient.jsx');
    assert.match(dashboard, /navRef=\{sidebarNavRef\}/);
    assert.match(source('app/_components/SidebarNav.jsx'), /ref=\{navRef\}/);
    assert.match(dashboard, /document\.getElementById\(`\$\{tab\}-tab`\)/);
    assert.match(dashboard, /container\.contains\(item\)/);
    assert.match(dashboard, /container\.scrollTop \+=/);
  });

  it('onboards every new company manager except the unrestricted super admin', () => {
    const auth = source('app/dashboard/resolve-dashboard-auth.js');
    const wizard = source('app/_components/OnboardingWizard.jsx');
    assert.match(auth, /!isSuperAdminPayload\(payload\) && !onboardingCompleted/);
    assert.doesNotMatch(auth, /isSelfServiceOrigin/);
    assert.match(wizard, /OBJECTIVE_MODULES/);
    assert.match(wizard, /id: 'objective'/);
    assert.match(wizard, /body\.modules = selectedModules/);
  });

  it('retains focused employee and public SEO surfaces', () => {
    const employeeNav = source('app/_components/EmployeeSidebar.jsx');
    const landing = source('app/page.jsx');
    const job = source('app/jobs/[jobKey]/page.jsx');
    assert.match(employeeNav, /navGroupToday/);
    assert.match(employeeNav, /navGroupGrow/);
    assert.match(employeeNav, /isDedicatedRoute/);
    assert.match(landing, /application\/ld\+json/);
    assert.match(job, /generateMetadata/);
    assert.match(job, /alternates: url \? \{ canonical: url \}/);
  });

  it('keeps manager and employee sign-in on the same authentication shell', () => {
    const managerLogin = source('app/login/page.jsx');
    const employeeLogin = source('app/employee/login/EmployeeLoginClient.jsx');
    const authShell = source('app/_components/AuthShell.jsx');
    assert.match(managerLogin, /<AuthShell/);
    assert.match(employeeLogin, /<AuthShell/);
    assert.match(authShell, /<PublicNarrowShell/);
    assert.match(authShell, /<BrandMark/);
    assert.match(authShell, /<LanguageSelect/);
  });
});
