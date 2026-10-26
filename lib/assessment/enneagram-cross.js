import { getTypeData } from '../i18n-data.js';
import { getEnneagramBlend } from './enneagram-blend.js';

/** Absolute floor (6 questions × 1–5). Also widen by ~20% of the leading score. */
export const SCORE_CLOSE_DELTA = 3;
export const SCORE_CLOSE_RATIO = 0.2;
const CLUSTER_MAX = 4;
const PAIR_DISPLAY_MAX = 3;

function toScore(value) {
  const n = typeof value === 'number' ? value : parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

export function closeDeltaForLead(leadScore) {
  const lead = toScore(leadScore);
  return Math.max(SCORE_CLOSE_DELTA, Math.round(lead * SCORE_CLOSE_RATIO));
}

export function rankEnneagramScores(scores) {
  const ranked = [];
  for (let type = 1; type <= 9; type += 1) {
    ranked.push({ type, score: toScore(scores?.[type] ?? scores?.[String(type)]) });
  }
  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.type - b.type;
  });
  return ranked;
}

/**
 * Types in the same score band as the leader.
 * Band = max(3, ~20% of the top score), so 25/22/21/20 stay together; a drop to 18 does not.
 */
export function clusterCloseTypes(ranked, delta, maxTypes = CLUSTER_MAX) {
  const top = (ranked || []).filter((r) => r && r.score > 0);
  if (top.length === 0) return [];
  const band = delta != null ? delta : closeDeltaForLead(top[0].score);
  const cluster = [top[0]];
  for (let i = 1; i < top.length && cluster.length < maxTypes; i += 1) {
    const fromLead = top[0].score - top[i].score;
    const fromPrev = cluster[cluster.length - 1].score - top[i].score;
    if (fromLead <= band && fromPrev <= band) cluster.push(top[i]);
    else break;
  }
  return cluster;
}

function pairGap(a, b) {
  return Math.abs(a.score - b.score);
}

function buildClusterPairs(cluster, locale) {
  if (!cluster || cluster.length < 2) return [];
  const pairs = [];
  for (let i = 0; i < cluster.length; i += 1) {
    for (let j = i + 1; j < cluster.length; j += 1) {
      const a = cluster[i];
      const b = cluster[j];
      const blend = getEnneagramBlend(a.type, b.type, locale);
      if (!blend) continue;
      pairs.push({
        a,
        b,
        gap: pairGap(a, b),
        involvesLead: i === 0,
        blend,
      });
    }
  }
  pairs.sort((p, q) => {
    if (p.involvesLead !== q.involvesLead) return p.involvesLead ? -1 : 1;
    if (p.gap !== q.gap) return p.gap - q.gap;
    return p.a.type - q.a.type;
  });
  return pairs.slice(0, PAIR_DISPLAY_MAX);
}

/**
 * T1–T9 cross-read: combinations among types that are close in this result.
 */
export function buildEnneagramCross(scores, locale = 'pt-BR') {
  if (!scores || typeof scores !== 'object') return null;
  const ranked = rankEnneagramScores(scores);
  const primary = ranked[0];
  if (!primary || primary.score <= 0) return null;

  const typeData = getTypeData(locale);
  const primaryData = typeData[primary.type];
  if (!primaryData) return null;

  const cluster = clusterCloseTypes(ranked);
  const close = cluster.length >= 2;
  const secondary = ranked[1] && ranked[1].score > 0 ? ranked[1] : null;
  const pairs = close ? buildClusterPairs(cluster, locale) : [];
  const leadPair = pairs[0] || null;
  const blend = leadPair?.blend || null;

  const seen = new Set();
  const strengths = [];
  const clusterForStrengths = close ? cluster : [primary];
  clusterForStrengths.forEach((item, idx) => {
    const data = typeData[item.type];
    if (!data) return;
    const take = idx === 0 ? 3 : 2;
    let added = 0;
    for (const text of data.strengths) {
      if (seen.has(text.toLowerCase())) continue;
      seen.add(text.toLowerCase());
      strengths.push({
        text,
        type: item.type,
        role: idx === 0 ? 'primary' : 'cluster',
      });
      added += 1;
      if (added >= take) break;
    }
  });

  return {
    ranked,
    primary,
    secondary,
    cluster,
    clusterTypes: cluster.map((c) => c.type),
    close,
    delta: secondary ? primary.score - secondary.score : null,
    typeData,
    strengths,
    challenge: primaryData.challenge,
    teamPrimary: primaryData.team,
    pairs,
    blend,
    teamCross: blend?.team || primaryData.team,
  };
}
