/** Server-side app URL. APP_URL is read at runtime for each environment.
 * NEXT_PUBLIC_APP_URL remains a compatibility fallback during rollout.
 * Do not use the landing-page URL for invitations or authentication links.
 */
export function runtimeAppUrl() {
  return String(process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || '').trim().replace(/\/+$/, '');
}
