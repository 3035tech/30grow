/**
 * Inteligência comportamental agregada do time (Overview) — v3.
 * Pure — sem DB. Hedged; sem indivíduos.
 * Cruzamento: dominante + 2º/3º tipo + pares + Motivadores (intensidade/recorrência/dispersão).
 */

import { MOTIVATORS_DIMENSIONS, motivatorDimensionLabel } from '../ae/motivators-dimensions.js';
import { cognitiveDiversity01 } from '../analytics/leadership-analytics.js';
import { contentLocale } from '../i18n.js';

export const TEAM_INTEL_PEOPLE_CAP = 150;
export const TEAM_INTEL_SMALL_SAMPLE = 5;

const TYPE_META = {
  1: { short: 'Perfeccionista', shortEn: 'Reformer', color: '#C9A227' },
  2: { short: 'Auxiliador', shortEn: 'Helper', color: '#E87B47' },
  3: { short: 'Realizador', shortEn: 'Achiever', color: '#E8A447' },
  4: { short: 'Individualista', shortEn: 'Individualist', color: '#7C5CFF' },
  5: { short: 'Investigador', shortEn: 'Investigator', color: '#47A8E8' },
  6: { short: 'Leal', shortEn: 'Loyalist', color: '#47C4E8' },
  7: { short: 'Entusiasta', shortEn: 'Enthusiast', color: '#47E87B' },
  8: { short: 'Desafiador', shortEn: 'Challenger', color: '#B54A3A' },
  9: { short: 'Pacificador', shortEn: 'Peacemaker', color: '#47E8C4' },
};

/**
 * Tipos empatados no topo — RH: contar ambos, % sobre pessoas reais.
 */
export function dominantTypesFromScores(scores, topType) {
  const map = {};
  let max = -Infinity;
  if (scores && typeof scores === 'object') {
    for (let t = 1; t <= 9; t += 1) {
      const v = Number(scores[t] ?? scores[String(t)] ?? NaN);
      if (!Number.isFinite(v)) continue;
      map[t] = v;
      if (v > max) max = v;
    }
  }
  if (max === -Infinity) {
    const tt = Number(topType);
    return tt >= 1 && tt <= 9 ? [tt] : [];
  }
  const tied = [];
  for (let t = 1; t <= 9; t += 1) {
    if (map[t] === max) tied.push(t);
  }
  return tied.length ? tied : [];
}

/** Ranking T1–T9 por score (desc). */
export function rankTypesFromScores(scores) {
  if (!scores || typeof scores !== 'object') return [];
  const entries = [];
  for (let t = 1; t <= 9; t += 1) {
    const v = Number(scores[t] ?? scores[String(t)] ?? NaN);
    if (Number.isFinite(v)) entries.push({ t, v });
  }
  entries.sort((a, b) => b.v - a.v || a.t - b.t);
  return entries;
}

/** 2º tipo (se perto do topo) — peso parcial para cruzamentos. */
export function secondaryTypeFromScores(scores, topType) {
  const entries = rankTypesFromScores(scores);
  if (!entries.length) {
    const tt = Number(topType);
    return tt >= 1 && tt <= 9 ? null : null;
  }
  const top = entries[0];
  const second = entries[1];
  if (!second) return null;
  if (second.v === top.v) return null;
  if (second.v >= top.v * 0.85) return second.t;
  return null;
}

/** 3º tipo (ainda relevante, limiar mais frouxo). */
export function tertiaryTypeFromScores(scores) {
  const entries = rankTypesFromScores(scores);
  if (entries.length < 3) return null;
  const top = entries[0];
  const third = entries[2];
  if (!third || third.v === top.v) return null;
  if (third.v >= top.v * 0.75) return third.t;
  return null;
}

/**
 * Barras de perfil (só dominantes / empates) — UI.
 */
