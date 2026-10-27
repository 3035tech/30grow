/**
 * Hedged Overview type-mix composition (B-410) — pure, no DB.
 */

function dominantFromTypeCount(typeCount) {
  let best = null;
  let bestN = 0;
  for (const [k, v] of Object.entries(typeCount || {})) {
    const n = Number(v) || 0;
    if (n > bestN) {
      bestN = n;
      best = parseInt(k, 10);
    }
  }
  return bestN > 0 && best >= 1 && best <= 9 ? best : null;
}

/**
 * @returns {{ kind: 'empty'|'balanced'|'concentrated'|'gap', missingTypes: number[], dominantType: number|null, pct: number }}
 */
export function buildTypeMixCompositionAdvice(typeCount = {}) {
  const counts = {};
  let total = 0;
  for (let t = 1; t <= 9; t += 1) {
    const n = Number(typeCount[t] ?? typeCount[String(t)] ?? 0) || 0;
    counts[t] = n;
    total += n;
  }
  if (total <= 0) {
    return { kind: 'empty', missingTypes: [1, 2, 3, 4, 5, 6, 7, 8, 9], dominantType: null, pct: 0 };
  }
  const dominantType = dominantFromTypeCount(counts);
  const dominantN = dominantType ? counts[dominantType] : 0;
  const pct = Math.round((dominantN / total) * 100);
  const missingTypes = [];
  for (let t = 1; t <= 9; t += 1) {
    if (counts[t] === 0) missingTypes.push(t);
  }
  if (pct >= 45 && dominantType) {
    return { kind: 'concentrated', missingTypes, dominantType, pct };
  }
  if (missingTypes.length >= 4) {
    return { kind: 'gap', missingTypes: missingTypes.slice(0, 5), dominantType, pct };
  }
  return { kind: 'balanced', missingTypes, dominantType, pct };
}

/**
 * Internal Δ: compare two type-count windows (e.g. last 90d vs prior 90d).
 * @returns {{ available: boolean, recentDominant?: number|null, priorDominant?: number|null, recentPct?: number, priorPct?: number, pctDelta?: number, dominantChanged?: boolean }}
 */
export function buildTypeMixWindowDelta(recentCount = {}, priorCount = {}) {
  const recent = buildTypeMixCompositionAdvice(recentCount);
  const prior = buildTypeMixCompositionAdvice(priorCount);
  if (recent.kind === 'empty' || prior.kind === 'empty') {
    return { available: false };
  }
  return {
    available: true,
    recentDominant: recent.dominantType,
    priorDominant: prior.dominantType,
    recentPct: recent.pct,
    priorPct: prior.pct,
    pctDelta: Math.round((recent.pct || 0) - (prior.pct || 0)),
    dominantChanged: recent.dominantType !== prior.dominantType,
  };
}

function toWeight(w, t) {
  const n = Number(w?.[String(t)] ?? w?.[t] ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Hedged advice: team type mix vs open vacancy rubric weights.
 * @param {Record<string|number, number>} typeCount
 * @param {object[]} openVacancyWeights — array of desired_type_weights objects
 * @returns {{ kind: 'empty'|'aligned'|'scarce_sought'|'surplus_unweighted', soughtTypes: number[], scarceTypes: number[], surplusType: number|null }}
 */
export function buildMixVsRubricAdvice(typeCount = {}, openVacancyWeights = []) {
  const weightsList = Array.isArray(openVacancyWeights)
    ? openVacancyWeights.filter((w) => w && typeof w === 'object')
    : [];
  if (!weightsList.length) {
    return { kind: 'empty', soughtTypes: [], scarceTypes: [], surplusType: null };
  }

  const sumW = {};
  for (let t = 1; t <= 9; t += 1) sumW[t] = 0;
  let anyWeight = 0;
  for (const w of weightsList) {
    for (let t = 1; t <= 9; t += 1) {
      const wt = toWeight(w, t);
      sumW[t] += wt;
      anyWeight += wt;
    }
  }
  if (anyWeight <= 0) {
    return { kind: 'empty', soughtTypes: [], scarceTypes: [], surplusType: null };
  }

  const sought = Object.keys(sumW)
    .map((k) => ({ type: Number(k), weight: sumW[k] }))
    .filter((x) => x.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.type - b.type);
  const soughtTypes = sought.slice(0, 3).map((x) => x.type);

  let teamTotal = 0;
  const counts = {};
  for (let t = 1; t <= 9; t += 1) {
    counts[t] = Number(typeCount[t] ?? typeCount[String(t)] ?? 0) || 0;
    teamTotal += counts[t];
  }
  if (teamTotal <= 0) {
    return { kind: 'empty', soughtTypes, scarceTypes: soughtTypes, surplusType: null };
  }

  const scarceTypes = soughtTypes.filter((t) => {
    const share = counts[t] / teamTotal;
    return counts[t] === 0 || share < 0.08;
  });

  const dominantType = dominantFromTypeCount(counts);
  const maxSought = sought[0]?.weight || 0;
  const surplusUnweighted =
    dominantType != null &&
    sumW[dominantType] < maxSought * 0.25 &&
    (counts[dominantType] || 0) / teamTotal >= 0.35;

  if (scarceTypes.length > 0) {
    return {
      kind: 'scarce_sought',
      soughtTypes,
      scarceTypes: scarceTypes.slice(0, 3),
      surplusType: surplusUnweighted ? dominantType : null,
    };
  }
  if (surplusUnweighted) {
    return {
      kind: 'surplus_unweighted',
      soughtTypes,
      scarceTypes: [],
      surplusType: dominantType,
    };
  }
  return { kind: 'aligned', soughtTypes, scarceTypes: [], surplusType: null };
}

export { dominantFromTypeCount };
