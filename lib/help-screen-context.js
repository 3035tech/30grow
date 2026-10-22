/**
 * Help assistant: map dashboard tab → Guia “screens” step + related sections + suggestion chips.
 * Used for tips on the open screen and system suggestions.
 */

import { messageNode, normalizeLocale, t } from './i18n.js';
import { HELP_SECTION_STEP_COUNTS } from './help-sections.js';

/**
 * @typedef {{ screenStep: number, guideSections: string[], suggestKeys: string[] }} HelpTabMeta
 */

/** @type {Readonly<Record<string, HelpTabMeta>>} */
export const HELP_BY_DASHBOARD_TAB = Object.freeze({
  organization: {
    guideSections: ['organization', 'team'],
    suggestKeys: ['panel.helpAssist.suggestThisScreen', 'panel.helpAssist.suggestSystemTips'],
  },
  overview: {
    screenStep: 1,
    guideSections: ['b1000HrScore', 'b1000TurnoverRadar', 'dashboardCohort', 'behavioralIntel', 'birthdays'],
    suggestKeys: [
      'panel.helpAssist.suggestThisScreen',
      'panel.helpAssist.suggestHrScore',
      'panel.helpAssist.suggestTurnoverRadar',
      'panel.helpAssist.suggestSystemTips',
    ],
  },
  analytics: {
    screenStep: 2,
    guideSections: ['reports', 'dashboardCohort', 'b1000HrScore', 'b1000TurnoverRadar'],
    suggestKeys: [
      'panel.helpAssist.suggestThisScreen',
      'panel.helpAssist.suggestHrScore',
      'panel.helpAssist.suggestTurnoverRadar',
      'panel.helpAssist.suggestSystemTips',
    ],
  },
  team: {
    screenStep: 3,
    guideSections: ['team', 'people', 'b700Onboarding', 'compensation', 'employeeHome'],
    suggestKeys: [
      'panel.helpAssist.suggestThisScreen',
      'panel.helpAssist.suggestEmployeeJourney',
      'panel.helpAssist.suggestColaborador',
      'panel.helpAssist.suggestSystemTips',
    ],
  },
  pdi: {
    screenStep: 24,
    guideSections: ['b600Pdi', 'b600Retention', 'b1000Academy', 'lmsBasic'],
    suggestKeys: [
      'panel.helpAssist.suggestThisScreen',
      'panel.helpAssist.suggestSystemTips',
    ],
  },
  compatibility: {
    screenStep: 4,
    guideSections: ['team', 'behavioralIntel'],
    suggestKeys: [
      'panel.helpAssist.suggestThisScreen',
      'panel.helpAssist.suggestScreensMap',
      'panel.helpAssist.suggestSystemTips',
    ],
  },
  compare: {
    screenStep: 5,
    guideSections: ['team', 'dashboardCohort'],
    suggestKeys: [
      'panel.helpAssist.suggestThisScreen',
      'panel.helpAssist.suggestDashboardCohort',
      'panel.helpAssist.suggestSystemTips',
    ],
  },
  group: {
    screenStep: 6,
    guideSections: ['b600Pulse', 'behavioralIntel', 'climate'],
    suggestKeys: [
      'panel.helpAssist.suggestThisScreen',
      'panel.helpAssist.suggestScreensMap',
      'panel.helpAssist.suggestSystemTips',
    ],
  },
  leadership: {
    screenStep: 7,
    guideSections: ['b1000Succession', 'nineBox', 'b1000Performance'],
    suggestKeys: [
      'panel.helpAssist.suggestThisScreen',
      'panel.helpAssist.suggestScreensMap',
      'panel.helpAssist.suggestSystemTips',
    ],
  },
  vacancies: {
    screenStep: 8,
    guideSections: ['vacancies', 'pipeline', 'publicVacancy', 'enneagram', 'b600Fit'],
    suggestKeys: [
      'panel.helpAssist.suggestThisScreen',
      'panel.helpAssist.suggestCreateVacancy',
      'panel.helpAssist.suggestHire',
      'panel.helpAssist.suggestSystemTips',
    ],
  },
  'talent-bank': {
    screenStep: 9,
    guideSections: ['talentBank', 'vacancies'],
    suggestKeys: [
      'panel.helpAssist.suggestThisScreen',
      'panel.helpAssist.suggestCreateVacancy',
      'panel.helpAssist.suggestSystemTips',
    ],
  },
  motivators: {
    screenStep: 10,
    guideSections: ['motivators', 'b600Retention'],
    suggestKeys: [
      'panel.helpAssist.suggestThisScreen',
      'panel.helpAssist.suggestMotivators',
      'panel.helpAssist.suggestSystemTips',
    ],
  },
  climate: {
    screenStep: 11,
    guideSections: ['climate', 'enps', 'b1000Culture'],
    suggestKeys: [
      'panel.helpAssist.suggestThisScreen',
      'panel.helpAssist.suggestScreensMap',
      'panel.helpAssist.suggestSystemTips',
    ],
  },
  whistleblowing: {
    screenStep: 11,
    guideSections: ['b3005Pack', 'climate'],
    suggestKeys: [
      'panel.helpAssist.suggestThisScreen',
      'panel.helpAssist.suggestWhistleblowing',
      'panel.helpAssist.suggestSystemTips',
    ],
  },
  'job-roles': {
    screenStep: 12,
    guideSections: ['b1000JobRoles', 'vacancies'],
    suggestKeys: [
      'panel.helpAssist.suggestThisScreen',
      'panel.helpAssist.suggestJobRoles',
      'panel.helpAssist.suggestSystemTips',
    ],
  },
  'performance-reviews': {
    screenStep: 13,
    guideSections: ['b1000Performance', 'nineBox', 'b600Pdi', 'b3000Pack'],
    suggestKeys: [
      'panel.helpAssist.suggestThisScreen',
      'panel.helpAssist.suggestSystemTips',
    ],
  },
  okr: {
    screenStep: 23,
    guideSections: ['b3000Pack', 'setupPath'],
    suggestKeys: [
      'panel.helpAssist.suggestThisScreen',
      'panel.helpAssist.suggestOkr',
      'panel.helpAssist.suggestSystemTips',
    ],
  },
  succession: {
    screenStep: 14,
    guideSections: ['b1000Succession', 'nineBox'],
    suggestKeys: [
      'panel.helpAssist.suggestThisScreen',
      'panel.helpAssist.suggestScreensMap',
      'panel.helpAssist.suggestSystemTips',
    ],
  },
  'exit-analysis': {
    screenStep: 15,
    guideSections: ['b1000Exit'],
    suggestKeys: [
      'panel.helpAssist.suggestThisScreen',
      'panel.helpAssist.suggestScreensMap',
      'panel.helpAssist.suggestSystemTips',
    ],
  },
  'learning-resources': {
    screenStep: 16,
    guideSections: ['b1000Academy', 'lmsBasic', 'b600Pdi'],
    suggestKeys: [
      'panel.helpAssist.suggestThisScreen',
      'panel.helpAssist.suggestScreensMap',
      'panel.helpAssist.suggestSystemTips',
    ],
  },
  'company-benefits': {
    screenStep: 17,
    guideSections: ['b1000Benefits', 'compensation'],
    suggestKeys: [
      'panel.helpAssist.suggestThisScreen',
      'panel.helpAssist.suggestScreensMap',
      'panel.helpAssist.suggestSystemTips',
    ],
  },
  lms: {
    screenStep: 18,
    guideSections: ['lmsBasic', 'b1000Academy'],
    suggestKeys: [
      'panel.helpAssist.suggestThisScreen',
      'panel.helpAssist.suggestScreensMap',
      'panel.helpAssist.suggestSystemTips',
    ],
  },
  compensation: {
    screenStep: 19,
    guideSections: ['compensation', 'b3000Pack'],
    suggestKeys: [
      'panel.helpAssist.suggestThisScreen',
      'panel.helpAssist.suggestScreensMap',
      'panel.helpAssist.suggestSystemTips',
    ],
  },
  'company-feed': {
    screenStep: 20,
    guideSections: ['companyFeed', 'b1000Culture'],
    suggestKeys: [
      'panel.helpAssist.suggestThisScreen',
      'panel.helpAssist.suggestGuide',
      'panel.helpAssist.suggestSystemTips',
    ],
  },
  companies: {
    screenStep: 20,
    guideSections: ['access', 'links'],
    suggestKeys: [
      'panel.helpAssist.suggestThisScreen',
      'panel.helpAssist.suggestGuide',
      'panel.helpAssist.suggestSystemTips',
    ],
  },
  users: {
    screenStep: 20,
    guideSections: ['access'],
    suggestKeys: [
      'panel.helpAssist.suggestThisScreen',
      'panel.helpAssist.suggest2fa',
      'panel.helpAssist.suggestSystemTips',
    ],
  },
  leads: {
    screenStep: 20,
    guideSections: ['access'],
    suggestKeys: [
      'panel.helpAssist.suggestThisScreen',
      'panel.helpAssist.suggestGuide',
      'panel.helpAssist.suggestSystemTips',
    ],
  },
  'digital-certificate': {
    guideSections: ['digitalCertificate', 'timeClock', 'access'],
    suggestKeys: ['panel.helpAssist.suggestThisScreen', 'panel.helpAssist.suggestGuide'],
  },
  'product-feedback': {
    screenStep: 20,
    guideSections: ['productFeedback', 'access'],
    suggestKeys: [
      'panel.helpAssist.suggestThisScreen',
      'panel.helpAssist.suggestGuide',
      'panel.helpAssist.suggestSystemTips',
    ],
  },
  dp: {
    screenStep: 16,
    guideSections: ['dpLight', 'timeClock', 'hourBank', 'team', 'employeeHome'],
    suggestKeys: [
      'panel.helpAssist.suggestThisScreen',
      'panel.helpAssist.suggestGuide',
      'panel.helpAssist.suggestSystemTips',
    ],
  },
  audit: {
    screenStep: 20,
    guideSections: ['access'],
    suggestKeys: [
      'panel.helpAssist.suggestThisScreen',
      'panel.helpAssist.suggestGuide',
      'panel.helpAssist.suggestSystemTips',
    ],
  },
  help: {
    screenStep: 21,
    guideSections: ['setupPath', 'welcome', 'screens', 'tips'],
    suggestKeys: [
      'panel.helpAssist.suggestSetupPath',
      'panel.helpAssist.suggestScreensMap',
      'panel.helpAssist.suggestSystemTips',
      'panel.helpAssist.suggestGuide',
    ],
  },
  profile: {
    screenStep: 21,
    guideSections: ['access', 'navigation'],
    suggestKeys: [
      'panel.helpAssist.suggestThisScreen',
      'panel.helpAssist.suggest2fa',
      'panel.helpAssist.suggestSystemTips',
    ],
  },
});

