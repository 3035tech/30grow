import { z } from 'zod';
import {
  certificateSettingsSchema,
  publicCertificateSettings,
  readSigningSettings,
  writeSigningSettings,
} from './certificate-settings.js';
import { withSigningCertificate } from './signing.js';
import { canAccessDashboardTab } from '../permissions.js';

export const canManageDigitalCertificate = (payload) =>
  canAccessDashboardTab(payload, 'digital-certificate');
export const certificateAdminSchema = z
  .object({
    action: z.enum(['test', 'save']),
    bucket: z.string().trim().min(3).max(63),
    key: z.string().min(1).max(1024),
    region: z.string().trim().min(1).max(64),
    versionId: z.string().max(1024).default(''),
    password: z.string().max(1024).optional().default(''),
  })
  .strict();
export async function validateAndSaveCertificate(input) {
  const current = await readSigningSettings();
  const settings = certificateSettingsSchema.parse({
    bucket: input.bucket,
    key: input.key,
    region: input.region,
    versionId: input.versionId,
    password: input.password || current?.password || '',
  });
  // Verify the chain, dates, password and actual signing operation before activation.
  const certificate = await withSigningCertificate(
    async ({ sign, certificate }) => {
      await sign(Buffer.from('30Grow certificate validation', 'utf8'));
      return certificate;
    },
    { settings },
  );
  const validated = {
    ...settings,
    certificate,
    validatedAt: new Date().toISOString(),
  };
  if (input.action === 'save') await writeSigningSettings(validated);
  return publicCertificateSettings(validated);
}
