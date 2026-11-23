-- New Black Friday signups receive the 90-day offer. Existing license and
-- billing term rows are intentionally preserved without retroactive changes.
CREATE OR REPLACE FUNCTION issue_company_early_access_license() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.signup_source='early_access' AND NEW.company_id IS NOT NULL THEN
    INSERT INTO company_licenses(company_id,starts_at,expires_at,offer_tier,trial_days)
    VALUES(NEW.company_id,NEW.created_at,NEW.created_at+interval '90 days','trial',90)
    ON CONFLICT(company_id) DO NOTHING;
    INSERT INTO company_billing_terms(company_id,managed,trial_ends_at)
    SELECT company_id,TRUE,expires_at FROM company_licenses WHERE company_id=NEW.company_id
    ON CONFLICT(company_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON TABLE company_billing_terms IS 'New self-service companies receive a 90-day trial during the Black Friday offer; existing companies preserve access. No automatic retroactive billing.';

INSERT INTO schema_migrations(name)
VALUES('186_black_friday_trial_duration.sql')
ON CONFLICT(name) DO NOTHING;