/** Always offered in the empty chat (system-wide). */
export const HELP_SYSTEM_SUGGEST_KEYS = Object.freeze([
  'panel.helpAssist.suggestSetupPath',
  'panel.helpAssist.suggestScreensMap',
  'panel.helpAssist.suggestThisScreen',
  'panel.helpAssist.suggestSystemTips',
  'panel.helpAssist.suggestWhatNext',
]);

const TAB_LABEL_KEY = Object.freeze({
  overview: 'dashboard.overview',
  analytics: 'dashboard.analytics',
  team: 'dashboard.team',
  pdi: 'dashboard.pdi',
  organization: 'panel.orgUnits.title',
  compatibility: 'dashboard.compatibility',
  compare: 'dashboard.compare',
  group: 'dashboard.group',
  leadership: 'dashboard.leadership',
  vacancies: 'dashboard.vacancies',
  'talent-bank': 'dashboard.talentBank',
  motivators: 'dashboard.motivators',
  climate: 'dashboard.climate',
  whistleblowing: 'dashboard.whistleblowing',
  'job-roles': 'dashboard.jobRoles',
  'performance-reviews': 'dashboard.performanceReviews',
  okr: 'dashboard.okr',
  succession: 'dashboard.succession',
  'exit-analysis': 'dashboard.exitAnalysis',
  'learning-resources': 'dashboard.learningResources',
  'company-benefits': 'dashboard.companyBenefits',
  'company-feed': 'dashboard.companyFeed',
  lms: 'dashboard.lms',
  compensation: 'dashboard.compensation',
  companies: 'dashboard.companies',
  users: 'dashboard.users',
  leads: 'dashboard.leads',
  'product-feedback': 'dashboard.productFeedback',
  'digital-certificate': 'digitalCertificate.title',
  dp: 'dashboard.dp',
  audit: 'dashboard.audit',
  help: 'dashboard.help',
  profile: 'dashboard.profile',
});

