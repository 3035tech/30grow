import { computeAreaScore010 } from './assessment/area-fit.js';

export function toNum(x) {
  const n = typeof x === 'number' ? x : parseFloat(x);
  return Number.isFinite(n) ? n : 0;
}

/** Enriquecer linha de assessment com Fit (área atual) + aderência por rubrica. */
export function fitForCandidate(scores, stats, weights) {
  if (!stats) return { fitScore: null, fitLabel: null };
  const w = weights && Object.keys(weights).length ? weights : null;
  let score = 0;
  let wsum = 0;
  for (let t = 1; t <= 9; t++) {
    const v = toNum(scores?.[t] ?? scores?.[String(t)] ?? 0);
    const z = (v - toNum(stats.means?.[t])) / Math.max(toNum(stats.stds?.[t]), 1e-6);
    const wt = w ? toNum(w[String(t)] ?? w[t] ?? 0) : 0;
    if (w) {
      score += wt * z;
      wsum += Math.abs(wt);
    }
  }
  if (!w) return { fitScore: null, fitLabel: null };
  const norm = wsum ? score / wsum : score;
  const label = norm >= 0.75 ? 'high' : norm >= 0.25 ? 'medium' : 'low';
  return { fitScore: norm, fitLabel: label };
}

/**
 * @param {object} r linha cru da query assessments
 * @param {{
 *   selectedArea: string,
 *   areaStats: object|null,
 *   areaRubric: object|null,
 *   rubricByAreaKey: Record<string, object>,
 *   vacancyRubricByVacancyId?: Record<string, object>,
 * }} ctx
 */
export function enrichAssessmentDashboardRow(r, ctx) {
  const { selectedArea, areaStats, areaRubric, rubricByAreaKey, vacancyRubricByVacancyId = {} } = ctx;
  const fit = selectedArea !== 'all' ? fitForCandidate(r.scores, areaStats, areaRubric) : { fitScore: null, fitLabel: null };
  const weights = rubricByAreaKey[r.areaKey] || {};
  const areaFit = computeAreaScore010(r.scores, weights);
  const vacId = r.vacancyId != null ? String(r.vacancyId) : '';
  const vacWeights = vacId && vacancyRubricByVacancyId[vacId] ? vacancyRubricByVacancyId[vacId] : {};
  const vacancyFit = computeAreaScore010(r.scores, vacWeights);
  const preferVacancy = vacWeights && Object.keys(vacWeights).length > 0;
  const displayFit = preferVacancy ? vacancyFit : areaFit;
  return {
    ...r,
    ...fit,
    areaFitScore010: areaFit.score010,
    areaFitLabel: areaFit.label,
    vacancyFitScore010: vacancyFit.score010,
    vacancyFitLabel: vacancyFit.label,
    displayFitScore010: displayFit.score010,
    displayFitLabel: displayFit.label,
  };
}
