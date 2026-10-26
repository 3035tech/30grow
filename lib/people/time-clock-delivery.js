import { asDb } from '../ae/as-db.js';
import {
  resolveMobilePushDestination,
  validExpoPushToken,
} from '../mobile/mobile-employee-push.js';
export const TIME_PUSH_MAX_ATTEMPTS = 5;
export const TIME_PUSH_BATCH = 20;
export async function processTimePush(
  dbOrQuery,
  { fetcher = fetch, limit = TIME_PUSH_BATCH } = {},
) {
  const started = Date.now();
  const db = asDb(dbOrQuery);
  const counts = { sent: 0, retry: 0, failed: 0, skipped: 0 };
  for (let i = 0; i < Math.min(limit, TIME_PUSH_BATCH); i++) {
    if (Date.now() - started > 25000) break;
    const claimed = await db.query(
      `UPDATE time_clock_push_deliveries d SET status='sending',locked_at=now(),attempts=attempts+1,total_attempts=total_attempts+1 WHERE id=(SELECT id FROM time_clock_push_deliveries WHERE (status='pending' AND next_attempt_at<=now()) OR (status='sending' AND locked_at<now()-interval '2 minutes') ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`,
    );
    const job = claimed.rows[0];
    if (!job) break;
    await db.query(
      'INSERT INTO time_clock_push_attempts(delivery_id,attempt_no) VALUES($1,$2) ON CONFLICT DO NOTHING',
      [job.id, job.total_attempts],
    );
    const r = await db.query(
      `SELECT t.expo_push_token AS token,t.push_destinations AS destinations FROM mobile_employee_push_tokens t JOIN candidates c ON c.id=t.candidate_id AND c.company_id=t.company_id JOIN candidate_notifications n ON n.id=$4 AND n.company_id=t.company_id AND n.recipient_candidate_id=t.candidate_id WHERE t.id=$1 AND t.company_id=$2 AND t.candidate_id=$3 AND t.active AND c.employment_status='employee'`,
      [job.token_id, job.company_id, job.candidate_id, job.notification_id],
    );
    const token = r.rows[0];
    let status = 'sent',
      error = null;
    if (!token || !validExpoPushToken(token.token)) {
      status = 'skipped';
      error = 'context_changed';
    } else
      try {
        const destination = resolveMobilePushDestination(
          'time_clock',
          token.destinations,
        );
        const response = await fetcher('https://exp.host/--/api/v2/push/send', {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            to: token.token,
            title: '30 Grow',
            body: 'Você tem uma atualização no app.',
            sound: 'default',
            data: {
              notificationId: String(job.notification_id),
              destination,
              url: `team30://workspace?destination=${destination}`,
            },
          }),
          signal: AbortSignal.timeout(4000),
        });
        const payload = await response.json();
        const ticket = Array.isArray(payload.data)
          ? payload.data[0]
          : payload.data;
        if (!response.ok || ticket?.status !== 'ok') {
          error =
            ticket?.details?.error === 'DeviceNotRegistered'
              ? 'unregistered'
              : 'provider';
          status = error === 'unregistered' ? 'skipped' : 'pending';
          if (error === 'unregistered')
            await db.query(
              'UPDATE mobile_employee_push_tokens SET active=FALSE,last_error=$2,updated_at=now() WHERE id=$1 AND company_id=$3 AND candidate_id=$4 AND expo_push_token=$5',
              [
                job.token_id,
                'DeviceNotRegistered',
                job.company_id,
                job.candidate_id,
                token.token,
              ],
            );
        }
      } catch {
        status = 'pending';
        error = 'network';
      }
    if (status === 'pending' && job.attempts >= TIME_PUSH_MAX_ATTEMPTS) {
      status = 'failed';
    }
    await db.query(
      `UPDATE time_clock_push_deliveries SET status=$2,last_error=$3,locked_at=NULL,next_attempt_at=now()+($4::int*interval '1 second'),sent_at=CASE WHEN $2='sent' THEN now() ELSE NULL END WHERE id=$1 AND status='sending' AND attempts=$5`,
      [
        job.id,
        status,
        error,
        Math.min(3600, 30 * 2 ** job.attempts),
        job.attempts,
      ],
    );
    await db.query(
      'UPDATE time_clock_push_attempts SET finished_at=now(),outcome=$3,error_code=$4 WHERE delivery_id=$1 AND attempt_no=$2',
      [job.id, job.total_attempts, status, error],
    );
    counts[status === 'pending' ? 'retry' : status]++;
  }
  return counts;
}
export async function retryTimePush(dbOrQuery, { companyId = null, id }) {
  const db = asDb(dbOrQuery);
  const result = await db.query(
    `UPDATE time_clock_push_deliveries SET status='pending',attempts=0,next_attempt_at=now(),last_error=NULL WHERE id=$1 AND ($2::bigint IS NULL OR company_id=$2) AND status='failed' RETURNING id`,
    [id, companyId],
  );
  return { ok: result.rowCount > 0 };
}