/**
 * @param {string|null|undefined} tab
 * @returns {HelpTabMeta|null}
 */
export function helpMetaForTab(tab) {
  const id = String(tab || '').trim();
  return HELP_BY_DASHBOARD_TAB[id] || null;
}

/**
 * @param {string} locale
 * @param {string|null|undefined} tab
 * @returns {string}
 */
export function helpTabLabel(locale, tab) {
  const key = TAB_LABEL_KEY[String(tab || '')];
  if (!key) return String(tab || '').trim() || '';
  const label = t(locale, key);
  return label === key ? String(tab) : label;
}

/**
 * Purpose text from Guia screensStepN for the open tab.
 * @param {string} locale
 * @param {string|null|undefined} tab
 */
export function helpScreenPurpose(locale, tab) {
  if (tab === 'digital-certificate') return t(locale, 'digitalCertificate.description');
  if (tab === 'organization') return t(locale, 'panel.orgUnits.hint');
  const meta = helpMetaForTab(tab);
  if (!meta) return '';
  const loc = normalizeLocale(locale);
  const pack = messageNode(loc, 'panel.help');
  return String(pack[`screensStep${meta.screenStep}`] || '').trim();
}

/**
 * Compact tip lines from related Guia sections (title + first 2 steps each).
 * @param {string} locale
 * @param {string|null|undefined} tab
 * @param {{ maxSections?: number, maxSteps?: number }} [opts]
 */