export function buildProfileBars(people = []) {
  const nPeople = people.length;
  const weight = {};
  for (let t = 1; t <= 9; t += 1) weight[t] = 0;

  for (const p of people) {
    const types = dominantTypesFromScores(p.scores, p.topType);
    if (!types.length) continue;
    const share = 1 / types.length;
    for (const t of types) weight[t] += share;
  }

  const bars = [];
  for (let t = 1; t <= 9; t += 1) {
    const count = weight[t];
    if (count <= 0) continue;
    bars.push({
      type: t,
      count: Math.round(count * 10) / 10,
      pct: nPeople > 0 ? Math.round((count / nPeople) * 100) : 0,
    });
  }
  bars.sort((a, b) => b.count - a.count || a.type - b.type);
  return { bars, nPeople, typeCount: weight };
}

/**
 * Presença para cruzamentos: dominante 1.0 + 2º 0.35 + 3º 0.15.
 * Pares dominante×secundário para tensões/complementos.
 */
export function buildTypePresence(people = []) {
  const presence = {};
  for (let t = 1; t <= 9; t += 1) presence[t] = 0;
  const blends = {};
  let n = 0;
  for (const p of people) {
    const types = dominantTypesFromScores(p.scores, p.topType);
    if (!types.length) continue;
    n += 1;
    const share = 1 / types.length;
    for (const t of types) presence[t] += share;
    const sec = secondaryTypeFromScores(p.scores, p.topType);
    if (sec != null && !types.includes(sec)) presence[sec] += 0.35;
    const ter = tertiaryTypeFromScores(p.scores);
    if (ter != null && !types.includes(ter) && ter !== sec) presence[ter] += 0.15;

    const primary = types[0];
    if (primary && sec != null) {
      const a = Math.min(primary, sec);
      const b = Math.max(primary, sec);
      const key = `${a}-${b}`;
      blends[key] = (blends[key] || 0) + 1;
    }
  }
  return { presence, blends, nPeople: n };
}

export function buildProfileMicrophraseKey(bars = []) {
  const top = bars.slice(0, 3).map((b) => b.type);
  if (!top.length) return { key: 'empty', types: [] };
  const has = (set) => top.some((t) => set.has(t));
  const themes = [];
  if (has(new Set([1, 6]))) themes.push('quality');
  if (has(new Set([2, 9]))) themes.push('care');
  if (has(new Set([3, 8]))) themes.push('results');
  if (has(new Set([4, 7]))) themes.push('creativity');
  if (has(new Set([5]))) themes.push('analysis');
  if (!themes.length) themes.push('mixed');
  const signature = themes.slice(0, 3).join('_');
  const known = new Set([
    'quality',
    'care',
    'results',
    'creativity',
    'analysis',
    'mixed',
    'quality_care',
    'quality_results',
    'care_results',
    'results_creativity',
    'quality_care_results',
  ]);
  const key = known.has(signature) ? signature : themes[0] || 'mixed';
  return { key, types: top };
}

/**
 * Intensidade + recorrência Top 5 + dispersão (coef. variação).
 */
export function buildMotivatorRanking(attempts = []) {
  const dims = MOTIVATORS_DIMENSIONS.map((d) => d.key);
  const sum = Object.fromEntries(dims.map((k) => [k, 0]));
  const sumSq = Object.fromEntries(dims.map((k) => [k, 0]));
  const top5Hits = Object.fromEntries(dims.map((k) => [k, 0]));
  let scored = 0;

  for (const a of attempts) {
    const scores =
      a.dimensionScores && typeof a.dimensionScores === 'object' ? a.dimensionScores : null;
    if (!scores) continue;
    scored += 1;
    const entries = dims
      .map((k) => ({ key: k, v: Number(scores[k]) }))
      .filter((e) => Number.isFinite(e.v));
    for (const e of entries) {
      sum[e.key] += e.v;
      sumSq[e.key] += e.v * e.v;
    }

    let topKeys = [];
    if (Array.isArray(a.ranking) && a.ranking.length) {
      topKeys = a.ranking.map((x) => String(x)).filter(Boolean).slice(0, 5);
    } else {
      topKeys = [...entries].sort((x, y) => y.v - x.v).slice(0, 5).map((e) => e.key);
    }
    for (const k of new Set(topKeys)) {
      if (top5Hits[k] != null) top5Hits[k] += 1;
    }
  }

  const items = dims.map((key) => {
    const intensity = scored > 0 ? Math.round(sum[key] / scored) : 0;
    const recurrencePct = scored > 0 ? Math.round((top5Hits[key] / scored) * 100) : 0;
    let dispersion = 0;
    if (scored >= 2) {
      const mean = sum[key] / scored;
      const variance = Math.max(0, sumSq[key] / scored - mean * mean);
      const std = Math.sqrt(variance);
      dispersion = mean > 0 ? Math.min(100, Math.round((std / mean) * 100)) : 0;
    }
    const combined = intensity * 0.4 + recurrencePct * 0.45 + dispersion * 0.15;
    return { key, intensity, recurrencePct, dispersion, combined };
  });
  items.sort((a, b) => b.combined - a.combined || b.recurrencePct - a.recurrencePct || a.key.localeCompare(b.key));
  return { items, nPeople: scored };
}

