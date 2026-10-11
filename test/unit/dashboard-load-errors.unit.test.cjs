const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const swc = require('next/dist/build/swc');

// Execute the real component and hooks with controlled requests, without a DB or session.
async function mount(file, fetch, exportName = 'default', suffix = '') {
  const slots = [], effects = [];
  let cursor = 0;
  const changed = (a, b) => !a || a.length !== b.length || a.some((v, i) => v !== b[i]);
  const hooks = {
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }];
    },
    useRef(initial) { const i = cursor++; return slots[i] ||= { current: initial }; },
    useEffect(fn, deps) {
      const i = cursor++;
      if (changed(slots[i]?.deps, deps)) effects.push(() => {
        slots[i]?.cleanup?.();
        slots[i] = { deps, cleanup: fn() };
      });
    },
    useCallback(fn, deps) {
      const i = cursor++;
      if (changed(slots[i]?.deps, deps)) slots[i] = { deps, fn };
      return slots[i].fn;
    },
  };
  const element = (type, props, ...children) => ({ type, props: { ...props, children } });
  const domain = await import("../../lib/domain-status.js");
  const stubs = new Proxy({ ...domain, __esModule: true,
    PAGE_SIZE_OPTIONS: [20, 50], useOrgUnits: () => ({ units: [] }),
    localIsoToday: () => "2026-10-10", fieldExpenseStatusLabel: (_l, s) => s, S: {}, cn: (...x) => x.filter(Boolean).join(' '),
    t: (_locale, key) => key, useAppFeedback: () => ({ toast() {} }),
  }, { get: (obj, key) => obj[key] ?? key });
  await swc.loadBindings();
  const result = await swc.transform(fs.readFileSync(file, 'utf8') + suffix, {
    filename: file, jsc: { parser: { syntax: 'ecmascript', jsx: true },
      transform: { react: { runtime: 'classic' } }, target: 'es2022' }, module: { type: 'commonjs' },
  });
  const module = { exports: {} };
  vm.runInNewContext(result.code, { module, exports: module.exports, fetch, URLSearchParams,
    AbortController, console, setTimeout: () => 1, clearTimeout() {}, React: { createElement: element },
    require: id => id === 'react' ? hooks : stubs,
  }, { filename: file });
  return {
    render(props) { cursor = 0; const tree = module.exports[exportName](props); effects.splice(0).forEach(fn => fn()); return tree; },
    async settle(props) { await new Promise(resolve => setImmediate(resolve)); return this.render(props); },
  };
}
function find(tree, predicate) {
  if (!tree || typeof tree !== 'object') return null;
  if (predicate(tree)) return tree;
  for (const child of [tree.props?.children].flat(Infinity)) {
    const match = find(child, predicate); if (match) return match;
  }
  return null;
}
const culture = 'app/dashboard/tabs/overview/CultureInsightsCard.jsx';
const response = (body, ok = true) => ({ ok, status: ok ? 200 : 400, json: async () => body });
const summary = { hasClimateData: true, overallHealth: 'neutral' };

test('culture summary and full details both send the selected company', async () => {
  const urls = [];
  const app = await mount(culture, async url => {
    urls.push(url);
    return response(url.includes('summary=') ? { ok: true, summary } : { ok: true, culture: { insights: [] } });
  });
  const props = { companyId: 42 };
  app.render(props);
  const tree = await app.settle(props);
  await find(tree, n => n.type === 'button').props.onClick();
  assert.equal(urls.length, 2);
  urls.forEach(url => assert.equal(new URL(url, 'https://test').searchParams.get('companyId'), '42'));
  assert.equal(new URL(urls[0], 'https://test').searchParams.get('summary'), 'true');
});

test('culture HTTP failure renders retry, and recovery renders valid empty state', async () => {
  let fail = true;
  const app = await mount(culture, async () => response(fail ? { error: 'COMPANY_REQUIRED' } : { ok: true, summary: {} }, !fail));
  const props = { companyId: 1 };
  app.render(props);
  const failed = await app.settle(props);
  const banner = find(failed, n => n.type === 'ListLoadError');
  assert.ok(banner);
  fail = false;
  banner.props.onRetry(); app.render(props);
  const recovered = await app.settle(props);
  assert.equal(find(recovered, n => n.type === 'ListLoadError'), null);
  assert.ok(JSON.stringify(recovered).includes('noData'));
});

test('culture cannot display a late response from the previous company', async () => {
  const pending = [];
  const app = await mount(culture, url => new Promise(resolve => pending.push({ url, resolve })));
  app.render({ companyId: 1 }); app.render({ companyId: 2 });
  pending[1].resolve(response({ ok: true, summary: { ...summary, declaredSnippet: 'Company TWO' } }));
  await app.settle({ companyId: 2 });
  pending[0].resolve(response({ ok: true, summary: { ...summary, declaredSnippet: 'Company ONE' } }));
  const tree = await app.settle({ companyId: 2 });
  assert.ok(JSON.stringify(tree).includes('Company TWO'));
  assert.ok(!JSON.stringify(tree).includes('Company ONE'));
});

test('culture with no selected company finishes loading without a request', async () => {
  const app = await mount(culture, () => { throw Error('unexpected request'); });
  app.render({}); const tree = await app.settle({});
  assert.equal(find(tree, n => n.type === 'AppLoading'), null);
});

test('paged DP list retains an explicit failure and retries successfully', async () => {
  let fail = true;
  const app = await mount('app/_components/TimeClockWorkspace.jsx', async () => response(fail ? { error: 'Unavailable' } : { items: [], total: 0 }, !fail),
    'listProbe', '\nexport function listProbe() { return usePagedList("/api/admin/time-clock/people", { companyId: "1" }, []); }');
  app.render(); const failed = await app.settle();
  assert.equal(failed.loading, false); assert.equal(failed.error, 'Unavailable');
  fail = false; await failed.reload(); const recovered = app.render();
  assert.equal(recovered.loading, false); assert.equal(recovered.error, undefined);
  assert.equal(recovered.total, 0);
});

for (const [file, name, suffix = ''] of [
  ['TimeClockHolidaysBlock', 'TimeClockHolidaysBlock'],
  ['TimeClockRequestsBlock', 'TimeClockRequestsBlock'],
  ['TimeClockAdminBlock', 'TimeClockAdminBlock'],
  ['HourBankAdminBlock', 'HourBankAdminBlock'],
  ['FieldTeamWorkspace', 'FieldExpensesQueue', '\nexport { FieldExpensesQueue };'],
  ['FieldTeamWorkspace', 'FieldVisitsDay', '\nexport { FieldVisitsDay };'],
]) {
  test(`${name}: failed load shows retry instead of empty, recovery clears error`, async () => {
    let fail = true;
    const app = await mount(`app/_components/${file}.jsx`, async () => response(fail ? { error: 'Unavailable' } : { items: [], total: 0 }, !fail), name, suffix);
    const props = { companyId: 1, locale: 'pt-BR', toast() {} };
    app.render(props);
    const failed = await app.settle(props);
    const banner = find(failed, n => n.type === 'ListLoadError');
    assert.ok(banner, 'failure must remain visible');
    assert.equal(find(failed, n => n.type === 'EmptyState'), null, 'failure must not look empty');
    fail = false; await banner.props.onRetry(); app.render(props);
    const recovered = await app.settle(props);
    assert.equal(find(recovered, n => n.type === 'ListLoadError'), null);
    assert.ok(find(recovered, n => n.type === 'EmptyState'), 'successful empty response should display empty state');
  });
}
