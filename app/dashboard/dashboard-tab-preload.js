'use client';

/**
 * Warms the JS chunk of a dashboard tab on menu hover/focus so the click only
 * waits for the server payload. Paths must match the `dynamic()` imports in
 * DashboardClient.jsx (same module → same chunk).
 */
const TAB_CHUNKS = {
  overview: () => import('./tabs/OverviewTab'),
  analytics: () => import('./tabs/AnalyticsTab'),
  organization: () => import('./tabs/OrganizationTab'),
  team: () => import('./tabs/TeamTab'),
  compatibility: () => import('./tabs/CompatTab'),
  compare: () => import('./tabs/CompareTabLoader'),
  group: () => import('./tabs/GroupTab'),
  leadership: () => import('./tabs/LeadershipTab'),
  vacancies: () => import('./tabs/VacanciesAdminTab'),
  'talent-bank': () => import('./tabs/TalentBankAdminTab'),
  'job-roles': () => import('./tabs/JobRolesAdminTab'),
  motivators: () => import('./tabs/MotivatorsAdminTab'),
  climate: () => import('./tabs/ClimateTab'),
  whistleblowing: () => import('./tabs/WhistleblowingAdminTab'),
  companies: () => import('./tabs/CompaniesAdminTab'),
  users: () => import('./tabs/UsersAdminTab'),
  leads: () => import('./tabs/LeadsAdminTab'),
  'product-feedback': () => import('./tabs/ProductFeedbackAdminTab'),
  'digital-certificate': () => import('./tabs/DigitalCertificateAdminTab'),
  audit: () => import('./tabs/AuditAdminTab'),
  'performance-reviews': () => import('./tabs/PerformanceReviewsAdminTab'),
  pdi: () => import('./tabs/PdiAdminTab'),
  okr: () => import('./tabs/OkrAdminTab'),
  succession: () => import('./tabs/SuccessionAdminTab'),
  'exit-analysis': () => import('./tabs/ExitAnalysisAdminTab'),
  'learning-resources': () => import('./tabs/LearningResourcesAdminTab'),
  lms: () => import('./tabs/LmsAdminTab'),
  'company-benefits': () => import('./tabs/CompanyBenefitsAdminTab'),
  'company-feed': () => import('./tabs/CompanyFeedAdminTab'),
  dp: () => import('./tabs/DpAdminTab'),
  compensation: () => import('./tabs/CompensationAdminTab'),
  help: () => import('./tabs/HelpTab'),
  profile: () => import('../_components/ProfileTab'),
};

const warmed = new Set();

export function preloadDashboardTab(id) {
  const load = TAB_CHUNKS[id];
  if (!load || warmed.has(id)) return;
  warmed.add(id);
  load().catch(() => warmed.delete(id));
}