export function helpScreenTips(locale, tab, opts = {}) {
  const meta = helpMetaForTab(tab);
  if (!meta) return [];
  const loc = normalizeLocale(locale);
  const pack = messageNode(loc, 'panel.help');
  const maxSections = opts.maxSections ?? 3;
  const maxSteps = opts.maxSteps ?? 2;
  const tips = [];
  for (const section of meta.guideSections.slice(0, maxSections)) {
    const title = pack[`${section}Title`];
    if (!title) continue;
    const steps = [];
    const stepCap = HELP_SECTION_STEP_COUNTS[section] ?? 6;
    for (let i = 1; i <= Math.min(maxSteps, stepCap); i += 1) {
      const step = pack[`${section}Step${i}`];
      if (step) steps.push(String(step));
    }
    tips.push({ section, title: String(title), steps });
  }
  return tips;
}

/**
 * System tips (Guia → Dicas rápidas), capped.
 * @param {string} locale
 * @param {number} [limit]
 */
export function helpSystemTips(locale, limit = 6) {
  const loc = normalizeLocale(locale);
  const pack = messageNode(loc, 'panel.help');
  const out = [];
  const cap = HELP_SECTION_STEP_COUNTS.tips ?? 12;
  for (let i = 1; i <= Math.min(limit, cap); i += 1) {
    const step = pack[`tipsStep${i}`];
    if (step) out.push(String(step));
  }
  return out;
}

