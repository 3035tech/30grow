-- B-2804 item 11: retention purge for collaborator in-app notifications (same policy as 027).
-- B-2721 polish: app retries of a time request (adjustment / excuse) reuse the first row.
-- Reapplicable.

CREATE INDEX IF NOT EXISTS idx_candidate_notifications_created_at
  ON candidate_notifications (created_at ASC);

COMMENT ON INDEX idx_candidate_notifications_created_at IS
  'Supports batched retention DELETE of old candidate_notifications.';

ALTER TABLE employee_time_requests
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_time_requests_mobile_idempotency
  ON employee_time_requests (company_id, candidate_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMENT ON COLUMN employee_time_requests.idempotency_key IS
  'Header Idempotency-Key do app: reenvio do mesmo pedido devolve a linha original.';
