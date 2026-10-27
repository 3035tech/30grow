export function keyResultProgress(startValue, targetValue, currentValue) {
  if ([startValue, targetValue, currentValue].some(v => v == null || !Number.isFinite(Number(v)))) return null;
  const start = Number(startValue), target = Number(targetValue), current = Number(currentValue);
  if (start === target) return null;
  return Math.round(Math.max(0, Math.min(100, (current - start) / (target - start) * 100)) * 100) / 100;
}

export function okrRollup(items, weighted = false) {
  let sum = 0, total = 0;
  for (const item of items || []) {
    const weight = weighted ? Number(item.weight ?? 1) : 1;
    if (item.progressPct == null || !Number.isFinite(item.progressPct) || weight <= 0) continue;
    sum += item.progressPct * weight; total += weight;
  }
  return total ? Math.round(sum / total * 100) / 100 : null;
}
