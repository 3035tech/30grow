/**
 * 30Grow design tokens — brand, surfaces, and semantic status colors.
 *
 * Rules:
 * - Grow green is for identity / CTA / focus — not for pipeline or "neutral" status.
 * - Semantic tokens (success, danger, warning, info, neutral) are for meaning.
 * - synergy / tension remain aliases for compatibility UI (legacy callers).
 * - Logo mark + LOGO palette: see lib/marketing/brand.js (30 + growth arrow).
 */

import tokens from './marketing/brand-tokens.cjs';
const { GROW, GREEN, FONT_UI, SHADOWS } = tokens;

export { BRAND_ASSETS, LOGO, brandMarkSrc } from './marketing/brand.js';

/** Grow scale. Solid actions use the separate accessible action token. */
export const BRAND = GREEN;
/** @deprecated Compatibility alias. Use BRAND for new code. */
export const PURPLE = GREEN;

export const C = {
  // Surfaces — off-white canvas, white cards; color reserved for selection / brand moments
  bg: GROW.background,
  surface: '#ffffff',
  card: '#ffffff',
  /** Soft brand wash — selection / brand moments only (not default card fill) */
  cardTint: 'rgba(34,197,94,0.04)',
  border: GROW.border,

  // Brand (logo-aligned)
  purple: GROW.action,
  purpleSoft: PURPLE[400],
  /** @deprecated use purpleDeep — historically misnamed (darker than purple) */
  purpleLight: PURPLE[600],
  purpleDeep: PURPLE[600],
  purpleDark: PURPLE[800],

  // Text (navy/slate, high contrast on white)
  text: GROW.navy,
  muted: GROW.textSecondary,
  faint: GROW.textSecondary,
  inputBg: GROW.surface,
  sectionLabel: GROW.textSecondary,

  // Semantic status (do not reuse identity green here)
  success: '#15803d',
  danger: '#dc2626',
  warning: '#d97706',
  info: '#0284c7',
  /** Semantic slate — compatibility "neutral", muted chrome */
  neutral: '#64748B',

  // Compatibility aliases
  synergy: '#15803d',
  tension: '#dc2626',
};

/**
 * Pipeline stage colors — identity green intentionally excluded.
 * test_completed uses slate-indigo so it does not read as a CTA.
 * Use getPipelineStageColor(id, { isDark }) for kanban/pills on dark surfaces.
 */
export const PIPELINE_STAGE_COLORS = {
  new: 'rgba(17,24,39,.5)',
  test_completed: '#6366F1',
  screening: C.info,
  interview: C.warning,
  approved: C.success,
  hired: '#0f766e',
  rejected: C.danger,
  archived: 'rgba(17,24,39,.3)',
};

/** Brighter / higher-contrast pipeline hues for `.dark` kanban headers & pills. */
export const PIPELINE_STAGE_COLORS_DARK = {
  new: 'rgba(242,239,247,.72)',
  test_completed: '#A5B4FC',
  screening: '#38BDF8',
  interview: '#FBBF24',
  approved: '#4ADE80',
  hired: '#2DD4BF',
  rejected: '#F87171',
  archived: 'rgba(242,239,247,.42)',
};

/**
 * @param {string} stageId
 * @param {{ isDark?: boolean }} [opts]
 */
export function getPipelineStageColor(stageId, opts = {}) {
  const map = opts.isDark ? PIPELINE_STAGE_COLORS_DARK : PIPELINE_STAGE_COLORS;
  return map[stageId] || map.new || PIPELINE_STAGE_COLORS.new;
}

export const FONTS = {
  ui: FONT_UI, serif: FONT_UI, display: FONT_UI, mono: FONT_UI,
  code: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
};

/**
 * Tailwind type scale (see `tailwind.config.js` fontSize + `font-ui` / `font-mono` / `font-display`).
 * Prefer classes over hex fontSize in style={{}}.
 *
 * | Token        | Size | Use |
 * |--------------|------|-----|
 * | `text-2xs`   | 11px | Labels, table headers, meta chips (`S.label`) |
 * | `text-xs`    | 12px | Faint secondary (`S.faint`, card muted) |
 * | `text-prose` | 13px | Body muted, primary CTA (`S.muted`, `S.btnPrimary`) |
 * | `text-sm`    | 14px | Card body / row titles |
 * | `text-base+` | 16px+| Page titles (often with `font-display`) |
 */

/** Prefer Tailwind `shadow-card` / `shadow-dialog` / `shadow-toast` in JSX. */
export const SHADOW = {cardElevated: SHADOWS.card, dialog: SHADOWS.dialog, toast: SHADOWS.toast};

/**
 * Inline styles for T1–T9 chips (TypeBadge). Dark needs a stronger wash so hex stays readable.
 * Pair with class `ui-type-badge` (saturate/brightness in dark-mode.css).
 */
export function typeChipSurfaceStyle(hex, { isDark = false } = {}) {
  const c = String(hex || '').trim();
  if (!c) return {};
  return {
    background: `${c}${isDark ? '40' : '18'}`,
    border: `1px solid ${c}${isDark ? 'b0' : '44'}`,
    // Raw hex text fails WCAG AA for light hues (T7 yellow ~1.5:1); keep the hue, shift lightness.
    color: isDark ? `color-mix(in srgb, ${c} 70%, white)` : `color-mix(in srgb, ${c} 55%, black)`,
  };
}

/**
 * Compare heat cell (score bubble). Avoids dark-on-dark text when isDark.
 */
export function typeScoreCellStyle(hex, { isTop = false, pct = 0, isDark = false, borderFallback = C.border } = {}) {
  const c = String(hex || '').trim();
  if (!c) return {};
  const alpha = Math.max(isDark ? 48 : 20, Math.round(Number(pct) * (isDark ? 2.1 : 1.5)));
  const alphaHex = Math.min(255, alpha).toString(16).padStart(2, '0');
  return {
    background: isTop ? c : `${c}${alphaHex}`,
    border: isTop ? `2px solid ${c}` : `1px solid ${borderFallback}`,
    boxShadow: isTop ? `0 0 0 2px ${c}55` : 'none',
    color: isTop ? '#fff' : isDark ? 'rgba(248,246,252,0.9)' : 'rgba(17,24,39,0.72)',
    fontWeight: isTop ? 600 : 400,
  };
}
