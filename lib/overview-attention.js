/** Calendar date deadlines: a past due_date never becomes a misleading zero-day delay. */
export function oldestOverdueDays(rows, now = new Date()) {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const days = (rows || []).map(row => {
    if (!row?.dueDate) return null;
    const raw = row.dueDate instanceof Date ? row.dueDate.toISOString().slice(0, 10) : String(row.dueDate).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
    const date = Date.parse(`${raw}T00:00:00Z`);
    return Number.isFinite(date) && date < today ? Math.floor((today-date)/86400000) : null;
  }).filter(value => value != null);
  return days.length ? Math.max(...days) : null;
}

export function organizeOverviewAttention(items, { limit = 10, oldAfterDays = 90 } = {}) {
  const unique = new Map();
  for (const item of items || []) {
    const key = item.dedupeKey || item.id;
    const previous = unique.get(key);
    // Repeated reminders describe one task. Keep the newest reminder for that task.
    if (!previous || (item.days ?? Infinity) < (previous.days ?? Infinity)) unique.set(key, item);
  }
  const rank = {high:0,medium:1,low:2};
  const sorted = [...unique.values()].map(({dedupeKey,...item}) => item).sort((a,b) =>
    (rank[a.priority] ?? 9)-(rank[b.priority] ?? 9) || (b.days ?? -1)-(a.days ?? -1));
  const old = item => !item.overdue && Number.isFinite(item.days) && item.days > oldAfterDays;
  return { current: sorted.filter(item => !old(item)).slice(0,limit), older: sorted.filter(old).slice(0,limit), oldAfterDays };
}
