import { withTransaction } from './db.js';
import { BillingError, getStripe, stripeMode } from './billing/stripe.js';
import { TERMINAL_STATUSES } from './billing/catalog.js';

/** Company lock precedes billing account locks, also used by checkout creation.
 * Read provider state before removing access; never cancel or refund implicitly.
 */
export async function withCompanyDeactivation(companyId, change) {
  return withTransaction(async db => {
    const company = (await db.query('SELECT id FROM companies WHERE id=$1 AND deleted=FALSE FOR UPDATE', [companyId])).rows[0];
    if (!company) throw new BillingError('NOT_FOUND', 404);
    const accounts = (await db.query('SELECT * FROM company_billing_accounts WHERE company_id=$1 ORDER BY livemode FOR UPDATE', [companyId])).rows;
    for (const account of accounts) {
      if (!TERMINAL_STATUSES.includes(account.status)) throw new BillingError('COMPANY_BILLING_UNRESOLVED', 409);
      if (!account.customer_id) {
        if (account.subscription_id || account.checkout_attempt) throw new BillingError('COMPANY_BILLING_UNRESOLVED', 409);
        continue;
      }
      // A different environment cannot be certified with the current key.
      if (stripeMode() !== account.livemode) throw new BillingError('COMPANY_BILLING_UNRESOLVED', 409);
      const stripe = getStripe();
      const [subscriptions, checkouts] = await Promise.all([
        stripe.subscriptions.list({ customer: account.customer_id, status: 'all', limit: 100 }),
        stripe.checkout.sessions.list({ customer: account.customer_id, status: 'open', limit: 100 }),
      ]);
      if (!Array.isArray(subscriptions.data) || !Array.isArray(checkouts.data)) throw new BillingError('BILLING_UNAVAILABLE', 503);
      if (subscriptions.has_more || checkouts.has_more || subscriptions.data.some(s => !TERMINAL_STATUSES.includes(s.status)) || checkouts.data.length) {
        throw new BillingError('COMPANY_BILLING_UNRESOLVED', 409);
      }
      // A committed intent can still have an uncertain provider result. Checkout
      // expires within 24h; only then may a fresh provider read resolve it.
      if (account.checkout_attempt && !account.checkout_session_id &&
        (!account.checkout_created_at || Date.now() - new Date(account.checkout_created_at).getTime() < 86400000)) {
        throw new BillingError('COMPANY_BILLING_UNRESOLVED', 409);
      }
    }
    return change(db);
  });
}

export async function archiveCompany(companyId) {
  return withCompanyDeactivation(companyId, async db => {
    await db.query('UPDATE company_links SET active=FALSE,rotated_at=NOW() WHERE company_id=$1 AND active=TRUE', [companyId]);
    await db.query(`UPDATE vacancy_links vl SET active=FALSE,rotated_at=NOW() FROM vacancies v
      WHERE vl.vacancy_id=v.id AND v.company_id=$1 AND vl.active=TRUE`, [companyId]);
    await db.query('UPDATE vacancies SET deleted=TRUE WHERE company_id=$1 AND deleted=FALSE', [companyId]);
    await db.query('UPDATE companies SET deleted=TRUE,active=FALSE WHERE id=$1 AND deleted=FALSE', [companyId]);
  });
}
