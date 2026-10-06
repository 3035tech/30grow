/**
 * Shared native form control classes (select / input / textarea / checkbox).
 * Pair with `.ui-select` / `.ui-checkbox` in `app/globals.css` for system look.
 * Prefer these (or `S.input` / `S.select`) over ad-hoc border classes.
 */

/** Chrome shared by text-like controls (no width — callers add `w-full` when needed). */
export const fieldControlChromeClass =
  'box-border min-h-touch rounded-control border border-input-line bg-surface px-3 py-2.5 font-ui text-base sm:text-sm text-ink transition-[border-color,background-color] duration-150 focus:border-brand-500 disabled:cursor-default disabled:opacity-55';

/** Text / password / number / date shell. */
export const fieldInputClass = `${fieldControlChromeClass} ui-field`;

/** Native `<select>` with custom chevron (`.ui-select`). Not full-width by default. */
export const fieldSelectClass = `${fieldControlChromeClass} ui-select cursor-pointer`;

/** Compact select (page-size, inline filters). */
export const fieldSelectCompactClass = `${fieldSelectClass} px-2.5 py-1.5`;

/** Full-width select for forms / dialogs. */
export const fieldSelectBlockClass = `${fieldSelectClass} w-full`;

/** Textarea. */
export const fieldTextareaClass = `${fieldControlChromeClass.replace('min-h-touch', 'min-h-[88px]')} ui-field w-full resize-y font-ui leading-relaxed`;

/** Checkbox with custom checkmark (`.ui-checkbox`). */
export const fieldCheckboxClass =
  'ui-checkbox mt-0.5 h-[18px] w-[18px] flex-shrink-0 cursor-pointer disabled:cursor-default disabled:opacity-55';
