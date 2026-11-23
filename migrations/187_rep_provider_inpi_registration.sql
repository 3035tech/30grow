-- REP-P INPI registration belongs to the software provider, not each employer.
-- Preserve legacy establishment values; exports now source the provider constant.
ALTER TABLE rep_establishments
  ALTER COLUMN registration SET DEFAULT 'BR512026010154-9';

ALTER TABLE rep_establishments
  DROP CONSTRAINT IF EXISTS rep_establishments_registration_check;

ALTER TABLE rep_establishments
  ADD CONSTRAINT rep_establishments_registration_check
  CHECK (registration ~ '^[0-9]{17}$' OR registration = 'BR512026010154-9');

COMMENT ON COLUMN rep_establishments.registration IS
  'Legacy compatibility field. REP-P INPI registration belongs to 30Grow/3035Tech and is sourced from provider configuration.';

INSERT INTO schema_migrations(name)
VALUES('187_rep_provider_inpi_registration.sql')
ON CONFLICT(name) DO NOTHING;
