/** Minimum anonymous responses required before climate results are available. */
export function climateMinResponses() {
  const n = parseInt(String(process.env.CLIMATE_MIN_RESPONSES || '5'), 10);
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 100) : 5;
}
