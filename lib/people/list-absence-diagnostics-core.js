/**
 * B-2601 — pure constants + classifiers (safe for client bundle).
 * DB lookup lives in list-absence-diagnostics.js (server only).
 */

import { t } from '../i18n.js';
import {
  EMPLOYMENT_STATUS,
  ROSTER_SCOPE,
  ROSTER_SCOPE_SET,
} from '../domain-status.js';

export const ABSENCE_DIAG_CAP = 12;
export const ABSENCE_DIAG_Q_MIN = 1;
export const ABSENCE_DIAG_Q_MAX = 80;

export const ABSENCE_REASON = Object.freeze({
  NO_MATCH: 'no_match',
  HOMONYMS: 'homonyms',
  WRONG_ROSTER: 'wrong_roster',
  ALUMNI: 'alumni',
  SOFT_FILTERS: 'soft_filters',
  NO_ASSESSMENT: 'no_assessment',
  NOT_IN_TALENT_BANK: 'not_in_talent_bank',
  NOT_IN_VACANCY: 'not_in_vacancy',
  OTHER_VACANCIES: 'other_vacancies',
  IN_LIST: 'in_list',
});

/** Which list the manager is looking at (POST /api/admin/help-diagnose `list`). */
export const ABSENCE_LIST = Object.freeze({
  TEAM: 'team',
  TALENT_BANK: 'talentBank',
  VACANCY_PIPELINE: 'vacancyPipeline',
});
export const ABSENCE_LIST_SET = new Set(Object.values(ABSENCE_LIST));
export const ABSENCE_OTHER_VACANCY_CAP = 3;

export const ABSENCE_SUGGESTION = Object.freeze({
  CLEAR_SEARCH: 'clear_search',
  SWITCH_ROSTER: 'switch_roster',
  CLEAR_FILTERS: 'clear_filters',
  OPEN_PERSON: 'open_person',
});

/**
 * Classify whether a candidate row would appear under a roster scope
 * (mirrors assessmentListWhereParts roster rules for a single person).
 *
 * @param {{ employmentStatus: string, hasCompanyAssessment: boolean, hasVacancyAssessment: boolean }} row
 * @param {string} rosterScope
 */
export function classifyRosterVisibility(row, rosterScope) {
  const roster = ROSTER_SCOPE_SET.has(rosterScope) ? rosterScope : ROSTER_SCOPE.INTERNAL;
  const isAlumni = row.employmentStatus === EMPLOYMENT_STATUS.ALUMNI;
  const hasAny = Boolean(row.hasCompanyAssessment) || Boolean(row.hasVacancyAssessment);
  const inAlumni = isAlumni && hasAny;
  const inInternal =
    !isAlumni
    && (Boolean(row.hasCompanyAssessment)
      || (Boolean(row.hasVacancyAssessment) && row.employmentStatus === EMPLOYMENT_STATUS.EMPLOYEE));
  const inRecruiting = Boolean(row.hasVacancyAssessment);
  const flags = { inInternal, inRecruiting, inAlumni };

  if (roster === ROSTER_SCOPE.ALL) return { visible: hasAny, ...flags };
  if (roster === ROSTER_SCOPE.RECRUITING) return { visible: inRecruiting, ...flags };
  if (roster === ROSTER_SCOPE.ALUMNI) return { visible: inAlumni, ...flags };
  return { visible: inInternal, ...flags };
}

/**
 * Build structured reasons + suggestions from DB rows (pure; unit-testable).
 *
 * @param {object} opts
 * @param {string} opts.q
 * @param {string} [opts.rosterScope]
 * @param {string|null} [opts.listFilter]
 * @param {string|null} [opts.pipelineStage]
 * @param {Array<object>} opts.rows
 */
