-- Production runtime only: no DDL privileges and no deletion of financial history.
-- Run through the privileged migration connection after migration 169.
DO $billing_grants$
BEGIN
  IF current_database()<>'grow30' OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='grow30_app') THEN
    RAISE EXCEPTION 'Expected grow30 production database and grow30_app runtime role';
  END IF;
  GRANT SELECT,INSERT,UPDATE ON billing_admin_operations TO grow30_app;
  REVOKE DELETE,TRUNCATE ON billing_admin_operations FROM grow30_app;
  GRANT SELECT,INSERT ON billing_admin_operation_events TO grow30_app;
  REVOKE UPDATE,DELETE,TRUNCATE ON billing_admin_operation_events FROM grow30_app;
  GRANT USAGE,SELECT ON SEQUENCE billing_admin_operation_events_id_seq TO grow30_app;
END $billing_grants$;
