/**
 * Pure helpers for vacancy client reports (safe for client + server).
 */

import { PIPELINE_STAGE } from './pipeline.js';

export const REPORT_NOTE_MIN_CHARS = 80;
export const CONSULTANT_NOTE_MAX_CHARS = 280;
export const STRUCTURED_FIELD_MAX_CHARS = 220;

export const REPORT_RECOMMENDATIONS = Object.freeze(['advance', 'discuss', 'bank']);

const EXCLUDED_STAGES = new Set([PIPELINE_STAGE.REJECTED, PIPELINE_STAGE.ARCHIVED]);

function toNum(x) {
  const n = typeof x === 'number' ? x : parseFloat(x);
  return Number.isFinite(n) ? n : 0;
}

export function normalizeReportWeights(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const out = {};
  for (let t = 1; t <= 9; t += 1) {
    const wt = toNum(raw[String(t)] ?? raw[t] ?? 0);
    if (wt > 0) out[t] = wt;
  }
  return out;
}

/** Types the vacancy rubric values, highest weight first. */
export function rubricWeightedTypes(weights) {
  const w = normalizeReportWeights(weights);
  return Object.keys(w)
    .map((k) => ({ type: Number(k), weight: w[k] }))
    .filter((x) => Number.isFinite(x.type) && x.type >= 1 && x.type <= 9)
    .sort((a, b) => b.weight - a.weight || a.type - b.type);
}

/**
 * Client-facing recommendation derived from pipeline (no new DB field).
 * advance | discuss | bank | exclude
 */
export function recommendationFromStage(stage) {
  const s = String(stage || '');
  if (s === PIPELINE_STAGE.APPROVED || s === PIPELINE_STAGE.HIRED) return 'advance';
  if (s === PIPELINE_STAGE.INTERVIEW || s === PIPELINE_STAGE.SCREENING) return 'discuss';
  if (s === PIPELINE_STAGE.REJECTED || s === PIPELINE_STAGE.ARCHIVED) return 'exclude';
  return 'bank';
}

export function normalizeRecommendation(value, fallback = 'bank') {
  const v = String(value || '').trim();
  if (REPORT_RECOMMENDATIONS.includes(v)) return v;
  if (v === 'exclude') return 'bank';
  return REPORT_RECOMMENDATIONS.includes(fallback) ? fallback : 'bank';
}

export function isExcludedFromClientShortlist(stage) {
  return EXCLUDED_STAGES.has(String(stage || ''));
}

/**
 * Which rubric types the candidate already leans into (and which are gaps).
 */
export function fitTypeAlignment(scores, weights) {
  const scored = [];
  for (let t = 1; t <= 9; t += 1) {
    scored.push({ type: t, score: toNum(scores?.[t] ?? scores?.[String(t)] ?? 0) });
  }
  scored.sort((a, b) => b.score - a.score || a.type - b.type);
  const topSet = new Set(scored.slice(0, 3).map((x) => x.type));

  const weighted = rubricWeightedTypes(weights);
  const alignedTypes = weighted.filter((w) => topSet.has(w.type)).map((w) => w.type);
  const gapTypes = weighted.filter((w) => !topSet.has(w.type)).map((w) => w.type);

  return {
    alignedTypes: alignedTypes.slice(0, 3),
    gapTypes: gapTypes.slice(0, 2),
  };
}
