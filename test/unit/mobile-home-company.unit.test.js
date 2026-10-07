import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { z } from 'zod';
import { normalizeLocale } from '../../lib/locale-negotiation.js';

test('mobile home exposes only the authenticated company introduction', async () => {
  for (const companyId of [1, 2, null]) {
    const calls = [];
    const dependencies = {
      z, dismissEmployeeWelcome: async () => ({ ok: true }), apiErrorFromResult: () => ({}), checkRateLimit: async () => ({ ok: true }), clientIpFromRequest: () => 'ip',
      NextResponse: { json: (body) => body },
      apiError: (_request, code, status) => ({ code, status }),
      HTTP_STATUS: { UNAUTHORIZED: 401, INTERNAL_SERVER_ERROR: 500 }, ERR: { UNAUTHORIZED: 'UNAUTHORIZED', INTERNAL: 'INTERNAL' },
      authenticateMobileEmployee: async () => companyId ? { companyId, candidateId: companyId * 10 } : null,
      getEmployeeProfile: async () => ({ ok: true, person: { preferredLocale: 'en' } }),
      getCompanyEnabledModules: async (_db, cid) => { assert.equal(cid, companyId); return ['core', 'learning']; },
      normalizeLocale,
      mobileEmployeeBearerToken: () => 'test', t: () => 'Task',
      getTimeClockAccess: async (_db, scope) => ({ ok: true, enabled: scope.companyId === 1 }),
      getEmployeeHome: async (_db, scope) => {
        calls.push(scope);
        return { ok: true, person: { fullName: 'Pessoa' }, company: { name: `Empresa ${scope.companyId}`, aboutHtml: '<p>História</p>', website: 'https://example.com', logoUrl: 'private-unused-field' }, tasks: [], plans: [], courses: [], okrActivities: [], showWelcome: true };
      },
    };
    const context = vm.createContext({ console, URL });
    const module = new vm.SourceTextModule(await readFile(new URL('../../app/api/mobile/v1/employee/home/route.js', import.meta.url), 'utf8'), { context });
    await module.link(async () => new vm.SyntheticModule(Object.keys(dependencies), function () { for (const [name, value] of Object.entries(dependencies)) this.setExport(name, value); }, { context }));
    await module.evaluate();
    const response = await module.namespace.GET({ url: 'https://example.com/home?companyId=999' });
    if (!companyId) { assert.equal(response.status, 401); assert.equal(calls.length, 0); continue; }
    assert.equal(calls[0].companyId, companyId);
    assert.equal(calls[0].locale, 'en');
    assert.deepEqual([...response.companyModules], ['core', 'learning']);
    assert.equal(calls[0].candidateId, companyId * 10);
    assert.equal(response.company.name, `Empresa ${companyId}`);
    assert.deepEqual(Object.keys(response.company).sort(), ['aboutHtml', 'name', 'website']);
    assert.equal(response.features.timeClock, companyId === 1);
    assert.equal(response.showWelcome, true);
    assert.equal(response.locale, 'en');
    const override = await module.namespace.GET({ url: 'https://example.com/home?locale=fr-FR' });
    assert.equal(override.locale, 'fr-FR');
    assert.equal(calls[1].locale, 'fr-FR');
    const afterOverride = await module.namespace.GET({ url: 'https://example.com/home' });
    assert.equal(afterOverride.locale, 'en');
  }
});
