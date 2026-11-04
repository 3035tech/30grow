-- Companies on the managed billing model keep the existing trial period.
-- After it ends, up to five active employees remain free; a paid subscription
-- controls capacity above that. Grandfathered companies remain unrestricted.
CREATE OR REPLACE FUNCTION enforce_company_billing_capacity() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  billing_mode TEXT := current_setting('grow.billing_mode',true);
  company_managed BOOLEAN;
  trial_ends TIMESTAMPTZ;
  account_status TEXT;
  plan TEXT;
  period_ends TIMESTAMPTZ;
  max_people INTEGER;
  current_people INTEGER;
BEGIN
  IF billing_mode IS NULL OR billing_mode NOT IN ('test','live') OR NEW.employment_status<>'employee' THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND OLD.employment_status='employee' AND OLD.company_id=NEW.company_id THEN RETURN NEW; END IF;
  PERFORM 1 FROM companies WHERE id=NEW.company_id FOR UPDATE;
  SELECT t.managed,t.trial_ends_at,a.status,a.plan_key,a.period_end
    INTO company_managed,trial_ends,account_status,plan,period_ends
    FROM company_billing_terms t
    LEFT JOIN company_billing_accounts a ON a.company_id=t.company_id AND a.livemode=(billing_mode='live')
    WHERE t.company_id=NEW.company_id;
  IF NOT FOUND OR NOT company_managed THEN RETURN NEW; END IF;

  -- Preserve the trial as promised, including any active Stripe trial.
  IF (COALESCE(account_status,'none')='none' AND trial_ends>now())
    OR (account_status='trialing' AND period_ends>now()) THEN RETURN NEW; END IF;

  IF account_status='active' AND period_ends>now() THEN
    IF plan='usd_company_monthly' THEN RETURN NEW; END IF;
    max_people := CASE plan
      WHEN 'brl_small_monthly' THEN 20 WHEN 'brl_small_annual' THEN 20
      WHEN 'brl_launch_monthly' THEN 20 WHEN 'brl_growing_monthly' THEN 50
      WHEN 'brl_medium_monthly' THEN 100 ELSE NULL END;
    IF max_people IS NOT NULL THEN
      SELECT COUNT(*) INTO current_people FROM candidates
        WHERE company_id=NEW.company_id AND employment_status='employee' AND id IS DISTINCT FROM NEW.id;
      IF current_people>=max_people THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='BILLING_CAPACITY'; END IF;
      RETURN NEW;
    END IF;
  END IF;

  SELECT COUNT(*) INTO current_people FROM candidates
    WHERE company_id=NEW.company_id AND employment_status='employee' AND id IS DISTINCT FROM NEW.id;
  max_people := 5;
  IF current_people>=max_people THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='BILLING_CAPACITY'; END IF;
  RETURN NEW;
END;
$$;

INSERT INTO schema_migrations(name) VALUES('179_free_plan_employee_capacity.sql') ON CONFLICT(name) DO NOTHING;
