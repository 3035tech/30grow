import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { isPublicThemePath, resolveDarkMode, themeInitScript } from '../../lib/theme-mode.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

function runInitScript({ stored, pathname, osDark }) {
  const classes = new Set();
  const ctx = {
    localStorage: { getItem: () => stored },
    location: { pathname },
    window: { matchMedia: () => ({ matches: osDark }) },
    document: { documentElement: { classList: { add: (c) => classes.add(c) } } },
  };
  vm.runInNewContext(themeInitScript(), ctx);
  return classes.has('dark');
}

describe('theme mode', () => {
  it('treats token/candidate routes as public and the panel as private', () => {
    for (const p of ['/t/abc', '/v/abc', '/assessment/motivators/x', '/jobs', '/jobs/dev-1', '/pulso', '/r/tok']) {
      assert.equal(isPublicThemePath(p), true, p);
    }
    for (const p of ['/dashboard', '/employee', '/login', '/', '/pricing', '/tasks']) {
      assert.equal(isPublicThemePath(p), false, p);
    }
  });

  it('saved choice wins; public routes follow the OS only when nothing is saved', () => {
    assert.equal(resolveDarkMode('true', '/dashboard', false), true);
    assert.equal(resolveDarkMode('false', '/t/x', true), false);
    assert.equal(resolveDarkMode(null, '/t/x', true), true);
    assert.equal(resolveDarkMode(null, '/t/x', false), false);
    assert.equal(resolveDarkMode(null, '/dashboard', true), false);
  });

  it('pre-paint script matches resolveDarkMode', () => {
    const cases = [
      { stored: 'true', pathname: '/dashboard', osDark: false },
      { stored: 'false', pathname: '/v/x', osDark: true },
      { stored: null, pathname: '/v/x', osDark: true },
      { stored: null, pathname: '/dashboard', osDark: true },
      { stored: null, pathname: '/jobs', osDark: true },
    ];
    for (const c of cases) {
      assert.equal(runInitScript(c), resolveDarkMode(c.stored, c.pathname, c.osDark), JSON.stringify(c));
    }
  });

  it('prints light: dark tokens are screen-only and the provider swaps on beforeprint', () => {
    const css = read('app/dark-mode.css');
    assert.match(css, /@media screen \{\s*html\.dark,/);
    const provider = read('app/_components/DarkModeProvider.jsx');
    assert.match(provider, /addEventListener\('beforeprint'/);
    assert.match(provider, /addEventListener\('afterprint'/);
    assert.doesNotMatch(provider, /localStorage\.setItem\(DARK_MODE_STORAGE_KEY, String\(isDark\)\)/);
  });

  it('public candidate flows no longer force the light color scheme', () => {
    for (const f of ['app/_components/AssessmentFlow.jsx', 'app/_components/MotivatorsFlow.jsx', 'app/_components/PublicVacancyPosting.jsx']) {
      assert.doesNotMatch(read(f), /\[color-scheme:light\]/, f);
    }
  });
});

describe('dashboard tab preload', () => {
  it('every preload path matches a dynamic() import in DashboardClient', () => {
    const preload = read('app/dashboard/dashboard-tab-preload.js');
    const client = read('app/dashboard/DashboardClient.jsx');
    const paths = [...preload.matchAll(/import\('([^']+)'\)/g)].map((m) => m[1]);
    assert.ok(paths.length >= 30);
    for (const p of paths) assert.ok(client.includes(`import('${p}')`), p);
  });

  it('menu items preload on intent and navigation exposes pending state', () => {
    const client = read('app/dashboard/DashboardClient.jsx');
    assert.match(client, /onIntent: navigable === false \? undefined : \(\) => preloadDashboardTab\(destinationTab\)/);
    assert.match(read('app/_components/SidebarNav.jsx'), /onMouseEnter: onIntent/);
    assert.match(client, /<NavLoadBar active=\{panelLoading \|\| navPending\} \/>/);
    const nav = read('app/dashboard/hooks/useDashboardNavigation.js');
    assert.match(nav, /startNavTransition\(\(\) => \{\s*router\.push/);
  });
});
