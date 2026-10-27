function toNum(x) {
  const n = typeof x === 'number' ? x : parseFloat(x);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Fit 0–10 vs vacancy rubric weights (T1–T9 only). Motivators never enter.
 * @returns {{ score010: number|null, label: string|null, breakdown?: object }}
 */
export function computeAreaScore010(scores, desiredTypeWeights, { withBreakdown = false } = {}) {
  const w = desiredTypeWeights && Object.keys(desiredTypeWeights).length ? desiredTypeWeights : null;
  if (!w) return { score010: null, label: null, breakdown: withBreakdown ? null : undefined };

  let maxScore = 0;
  for (let t = 1; t <= 9; t++) {
    const v = toNum(scores?.[t] ?? scores?.[String(t)] ?? 0);
    if (v > maxScore) maxScore = v;
  }
  if (!maxScore) {
    return { score010: null, label: null, breakdown: withBreakdown ? null : undefined };
  }

  let sum = 0;
  let wsum = 0;
  const contributions = [];
  for (let t = 1; t <= 9; t++) {
    const wt = toNum(w[`T${t}`] ?? w[String(t)] ?? 0);
    if (wt <= 0) continue;
    const v = toNum(scores?.[t] ?? scores?.[String(t)] ?? 0);
    const nv = v / maxScore; // 0..1 relative to candidate profile
    const weighted = wt * nv;
    sum += weighted;
    wsum += wt;
    if (withBreakdown) {
      contributions.push({
        type: t,
        weight: wt,
        rawScore: v,
        normalized: Math.round(nv * 1000) / 1000,
        contribution: Math.round(weighted * 1000) / 1000,
      });
    }
  }
  if (!wsum) {
    return { score010: null, label: null, breakdown: withBreakdown ? null : undefined };
  }

  const raw = (sum / wsum) * 10;
  const score010 = Math.max(0, Math.min(10, Math.round(raw * 10) / 10)); // 1 decimal
  const label = score010 >= 7.5 ? 'high' : score010 >= 5 ? 'medium' : 'low';
  const result = { score010, label };
  if (withBreakdown) {
    contributions.sort((a, b) => b.contribution - a.contribution);
    result.breakdown = {
      method: 'weighted_normalized_t1_t9',
      maxScoreInProfile: maxScore,
      weightSum: wsum,
      rawBeforeClamp: Math.round(raw * 1000) / 1000,
      score010,
      label,
      excludes: ['motivators', 'skills', 'experience'],
      types: contributions,
    };
  }
  return result;
}
