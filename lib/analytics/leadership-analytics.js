import { computeAreaScore010 } from '../area-fit.js';

/** Max assessment score rows loaded for Leadership avgFit010 (sample, not full table). */
export const LEADERSHIP_SCORES_SAMPLE_CAP = 800;

/** Max latest-per-candidate rows scanned for leadership potentials ranking. */
export const LEADERSHIP_POTENTIALS_SCAN_CAP = 500;

function toNum(x) {
  const n = typeof x === 'number' ? x : parseFloat(x);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Pesos relativos por tipo (1–9) para um indicador executivo de “potencial de liderança”.
 * Baseado nas descrições de contribuição em equipe do modelo (resultado, decisão, lealdade, padrão, etc.).
 * Não é avaliação de competência real — só um ranqueamento exploratório para RH.
 */
export const LEADERSHIP_TYPE_WEIGHTS = {
  8: 1.0, // Desafiador: decisão, proteção, crise
  3: 0.95, // Realizador: metas, influência, execução
  6: 0.86, // Leal: responsabilidade, planejamento, confiança
  1: 0.78, // Perfeccionista: padrão, compliance, disciplina
  5: 0.7, // Investigador: profundidade, estratégia técnica
  9: 0.62, // Pacificador: mediação, clima
  7: 0.58, // Entusiasta: energia, mobilização
  2: 0.55, // Auxiliador: pessoas, cultura
  4: 0.48, // Individualista: visão, autenticidade
};

/**
 * Score 0–10: média ponderada das pontuações normalizadas pelo máximo do próprio perfil (mesma ideia do fit por rubrica).
 * @param {object} scores
 * @returns {{ score010: number|null, label: string|null }}
 */
export function computeLeadershipPotential010(scores) {
  let maxScore = 0;
  for (let t = 1; t <= 9; t++) {
    const v = toNum(scores?.[t] ?? scores?.[String(t)] ?? 0);
    if (v > maxScore) maxScore = v;
  }
  if (!maxScore) return { score010: null, band: null };

  let sum = 0;
  let wsum = 0;
  for (let t = 1; t <= 9; t++) {
    const wt = toNum(LEADERSHIP_TYPE_WEIGHTS[t] ?? 0);
    if (wt <= 0) continue;
    const v = toNum(scores?.[t] ?? scores?.[String(t)] ?? 0);
    sum += wt * (v / maxScore);
    wsum += wt;
  }
  if (!wsum) return { score010: null, band: null };

  const raw = (sum / wsum) * 10;
  const score010 = Math.max(0, Math.min(10, Math.round(raw * 10) / 10));
  let band = 'explore';
  if (score010 >= 7.5) band = 'standout';
  else if (score010 >= 6) band = 'strong';
  else if (score010 >= 4.5) band = 'moderate';
  return { score010, band };
}

/**
 * @param {Array<{ companyId: number, companyName: string, candidateId: number, name: string, scores: object, topType: number }>} rows
 * @param {{ topPerCompany?: number }} [opts]
 */
export function buildLeadershipPotentialsByCompany(rows, opts = {}) {
  const topPerCompany = opts.topPerCompany ?? 6;
  const byCo = new Map();
  for (const r of rows) {
    const id = r.companyId;
    const key = String(id);
    if (!byCo.has(key)) {
      byCo.set(key, { companyId: id, companyName: r.companyName || `Empresa #${id}`, people: [] });
    }
    const { score010, band } = computeLeadershipPotential010(r.scores);
    if (score010 == null) continue;
    byCo.get(key).people.push({
      candidateId: r.candidateId,
      name: r.name,
      topType: r.topType,
      leadership010: score010,
      leadershipBand: band,
    });
  }
  return [...byCo.values()]
    .map((block) => ({
      ...block,
      people: [...block.people].sort((a, b) => b.leadership010 - a.leadership010).slice(0, topPerCompany),
    }))
    .filter((b) => b.people.length > 0)
    .sort((a, b) => String(a.companyName).localeCompare(String(b.companyName), 'pt'));
}

/** @param {Record<number, number>} countsByType */
export function normalizeTypeShares(countsByType) {
  let total = 0;
  for (let t = 1; t <= 9; t++) total += countsByType[t] || 0;
  if (!total) return {};
  const out = {};
  for (let t = 1; t <= 9; t++) out[t] = (countsByType[t] || 0) / total;
  return out;
}

/** Shannon entropy normalized to 0..1 (max = log(9) for 9 types). */
export function cognitiveDiversity01(countsByType) {
  const p = normalizeTypeShares(countsByType);
  let h = 0;
  for (let t = 1; t <= 9; t++) {
    const pi = p[t] || 0;
    if (pi > 0) h -= pi * Math.log(pi);
  }
  const maxH = Math.log(9);
  return maxH > 0 ? Math.min(1, h / maxH) : 0;
}

/**
 * @param {Array<{ scores: object, areaKey: string }>} rows
 * @param {Record<string, object>} rubricByAreaKey
 */
export function averageFit010ForRows(rows, rubricByAreaKey) {
  const vals = [];
  for (const r of rows) {
    const w = rubricByAreaKey[r.areaKey] || {};
    const { score010 } = computeAreaScore010(r.scores, w);
    if (score010 != null) vals.push(score010);
  }
  if (!vals.length) return null;
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  return Math.round(avg * 10) / 10;
}

/**
 * @param {Array<{ areaKey: string, areaLabel: string, topType: number, cnt: number }>} distRows
 * @param {Array<{ key: string, label: string }>} areasList
 * @param {Record<string, Array<{ scores: object }>>} [scoresRowsByKey]
 * @param {Record<string, object>} [rubricByAreaKey]
 */
export function buildAreaSummaries(distRows, areasList, scoresRowsByKey = null, rubricByAreaKey = null) {
  const byKey = {};
  for (const a of areasList) {
    byKey[a.key] = {
      areaKey: a.key,
      areaLabel: a.label,
      topTypeCounts: Object.fromEntries(Array.from({ length: 9 }, (_, i) => [i + 1, 0])),
      n: 0,
    };
  }
  for (const row of distRows) {
    const k = byKey[row.areaKey];
    if (!k) continue;
    k.topTypeCounts[row.topType] = row.cnt;
    k.n += row.cnt;
  }
  const out = [];
  for (const k of Object.values(byKey)) {
    if (k.n === 0) continue;
    let dominantType = null;
    let maxC = 0;
    for (let t = 1; t <= 9; t++) {
      const c = k.topTypeCounts[t] || 0;
      if (c > maxC) {
        maxC = c;
        dominantType = t;
      }
    }
    const rows = (scoresRowsByKey && scoresRowsByKey[k.areaKey]) || [];
    const avgFit010 =
      rubricByAreaKey && rows.length
        ? averageFit010ForRows(
            rows.map((r) => ({ scores: r.scores, areaKey: k.areaKey })),
            rubricByAreaKey
          )
        : null;
    out.push({
      ...k,
      dominantType,
      diversity01: cognitiveDiversity01(k.topTypeCounts),
      avgFit010,
    });
  }
  out.sort((a, b) => b.n - a.n);
  return out;
}

/**
 * Share of assessments whose top type is among the highest-weighted rubric types.
 * @param {Record<number, number>} topTypeCounts
 * @param {object} weights
 */
export function rubricAlignmentShare(topTypeCounts, weights) {
  const w = weights && Object.keys(weights).length ? weights : null;
  if (!w) return null;
  let n = 0;
  for (let t = 1; t <= 9; t++) n += topTypeCounts[t] || 0;
  if (!n) return null;
  let maxW = 0;
  for (let t = 1; t <= 9; t++) maxW = Math.max(maxW, toNum(w[String(t)] ?? w[t] ?? 0));
  if (maxW <= 0) return null;
  const aligned = [];
  for (let t = 1; t <= 9; t++) {
    if (toNum(w[String(t)] ?? w[t] ?? 0) >= maxW * 0.92) aligned.push(t);
  }
  if (!aligned.length) return null;
  let c = 0;
  for (const t of aligned) c += topTypeCounts[t] || 0;
  return Math.round((c / n) * 1000) / 10;
}

/** Global top-type counts from dist rows */
export function globalTopTypeCounts(distRows) {
  const topTypeCounts = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [i + 1, 0]));
  for (const row of distRows) {
    topTypeCounts[row.topType] = (topTypeCounts[row.topType] || 0) + row.cnt;
  }
  return topTypeCounts;
}
