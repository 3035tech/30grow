/**
 * Canonical information architecture for the manager dashboard.
 *
 * Keep this map independent from permissions: the shell decides which links a
 * manager can see, while breadcrumbs and section persistence share the same
 * ownership model.
 */
export const DASHBOARD_NAV_SECTION = Object.freeze({
  HOME: 'home',
  PEOPLE: 'people',
  RECRUITING: 'recruiting',
  DEVELOPMENT: 'development',
  CULTURE_HR: 'cultureHr',
  ADMINISTRATION: 'administration',
});

export const DASHBOARD_NAV_SECTIONS = Object.freeze([
  { id: DASHBOARD_NAV_SECTION.HOME, labelKey: 'dashboard.sectionHome', icon: 'overview' },
  { id: DASHBOARD_NAV_SECTION.PEOPLE, labelKey: 'dashboard.sectionPeople', icon: 'team' },
  { id: DASHBOARD_NAV_SECTION.RECRUITING, labelKey: 'dashboard.sectionRecruiting', icon: 'vacancies' },
  { id: DASHBOARD_NAV_SECTION.DEVELOPMENT, labelKey: 'dashboard.sectionDevelopment', icon: 'academy' },
  { id: DASHBOARD_NAV_SECTION.CULTURE_HR, labelKey: 'dashboard.sectionCultureHr', icon: 'climate' },
  { id: DASHBOARD_NAV_SECTION.ADMINISTRATION, labelKey: 'dashboard.sectionAdministration', icon: 'companies' },
]);

export const DASHBOARD_TAB_NAV = Object.freeze({
  overview: { section: DASHBOARD_NAV_SECTION.HOME, labelKey: 'dashboard.overview' },
  analytics: { section: DASHBOARD_NAV_SECTION.HOME, labelKey: 'dashboard.analytics' },
  team: { section: DASHBOARD_NAV_SECTION.PEOPLE, labelKey: 'dashboard.team' },
  organization: { section: DASHBOARD_NAV_SECTION.PEOPLE, labelKey: 'panel.orgUnits.title' },
  compensation: { section: DASHBOARD_NAV_SECTION.PEOPLE, labelKey: 'dashboard.compensation' },
  vacancies: { section: DASHBOARD_NAV_SECTION.RECRUITING, labelKey: 'dashboard.vacancies' },
  'talent-bank': { section: DASHBOARD_NAV_SECTION.RECRUITING, labelKey: 'dashboard.talentBank' },
  'job-roles': { section: DASHBOARD_NAV_SECTION.RECRUITING, labelKey: 'dashboard.jobRoles' },
  pdi: { section: DASHBOARD_NAV_SECTION.DEVELOPMENT, labelKey: 'dashboard.pdi' },
  'performance-reviews': { section: DASHBOARD_NAV_SECTION.DEVELOPMENT, labelKey: 'dashboard.performanceReviews' },
  okr: { section: DASHBOARD_NAV_SECTION.DEVELOPMENT, labelKey: 'dashboard.okr' },
  succession: { section: DASHBOARD_NAV_SECTION.DEVELOPMENT, labelKey: 'dashboard.succession' },
  'learning-resources': { section: DASHBOARD_NAV_SECTION.DEVELOPMENT, labelKey: 'dashboard.learningResources' },
  lms: { section: DASHBOARD_NAV_SECTION.DEVELOPMENT, labelKey: 'dashboard.lms' },
  compatibility: { section: DASHBOARD_NAV_SECTION.CULTURE_HR, labelKey: 'dashboard.compatibility' },
  compare: { section: DASHBOARD_NAV_SECTION.CULTURE_HR, labelKey: 'dashboard.compare' },
  group: { section: DASHBOARD_NAV_SECTION.CULTURE_HR, labelKey: 'dashboard.group' },
  leadership: { section: DASHBOARD_NAV_SECTION.CULTURE_HR, labelKey: 'dashboard.leadership' },
  motivators: { section: DASHBOARD_NAV_SECTION.CULTURE_HR, labelKey: 'dashboard.motivators' },
  climate: { section: DASHBOARD_NAV_SECTION.CULTURE_HR, labelKey: 'dashboard.climate' },
  'exit-analysis': { section: DASHBOARD_NAV_SECTION.CULTURE_HR, labelKey: 'dashboard.exitAnalysis' },
  dp: { section: DASHBOARD_NAV_SECTION.PEOPLE, labelKey: 'dashboard.dp' },
  whistleblowing: { section: DASHBOARD_NAV_SECTION.CULTURE_HR, labelKey: 'dashboard.whistleblowing' },
  'company-benefits': { section: DASHBOARD_NAV_SECTION.PEOPLE, labelKey: 'dashboard.companyBenefits' },
  'company-feed': { section: DASHBOARD_NAV_SECTION.CULTURE_HR, labelKey: 'dashboard.companyFeed' },
  companies: { section: DASHBOARD_NAV_SECTION.ADMINISTRATION, labelKey: 'dashboard.companies' },
  users: { section: DASHBOARD_NAV_SECTION.ADMINISTRATION, labelKey: 'dashboard.users' },
  leads: { section: DASHBOARD_NAV_SECTION.ADMINISTRATION, labelKey: 'dashboard.leads' },
  'product-feedback': { section: DASHBOARD_NAV_SECTION.ADMINISTRATION, labelKey: 'dashboard.productFeedback' },
  'digital-certificate': { section: DASHBOARD_NAV_SECTION.ADMINISTRATION, labelKey: 'digitalCertificate.title' },
  audit: { section: DASHBOARD_NAV_SECTION.ADMINISTRATION, labelKey: 'dashboard.audit' },
  profile: { section: DASHBOARD_NAV_SECTION.ADMINISTRATION, labelKey: 'dashboard.profile' },
  help: { section: null, labelKey: 'dashboard.help' },
});

export function getDashboardTabNav(tab) {
  return DASHBOARD_TAB_NAV[tab] || DASHBOARD_TAB_NAV.overview;
}

export function getDashboardSection(tab) {
  return getDashboardTabNav(tab).section;
}

export function getDefaultDashboardSections(tab = 'overview') {
  const activeSection = getDashboardSection(tab);
  return Object.fromEntries(
    DASHBOARD_NAV_SECTIONS.map(({ id }) => [id, id === activeSection])
  );
}