function shareOfPresence(presence, types, nPeople) {
  if (!nPeople) return 0;
  let w = 0;
  for (const t of types) w += Number(presence[t] || 0);
  return w / nPeople;
}

function blendShare(blends, pairs, nPeople) {
  if (!nPeople) return 0;
  let n = 0;
  for (const [a, b] of pairs) {
    const key = `${Math.min(a, b)}-${Math.max(a, b)}`;
    n += Number(blends[key] || 0);
  }
  return n / nPeople;
}

function motivatorByKey(items, key) {
  return items.find((x) => x.key === key) || null;
}

function missingTypeCount(presence) {
  let n = 0;
  for (let t = 1; t <= 9; t += 1) {
    if ((presence[t] || 0) < 0.15) n += 1;
  }
  return n;
}

const FORCE_RULES = [
  {
    id: 'quality',
    score: (ctx) => {
      const s = shareOfPresence(ctx.presence, [1], ctx.nEneagram);
      const m = motivatorByKey(ctx.motivators, 'desenvolvimento');
      const blend = blendShare(ctx.blends, [[1, 6], [1, 2]], ctx.nEneagram);
      return s * 55 + (m?.recurrencePct || 0) * 0.25 + (m?.intensity || 0) * 0.1 + blend * 18;
    },
  },
  {
    id: 'collaboration',
    score: (ctx) => {
      const s = shareOfPresence(ctx.presence, [2, 9], ctx.nEneagram);
      const m = motivatorByKey(ctx.motivators, 'relacionamentos');
      return s * 50 + (m?.recurrencePct || 0) * 0.3;
    },
  },
  {
    id: 'execution',
    score: (ctx) => {
      const s = shareOfPresence(ctx.presence, [3, 8], ctx.nEneagram);
      const g = motivatorByKey(ctx.motivators, 'crescimento');
      const d = motivatorByKey(ctx.motivators, 'desafio');
      return s * 48 + ((g?.recurrencePct || 0) + (d?.recurrencePct || 0)) * 0.2;
    },
  },
  {
    id: 'creativity',
    score: (ctx) => {
      const s = shareOfPresence(ctx.presence, [4, 7], ctx.nEneagram);
      const m = motivatorByKey(ctx.motivators, 'criatividade');
      return s * 50 + (m?.recurrencePct || 0) * 0.35;
    },
  },
  {
    id: 'learning',
    score: (ctx) => {
      const d = motivatorByKey(ctx.motivators, 'desenvolvimento');
      const c = motivatorByKey(ctx.motivators, 'crescimento');
      const s5 = shareOfPresence(ctx.presence, [5], ctx.nEneagram);
      return ((d?.combined || 0) + (c?.combined || 0)) * 0.55 + s5 * 12;
    },
  },
  {
    id: 'analysis',
    score: (ctx) => {
      const s = shareOfPresence(ctx.presence, [5], ctx.nEneagram);
      return s * 70 + (motivatorByKey(ctx.motivators, 'desafio')?.intensity || 0) * 0.15;
    },
  },
  {
    id: 'reliability',
    score: (ctx) => {
      const s = shareOfPresence(ctx.presence, [6, 1], ctx.nEneagram);
      const m = motivatorByKey(ctx.motivators, 'seguranca');
      return s * 45 + (m?.recurrencePct || 0) * 0.3;
    },
  },
  {
    id: 'purpose',
    score: (ctx) => {
      const m = motivatorByKey(ctx.motivators, 'proposito');
      const s = shareOfPresence(ctx.presence, [4, 1], ctx.nEneagram);
      return (m?.combined || 0) * 0.7 + s * 8;
    },
  },
  {
    id: 'autonomy_drive',
    score: (ctx) => {
      const m = motivatorByKey(ctx.motivators, 'autonomia');
      const s = shareOfPresence(ctx.presence, [5, 4, 8], ctx.nEneagram);
      return (m?.combined || 0) * 0.5 + s * 20;
    },
  },
  {
    id: 'balance',
    score: (ctx) => {
      const m = motivatorByKey(ctx.motivators, 'equilibrio');
      return (m?.combined || 0) * 0.65;
    },
  },
  {
    id: 'standards_care',
    score: (ctx) => {
      // Blend 1–2 / presença conjunta qualidade + cuidado
      const blend = blendShare(ctx.blends, [[1, 2], [1, 9]], ctx.nEneagram);
      const s = Math.min(
        shareOfPresence(ctx.presence, [1], ctx.nEneagram),
        shareOfPresence(ctx.presence, [2, 9], ctx.nEneagram)
      );
      return blend * 55 + s * 40;
    },
  },
];

