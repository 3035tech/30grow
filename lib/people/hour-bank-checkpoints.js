/**
 * Checkpoints do banco de horas (migration 148): saldo por pessoa num dia passado, para o
 * cálculo partir dele em vez de reprocessar desde o início do banco em empresas sem
 * fechamento. Triggers apagam o checkpoint quando uma entrada do cálculo muda; o cron
 * reescreve em lote com lock consultivo exclusivo por empresa (os triggers usam o mesmo
 * lock compartilhado), então uma edição nunca fica fora do saldo gravado.
 */

import { query, withTransaction } from '../db.js';
import { EMPLOYMENT_STATUS } from '../domain-status.js';
import { DEFAULT_SCHEDULE, getCompanyTimeSchedule, isoDayInTz } from './time-clock.js';
import {
  HOUR_BANK_BATCH,
  HOUR_BANK_CALC_VERSION,
  HOUR_BANK_CHECKPOINT_LAG_DAYS,
  HOUR_BANK_CHECKPOINT_REFRESH_DAYS,
  HOUR_BANK_CHECKPOINT_RUN_CAP,
  HOUR_BANK_CHECKPOINT_LOCK_CLASS,
  computeHourBankBalances,
  hourBankStartedOn,
} from './hour-bank-balance.js';
import { addDaysIso } from './time-day-summary.js';

/** Employees whose checkpoint is missing, from another calc version or older than `staleBefore`. */
async function staleCheckpointIds(companyId, { staleBefore, afterId, limit }) {
  const r = await query(
    `SELECT c.id
     FROM candidates c
     LEFT JOIN hour_bank_checkpoints k ON k.company_id = c.company_id AND k.candidate_id = c.id
     WHERE c.company_id = $1 AND c.employment_status = '${EMPLOYMENT_STATUS.EMPLOYEE}' AND c.id > $2
       AND (k.candidate_id IS NULL OR k.calc_version <> $3 OR k.as_of < $4::date)
     ORDER BY c.id
     LIMIT $5`,
    [companyId, afterId, HOUR_BANK_CALC_VERSION, staleBefore, limit]
  );
  return (r.rows || []).map((row) => Number(row.id));
}

/** Compute and upsert one chunk at `asOf` under the company's exclusive checkpoint lock. */
async function writeCheckpointChunk(companyId, ids, { asOf, schedule }) {
  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock($1, ($2::bigint % 2147483647)::int)', [
      HOUR_BANK_CHECKPOINT_LOCK_CLASS,
      companyId,
    ]);
    const balances = await computeHourBankBalances(client, {
      companyId, candidateIds: ids, upTo: asOf, schedule, sequential: true,
    });
    const rows = [...balances.entries()];
    if (!rows.length) return 0;
    await client.query(
      `INSERT INTO hour_bank_checkpoints (company_id, candidate_id, as_of, balance_minutes, calc_version, computed_at)
       SELECT $1, u.c, $3::date, u.b, $4, NOW()
       FROM unnest($2::bigint[], $5::int[]) AS u(c, b)
       ON CONFLICT (company_id, candidate_id) DO UPDATE SET
         as_of = EXCLUDED.as_of,
         balance_minutes = EXCLUDED.balance_minutes,
         calc_version = EXCLUDED.calc_version,
         computed_at = EXCLUDED.computed_at`,
      [companyId, rows.map(([id]) => id), asOf, HOUR_BANK_CALC_VERSION, rows.map(([, v]) => v.balanceMinutes)]
    );
    return rows.length;
  });
}

/** Refresh stale checkpoints of one company (bank on), up to `budget` people. */
export async function refreshCompanyHourBankCheckpoints(companyId, { budget = HOUR_BANK_CHECKPOINT_RUN_CAP, now = new Date() } = {}) {
  const cid = Number(companyId);
  const { schedule } = await getCompanyTimeSchedule(query, { companyId: cid });
  if (!schedule?.hourBankEnabled) return { refreshed: 0, asOf: null };
  const today = isoDayInTz(now, schedule.timezone || DEFAULT_SCHEDULE.timezone);
  const asOf = addDaysIso(today, -HOUR_BANK_CHECKPOINT_LAG_DAYS);
  if (asOf < hourBankStartedOn(schedule, today)) return { refreshed: 0, asOf: null };
  const staleBefore = addDaysIso(asOf, -HOUR_BANK_CHECKPOINT_REFRESH_DAYS);

  let refreshed = 0;
  let afterId = 0;
  while (refreshed < budget) {
    const ids = await staleCheckpointIds(cid, {
      staleBefore, afterId, limit: Math.min(HOUR_BANK_BATCH, budget - refreshed),
    });
    if (!ids.length) break;
    refreshed += await writeCheckpointChunk(cid, ids, { asOf, schedule });
    afterId = ids[ids.length - 1];
  }
  return { refreshed, asOf };
}

/** People per run: env HOUR_BANK_CHECKPOINT_RUN_CAP (1–20000), else the default. */
export function hourBankCheckpointRunCap(env = process.env) {
  const n = Number.parseInt(env.HOUR_BANK_CHECKPOINT_RUN_CAP || '', 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 20000) : HOUR_BANK_CHECKPOINT_RUN_CAP;
}

/**
 * Nightly cron: every company with the bank on, capped at `runCap` people per run. A failing
 * company is logged and skipped (its checkpoints stay missing, reads just recompute).
 */
export async function refreshHourBankCheckpoints({ runCap = hourBankCheckpointRunCap(), now = new Date() } = {}) {
  const r = await query(
    `SELECT company_id AS "companyId" FROM company_time_schedules WHERE hour_bank_enabled ORDER BY company_id`
  );
  let refreshed = 0;
  let companies = 0;
  const failedCompanyIds = [];
  for (const row of r.rows || []) {
    if (refreshed >= runCap) break;
    try {
      const res = await refreshCompanyHourBankCheckpoints(row.companyId, { budget: runCap - refreshed, now });
      if (res.refreshed) companies += 1;
      refreshed += res.refreshed;
    } catch (err) {
      console.error('hour-bank-checkpoints company', row.companyId, err);
      failedCompanyIds.push(Number(row.companyId));
    }
  }
  return { refreshed, companies, capped: refreshed >= runCap, failedCompanyIds };
}
