import tokens from './brand-tokens.cjs';
const { GROW, GREEN } = tokens;
/**
 * 30Grow brand assets and logo-derived color references.
 * Vector master: public/brand/logo-symbol.svg (30 + integrated growth arrow).
 */

/** Bump when icon files change: browsers cache favicons by URL and ignore normal reloads. */
export const BRAND_ICON_VERSION = '2026-09-29';
export const versionedIcon = (path) => `${path}?v=${BRAND_ICON_VERSION}`;

/** Paths under /public */
export const BRAND_ASSETS = {
  mark: '/brand/logo-symbol.svg',
  markDark: '/brand/logo-symbol-dark.svg',
  wordmark: '/brand/logo-wordmark.svg',
  wordmarkDark: '/brand/logo-wordmark-dark.svg',
  s16: '/brand/logo-16.png',
  s32: '/brand/logo-32.png',
  s64: '/brand/logo-64.png',
  s128: '/brand/logo-128.png',
  s192: '/brand/logo-192.png',
  s256: '/brand/logo-256.png',
  s512: '/brand/logo-512.png',
  favicon: '/favicon.ico',
};

/**
 * Legacy palette aliases retained for consumers; all colors follow the Grow identity.
 * Prefer these when building brand UI moments; keep C.purple for product chrome.
 */
export const LOGO = {
  figure: GROW.navy,
  petalDeep: GREEN[800], petalMid: GREEN[500], petalBright: GREEN[400],
  petalSoft: GREEN[300], petalLavender: GREEN[200],
  canvas: GROW.background, primary: GROW.primary, primaryDeep: GROW.action,
  primarySoft: GREEN[200],
};

export function brandMarkSrc(size = 64) {
  if (size <= 16) return BRAND_ASSETS.s16;
  if (size <= 32) return BRAND_ASSETS.s32;
  if (size <= 64) return BRAND_ASSETS.s64;
  if (size <= 128) return BRAND_ASSETS.s128;
  if (size <= 192) return BRAND_ASSETS.s192;
  if (size <= 256) return BRAND_ASSETS.s256;
  return BRAND_ASSETS.s512;
}