const ATTENTION_RULES = [
  {
    id: 'overload',
    score: (ctx) => {
      const s = shareOfPresence(ctx.presence, [2, 3], ctx.nEneagram);
      const eq = motivatorByKey(ctx.motivators, 'equilibrio');
      const lowEq = eq ? Math.max(0, 55 - eq.intensity) : 0;
      return s * 40 + lowEq * 0.5;
    },
  },
  {
    id: 'stagnation',
    score: (ctx) => {
      const d = motivatorByKey(ctx.motivators, 'desenvolvimento');
      const ch = motivatorByKey(ctx.motivators, 'desafio');
      const sec = motivatorByKey(ctx.motivators, 'seguranca');
      const lowGrowth =
        Math.max(0, 50 - (d?.recurrencePct || 0)) + Math.max(0, 45 - (ch?.recurrencePct || 0));
      return lowGrowth * 0.4 + (sec?.recurrencePct || 0) * 0.25;
    },
  },
  {
    id: 'rigor_flex',
    score: (ctx) => {
      const t1 = shareOfPresence(ctx.presence, [1], ctx.nEneagram);
      const flex = motivatorByKey(ctx.motivators, 'flexibilidade');
      if (t1 < 0.12 || !flex || flex.recurrencePct < 35) return 0;
      return t1 * 50 + flex.recurrencePct * 0.4;
    },
  },
  {
    id: 'recognition_split',
    score: (ctx) => {
      const r = motivatorByKey(ctx.motivators, 'reconhecimento');
      if (!r) return 0;
      const byDisp = (r.dispersion || 0) >= 28 ? r.dispersion * 0.7 : 0;
      const byMid = r.recurrencePct >= 25 && r.recurrencePct <= 55 ? 28 : 0;
      return byDisp + byMid + (r.intensity > 65 ? 12 : 0);
    },
  },
  {
    id: 'unspoken',
    score: (ctx) => {
      const s = shareOfPresence(ctx.presence, [9, 2], ctx.nEneagram);
      return s >= 0.22 ? s * 55 : s * 20;
    },
  },
  {
    id: 'challenge_autonomy',
    score: (ctx) => {
      const ch = motivatorByKey(ctx.motivators, 'desafio');
      const au = motivatorByKey(ctx.motivators, 'autonomia');
      if (!ch || !au) return 0;
      if (ch.recurrencePct >= 40 && au.recurrencePct <= 35) {
        return ch.recurrencePct * 0.5 + (50 - au.recurrencePct) * 0.4;
      }
      return 0;
    },
  },
  {
    id: 'lead_autonomy',
    score: (ctx) => {
      const lead = motivatorByKey(ctx.motivators, 'lideranca');
      const au = motivatorByKey(ctx.motivators, 'autonomia');
      if (!lead || !au) return 0;
      if (lead.recurrencePct >= 40 && au.recurrencePct <= 30) return lead.recurrencePct * 0.45 + 20;
      if (au.recurrencePct >= 50 && lead.recurrencePct <= 25) return au.recurrencePct * 0.35 + 15;
      return 0;
    },
  },
  {
    id: 'growth_dev_gap',
    score: (ctx) => {
      const g = motivatorByKey(ctx.motivators, 'crescimento');
      const d = motivatorByKey(ctx.motivators, 'desenvolvimento');
      if (!g || !d) return 0;
      if (g.recurrencePct >= 45 && d.recurrencePct <= 35) {
        return g.recurrencePct * 0.4 + (50 - d.recurrencePct) * 0.45;
      }
      return 0;
    },
  },
  {
    id: 'finance_purpose',
    score: (ctx) => {
      const f = motivatorByKey(ctx.motivators, 'financeiro');
      const p = motivatorByKey(ctx.motivators, 'proposito');
      if (!f || !p) return 0;
      if (f.recurrencePct >= 40 && p.recurrencePct <= 30) return f.recurrencePct * 0.4 + 18;
      if (p.recurrencePct >= 45 && f.recurrencePct <= 25) return p.recurrencePct * 0.35 + 15;
      return 0;
    },
  },
  {
    id: 'style_gap',
    score: (ctx) => {
      const missing = missingTypeCount(ctx.presence);
      if (missing < 4 || ctx.nEneagram < 4) return 0;
      return missing * 8;
    },
  },
  {
    id: 'care_results_tension',
    score: (ctx) => {
      // Time com cuidado e resultado fortes juntos — risco de atrito de ritmo/prioridade
      const care = shareOfPresence(ctx.presence, [2, 9], ctx.nEneagram);
      const results = shareOfPresence(ctx.presence, [3, 8], ctx.nEneagram);
      if (care < 0.18 || results < 0.18) return 0;
      return Math.min(care, results) * 70 + blendShare(ctx.blends, [[2, 3], [9, 3], [2, 8]], ctx.nEneagram) * 25;
    },
  },
  {
    id: 'depth_pace_tension',
    score: (ctx) => {
      // Investigador / profundidade vs entusiasta / ritmo
      const depth = shareOfPresence(ctx.presence, [5, 1], ctx.nEneagram);
      const pace = shareOfPresence(ctx.presence, [7, 3], ctx.nEneagram);
      const blend = blendShare(ctx.blends, [[5, 7], [1, 7], [5, 3]], ctx.nEneagram);
      if (depth < 0.15 || pace < 0.15) return blend * 40;
      return Math.min(depth, pace) * 65 + blend * 30;
    },
  },
  {
    id: 'loyalty_change',
    score: (ctx) => {
      const t6 = shareOfPresence(ctx.presence, [6], ctx.nEneagram);
      const flex = motivatorByKey(ctx.motivators, 'flexibilidade');
      const sec = motivatorByKey(ctx.motivators, 'seguranca');
      if (t6 < 0.12) return 0;
      const flexHigh = flex && flex.recurrencePct >= 40 ? flex.recurrencePct * 0.35 : 0;
      const secHigh = sec && sec.recurrencePct >= 40 ? sec.recurrencePct * 0.25 : 0;
      return t6 * 45 + flexHigh + secHigh;
    },
  },
];

