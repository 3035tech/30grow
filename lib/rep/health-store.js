import { query } from '../db.js';
export async function recordSigningFailure() {
  try {
    await query(
      "INSERT INTO time_clock_health_observations(kind) VALUES('signing_failure')",
    );
  } catch {
    /* Preserve the original signing failure if telemetry is unavailable. */
  }
}
