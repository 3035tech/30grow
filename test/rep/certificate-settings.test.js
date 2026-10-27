import { test, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  GetSecretValueCommand,
  PutSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import {
  certificateSettingsSchema,
  readSigningSettings,
  writeSigningSettings,
  publicCertificateSettings,
} from '../../lib/rep/certificate-settings.js';
import { canManageDigitalCertificate } from '../../lib/rep/certificate-admin.js';
import { parseDashboardTab } from '../../lib/assessment/assessment-filters.js';
const settings = {
  bucket: 'private-certificates',
  key: 'signing/a1.p12',
  region: 'sa-east-1',
  versionId: 'v1',
  password: 'test-secret-only',
};
let previous;
beforeEach(() => {
  previous = process.env.REP_SIGNING_SECRET_ID;
  process.env.REP_SIGNING_SECRET_ID = 'rep-test-secret';
});
afterEach(() => {
  mock.restoreAll();
  if (previous === undefined) delete process.env.REP_SIGNING_SECRET_ID;
  else process.env.REP_SIGNING_SECRET_ID = previous;
});
test('only the platform super admin can open certificate management', () => {
  const allowed = { role: 'admin', companyId: null };
  assert.equal(canManageDigitalCertificate(allowed), true);
  assert.equal(
    parseDashboardTab({ tab: 'digital-certificate' }, allowed),
    'digital-certificate',
  );
  for (const payload of [
    null,
    { role: 'hr', companyId: 1 },
    { role: 'direction', companyId: 1 },
    { role: 'admin', companyId: 1 },
    { role: 'admin', company_id: 2 },
  ]) {
    assert.equal(canManageDigitalCertificate(payload), false);
    assert.notEqual(
      parseDashboardTab({ tab: 'digital-certificate' }, payload),
      'digital-certificate',
    );
  }
});
test('loads the dedicated secret and writes a new version without returning the password', async () => {
  const commands = [];
  mock.method(
    SecretsManagerClient.prototype,
    'send',
    async (command, options) => {
      commands.push(command);
      assert.equal(command.input.SecretId, 'rep-test-secret');
      assert.ok(options.abortSignal);
      return command instanceof GetSecretValueCommand
        ? { SecretString: JSON.stringify(settings) }
        : {};
    },
  );
  const loaded = await readSigningSettings();
  assert.deepEqual(loaded, settings);
  await writeSigningSettings(loaded);
  assert.ok(commands[1] instanceof PutSecretValueCommand);
  assert.deepEqual(JSON.parse(commands[1].input.SecretString), settings);
  const safe = publicCertificateSettings(loaded);
  assert.equal(safe.hasPassword, true);
  assert.equal(safe.editable, true);
  assert.ok(!JSON.stringify(safe).includes(settings.password));
  assert.ok(!('password' in safe));
  assert.ok(!('secretId' in safe));
});
test('an empty pre-provisioned secret can be initialized; malformed and denied secrets fail closed', async () => {
  const send = mock.method(
    SecretsManagerClient.prototype,
    'send',
    async () => ({ SecretString: '{}' }),
  );
  assert.equal(await readSigningSettings(), null);
  send.mock.mockImplementation(async () => ({
    SecretString: 'not json with private content',
  }));
  await assert.rejects(
    readSigningSettings(),
    (error) => error.message === 'REP_SIGNING_UNAVAILABLE' && !error.cause,
  );
  send.mock.mockImplementation(async () => {
    throw new Error('AccessDenied arn:aws:private');
  });
  await assert.rejects(
    readSigningSettings(),
    (error) => error.message === 'REP_SIGNING_UNAVAILABLE' && !error.cause,
  );
  assert.equal(
    certificateSettingsSchema.safeParse({
      ...settings,
      bucket: 'https://example.test',
    }).success,
    false,
  );
  assert.equal(
    certificateSettingsSchema.safeParse({ ...settings, password: 'a\0b' })
      .success,
    false,
  );
});
