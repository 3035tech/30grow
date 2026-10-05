import { chromium } from 'playwright';

const B = 'http://127.0.0.1:3010';
const OUT = '/tmp/mvp09';
const cache = new Map();
async function sessionCookie(email, password) {
  if (!cache.has(email)) cache.set(email, await loginOnce(email, password));
  return cache.get(email);
}
async function loginOnce(email, password) {
  const r = await fetch(`${B}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: B }, body: JSON.stringify({ email, password }) });
  const raw = (r.headers.getSetCookie?.() || []).find((c) => c.startsWith('team30_session='));
  return raw.split(';')[0].split('=').slice(1).join('=');
}

const shots = JSON.parse(process.argv[2]);
const browser = await chromium.launch();
const errors = [];
for (const s of shots) {
  const token = await sessionCookie(s.email, s.password);
  const ctx = await browser.newContext({
    viewport: s.mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    colorScheme: s.dark ? 'dark' : 'light',
  });
  await ctx.addCookies([
    { name: 'team30_session', value: token, url: B },
    { name: 'NEXT_LOCALE', value: s.locale || 'pt-BR', url: B },
  ]);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${s.name}: ${e.message}`));
  page.on('response', (res) => { if (res.status() >= 400) errors.push(`${s.name} ${res.status()} ${res.url().replace(B, '')}`); });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${s.name} console: ${m.text().slice(0, 160)} @ ${m.location()?.url || ''}`); });
  await page.goto(`${B}${s.path}`, { waitUntil: 'networkidle', timeout: 120000 });
  await page.waitForTimeout(s.wait || 1500);
  if (s.click) {
    for (const label of s.click) {
      await page.getByRole('tab', { name: label }).or(page.getByRole('button', { name: label })).first().click();
      await page.waitForTimeout(1200);
    }
  }
  if (s.uncheck) {
    await page.getByRole('checkbox', { name: s.uncheck }).first().click();
    await page.waitForTimeout(500);
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 1) errors.push(`${s.name}: horizontal overflow ${overflow}px`);
  await page.screenshot({ path: `${OUT}/${s.name}.png`, fullPage: Boolean(s.full) });
  await ctx.close();
}
await browser.close();
console.log(errors.length ? errors.join('\n') : 'no page errors / overflow');
