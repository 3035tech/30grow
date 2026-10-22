/**
 * Zod helpers for API Routes — parse body / query without ad-hoc if/typeof.
 * Agents: prefer these over manual validation in new routes.
 */

import { z } from 'zod';
import { NextResponse } from 'next/server';
import { validationFields } from './form-validation.js';
import { apiError, ERR, localeFromRequest } from './api-error.js';
import { t } from './i18n.js';
import { LOCALES } from './locale-negotiation.js';

const validationSummary = request => t(localeFromRequest(request), 'formValidation.summary');

export { z };

/** UI locale from the supported list (`LOCALES`). */
export const zLocale = z.enum(LOCALES);

/** Positive integer company / entity id from query string or JSON. */
export const zPositiveInt = z.coerce.number().int().positive();

/** Optional boolean from query (`true`/`1`/`yes`). */
export const zQueryBool = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((v) => {
    if (v === true || v === 'true' || v === '1' || v === 'yes') return true;
    return false;
  });

/**
 * @param {unknown} raw
 * @param {import('zod').ZodTypeAny} schema
 * @returns {{ ok: true, data: any } | { ok: false, error: import('zod').ZodError }}
 */
export function safeParse(schema, raw) {
  const result = schema.safeParse(raw);
  if (result.success) return { ok: true, data: result.data };
  return { ok: false, error: result.error };
}

/**
 * Parse JSON body with Zod. Returns Response on failure.
 * @param {Request} request
 * @param {import('zod').ZodTypeAny} schema
 * @returns {Promise<{ ok: true, data: any } | { ok: false, response: Response }>}
 */
export async function parseJsonBody(request, schema) {
  let raw;
  try {
    raw = await request.json();
  } catch {
    return { ok: false, response: apiError(request, ERR.INVALID_JSON, 400) };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, response: NextResponse.json({ errorCode: ERR.INVALID_DATA, error: validationSummary(request), fieldErrors: validationFields(parsed.error, localeFromRequest(request)) }, { status: 400 }) };
  }
  return { ok: true, data: parsed.data };
}

/**
 * Parse URL searchParams into plain object then Zod.
 * @param {Request} request
 * @param {import('zod').ZodTypeAny} schema
 * @returns {{ ok: true, data: any } | { ok: false, response: Response }}
 */
export function parseSearchParams(request, schema) {
  const url = new URL(request.url);
  const raw = Object.fromEntries(url.searchParams.entries());
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, response: NextResponse.json({ errorCode: ERR.INVALID_DATA, error: validationSummary(request), fieldErrors: validationFields(parsed.error, localeFromRequest(request)) }, { status: 400 }) };
  }
  return { ok: true, data: parsed.data };
}
