/**
 * Bounded async fan-out. Keeps pg pool headroom (PG_POOL_MAX default 10) when each item runs queries.
 */

/** Default for per-item work that runs several queries (leaves pool slots for concurrent requests). */
export const DB_FANOUT_CONCURRENCY = 4;

/** SMTP sends in flight per request (each send opens its own SMTP connection). */
export const MAIL_SEND_CONCURRENCY = 4;

/**
 * Like Promise.all(items.map(fn)) with at most `limit` in flight. Results keep input order.
 * Rejects on the first error (same contract as Promise.all); wrap `fn` to collect per-item failures.
 * @template T, R
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T, index: number) => Promise<R>} fn
 * @returns {Promise<R[]>}
 */
export async function mapWithConcurrency(items, limit, fn) {
  const list = Array.isArray(items) ? items : [];
  const results = new Array(list.length);
  const width = Math.max(1, Math.min(Number(limit) || 1, list.length));
  let next = 0;
  async function worker() {
    while (next < list.length) {
      const index = next;
      next += 1;
      results[index] = await fn(list[index], index);
    }
  }
  await Promise.all(Array.from({ length: width }, worker));
  return results;
}
