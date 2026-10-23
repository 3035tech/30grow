-- Durable financial intents and status history. External Stripe identifiers are
-- TEXT; entities and actors retain relational ownership and fixed domains.
CREATE TABLE IF NOT EXISTS billing_admin_operations (
  id UUID PRIMARY KEY,
  company_id INTEGER NOT NULL,
  livemode BOOLEAN NOT NULL,
  actor_user_id INTEGER NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK(kind IN ('cancel_renewal','resume_renewal','terminate','refund')),
  status TEXT NOT NULL DEFAULT 'prepared' CHECK(status IN ('prepared','processing','pending','succeeded','failed','needs_review')),
  reason TEXT NOT NULL CHECK(reason IN ('customer_request','withdrawal','annual_early_termination','service_issue','incorrect_charge')),
  note TEXT NOT NULL DEFAULT '' CHECK(char_length(note)<=1000),
  refund_basis TEXT CHECK(refund_basis IN ('full','partial','annual')),
  invoice_id TEXT,
  charge_id TEXT,
  subscription_id TEXT NOT NULL,
  stripe_refund_id TEXT UNIQUE,
  amount INTEGER CHECK(amount>0),
  currency TEXT CHECK(currency IN ('brl','usd')),
  requested_at TIMESTAMPTZ NOT NULL,
  policy_version TEXT NOT NULL,
  error_code TEXT CHECK(char_length(error_code)<=120),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY(company_id,livemode) REFERENCES company_billing_accounts(company_id,livemode),
  CHECK((kind='refund' AND refund_basis IS NOT NULL AND invoice_id IS NOT NULL AND charge_id IS NOT NULL AND amount IS NOT NULL AND currency IS NOT NULL) OR
        (kind<>'refund' AND refund_basis IS NULL AND invoice_id IS NULL AND charge_id IS NULL AND amount IS NULL AND currency IS NULL))
);
CREATE INDEX IF NOT EXISTS billing_admin_operations_company_idx ON billing_admin_operations(company_id,livemode,created_at DESC);
-- One proportional early-termination calculation per invoice; an additional
-- exceptional refund remains a separate, explicit manual decision.
CREATE UNIQUE INDEX IF NOT EXISTS billing_admin_annual_refund_once_idx ON billing_admin_operations(company_id,livemode,invoice_id)
  WHERE kind='refund' AND refund_basis='annual' AND status<>'failed';
CREATE TABLE IF NOT EXISTS billing_admin_operation_events (
  id BIGSERIAL PRIMARY KEY,
  operation_id UUID NOT NULL REFERENCES billing_admin_operations(id),
  status TEXT NOT NULL CHECK(status IN ('prepared','processing','pending','succeeded','failed','needs_review')),
  source TEXT NOT NULL CHECK(source IN ('api','webhook','reconcile')),
  stripe_status TEXT CHECK(stripe_status IN ('pending','requires_action','succeeded','failed','canceled')),
  error_code TEXT CHECK(char_length(error_code)<=120),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS billing_admin_operation_events_operation_idx ON billing_admin_operation_events(operation_id,id);
INSERT INTO schema_migrations(name) VALUES('169_billing_admin_operations.sql') ON CONFLICT(name) DO NOTHING;
