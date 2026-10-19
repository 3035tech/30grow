import { test, mock, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { S3Client } from '@aws-sdk/client-s3';
import {
  loadSigningP12,
  signingStorageConfig,
} from '../../lib/rep/certificate-storage.js';
import { signingConfigured } from '../../lib/rep/signing.js';
const envNames = [
  'REP_SIGNING_S3_BUCKET',
  'REP_SIGNING_S3_KEY',
  'REP_SIGNING_S3_REGION',
  'REP_SIGNING_S3_VERSION_ID',
  'REP_SIGNING_P12_PATH',
  'REP_SIGNING_CA_PATH',
  'REP_SIGNING_SECRET_ID',
];
let old;
beforeEach(() => {
  old = { ...process.env };
  for (const name of envNames) delete process.env[name];
  Object.assign(process.env, {
    REP_SIGNING_S3_BUCKET: 'private-certificates',
    REP_SIGNING_S3_KEY: 'signing/a1.pfx',
    REP_SIGNING_S3_REGION: 'sa-east-1',
    REP_SIGNING_CA_PATH: '/trusted/roots.pem',
  });
});
afterEach(() => {
  mock.restoreAll();
  for (const name of envNames) {
    if (old[name] === undefined) delete process.env[name];
    else process.env[name] = old[name];
  }
});
test('private S3 reference is required; a local P12 path is never used as fallback', async () => {
  delete process.env.REP_SIGNING_S3_BUCKET;
  process.env.REP_SIGNING_P12_PATH = '/old/certificate.p12';
  assert.equal(signingConfigured(), false);
  const send = mock.method(S3Client.prototype, 'send', () => {
    throw Error('unexpected request');
  });
  await assert.rejects(loadSigningP12(), /NOT_CONFIGURED/);
  assert.equal(send.mock.callCount(), 0);
  for (const key of ['', 'x\nsecret', 'é'.repeat(513)])
    assert.equal(
      signingStorageConfig({
        REP_SIGNING_S3_BUCKET: 'private-certificates',
        REP_SIGNING_S3_KEY: key,
      }),
      null,
    );
});
test('requests the exact private object/version and consumes bounded streaming bytes', async () => {
  process.env.REP_SIGNING_S3_VERSION_ID = 'fixed-version';
  let body;
  const destroy = mock.method(S3Client.prototype, 'destroy', () => {});
  mock.method(S3Client.prototype, 'send', async (command, options) => {
    assert.deepEqual(command.input, {
      Bucket: 'private-certificates',
      Key: 'signing/a1.pfx',
      VersionId: 'fixed-version',
    });
    assert.ok(options.abortSignal instanceof AbortSignal);
    body = Readable.from([Buffer.from('encrypted'), Buffer.from('-p12')]);
    return { Body: body, ContentLength: 13 };
  });
  assert.equal((await loadSigningP12()).toString(), 'encrypted-p12');
  assert.equal(body.destroyed, true);
  assert.equal(destroy.mock.callCount(), 1);
});
test('denied/missing objects, empty bodies and oversized streams fail without exposing AWS details', async () => {
  for (const response of [
    new Error('AccessDenied s3://private/secret'),
    {},
    { Body: Readable.from([]) },
    { Body: Readable.from([Buffer.alloc(1024 * 1024 + 1)]) },
    { Body: Readable.from([Buffer.from('x')]), ContentLength: 1024 * 1024 + 1 },
  ]) {
    mock.method(S3Client.prototype, 'send', async () => {
      if (response instanceof Error) throw response;
      return response;
    });
    await assert.rejects(
      loadSigningP12(),
      (error) => error.message === 'REP_SIGNING_UNAVAILABLE' && !error.cause,
    );
    if (response.Body) assert.equal(response.Body.destroyed, true);
    mock.restoreAll();
  }
});
test('download deadline also aborts the response body', async () => {
  const timeout = mock.method(AbortSignal, 'timeout', () =>
    AbortSignal.abort(new Error('deadline')),
  );
  const body = new Readable({ read() {} });
  mock.method(S3Client.prototype, 'send', async () => ({ Body: body }));
  await assert.rejects(loadSigningP12(), /UNAVAILABLE/);
  assert.equal(body.destroyed, true);
  assert.equal(timeout.mock.calls[0].arguments[0], 15000);
});
