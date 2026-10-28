import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import crypto from 'node:crypto';

test('S3 uploads preserve public asset caching but accept private document caching', async () => {
  const sent = [];
  class Command { constructor(input) { this.input = input; } }
  const deps = {
    default: crypto, DeleteObjectCommand: Command, GetObjectCommand: Command,
    HeadBucketCommand: Command, PutObjectCommand: Command,
    S3Client: class { async send(command) { sent.push(command.input); return {}; } },
    logger: { info() {}, error() {} },
  };
  const context = vm.createContext({ Buffer, process: { env: {
    S3_BUCKET: 'synthetic-only', S3_REGION: 'us-east-1', S3_ACCESS_KEY_ID: 'test', S3_SECRET_ACCESS_KEY: 'test',
  } } });
  const module = new vm.SourceTextModule(await readFile(new URL('../../lib/s3-object-storage.js', import.meta.url), 'utf8'), { context });
  await module.link(() => new vm.SyntheticModule(Object.keys(deps), function () {
    for (const [name, value] of Object.entries(deps)) this.setExport(name, value);
  }, { context }));
  await module.evaluate();
  await module.namespace.putObject({ key: 'logo.png', body: Buffer.from('test'), contentType: 'image/png' });
  await module.namespace.putObject({ key: 'private.pdf', body: Buffer.from('test'), contentType: 'application/pdf', cacheControl: 'private, no-store' });
  assert.equal(sent[0].CacheControl, 'public, max-age=31536000, immutable');
  assert.equal(sent[1].CacheControl, 'private, no-store');
  assert.equal(sent[1].ACL, undefined, 'cache policy must not silently change bucket/ACL configuration');
});

test('all DP upload paths request private caching', async () => {
  const source = await readFile(new URL('../../lib/people/employee-dp.js', import.meta.url), 'utf8');
  const uploads = [...source.matchAll(/await putObject\(\{([\s\S]*?)\}\)/g)];
  assert.equal(uploads.length, 3);
  for (const [, options] of uploads) assert.match(options, /cacheControl: 'private, no-store'/);
});
