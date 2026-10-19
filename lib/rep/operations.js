import { asDb } from '../ae/as-db.js';
import {
  publicCertificateSettings,
  readSigningSettings,
} from './certificate-settings.js';
export async function timeClockOperations(dbOrQuery) {
  const db = asDb(dbOrQuery);
  const [pending, failures, clock, jobs, failedJobs, services] =
    await Promise.all([
      db.query(
        `SELECT count(*)::int AS n,min(r.recorded_at) AS oldest FROM rep_original_records r LEFT JOIN rep_signed_documents d ON d.establishment_id=r.establishment_id AND d.nsr=r.nsr WHERE r.record_type=7 AND r.recorded_at<now()-interval '10 minutes' AND d.nsr IS NULL`,
      ),
      db.query(
        "SELECT count(*)::int AS n,max(observed_at) AS latest FROM time_clock_health_observations WHERE kind='signing_failure' AND observed_at>now()-interval '24 hours'",
      ),
      db.query(
        'SELECT offset_ms AS "offsetMs",observed_at AS "observedAt" FROM time_clock_health_observations WHERE kind=\'clock\' ORDER BY observed_at DESC,id DESC LIMIT 1',
      ),
      db.query(
        'SELECT status,count(*)::int AS n FROM time_clock_push_deliveries GROUP BY status',
      ),
      db.query(
        'SELECT id,company_id AS "companyId",total_attempts AS attempts,last_error AS "lastError",created_at AS "createdAt" FROM time_clock_push_deliveries WHERE status=\'failed\' ORDER BY id DESC LIMIT 25',
      ),
      db.query(
        'SELECT count(*)::int AS n FROM (SELECT DISTINCT ON(establishment_id) available FROM rep_service_observations ORDER BY establishment_id,id DESC) latest WHERE available=FALSE',
      ),
    ]);
  let certificate = null,
    certificateUnavailable = false;
  try {
    const settings = publicCertificateSettings(await readSigningSettings());
    certificate = settings?.certificate
      ? {
          validTo: settings.certificate.validTo,
          validatedAt: settings.validatedAt,
        }
      : null;
  } catch {
    certificateUnavailable = true;
  }
  const measurement = clock.rows[0] || null;
  return {
    ok: true,
    serverTime: new Date().toISOString(),
    unavailableServices: services.rows[0].n,
    pendingReceipts: pending.rows[0],
    signingFailures: failures.rows[0],
    clock: measurement,
    clockStale:
      !measurement ||
      Date.now() - new Date(measurement.observedAt).getTime() > 15 * 60000,
    clockOutsideTolerance: measurement
      ? Math.abs(Number(measurement.offsetMs)) > 30000
      : null,
    certificate,
    certificateUnavailable,
    deliveries: Object.fromEntries(jobs.rows.map((r) => [r.status, r.n])),
    failedJobs: failedJobs.rows,
  };
}