export function buildAbsenceDiagnostics({
  q,
  rosterScope = ROSTER_SCOPE.INTERNAL,
  listFilter = null,
  pipelineStage = null,
  rows = [],
}) {
  const needle = String(q || '').trim();
  const roster = ROSTER_SCOPE_SET.has(rosterScope) ? rosterScope : ROSTER_SCOPE.INTERNAL;
  const softActive = Boolean(listFilter) || (pipelineStage && pipelineStage !== 'all');

  /** @type {Array<{ code: string, meta?: object }>} */
  const reasons = [];
  /** @type {Array<{ action: string, roster?: string, candidateId?: number }>} */
  const suggestions = [];
  /** @type {Array<object>} */
  const candidates = [];

  if (!rows.length) {
    reasons.push({ code: ABSENCE_REASON.NO_MATCH });
    suggestions.push({ action: ABSENCE_SUGGESTION.CLEAR_SEARCH });
    if (softActive) {
      reasons.push({ code: ABSENCE_REASON.SOFT_FILTERS, meta: { listFilter, pipelineStage } });
      suggestions.push({ action: ABSENCE_SUGGESTION.CLEAR_FILTERS });
    }
    return { reasons, suggestions, candidates };
  }

  if (rows.length > 1) {
    reasons.push({ code: ABSENCE_REASON.HOMONYMS, meta: { count: rows.length } });
  }

  let anyVisibleUnderRoster = false;
  let anyWrongRoster = false;
  let anyAlumni = false;
  let anyNoAssessment = false;
  let suggestedOtherRoster = null;

  for (const row of rows) {
    const vis = classifyRosterVisibility(row, roster);
    const hasAnyAssessment = row.hasCompanyAssessment || row.hasVacancyAssessment;
    if (!hasAnyAssessment) anyNoAssessment = true;
    if (vis.visible && hasAnyAssessment) anyVisibleUnderRoster = true;
    if (!vis.visible && hasAnyAssessment) {
      anyWrongRoster = true;
      if (vis.inAlumni && roster !== ROSTER_SCOPE.ALUMNI) {
        suggestedOtherRoster = ROSTER_SCOPE.ALUMNI;
      } else if (roster === ROSTER_SCOPE.INTERNAL && vis.inRecruiting) {
        suggestedOtherRoster = ROSTER_SCOPE.RECRUITING;
      } else if (roster === ROSTER_SCOPE.RECRUITING && vis.inInternal) {
        suggestedOtherRoster = ROSTER_SCOPE.INTERNAL;
      } else if (roster !== ROSTER_SCOPE.ALL) {
        suggestedOtherRoster = ROSTER_SCOPE.ALL;
      }
    }
    if (row.employmentStatus === EMPLOYMENT_STATUS.ALUMNI) anyAlumni = true;

    candidates.push({
      id: row.id,
      name: row.fullName,
      email: row.email || null,
      employmentStatus: row.employmentStatus,
      assessmentId: row.latestAssessmentId || null,
      visibleInRoster: vis.visible && hasAnyAssessment,
      inInternal: vis.inInternal,
      inRecruiting: vis.inRecruiting,
      hasAssessment: hasAnyAssessment,
    });
  }

  if (anyNoAssessment) {
    reasons.push({ code: ABSENCE_REASON.NO_ASSESSMENT });
  }
  if (anyWrongRoster) {
    reasons.push({
      code: ABSENCE_REASON.WRONG_ROSTER,
      meta: { currentRoster: roster, suggestedRoster: suggestedOtherRoster },
    });
  }
  if (anyAlumni) {
    reasons.push({ code: ABSENCE_REASON.ALUMNI });
  }
  if (softActive && (anyVisibleUnderRoster || anyWrongRoster)) {
    reasons.push({
      code: ABSENCE_REASON.SOFT_FILTERS,
      meta: { listFilter, pipelineStage },
    });
  }

  if (anyWrongRoster && suggestedOtherRoster) {
    suggestions.push({
      action: ABSENCE_SUGGESTION.SWITCH_ROSTER,
      roster: suggestedOtherRoster,
    });
  }
  if (softActive) {
    suggestions.push({ action: ABSENCE_SUGGESTION.CLEAR_FILTERS });
  }
  suggestions.push({ action: ABSENCE_SUGGESTION.CLEAR_SEARCH });

  const openable = candidates.find((c) => c.id && (c.visibleInRoster || c.hasAssessment || c.inInternal || c.inRecruiting));
  if (openable) {
    suggestions.push({
      action: ABSENCE_SUGGESTION.OPEN_PERSON,
      candidateId: openable.id,
    });
  }

  const seen = new Set();
  const deduped = [];
  for (const s of suggestions) {
    const key = `${s.action}:${s.roster || ''}:${s.candidateId || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(s);
  }

  return {
    reasons,
    suggestions: deduped,
    candidates: candidates.slice(0, ABSENCE_DIAG_CAP),
    query: needle,
    roster,
  };
}

/**
 * Vacancy-side lists (Banco de talentos, pipeline da vaga): membership is a link to a
 * vacancy, not the Equipe roster. Pure; rows come from list-absence-diagnostics.js.
 *
 * @param {object} opts
 * @param {string} opts.q
 * @param {string} opts.list ABSENCE_LIST.TALENT_BANK | ABSENCE_LIST.VACANCY_PIPELINE
 * @param {boolean} [opts.filtersActive] filters the server cannot evaluate (pipeline: client-side)
 * @param {Array<{ id: number, fullName: string, email?: string|null, inList: boolean,
 *   matchesFilters?: boolean, stage?: string|null, otherVacancyTitles?: string[] }>} opts.rows
 */
export function buildListMembershipDiagnostics({ q, list, filtersActive = false, rows = [] }) {
  const needle = String(q || '').trim();
  const isPipeline = list === ABSENCE_LIST.VACANCY_PIPELINE;
  const reasons = [];
  const suggestions = [];

  if (!rows.length) {
    reasons.push({ code: ABSENCE_REASON.NO_MATCH });
    suggestions.push({ action: ABSENCE_SUGGESTION.CLEAR_SEARCH });
    if (filtersActive) suggestions.push({ action: ABSENCE_SUGGESTION.CLEAR_FILTERS });
    return { reasons, suggestions, candidates: [], query: needle, list };
  }

  if (rows.length > 1) reasons.push({ code: ABSENCE_REASON.HOMONYMS, meta: { count: rows.length } });

  const outside = rows.filter((r) => !r.inList);
  const inside = rows.filter((r) => r.inList);
  const hidden = inside.filter((r) => filtersActive || r.matchesFilters === false);
  const shown = inside.filter((r) => !filtersActive && r.matchesFilters !== false);

  if (outside.length) {
    reasons.push({ code: isPipeline ? ABSENCE_REASON.NOT_IN_VACANCY : ABSENCE_REASON.NOT_IN_TALENT_BANK });
    const titles = [...new Set(outside.flatMap((r) => r.otherVacancyTitles || []))].slice(0, ABSENCE_OTHER_VACANCY_CAP);
    if (isPipeline && titles.length) reasons.push({ code: ABSENCE_REASON.OTHER_VACANCIES, meta: { titles } });
  }
  if (hidden.length) {
    reasons.push({ code: ABSENCE_REASON.SOFT_FILTERS });
    suggestions.push({ action: ABSENCE_SUGGESTION.CLEAR_FILTERS });
  }
  if (shown.length) reasons.push({ code: ABSENCE_REASON.IN_LIST, meta: { stage: shown[0].stage || null } });
  suggestions.push({ action: ABSENCE_SUGGESTION.CLEAR_SEARCH });

  const candidates = rows.slice(0, ABSENCE_DIAG_CAP).map((r) => ({
    id: r.id,
    name: r.fullName,
    email: r.email || null,
    inList: Boolean(r.inList),
    stage: r.stage || null,
    otherVacancyTitles: (r.otherVacancyTitles || []).slice(0, ABSENCE_OTHER_VACANCY_CAP),
  }));
  return { reasons, suggestions, candidates, query: needle, list };
}

/**
 * One notice line per reason (`panel.team.diagnoseReason.<code>`), with meta filled in.
 * @param {string} locale
 * @param {Array<{ code: string, meta?: object }>} reasons
 * @param {{ stageLabel?: (stage: string) => string }} [opts]
 */
export function formatAbsenceReasonLines(locale, reasons, { stageLabel = (s) => s } = {}) {
  return (reasons || []).map((r) => {
    const key = `panel.team.diagnoseReason.${r.code}`;
    const meta = r.meta || {};
    const vars = {
      titles: Array.isArray(meta.titles) ? meta.titles.join(', ') : '',
      stage: meta.stage ? stageLabel(meta.stage) : t(locale, 'panel.team.diagnoseNoStage'),
    };
    const label = t(locale, key, vars);
    return `· ${label === key ? r.code : label}`;
  });
}
