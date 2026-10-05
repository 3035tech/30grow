import { chromium } from '@playwright/test';

const BASE = 'http://127.0.0.1:3010';
const browser = await chromium.launch();
const rows = [];
for (const path of ['/', '/pricing', '/login']) {
  for (const locale of ['pt-BR', 'es-419']) {
    for (const width of [1440, 1280, 1100, 1024, 768, 390]) {
      const ctx = await browser.newContext({ viewport: { width, height: 900 } });
      await ctx.addCookies([{ name: 'NEXT_LOCALE', value: locale, url: BASE }]);
      const page = await ctx.newPage();
      await page.goto(BASE + path, { waitUntil: 'networkidle' });
      const m = await page.evaluate(() => {
        const box = document.querySelector('[role="combobox"]');
        const header = document.querySelector('header');
        return {
          header: header ? Math.round(header.getBoundingClientRect().height) : null,
          select: box ? Math.round(box.getBoundingClientRect().width) : null,
          text: box?.textContent?.trim(),
          title: box?.getAttribute('title'),
          overflow: document.documentElement.scrollWidth - innerWidth,
        };
      });
      rows.push({ path, locale, width, ...m });
      if (path !== '/login' && [1024, 390].includes(width)) {
        await page.screenshot({ path: `/tmp/landing-fix-${path === '/' ? 'home' : 'pricing'}-${locale}-${width}.png`, clip: { x: 0, y: 0, width, height: 160 } });
      }
      if (path === '/' && locale === 'es-419' && width === 1440) {
        await page.locator('header [role="combobox"]').click();
        await page.screenshot({ path: '/tmp/landing-fix-open-es-419.png', clip: { x: 900, y: 0, width: 540, height: 520 } });
        const opts = await page.getByRole('option').allTextContents();
        rows.push({ options: opts.join(' | ') });
      }
      await ctx.close();
    }
  }
}
await browser.close();
console.table(rows);
