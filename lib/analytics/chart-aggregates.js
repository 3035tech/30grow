/**
 * Pure helpers for lean distribution charts (B-3020 P1).
 * No DB — UI / unit tests only.
 */

export const SCORE_HIST_BINS = Object.freeze([
  { id: '0-19', min: 0, max: 19, labelKey: 'bin0' },
  { id: '20-39', min: 20, max: 39, labelKey: 'bin20' },
  { id: '40-59', min: 40, max: 59, labelKey: 'bin40' },
  { id: '60-79', min: 60, max: 79, labelKey: 'bin60' },
  { id: '80-100', min: 80, max: 100, labelKey: 'bin80' },
]);

/** Default: hide distribution chart when sample is too small. */
export const CHART_MIN_N = 3;

/**
 * Merge rows that share a category key, sum counts, return top N.
 * @param {Array<{ [k: string]: unknown }>} rows
 * @param {{ key: string, countKey?: string, limit?: number }} opts
 */
export function topCategoryCounts(rows, { key, countKey = 'count', limit = 5 } = {}) {
  const map = new Map();
  for (const row of rows || []) {
    const k = row?.[key];
    if (k == null || k === '') continue;
    const id = String(k);
    const n = Number(row[countKey]) || 0;
    map.set(id, (map.get(id) || 0) + n);
  }
  return [...map.entries()]
    .map(([id, value]) => ({ id, value }))
    .sort((a, b) => b.value - a.value || a.id.localeCompare(b.id))
    .slice(0, Math.max(1, Number(limit) || 5));
}

/**
 * Histogram of numeric scores into fixed bins (overall 0–100).
 * @param {Array<number|null|undefined>} scores
 * @param {typeof SCORE_HIST_BINS} [bins]
 */
export function scoreHistogram(scores, bins = SCORE_HIST_BINS) {
  const counts = bins.map((b) => ({ ...b, value: 0 }));
  let scored = 0;
  for (const raw of scores || []) {
    if (raw == null || raw === '') continue;
    const n = Number(raw);
    if (!Number.isFinite(n)) continue;
    scored += 1;
    const bin = counts.find((b) => n >= b.min && n <= b.max);
    if (bin) bin.value += 1;
  }
  return { bins: counts, scored };
}

/**
 * Count 9Box cell occupancy (1–9) from review rows.
 * @param {Array<{ nineBoxCell?: number|null }>} rows
 */
export function nineBoxOccupancy(rows) {
  const cells = Object.fromEntries([...Array(9)].map((_, i) => [i + 1, 0]));
  let placed = 0;
  for (const row of rows || []) {
    const c = Number(row?.nineBoxCell);
    if (!Number.isFinite(c) || c < 1 || c > 9) continue;
    const cell = Math.round(c);
    cells[cell] += 1;
    placed += 1;
  }
  return { cells, placed };
}

/**
 * Sum below / inBand / above (+ optional payroll) across salary-map role rows.
 */
export function salaryBandTotals(rows) {
  let below = 0;
  let inBand = 0;
  let above = 0;
  let headcount = 0;
  let payrollSum = 0;
  for (const r of rows || []) {
    below += Number(r.below) || 0;
    inBand += Number(r.inBand) || 0;
    above += Number(r.above) || 0;
    headcount += Number(r.headcount) || 0;
    payrollSum += Number(r.payrollSum) || 0;
  }
  return {
    below,
    inBand,
    above,
    headcount,
    payrollSum: Math.round(payrollSum * 100) / 100,
    banded: below + inBand + above,
  };
}

/**
 * Bench coverage for critical roles (B-3024).
 * Roles with readyCount>0 → hasReady; else with any successor → developingOnly; else empty.
 * @param {Array<{ readyCount?: number, developingCount?: number, notReadyCount?: number, successorCount?: number }>} roles
 */
export function successionCoverage(roles) {
  let empty = 0;
  let hasReady = 0;
  let developingOnly = 0;
  for (const r of roles || []) {
    const ready = Number(r.readyCount) || 0;
    const developing =
      (Number(r.developingCount) || 0) + (Number(r.notReadyCount) || 0);
    const total = Number(r.successorCount);
    const n = Number.isFinite(total) ? total : ready + developing;
    if (n <= 0) empty += 1;
    else if (ready > 0) hasReady += 1;
    else developingOnly += 1;
  }
  return {
    empty,
    hasReady,
    developingOnly,
    roles: (roles || []).length,
    covered: hasReady + developingOnly,
  };
}

/**
 * Average KR attainment % (current/target, capped 0–100) by OKR level (B-3026).
 * @param {Array<{ level?: string, keyResults?: Array<{ currentValue?: number, targetValue?: number }> }>} objectives
 */
