import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';

async function storage(env) {
  const options = [], commands = [];
  class Command { constructor(input) { this.input = input; } }
  const dependencies = {
    default: crypto, DeleteObjectCommand: Command, GetObjectCommand: Command,
    HeadBucketCommand: Command, PutObjectCommand: Command,
    S3Client: class {
      constructor(config) { options.push(config); }
      async send(command) { commands.push(command.input); return {}; }
    },
    logger: { info() {}, error() {} },
  };
  const context = vm.createContext({ Buffer, process: { env } });
  const storageModule = new vm.SourceTextModule(await readFile(new URL('../../lib/s3-object-storage.js', import.meta.url), 'utf8'), { context });
  await storageModule.link(() => new vm.SyntheticModule(Object.keys(dependencies), function () {
    for (const [name, value] of Object.entries(dependencies)) this.setExport(name, value);
  }, { context }));
  await storageModule.evaluate();
  return { api: storageModule.namespace, options, commands };
}

test('ECS and web identities use the refreshable SDK provider without permanent access keys', async () => {
  for (const identity of [
    { AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: '/v2/credentials/synthetic' },
    { AWS_CONTAINER_CREDENTIALS_FULL_URI: 'http://127.0.0.1/credentials' },
    { AWS_WEB_IDENTITY_TOKEN_FILE: '/synthetic/token', AWS_ROLE_ARN: 'arn:aws:iam::123456789012:role/synthetic' },
  ]) {
    const s = await storage({ S3_BUCKET: 'synthetic', S3_REGION: 'us-west-2', ...identity });
    assert.equal(s.api.getObjectStorageConfig().configured, true);
    await s.api.putObject({ key: 'companies/3/company-posts/7/synthetic.txt', body: Buffer.from('test'), cacheControl: 'private, no-store' });
    assert.equal(s.options[0].credentials, undefined);
    assert.equal(s.commands[0].Bucket, 'synthetic');
    assert.equal(s.commands[0].CacheControl, 'private, no-store');
  }
});

test('bucket alone, partial credentials and role-only custom endpoints remain unconfigured', async () => {
  for (const env of [
    { S3_BUCKET: 'synthetic', AWS_PROFILE: 'default' },
    { S3_BUCKET: 'synthetic', AWS_WEB_IDENTITY_TOKEN_FILE: '/synthetic/token' },
    { S3_BUCKET: 'synthetic', S3_ACCESS_KEY_ID: 'partial', AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: '/v2/credentials/synthetic' },
    { S3_BUCKET: 'synthetic', S3_ENDPOINT: 'https://s3.example.test', AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: '/v2/credentials/synthetic' },
  ]) {
    const s = await storage(env);
    assert.equal(s.api.getObjectStorageConfig().configured, false);
    await assert.rejects(s.api.putObject({ key: 'synthetic.txt', body: Buffer.from('test') }), { code: 'STORAGE_NOT_CONFIGURED' });
    assert.equal(s.options.length, 0);
  }
});

test('explicit credentials for existing S3-compatible deployments keep priority', async () => {
  const s = await storage({ S3_BUCKET: 'synthetic', S3_REGION: 'us-west-2', S3_ENDPOINT: 'https://s3.example.test', S3_ACCESS_KEY_ID: 'explicit', S3_SECRET_ACCESS_KEY: 'synthetic-secret', AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: '/v2/credentials/synthetic' });
  assert.equal(s.api.getObjectStorageConfig().configured, true);
  await s.api.putObject({ key: 'synthetic.txt', body: Buffer.from('test') });
  assert.equal(s.options[0].credentials.accessKeyId, 'explicit');
  assert.equal(s.options[0].endpoint, 'https://s3.example.test');
  assert.equal(s.options[0].forcePathStyle, true);
});
