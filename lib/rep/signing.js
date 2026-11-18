import { recordSigningFailure } from './health-store.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { X509Certificate } from 'node:crypto';
import { Signer } from '@signpdf/utils';
import { loadSigningP12, signingStorageConfig } from './certificate-storage.js';
import {
  certificateSecretConfigured,
  readSigningSettings,
} from './certificate-settings.js';
const run = promisify(execFile);
export function signingConfigured() {
  return Boolean(
    (certificateSecretConfigured() || signingStorageConfig()) &&
    process.env.REP_SIGNING_CA_PATH?.trim(),
  );
}
export async function withSigningCertificate(
  action,
  { settings: suppliedSettings, p12: suppliedP12 } = {},
) {
  if (
    !(suppliedSettings && process.env.REP_SIGNING_CA_PATH?.trim()) &&
    !signingConfigured()
  )
    throw new Error('REP_SIGNING_NOT_CONFIGURED');
  const dir = await mkdtemp(path.join(tmpdir(), '30grow-rep-'));
  const bin = process.env.REP_OPENSSL_PATH || 'openssl';
  const env = { ...process.env };
  let stage = 'load-settings';
  const call = (args) =>
    run(bin, args, { env, timeout: 15000, maxBuffer: 1024 * 1024 });
  const readPkcs12 = async (args) => {
    try {
      return await call(['pkcs12', ...args]);
    } catch (error) {
      const output = `${error?.stderr || ''}\n${error?.message || ''}`;
      if (!/unsupported|unknown cipher|legacy provider|inner_evp_generic_fetch/i.test(output))
        throw error;
      return call(['pkcs12', '-legacy', ...args]);
    }
  };
  try {
    const settings = suppliedSettings || (await readSigningSettings());
    if (!settings) throw new Error('REP_SIGNING_NOT_CONFIGURED');
    env.REP_SIGNING_P12_PASSWORD = settings.password;
    const p12 = suppliedP12 ? Buffer.from(suppliedP12) : await loadSigningP12(settings);
    const bundle = path.join(dir, 'bundle.p12'),
      cert = path.join(dir, 'cert.pem'),
      key = path.join(dir, 'key.pem'),
      chain = path.join(dir, 'chain.pem');
    try {
      await writeFile(bundle, p12, { mode: 0o600 });
    } finally {
      p12.fill(0);
    }
    stage = 'extract-certificate';
    await readPkcs12([
      '-in',
      bundle,
      '-passin',
      'env:REP_SIGNING_P12_PASSWORD',
      '-clcerts',
      '-nokeys',
      '-out',
      cert,
    ]);
    stage = 'extract-private-key';
    await readPkcs12([
      '-in',
      bundle,
      '-passin',
      'env:REP_SIGNING_P12_PASSWORD',
      '-nocerts',
      '-nodes',
      '-out',
      key,
    ]);
    stage = 'extract-chain';
    await readPkcs12([
      '-in',
      bundle,
      '-passin',
      'env:REP_SIGNING_P12_PASSWORD',
      '-cacerts',
      '-nokeys',
      '-out',
      chain,
    ]);
    const hasChain = (await readFile(chain, 'utf8')).includes(
      'BEGIN CERTIFICATE',
    );
    stage = 'verify-certificate-chain';
    await call([
      'verify',
      '-CAfile',
      process.env.REP_SIGNING_CA_PATH,
      ...(hasChain ? ['-untrusted', chain] : []),
      cert,
    ]);
    stage = 'check-certificate-expiry';
    await call(['x509', '-in', cert, '-checkend', '0', '-noout']);
    stage = 'read-certificate-metadata';
    const certificate = new X509Certificate(await readFile(cert));
    const sign = async (data) => {
      stage = 'create-test-signature';
      const input = path.join(dir, 'input'),
        output = path.join(dir, 'output.der');
      await writeFile(input, data, { mode: 0o600 });
      await call([
        'cms',
        '-sign',
        '-binary',
        '-cades',
        '-md',
        'sha256',
        '-in',
        input,
        '-signer',
        cert,
        '-inkey',
        key,
        ...(hasChain ? ['-certfile', chain] : []),
        '-outform',
        'DER',
        '-out',
        output,
      ]);
      return readFile(output);
    };
    return await action({
      sign,
      fingerprint: certificate.fingerprint256.replaceAll(':', '').toLowerCase(),
      certificate: {
        fingerprint: certificate.fingerprint256
          .replaceAll(':', '')
          .toLowerCase(),
        subject: certificate.subject,
        issuer: certificate.issuer,
        validFrom: new Date(certificate.validFrom).toISOString(),
        validTo: new Date(certificate.validTo).toISOString(),
      },
    });
  } catch (error) {
    const code = typeof error?.code === 'string' && /^[A-Z0-9_-]{1,40}$/i.test(error.code)
      ? error.code
      : undefined;
    console.error('[rep-signing] certificate operation failed', {
      stage,
      errorName: typeof error?.name === 'string' ? error.name : 'UnknownError',
      ...(code ? { errorCode: code } : {}),
    });
    await recordSigningFailure();
    throw new Error('REP_SIGNING_UNAVAILABLE');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
export class RepPdfSigner extends Signer {
  constructor(sign) {
    super();
    this.signContent = sign;
  }
  sign(buffer) {
    return this.signContent(buffer);
  }
}
