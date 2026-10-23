/** Minimum security/billing contract required before a production server opens.
 * Explicit projections also verify the runtime role can read these fields.
 * No fallback, writes, migrations or provider calls belong in this check.
 */
export async function validateRuntimeSchema(db) {
  for (const sql of [
    'SELECT id,role,locale,active,deleted,company_id,session_version FROM users LIMIT 0',
    'SELECT id,deleted,active,enabled_modules,signup_creator_user_id FROM companies LIMIT 0',
    'SELECT user_id,capability,granted FROM user_capability_overrides LIMIT 0',
    'SELECT company_id,managed,trial_ends_at FROM company_billing_terms LIMIT 0',
    'SELECT company_id,livemode,customer_id,subscription_id,status,checkout_attempt,checkout_session_id,checkout_created_at FROM company_billing_accounts LIMIT 0',
    'SELECT id,company_id,actor_user_id,status FROM billing_admin_operations LIMIT 0',
    'SELECT id,operation_id,status FROM billing_admin_operation_events LIMIT 0',
  ]) await db.query(sql);
}
