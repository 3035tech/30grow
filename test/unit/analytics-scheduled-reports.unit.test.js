import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

for (const recipientUserIds of [[], [7]]) {
  test(`scheduled analytics resolves canonical user names (${recipientUserIds.length ? 'selected' : 'default'} recipients)`, async () => {
    const sent = [];
    const queries = [];
    const context = vm.createContext({ console, Date });
    const deps = {
      runtimeAppUrl: () => 'http://localhost:3010',
      asDb: db => db,
      isMailConfigured: () => true,
      sendTransactionalMail: mail => { sent.push(mail); },
      getAnalyticsReportPrefs: async () => ({ ok: true, prefs: { frequency: 'weekly', recipientUserIds } }),
      getHiringEffectivenessMetrics: async () => ({}),
      getAllTrends: async () => ({}),
      detectAllAlerts: async () => [],
      buildSimplePdf: () => Buffer.from('pdf'),
      t: () => 'Relatório',
      contentLocale: () => 'pt-BR',
    };
    const module = new vm.SourceTextModule(await readFile(new URL('../../lib/analytics/analytics-scheduled-reports.js', import.meta.url), 'utf8'), { context });
    await module.link(() => new vm.SyntheticModule(Object.keys(deps), function () {
      for (const [key, value] of Object.entries(deps)) this.setExport(key, value);
    }, { context }));
    await module.evaluate();
    const db = { query: async (sql, args) => {
      queries.push({ sql, args });
      if (sql.includes('FROM companies')) return { rows: [{ id: 2, name: 'Empresa Teste' }] };
      assert.match(sql, /u\.display_name AS name/);
      assert.doesNotMatch(sql, /u\.name\b/);
      assert.match(sql, /u\.company_id = \$1/);
      assert.match(sql, /u\.active = TRUE/);
      assert.match(sql, /u\.deleted = FALSE/);
      return { rows: [{ email: 'reports@example.test', name: 'Gestora' }] };
    } };
    const result = await module.namespace.runScheduledAnalyticsReports(db);
    assert.equal(result.sent, 1);
    assert.equal(result.errors, 0);
    assert.equal(sent[0].to, 'reports@example.test');
    const recipients = queries.find(q => q.sql.includes('FROM users'));
    assert.equal(recipients.args[0], 2);
    if (recipientUserIds.length) {
      assert.match(recipients.sql, /u\.id = ANY\(\$2::bigint\[\]\)/);
      assert.deepEqual(recipients.args[1], recipientUserIds);
    } else {
      assert.match(recipients.sql, /u\.role IN \('direction', 'admin'\)/);
    }
  });
}
