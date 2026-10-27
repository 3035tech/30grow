/**
 * Shared logo limits (safe for client + server). Persistência/validação em company-logo.js.
 */

export const COMPANY_LOGO_MAX_BYTES = 512 * 1024;

/** Lado máximo do export (px). Logo não precisa de 4K. */
export const COMPANY_LOGO_MAX_EDGE = 768;

/** Aceite no input / MIME no servidor. Sem SVG. */
export const COMPANY_LOGO_MIME_TO_EXT = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

/** Arquivo de origem antes do crop (cliente). */
export const COMPANY_LOGO_SOURCE_MAX_BYTES = 20 * 1024 * 1024;

export const COMPANY_LOGO_ACCEPT = 'image/png,image/jpeg,image/webp';
