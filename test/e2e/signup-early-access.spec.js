/**
 * Early-access /signup — formulário → sucesso → (API) set-password → login.
 * Precisa Next + DTOV (SMTP mock + NEXT_PUBLIC_APP_URL).
 */
import { test, expect } from '@playwright/test';
import { uniqueCandidateEmail, fillLogin } from './fixtures.js';

test.describe('early-access signup', () => {
  test('form creates pending account and shows success', async ({ page, request }) => {
    const email = uniqueCandidateEmail('signup');
    const companyName = `#0Pay E2E ${Date.now()}`;
    const password = 'SignupE2E!2026';

    await page.goto('/signup');
    await expect(page.getByRole('heading', { name: /crie sua conta|create your free account/i })).toBeVisible({
      timeout: 20000,
    });

    await page.locator('#signup-fullname').fill('Thomas E2E');
    await page.locator('#signup-email').fill(email);
    await page.locator('#signup-company').fill(companyName);
    await page.locator('#signup-jobtitle').click();
    await page.getByRole('option', { name: /gerência ou coordenação de rh|hr manager or coordinator/i }).click();
    await page.locator('#signup-teamsize').click();
    await page.getByRole('option', { name: '11-50', exact: true }).click();
    await page.locator('#signup-pain').fill('Gestao 360');

    await page.getByRole('button', { name: /começar agora|start now/i }).click();

    await expect(page.getByRole('heading', { name: /confirmação enviada|confirmation sent/i })).toBeVisible({
      timeout: 20000,
    });
    await expect(page.getByText(email, { exact: false })).toBeVisible();

    // Completa ativação via API (token no Postgres DTOV)
    const { Client } = await import('pg');
    const client = new Client({
      host: process.env.POSTGRES_HOST || '127.0.0.1',
      port: Number(process.env.POSTGRES_PORT || 55432),
      database: process.env.POSTGRES_DB || 'enneagram_dtov',
      user: process.env.POSTGRES_USER || 'dtov',
      password: process.env.POSTGRES_PASSWORD || 'dtov_local_only',
      ssl: false,
    });
    await client.connect();
    try {
      const u = await client.query(
        `SELECT password_setup_token AS token, active, signup_pending
         FROM users WHERE LOWER(email) = $1 LIMIT 1`,
        [email.toLowerCase()]
      );
      expect(u.rowCount).toBe(1);
      expect(u.rows[0].active).toBe(false);
      expect(u.rows[0].signup_pending).toBe(true);
      const token = u.rows[0].token;
      expect(token).toBeTruthy();

      const peek = await request.get(`/api/public/set-password?token=${encodeURIComponent(token)}`);
      expect(peek.ok()).toBeTruthy();

      const done = await request.post('/api/public/set-password', {
        data: { token, password },
      });
      expect(done.ok()).toBeTruthy();
    } finally {
      await client.end();
    }

    await page.goto('/login');
    await fillLogin(page, { email, password });
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20000 });
  });
});
