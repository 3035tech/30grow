import { createHash } from 'node:crypto';
import { z } from 'zod';

export const IMPORT_FIELDS = Object.freeze({
  fullName: { column: 'full_name', max: 200 },
  email: { column: 'email', max: 254 },
  phone: { column: 'phone', max: 30 },
  linkedinUrl: { column: 'linkedin_url', max: 500 },
  city: { column: 'city', max: 120 },
  state: { column: 'state', max: 2 },
  workHistory: { column: 'work_history', max: 4000 },
  professionalSummary: { column: 'professional_summary', max: 8000 },
});
const nullableText = (max) => z.string().max(max).nullable();
export const profileImportSchema = z
  .object({
    ...Object.fromEntries(
      Object.entries(IMPORT_FIELDS).map(([key, { max }]) => [key, nullableText(max)]),
    ),
    warnings: z.array(z.string().max(400)).max(8),
  })
  .strict();
export const profileImportJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ...Object.fromEntries(
      Object.entries(IMPORT_FIELDS).map(([key]) => [key, { type: ['string', 'null'] }]),
    ),
    warnings: { type: 'array', items: { type: 'string' } },
  },
  required: [...Object.keys(IMPORT_FIELDS), 'warnings'],
};

export function importFingerprint(value) {
  return createHash('sha256')
    .update(String(value ?? '').trim())
    .digest('hex');
}
export function normalizeImportFields(input, { partial = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('INVALID_DATA');
  const result = {};
  for (const [key, raw] of Object.entries(input)) {
    if (!Object.hasOwn(IMPORT_FIELDS, key)) throw new Error('INVALID_DATA');
    if (raw == null && !partial) continue;
    if (typeof raw !== 'string') throw new Error('INVALID_DATA');
    let value = raw.trim();
    if (!value && !partial) continue;
    if (!value || value.length > IMPORT_FIELDS[key].max || /\u0000/.test(value))
      throw new Error('INVALID_DATA');
    if (key === 'email') {
      value = value.toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new Error('INVALID_EMAIL');
    }
    if (key === 'phone') {
      if (!/^\+?[\d\s().-]+$/.test(value)) throw new Error('INVALID_DATA');
      value = value.replace(/\D/g, '');
      if (value.length < 10 || value.length > 15) throw new Error('INVALID_DATA');
    }
    if (key === 'linkedinUrl') {
      if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
      let url;
      try {
        url = new URL(value);
      } catch {
        throw new Error('INVALID_DATA');
      }
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        !/^(www\.)?linkedin\.com$/i.test(url.hostname) ||
        url.username ||
        url.password ||
        url.port
      )
        throw new Error('INVALID_DATA');
      value = url.href;
    }
    if (key === 'state') {
      value = value.toUpperCase();
      if (
        !/^(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)$/.test(
          value,
        )
      )
        throw new Error('INVALID_DATA');
    }
    result[key] = value;
  }
  if (partial && !Object.keys(result).length) throw new Error('NO_FIELDS_TO_UPDATE');
  return result;
}