/**
 * Suggestion chip labels for empty chat / follow-ups.
 * Contextual first, then system-wide (deduped).
 * @param {string} locale
 * @param {string|null|undefined} tab
 */
export function helpSuggestionLabels(locale, tab) {
  const loc = normalizeLocale(locale);
  const meta = helpMetaForTab(tab);
  const keys = [...(meta?.suggestKeys || []), ...HELP_SYSTEM_SUGGEST_KEYS];
  const seen = new Set();
  const labels = [];
  for (const key of keys) {
    if (seen.has(key)) continue;
    seen.add(key);
    const label = t(loc, key);
    if (label && label !== key) labels.push(label);
  }
  return labels.slice(0, 8);
}

/**
 * Build a ready-made answer for “tips on this screen” / “system tips”.
 * @param {string} locale
 * @param {{ tab?: string|null, mode?: 'screen'|'system'|'both' }} opts
 */
export function buildContextualTipsAnswer(locale, opts = {}) {
  const loc = normalizeLocale(locale);
  const mode = opts.mode || 'both';
  const tab = opts.tab || null;
  const parts = [];

  if (mode === 'screen' || mode === 'both') {
    const purpose = helpScreenPurpose(loc, tab);
    const label = helpTabLabel(loc, tab);
    if (purpose) {
      parts.push(
        label
          ? t(loc, 'panel.helpAssist.ctxScreenHeader', { tab: label })
          : t(loc, 'panel.helpAssist.ctxScreenHeaderGeneric')
      );
      parts.push(purpose);
      const tips = helpScreenTips(loc, tab, { maxSections: 2, maxSteps: 2 });
      for (const block of tips) {
        parts.push(`· ${block.title}: ${block.steps[0] || ''}`.trim());
      }
    } else if (mode === 'screen') {
      parts.push(t(loc, 'panel.helpAssist.ctxNoTab'));
    }
  }

  if (mode === 'system' || mode === 'both') {
    const sys = helpSystemTips(loc, mode === 'system' ? 8 : 4);
    if (sys.length) {
      parts.push(t(loc, 'panel.helpAssist.ctxSystemHeader'));
      for (const line of sys) parts.push(`· ${line}`);
    }
  }

  if (!parts.length) {
    return t(loc, 'panel.helpAssist.faqScreens');
  }
  parts.push(t(loc, 'panel.helpAssist.ctxFooterGuide'));
  return parts.filter(Boolean).join('\n');
}

/**
 * True when the user is asking about the current open screen / tips / system suggestions.
 * @param {string} queryFolded
 */
export function isContextualHelpIntent(queryFolded) {
  const q = String(queryFolded || '');
  return (
    /para\s+que\s+serve\s+(esta|essa|a\s+tela|a\s+aba|aqui)/i.test(q) ||
    /what\s+(is|does)\s+(this|the)\s+(screen|tab|page)/i.test(q) ||
    /dicas?\s+(desta|dessa|nesta|nessa|da\s+tela|da\s+aba|aqui|do\s+sistema)/i.test(q) ||
    /tips?\s+(for\s+)?(this|the)\s+(screen|tab)|system\s+tips?/i.test(q) ||
    /sugest(o|õ)es?\s+(do\s+)?sistema/i.test(q) ||
    /system\s+suggestions?/i.test(q) ||
    /o\s+que\s+(fazer|posso\s+fazer)\s+(nesta|nessa|aqui)/i.test(q) ||
    /what\s+(should|can)\s+i\s+do\s+(here|on\s+this)/i.test(q) ||
    /mapa\s+(das?\s+)?(telas|abas)|cada\s+tela|each\s+(screen|tab)/i.test(q)
  );
}
