import {
  fieldCheckboxClass,
  fieldInputClass,
  fieldSelectBlockClass,
  fieldTextareaClass,
} from './form-control-styles';

/** Shared overlay / card class strings for in-app dialogs (confirm, notice, prompt). */
export const dialogOverlayClass =
  'fixed inset-0 z-[10060] box-border flex items-center justify-center bg-ink/45 p-6';

/** Above prompt/confirm — e.g. logo crop stacked on company form. */
export const dialogOverlayElevatedClass =
  'fixed inset-0 z-[10070] box-border flex items-center justify-center bg-ink/45 p-6';

export const dialogCardClass =
  'w-full max-w-[420px] rounded-card border border-ink/12 bg-surface px-6 py-6 shadow-dialog';

/** Same action tokens as `S.btnPrimary` (dashboard-shared). */
export const dialogBtnPrimaryClass =
  'min-h-touch cursor-pointer rounded-control border-none bg-action px-5 py-2.5 font-ui text-sm font-medium text-action-ink transition-colors hover:bg-action-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:ring-offset-2 disabled:cursor-default disabled:opacity-55';

/** Solid button without fill, for destructive confirms: pair with `bg-danger`. */
export const dialogBtnSolidClass =
  'min-h-touch cursor-pointer rounded-control border-none px-5 py-2.5 font-ui text-sm font-medium text-white';

export const dialogBtnGhostClass =
  'min-h-touch cursor-pointer rounded-control border border-ink/12 bg-transparent px-5 py-2.5 font-ui text-sm font-medium text-ink-muted';

/** Text / password / number in dialogs. */
export const dialogFieldClass = `mt-1.5 w-full ${fieldInputClass}`;

/** Custom select trigger in dialogs. */
export const dialogSelectClass = `mt-1.5 ${fieldSelectBlockClass}`;

/** Textarea in dialogs. */
export const dialogTextareaClass = `mt-1.5 ${fieldTextareaClass}`;

export const dialogCheckboxClass = fieldCheckboxClass;