const ACTION_RULES = [
  { id: 'development', when: (ids) => ids.has('learning') || ids.has('stagnation') || ids.has('growth_dev_gap'), priority: 10 },
  { id: 'flexibility', when: (ids) => ids.has('rigor_flex') || ids.has('quality') || ids.has('balance') || ids.has('loyalty_change'), priority: 9 },
  { id: 'career', when: (ids) => ids.has('stagnation') || ids.has('execution') || ids.has('growth_dev_gap'), priority: 8 },
  { id: 'recognition', when: (ids) => ids.has('recognition_split'), priority: 9 },
  { id: 'communication', when: (ids) => ids.has('unspoken') || ids.has('rigor_flex') || ids.has('style_gap') || ids.has('care_results_tension') || ids.has('depth_pace_tension'), priority: 7 },
  { id: 'leadership', when: (ids) => ids.has('lead_autonomy') || ids.has('execution'), priority: 7 },
  { id: 'workload', when: (ids) => ids.has('overload'), priority: 10 },
  { id: 'autonomy', when: (ids) => ids.has('challenge_autonomy') || ids.has('lead_autonomy') || ids.has('autonomy_drive'), priority: 8 },
  { id: 'collaboration', when: (ids) => ids.has('collaboration') || ids.has('unspoken') || ids.has('standards_care') || ids.has('care_results_tension'), priority: 6 },
  { id: 'challenge', when: (ids) => ids.has('creativity') || ids.has('learning') || ids.has('depth_pace_tension'), priority: 6 },
  { id: 'purpose', when: (ids) => ids.has('purpose') || ids.has('finance_purpose'), priority: 7 },
  { id: 'diversity', when: (ids) => ids.has('style_gap'), priority: 6 },
];