export function okrLevelRollup(objectives) {
  const order = ['company', 'team', 'person'];
  const buckets = Object.fromEntries(
    order.map((level) => [level, { level, krCount: 0, sumPct: 0, objectives: 0 }])
  );
  for (const obj of objectives || []) {
    const level = String(obj?.level || '');
    if (!buckets[level]) continue;
    buckets[level].objectives += 1;
    for (const kr of obj.keyResults || []) {
      const target = Number(kr?.targetValue);
      if (!Number.isFinite(target) || target <= 0) continue;
      const current = Number(kr?.currentValue) || 0;
      const pct = Math.max(0, Math.min(100, (current / target) * 100));
      buckets[level].krCount += 1;
      buckets[level].sumPct += pct;
    }
  }
  return order
    .map((level) => {
      const b = buckets[level];
      return {
        id: level,
        level,
        krCount: b.krCount,
        objectives: b.objectives,
        avgPct: b.krCount > 0 ? Math.round(b.sumPct / b.krCount) : null,
      };
    })
    .filter((r) => r.krCount > 0);
}

/**
 * Sort HR Score byArea for CategoryBars (B-3025). Higher avg first.
 * @param {Array<{ area?: string, avgScore?: number, count?: number }>} byArea
 * @param {{ limit?: number }} [opts]
 */
export function hrScoreAreaBars(byArea, { limit = 8 } = {}) {
  const cap = Math.max(1, Number(limit) || 8);
  return [...(byArea || [])]
    .map((a) => ({
      id: String(a.area || ''),
      label: String(a.area || ''),
      value: Math.round(Number(a.avgScore) || 0),
      count: Number(a.count) || 0,
    }))
    .filter((a) => a.id)
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))
    .slice(0, cap);
}

/**
 * Turnover risk buckets low/medium/high (B-3028).
 * @param {{ low?: number, medium?: number, high?: number } | null | undefined} counts
 */
export function turnoverRiskDistribution(counts) {
  const low = Math.max(0, Number(counts?.low) || 0);
  const medium = Math.max(0, Number(counts?.medium) || 0);
  const high = Math.max(0, Number(counts?.high) || 0);
  return {
    low,
    medium,
    high,
    scanned: low + medium + high,
    atRisk: medium + high,
  };
}

const WHISTLE_STATUS_ORDER = Object.freeze(['new', 'triaging', 'responded', 'closed']);

/**
 * Funnel counts for whistleblowing statuses (B-3027). No report text.
 * @param {Array<{ status?: string, count?: number }>|Record<string, number>} rowsOrMap
 */
export function whistleStatusFunnel(rowsOrMap) {
  const map = new Map();
  if (rowsOrMap && !Array.isArray(rowsOrMap) && typeof rowsOrMap === 'object') {
    for (const [k, v] of Object.entries(rowsOrMap)) {
      map.set(String(k), Math.max(0, Number(v) || 0));
    }
  } else {
    for (const row of rowsOrMap || []) {
      const id = String(row?.status || '');
      if (!id) continue;
      map.set(id, (map.get(id) || 0) + (Math.max(0, Number(row.count) || 0)));
    }
  }
  const items = WHISTLE_STATUS_ORDER.map((status) => ({
    id: status,
    status,
    value: map.get(status) || 0,
  }));
  const total = items.reduce((n, i) => n + i.value, 0);
  return { items, total };
}

/**
 * Company vacation pool stack (B-3029). Days are calendar days.
 * @param {{ entitlementDays?: number, adjustmentDays?: number, usedDays?: number, pendingDays?: number }} row
 */
export function vacationPoolTotals(row) {
  const entitlement = Math.max(0, Number(row?.entitlementDays) || 0);
  const adjustment = Number(row?.adjustmentDays) || 0;
  const used = Math.max(0, Number(row?.usedDays) || 0);
  const pending = Math.max(0, Number(row?.pendingDays) || 0);
  const pool = entitlement + adjustment;
  const available = pool - used - pending;
  return {
    entitlementDays: entitlement,
    adjustmentDays: adjustment,
    poolDays: pool,
    usedDays: used,
    pendingDays: pending,
    availableDays: available,
    utilizedDays: used + pending,
  };
}

/**
 * Bars by job role / area label for vacation utilization (B-3029).
 * @param {Array<{ id?: string, label?: string, usedDays?: number, pendingDays?: number, availableDays?: number, headcount?: number }>} rows
 * @param {{ limit?: number }} [opts]
 */
export function vacationPoolByAreaBars(rows, { limit = 8 } = {}) {
  const cap = Math.max(1, Number(limit) || 8);
  return [...(rows || [])]
    .map((r) => {
      const used = Math.max(0, Number(r.usedDays) || 0);
      const pending = Math.max(0, Number(r.pendingDays) || 0);
      const available = Number(r.availableDays);
      const utilized = used + pending;
      const label = String(r.label || r.id || '').trim();
      return {
        id: String(r.id || label || 'unknown'),
        label: label || '—',
        value: utilized,
        usedDays: used,
        pendingDays: pending,
        availableDays: Number.isFinite(available) ? available : 0,
        headcount: Math.max(0, Number(r.headcount) || 0),
      };
    })
    .filter((r) => r.headcount > 0 || r.value > 0)
    .sort(
      (a, b) =>
        b.value - a.value ||
        b.headcount - a.headcount ||
        a.label.localeCompare(b.label)
    )
    .slice(0, cap);
}
