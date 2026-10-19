-- Relational billing state: one commercial policy per company, distinct Stripe
-- identities per sandbox/live mode; no card data or raw webhook payloads stored.
CREATE TABLE IF NOT EXISTS company_billing_terms (
  company_id INTEGER PRIMARY KEY REFERENCES companies(id),
  managed BOOLEAN NOT NULL DEFAULT FALSE,
  trial_ends_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Preserve all existing companies and their promised terms. Legacy access is
-- grandfathered until an explicit subscription is purchased.
INSERT INTO company_billing_terms(company_id, managed, trial_ends_at)
SELECT c.id, FALSE, COALESCE(l.expires_at, now()) FROM companies c
LEFT JOIN company_licenses l ON l.company_id=c.id
ON CONFLICT(company_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS company_billing_accounts (
  company_id INTEGER NOT NULL REFERENCES companies(id),
  livemode BOOLEAN NOT NULL,
  customer_id TEXT UNIQUE,
  subscription_id TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'none' CHECK(status IN ('none','incomplete','incomplete_expired','trialing','active','past_due','canceled','unpaid','paused')),
  plan_key TEXT CHECK(plan_key IN ('brl_small_monthly','brl_growing_monthly','brl_medium_monthly','brl_small_annual','usd_company_monthly','brl_launch_monthly')),
  currency TEXT CHECK(currency IN ('brl','usd')),
  period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
  schedule_id TEXT,
  checkout_attempt UUID,
  checkout_plan_key TEXT CHECK(checkout_plan_key IN ('brl_small_monthly','brl_growing_monthly','brl_medium_monthly','brl_small_annual','usd_company_monthly')),
  checkout_launch BOOLEAN NOT NULL DEFAULT FALSE,
  checkout_trial_end TIMESTAMPTZ,
  checkout_created_at TIMESTAMPTZ,
  checkout_session_id TEXT UNIQUE,
  checkout_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(company_id, livemode)
);
CREATE TABLE IF NOT EXISTS billing_launch_redemptions (
  company_id INTEGER NOT NULL REFERENCES companies(id),
  livemode BOOLEAN NOT NULL,
  slot INTEGER NOT NULL CHECK(slot BETWEEN 1 AND 20),
  redeemed BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at TIMESTAMPTZ NOT NULL,
  subscription_id TEXT UNIQUE,
  PRIMARY KEY(company_id,livemode),
  UNIQUE(livemode,slot),
  FOREIGN KEY(company_id,livemode) REFERENCES company_billing_accounts(company_id,livemode)
);
CREATE TABLE IF NOT EXISTS billing_webhook_events (
  event_id TEXT PRIMARY KEY,
  livemode BOOLEAN NOT NULL,
  event_type TEXT NOT NULL,
  stripe_created_at TIMESTAMPTZ NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS billing_webhook_events_processed_idx ON billing_webhook_events(processed_at);

-- New signups receive 30 days in every cohort. Existing licenses are never
-- rewritten. This also covers old app instances during an overlapping rollout.
CREATE OR REPLACE FUNCTION issue_company_early_access_license() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.signup_source='early_access' AND NEW.company_id IS NOT NULL THEN
    INSERT INTO company_licenses(company_id,starts_at,expires_at,offer_tier,trial_days)
    VALUES(NEW.company_id,NEW.created_at,NEW.created_at+interval '30 days','trial',30)
    ON CONFLICT(company_id) DO NOTHING;
    INSERT INTO company_billing_terms(company_id,managed,trial_ends_at)
    SELECT company_id,TRUE,expires_at FROM company_licenses WHERE company_id=NEW.company_id
    ON CONFLICT(company_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
COMMENT ON TABLE company_billing_terms IS 'New self-service companies have a 30-day trial; existing companies preserve access. No automatic retroactive billing.';
COMMENT ON TABLE billing_launch_redemptions IS '20 founder slots per Stripe mode. Reservations expire; redeemed slots persist even after cancellation to prevent reuse.';
-- Capacity is an integrity rule, including concurrent hires from different APIs.
-- Only app connections explicitly enabled for a Stripe mode enforce it. Other
-- environments, legacy companies and unpaid local trials are preserved.
CREATE OR REPLACE FUNCTION enforce_company_billing_capacity() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  billing_mode TEXT := current_setting('grow.billing_mode',true);
  max_people INTEGER;
  current_people INTEGER;
BEGIN
  IF billing_mode IS NULL OR billing_mode NOT IN ('test','live') OR NEW.employment_status<>'employee' THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' THEN
    IF OLD.employment_status='employee' AND OLD.company_id=NEW.company_id THEN RETURN NEW; END IF;
  END IF;
  PERFORM 1 FROM companies WHERE id=NEW.company_id FOR UPDATE;
  SELECT CASE a.plan_key WHEN 'brl_small_monthly' THEN 20 WHEN 'brl_small_annual' THEN 20
    WHEN 'brl_launch_monthly' THEN 20 WHEN 'brl_growing_monthly' THEN 50 WHEN 'brl_medium_monthly' THEN 100 END
    INTO max_people FROM company_billing_accounts a JOIN company_billing_terms t USING(company_id)
    WHERE a.company_id=NEW.company_id AND a.livemode=(billing_mode='live') AND t.managed
      AND a.status IN ('active','trialing') AND a.period_end>now();
  IF max_people IS NULL THEN RETURN NEW; END IF;
  SELECT COUNT(*) INTO current_people FROM candidates WHERE company_id=NEW.company_id AND employment_status='employee' AND id IS DISTINCT FROM NEW.id;
  IF current_people>=max_people THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='BILLING_CAPACITY'; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS candidates_billing_capacity ON candidates;
CREATE TRIGGER candidates_billing_capacity BEFORE INSERT OR UPDATE OF company_id,employment_status ON candidates
FOR EACH ROW EXECUTE FUNCTION enforce_company_billing_capacity();

INSERT INTO schema_migrations(name) VALUES('166_stripe_billing.sql') ON CONFLICT(name) DO NOTHING;
