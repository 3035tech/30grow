import {
  GetSecretValueCommand,
  PutSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import { z } from 'zod';
import { signingStorageConfig } from './certificate-storage.js';

const SECRET_TIMEOUT_MS = 15000;
export const certificateSettingsSchema = z
  .object({
    bucket: z.string().trim().min(3).max(63),
    key: z.string().min(1).max(1024),
    region: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9-]+$/),
    versionId: z.string().max(1024).optional().default(''),
    password: z
      .string()
      .max(1024)
      .refine((v) => !v.includes('\0')),
    certificate: z
      .object({
        fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
        subject: z.string(),
        issuer: z.string(),
        validFrom: z.string().datetime(),
        validTo: z.string().datetime(),
      })
      .optional(),
    validatedAt: z.string().datetime().optional(),
  })
  .refine(
    (v) =>
      signingStorageConfig({
        REP_SIGNING_S3_BUCKET: v.bucket,
        REP_SIGNING_S3_KEY: v.key,
      }) !== null,
  );

export function certificateSecretConfigured() {
  return Boolean(process.env.REP_SIGNING_SECRET_ID?.trim());
}
function secretClient() {
  return new SecretsManagerClient({
    region:
      process.env.REP_SIGNING_SECRET_REGION?.trim() ||
      process.env.AWS_REGION?.trim() ||
      'us-east-1',
    maxAttempts: 2,
  });
}
export async function readSigningSettings() {
  if (!certificateSecretConfigured()) {
    const source = signingStorageConfig();
    return source
      ? { ...source, password: process.env.REP_SIGNING_P12_PASSWORD || '' }
      : null;
  }
  const client = secretClient();
  try {
    const result = await client.send(
      new GetSecretValueCommand({
        SecretId: process.env.REP_SIGNING_SECRET_ID.trim(),
      }),
      { abortSignal: AbortSignal.timeout(SECRET_TIMEOUT_MS) },
    );
    if (!result.SecretString) return null;
    const raw = JSON.parse(result.SecretString);
    if (
      raw &&
      typeof raw === 'object' &&
      !Array.isArray(raw) &&
      Object.keys(raw).length === 0
    )
      return null;
    return certificateSettingsSchema.parse(raw);
  } catch (error) {
    // An existing secret without a current value can be initialized by the admin.
    if (error.name === 'ResourceNotFoundException') return null;
    throw new Error('REP_SIGNING_UNAVAILABLE');
  } finally {
    client.destroy();
  }
}
export async function writeSigningSettings(settings) {
  if (!certificateSecretConfigured())
    throw new Error('REP_SIGNING_NOT_CONFIGURED');
  const value = certificateSettingsSchema.parse(settings);
  const client = secretClient();
  try {
    await client.send(
      new PutSecretValueCommand({
        SecretId: process.env.REP_SIGNING_SECRET_ID.trim(),
        SecretString: JSON.stringify(value),
      }),
      { abortSignal: AbortSignal.timeout(SECRET_TIMEOUT_MS) },
    );
  } catch {
    throw new Error('REP_SIGNING_UNAVAILABLE');
  } finally {
    client.destroy();
  }
}
/** Deliberate allowlist: never return the password, secret identifier, or A1 bytes. */
export function publicCertificateSettings(settings) {
  return {
    editable: certificateSecretConfigured(),
    configured: Boolean(settings),
    bucket: settings?.bucket || '',
    key: settings?.key || '',
    region: settings?.region || 'us-east-1',
    versionId: settings?.versionId || '',
    hasPassword: Boolean(settings?.password),
    certificate: settings?.certificate || null,
    validatedAt: settings?.validatedAt || null,
  };
}
