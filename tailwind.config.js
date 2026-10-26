/** @type {import('tailwindcss').Config} */
/**
 * Tailwind theme aligned to lib/theme.js + lib/marketing/brand.js.
 * Canvas / ink / brand / semantic colors use CSS vars so `.dark` on <html> remaps them
 * (see app/dark-mode.css). Grow identity is separate from semantic states.
 */
const { SHADOWS } = require('./lib/marketing/brand-tokens.cjs');
const uiFont = ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'];
module.exports = {
  darkMode: 'class',
  content: ['./app/**/*.{js,jsx}', './lib/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        canvas: {
          DEFAULT: 'rgb(var(--canvas) / <alpha-value>)',
          alt: 'rgb(var(--canvas-alt) / <alpha-value>)',
        },
        surface: 'rgb(var(--surface) / <alpha-value>)',
        ink: {
          DEFAULT: 'rgb(var(--ink) / <alpha-value>)',
          muted: 'rgb(var(--ink-secondary) / <alpha-value>)',
          faint: 'rgb(var(--ink-faint) / <alpha-value>)',
          label: 'rgb(var(--ink-label) / <alpha-value>)',
        },
        brand: {
          50: 'rgb(var(--brand-50) / <alpha-value>)',
          100: 'rgb(var(--brand-100) / <alpha-value>)',
          200: 'rgb(var(--brand-200) / <alpha-value>)',
          300: 'rgb(var(--brand-300) / <alpha-value>)',
          400: 'rgb(var(--brand-400) / <alpha-value>)',
          500: 'rgb(var(--brand-500) / <alpha-value>)',
          600: 'rgb(var(--brand-600) / <alpha-value>)',
          700: 'rgb(var(--brand-700) / <alpha-value>)',
          800: 'rgb(var(--brand-800) / <alpha-value>)',
          900: 'rgb(var(--brand-900) / <alpha-value>)',
          DEFAULT: 'rgb(var(--brand-500) / <alpha-value>)',
        },
        action: {DEFAULT: 'rgb(var(--action) / <alpha-value>)', hover: 'rgb(var(--action-hover) / <alpha-value>)', ink: 'rgb(var(--on-action) / <alpha-value>)'},
        line: 'rgb(var(--border) / <alpha-value>)',
        'input-line': 'rgb(var(--input-border) / <alpha-value>)',
        navy: 'rgb(var(--navy) / <alpha-value>)',
        teal: 'rgb(var(--teal) / <alpha-value>)',
        success: 'rgb(var(--success) / <alpha-value>)',
        danger: 'rgb(var(--danger) / <alpha-value>)',
        warning: 'rgb(var(--warning) / <alpha-value>)',
        info: 'rgb(var(--info) / <alpha-value>)',
        soft: 'rgb(var(--soft) / <alpha-value>)',
        pipeline: {
          new: 'rgb(var(--ink) / 0.5)',
          test: '#6366F1',
          screening: 'rgb(var(--info) / <alpha-value>)',
          interview: 'rgb(var(--warning) / <alpha-value>)',
          approved: 'rgb(var(--success) / <alpha-value>)',
          hired: '#0f766e',
          rejected: 'rgb(var(--danger) / <alpha-value>)',
          archived: 'rgb(var(--ink) / 0.3)',
        },
      },
      // Small brand-colored text needs a darker tone than decorative identity green.
      textColor: { brand: { 500: 'rgb(var(--brand-700) / <alpha-value>)', 600: 'rgb(var(--brand-700) / <alpha-value>)' } },
      fontFamily: {
        ui: [
          'Inter',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
        display: uiFont,
        // Labels/meta/dense CTAs: same Inter family (tabular numbers in globals.css). True code uses font-code.
        mono: uiFont,
        code: [
          'ui-monospace',
          'SF Mono',
          'Menlo',
          'Consolas',
          'Liberation Mono',
          'monospace',
        ],
      },
      /**
       * Type scale (dashboard + app chrome). Prefer these over text-[Npx].
       * Roles: font-ui body · font-mono labels/meta/CTAs · font-display page titles / marketing.
       * 2xs (11) labels/meta · xs (12) faint · prose (13) body muted · sm (14) · base (16) · …
       */
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }], // 11px
        prose: ['0.8125rem', { lineHeight: '1.375rem' }], // 13px
      },
      borderRadius: {
        card: '16px',
        control: '10px',
      },
      boxShadow: SHADOWS,
      minHeight: {
        touch: '40px',
      },
      minWidth: {
        touch: '40px',
      },
    },
  },
  plugins: [],
};