/**
 * Top N. Com amostra ≥5, completa até N (softMin pode ser 0).
 */
export function pickTopRules(rules, ctx, limit, minScore = 12, softMin = 0) {
  const scored = rules
    .map((r) => ({ id: r.id, score: Number(r.score(ctx)) || 0 }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

  const hard = scored.filter((r) => r.score >= minScore).slice(0, limit);
  const enoughSample =
    (ctx.nEneagram || 0) >= TEAM_INTEL_SMALL_SAMPLE ||
    (ctx.nMotivators || 0) >= TEAM_INTEL_SMALL_SAMPLE;
  if (!enoughSample) {
    return hard.map((r) => ({ id: r.id, score: Math.round(r.score) }));
  }
  if (hard.length >= limit) {
    return hard.map((r) => ({ id: r.id, score: Math.round(r.score) }));
  }

  const out = [...hard];
  const seen = new Set(out.map((r) => r.id));
  for (const r of scored) {
    if (out.length >= limit) break;
    if (seen.has(r.id) || r.score < softMin) continue;
    out.push(r);
    seen.add(r.id);
  }
  return out.slice(0, limit).map((r) => ({ id: r.id, score: Math.round(r.score) }));
}

export function motivatorDiversityKind(attempts = []) {
  if (!attempts.length) return 'empty';
  const counts = {};
  let n = 0;
  for (const a of attempts) {
    let top = null;
    if (Array.isArray(a.ranking) && a.ranking[0]) top = String(a.ranking[0]);
    else if (a.dimensionScores) {
      let best = -Infinity;
      for (const [k, v] of Object.entries(a.dimensionScores)) {
        const num = Number(v);
        if (Number.isFinite(num) && num > best) {
          best = num;
          top = k;
        }
      }
    }
    if (!top) continue;
    counts[top] = (counts[top] || 0) + 1;
    n += 1;
  }
  if (n < 2) return 'empty';
  let h = 0;
  for (const c of Object.values(counts)) {
    const p = c / n;
    if (p > 0) h -= p * Math.log(p);
  }
  const maxH = Math.log(Math.max(2, Object.keys(counts).length));
  const d = maxH > 0 ? h / maxH : 0;
  if (d >= 0.72) return 'high';
  if (d >= 0.4) return 'moderate';
  return 'convergent';
}

/**
 * @param {{
 *   eneagramPeople?: Array<{ topType?: number, scores?: object }>,
 *   motivatorAttempts?: Array<{ dimensionScores?: object, ranking?: string[] }>,
 *   locale?: string,
 *   cohort?: { kind?: string, teamGroupId?: number|null, teamGroupName?: string|null },
 * }} input
 */
export function buildTeamBehavioralIntel(input = {}) {
  const eneagramPeople = Array.isArray(input.eneagramPeople) ? input.eneagramPeople : [];
  const motivatorAttempts = Array.isArray(input.motivatorAttempts) ? input.motivatorAttempts : [];
  const locale = input.locale || 'pt-BR';
  const cohort = input.cohort && typeof input.cohort === 'object' ? input.cohort : {};

  const profiles = buildProfileBars(eneagramPeople);
  const { presence, blends } = buildTypePresence(eneagramPeople);
  const micro = buildProfileMicrophraseKey(profiles.bars);
  const motivators = buildMotivatorRanking(motivatorAttempts);

  const ctx = {
    presence,
    blends: blends || {},
    typeCount: profiles.typeCount,
    nEneagram: profiles.nPeople,
    motivators: motivators.items,
    nMotivators: motivators.nPeople,
  };

  const forces = pickTopRules(FORCE_RULES, ctx, 5, 10, 0);
  const attentions = pickTopRules(ATTENTION_RULES, ctx, 5, 12, 0);

  const fired = new Set([...forces.map((f) => f.id), ...attentions.map((a) => a.id)]);
  let actions = ACTION_RULES.filter((a) => a.when(fired))
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))
    .slice(0, 6)
    .map((a) => ({ id: a.id }));

  if (actions.length < 4 && motivators.items.length) {
    const fallbackMap = {
      desenvolvimento: 'development',
      flexibilidade: 'flexibility',
      crescimento: 'career',
      reconhecimento: 'recognition',
      autonomia: 'autonomy',
      desafio: 'challenge',
      relacionamentos: 'collaboration',
      lideranca: 'leadership',
      proposito: 'purpose',
      equilibrio: 'flexibility',
    };
    for (const m of motivators.items) {
      if (actions.length >= 6) break;
      const id = fallbackMap[m.key];
      if (id && !actions.some((x) => x.id === id) && m.recurrencePct >= 30) {
        actions.push({ id });
      }
    }
  }

  const topMovers = motivators.items.slice(0, 5).map((m, i) => ({
    rank: i + 1,
    key: m.key,
    label: motivatorDimensionLabel(m.key, locale),
    intensity: m.intensity,
    recurrencePct: m.recurrencePct,
  }));

  const diversityKind = motivatorDiversityKind(motivatorAttempts);
  const typeDiv =
    profiles.nPeople > 0
      ? cognitiveDiversity01(
          Object.fromEntries(
            Object.entries(profiles.typeCount).map(([k, v]) => [Number(k), Math.round(Number(v))])
          )
        )
      : 0;

  const mapItem = (m) => ({
    ...m,
    label: motivatorDimensionLabel(m.key, locale),
  });

  return {
    profiles: {
      bars: profiles.bars.map((b) => ({
        ...b,
        name:
          contentLocale(locale) === 'en'
            ? TYPE_META[b.type]?.shortEn || `T${b.type}`
            : TYPE_META[b.type]?.short || `T${b.type}`,
        color: TYPE_META[b.type]?.color || '#64748b',
      })),
      nPeople: profiles.nPeople,
      microphraseKey: micro.key,
      microphraseTypes: micro.types,
    },
    motivators: {
      items: motivators.items.map(mapItem),
      top: motivators.items.slice(0, 5).map(mapItem),
      rest: motivators.items.slice(5).map(mapItem),
      nPeople: motivators.nPeople,
    },
    forces,
    attentions,
    topMovers,
    diversityKind,
    actions: actions.slice(0, 6),
    meta: {
      nEneagram: profiles.nPeople,
      nMotivators: motivators.nPeople,
      smallSample: profiles.nPeople > 0 && profiles.nPeople < TEAM_INTEL_SMALL_SAMPLE,
      smallSampleMotivators:
        motivators.nPeople > 0 && motivators.nPeople < TEAM_INTEL_SMALL_SAMPLE,
      typeDiversity01: Math.round(typeDiv * 100) / 100,
      empty: profiles.nPeople === 0 && motivators.nPeople === 0,
      cohortKind: cohort.kind || 'filters',
      teamGroupId: cohort.teamGroupId ?? null,
      teamGroupName: cohort.teamGroupName || null,
    },
  };
}
