import { test, mock } from 'node:test';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
  PutSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import { validateAndSaveCertificate } from '../../lib/rep/certificate-admin.js';
import { S3Client } from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { withSigningCertificate } from '../../lib/rep/signing.js';
import { createReceiptPdf } from '../../lib/rep/receipts.js';
const run = promisify(execFile);
test('CAdES detached and PAdES PDF verify cryptographically; missing/invalid credentials fail closed', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'rep-sign-test-'));
  const bin = '/opt/homebrew/bin/openssl';
  const previous = { ...process.env };
  try {
    delete process.env.REP_SIGNING_S3_BUCKET;
    delete process.env.REP_SIGNING_S3_KEY;
    delete process.env.REP_SIGNING_SECRET_ID;
    delete process.env.REP_SIGNING_CA_PATH;
    await assert.rejects(
      withSigningCertificate(() => {}),
      /NOT_CONFIGURED/,
    );
    const key = path.join(dir, 'key.pem'),
      cert = path.join(dir, 'cert.pem'),
      p12 = path.join(dir, 'cert.p12');
    await run(bin, [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '1',
      '-subj',
      '/CN=REP test only',
      '-keyout',
      key,
      '-out',
      cert,
    ]);
    await run(bin, [
      'pkcs12',
      '-export',
      '-inkey',
      key,
      '-in',
      cert,
      '-out',
      p12,
      '-passout',
      'pass:test-only',
    ]);
    Object.assign(process.env, {
      REP_OPENSSL_PATH: bin,
      REP_SIGNING_S3_BUCKET: 'rep-certificate-test',
      REP_SIGNING_S3_KEY: 'private/test.p12',
      REP_SIGNING_P12_PASSWORD: 'test-only',
      REP_SIGNING_CA_PATH: cert,
    });
    let encryptedP12 = await readFile(p12);
    mock.method(S3Client.prototype, 'send', async (command) => {
      assert.equal(command.input.Bucket, 'rep-certificate-test');
      assert.equal(command.input.Key, 'private/test.p12');
      return {
        Body: Readable.from([Buffer.from(encryptedP12)]),
        ContentLength: encryptedP12.length,
      };
    });
    const content = Buffer.from('dados fiscais\r\n', 'latin1');
    await withSigningCertificate(async ({ sign, fingerprint }) => {
      assert.equal(fingerprint.length, 64);
      const sig = await sign(content);
      const input = path.join(dir, 'data.txt'),
        signature = path.join(dir, 'data.p7s');
      await writeFile(input, content);
      await writeFile(signature, sig);
      await run(bin, [
        'cms',
        '-verify',
        '-cades',
        '-binary',
        '-inform',
        'DER',
        '-in',
        signature,
        '-content',
        input,
        '-CAfile',
        cert,
        '-out',
        path.join(dir, 'verified'),
      ]);
      const record = {
        employer_name: 'Escola Teste',
        employer_document: '11222333000181',
        worker_name: 'Ana',
        cpf: '52998224725',
        nsr: '3',
        registration: '12345678901234567',
        record_text: '0000000037' + '2026-10-17T13:00:00-0300',
        record_hash: 'a'.repeat(64),
      };
      const pdf = await createReceiptPdf(record, sign);
      assert.match(pdf.toString('latin1'), /ETSI.CAdES.detached/);
      const text = pdf.toString('latin1'),
        range = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/.exec(
          text,
        );
      assert.ok(range);
      const [a, b, c, d] = range.slice(1).map(Number);
      const signed = Buffer.concat([
        pdf.subarray(a, a + b),
        pdf.subarray(c, c + d),
      ]);
      const hex = text.slice(b + 1, c - 1);
      let der = Buffer.from(hex, 'hex');
      // DER SEQUENCE long-form length, excluding zero-filled PDF placeholder padding.
      const lenBytes = der[1] & 0x7f;
      const len =
        der[1] & 0x80
          ? parseInt(der.subarray(2, 2 + lenBytes).toString('hex'), 16) +
            2 +
            lenBytes
          : der[1] + 2;
      der = der.subarray(0, len);
      await writeFile(input, signed);
      await writeFile(signature, der);
      await run(bin, [
        'cms',
        '-verify',
        '-cades',
        '-binary',
        '-inform',
        'DER',
        '-in',
        signature,
        '-content',
        input,
        '-CAfile',
        cert,
        '-out',
        path.join(dir, 'verified-pdf'),
      ]);
      await writeFile('/private/tmp/30grow-rep-test-receipt.pdf', pdf);
    });
    // Uploaded bytes are validated directly, before any S3 write, and remain
    // intact for upload while the signing helper wipes only its private copy.
    const uploadedP12 = Buffer.from(encryptedP12);
    await withSigningCertificate(async ({ sign }) => {
      assert.ok((await sign(content)).length > 0);
    }, { settings: { password: 'test-only' }, p12: uploadedP12 });
    assert.deepEqual(uploadedP12, encryptedP12);
    await assert.rejects(withSigningCertificate(() => {}, {
      settings: { password: 'wrong' }, p12: uploadedP12,
    }), /UNAVAILABLE/);
    // Exercise the admin path against a real temporary A1 and mocked private AWS storage.
    process.env.REP_SIGNING_SECRET_ID = 'rep-test-secret';
    let stored = {};
    let writes = 0;
    mock.method(SecretsManagerClient.prototype, 'send', async (command) => {
      if (command instanceof GetSecretValueCommand)
        return { SecretString: JSON.stringify(stored) };
      assert.ok(command instanceof PutSecretValueCommand);
      writes += 1;
      stored = JSON.parse(command.input.SecretString);
      return {};
    });
    const candidate = {
      action: 'save',
      bucket: 'rep-certificate-test',
      key: 'private/test.p12',
      region: 'us-east-1',
      versionId: '',
      password: 'test-only',
    };
    const saved = await validateAndSaveCertificate(candidate);
    assert.equal(writes, 1);
    assert.equal(stored.password, 'test-only');
    assert.ok(Date.parse(saved.certificate.validTo) > Date.now());
    assert.ok(saved.validatedAt);
    assert.equal('password' in saved, false);
    await validateAndSaveCertificate({
      ...candidate,
      action: 'test',
      password: '',
    });
    assert.equal(writes, 1, 'testing must not activate a new secret');
    await assert.rejects(
      validateAndSaveCertificate({ ...candidate, password: 'wrong' }),
      /UNAVAILABLE/,
    );
    assert.equal(
      writes,
      1,
      'failed validation must preserve the current secret',
    );
    process.env.REP_SIGNING_P12_PASSWORD = 'unused-environment-password';
    await withSigningCertificate(async ({ sign }) =>
      assert.ok((await sign(content)).length > 0),
    );
    const expiredCert = path.join(dir, 'expired.pem');
    const expiredP12 = path.join(dir, 'expired.p12');
    await run(bin, [
      'x509',
      '-in',
      cert,
      '-signkey',
      key,
      '-not_before',
      '20200101000000Z',
      '-not_after',
      '20210101000000Z',
      '-out',
      expiredCert,
    ]);
    await run(bin, [
      'pkcs12',
      '-export',
      '-inkey',
      key,
      '-in',
      expiredCert,
      '-out',
      expiredP12,
      '-passout',
      'pass:test-only',
    ]);
    encryptedP12 = await readFile(expiredP12);
    process.env.REP_SIGNING_CA_PATH = expiredCert;
    await assert.rejects(validateAndSaveCertificate(candidate), /UNAVAILABLE/);
    assert.equal(writes, 1, 'an expired A1 must not replace active settings');
    encryptedP12 = await readFile(p12);
    process.env.REP_SIGNING_CA_PATH = cert;
    delete process.env.REP_SIGNING_SECRET_ID;
    process.env.REP_SIGNING_P12_PASSWORD = 'incorrect';
    await assert.rejects(
      withSigningCertificate(() => {}),
      /UNAVAILABLE/,
    );
  } finally {
    mock.restoreAll();
    for (const k of [
      'REP_OPENSSL_PATH',
      'REP_SIGNING_S3_BUCKET',
      'REP_SIGNING_S3_KEY',
      'REP_SIGNING_SECRET_ID',
      'REP_SIGNING_P12_PASSWORD',
      'REP_SIGNING_CA_PATH',
    ]) {
      if (previous[k] === undefined) delete process.env[k];
      else process.env[k] = previous[k];
    }
    await rm(dir, { recursive: true, force: true });
  }
});
