'use client';

import { SelectField } from './SelectField';

import { useEffect, useRef } from 'react';
import { t } from '../../lib/i18n';
import { isRichTextEmpty } from '../../lib/sanitize-html';
import { C } from '../../lib/theme';
import { cn } from '../../lib/cn';

const FONT_SIZES = [
  { value: '12px', key: 'fontSizeSm' },
  { value: '14px', key: 'fontSizeMd' },
  { value: '16px', key: 'fontSizeLg' },
  { value: '18px', key: 'fontSizeXl' },
];

const toolbarBtnClass =
  'cursor-pointer rounded-md border border-ink/12 bg-ink/[0.04] px-2 py-1 font-mono text-2xs leading-tight text-ink';

function ToolbarButton({ label, title, onClick, className }) {
  return (
    <button
      type="button"
      title={title || label}
      onMouseDown={(e) => {
        e.preventDefault();
      }}
      onClick={onClick}
      className={cn(toolbarBtnClass, className)}
    >
      {label}
    </button>
  );
}

function ToolbarSelect({ value, onChange, title, children }) {
  return (
    <SelectField
      title={title}
      value={value}
      onMouseDown={(e) => e.stopPropagation()}
      onChange={(e) => onChange(e.target.value)}
      className="ui-select max-w-[110px] cursor-pointer rounded-md border border-ink/12 bg-ink/[0.04] !px-1.5 !py-1 !pr-6 font-mono text-2xs text-ink"
    >
      {children}
    </SelectField>
  );
}

/**
 * Editor rico leve para notas livres.
 * Valor em HTML; onChange recebe HTML.
 * Chrome (toolbar/shell) em Tailwind; body may keep minHeight style.
 */
export function RichTextEditor({
  value,
  onChange,
  placeholder,
  minHeight = 140,
  locale = 'pt-BR',
  disabled = false,
  'aria-label': ariaLabel,
}) {
  const ref = useRef(null);
  const lastHtml = useRef('');
  const ph = placeholder ?? t(locale, 'recruiting.interviewNotesPh');

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const next = value || '';
    // Sync from React value only when it changed vs last push.
    // Do not compare to el.innerHTML (browser normalizes markup and can skip real updates).
    if (next === lastHtml.current) return;
    el.innerHTML = next;
    lastHtml.current = next;
  }, [value]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.contentEditable = disabled ? 'false' : 'true';
  }, [disabled]);

  const pushHtml = () => {
    if (disabled) return;
    const html = ref.current?.innerHTML || '';
    lastHtml.current = html;
    onChange?.(html);
  };

  const run = (cmd, arg = null) => {
    if (disabled) return;
    ref.current?.focus();
    document.execCommand(cmd, false, arg);
    pushHtml();
  };

  const applyFontSize = (px) => {
    if (disabled || !px) return;
    ref.current?.focus();
    document.execCommand('styleWithCSS', false, true);
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      document.execCommand('fontSize', false, '3');
    } else {
      document.execCommand('fontSize', false, '7');
    }
    const root = ref.current;
    if (root) {
      root.querySelectorAll('font[size], span[style*="font-size"]').forEach((node) => {
        if (node.tagName === 'FONT') {
          const span = document.createElement('span');
          span.style.fontSize = px;
          while (node.firstChild) span.appendChild(node.firstChild);
          node.parentNode?.replaceChild(span, node);
        } else if (node.style?.fontSize) {
          node.style.fontSize = px;
        }
      });
    }
    pushHtml();
  };

  const emit = () => pushHtml();

  const onKeyDown = (e) => {
    if (disabled) return;
    if (e.key === 'Tab') {
      e.preventDefault();
      run(e.shiftKey ? 'outdent' : 'indent');
    }
  };

  const isEmpty = isRichTextEmpty(value);

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-control border border-ink/12 bg-white/85',
        disabled && 'opacity-70'
      )}
      aria-busy={disabled || undefined}
    >
      <div
        className={cn(
          'flex flex-wrap items-center gap-1.5 border-b border-ink/12 bg-ink/[0.04] p-2',
          disabled && 'pointer-events-none'
        )}
      >
        <ToolbarButton label="B" title={t(locale, 'editor.bold')} onClick={() => run('bold')} className="font-bold" />
        <ToolbarButton label="I" title={t(locale, 'editor.italic')} onClick={() => run('italic')} className="italic" />
        <ToolbarButton label="U" title={t(locale, 'editor.underline')} onClick={() => run('underline')} className="underline" />
        <ToolbarButton
          label="S"
          title={t(locale, 'editor.strike')}
          onClick={() => run('strikeThrough')}
          className="line-through"
        />
        <ToolbarSelect
          value=""
          title={t(locale, 'editor.fontSize')}
          onChange={(px) => applyFontSize(px)}
        >
          <option value="">{t(locale, 'editor.fontSize')}</option>
          {FONT_SIZES.map((s) => (
            <option key={s.value} value={s.value}>
              {t(locale, `editor.${s.key}`)}
            </option>
          ))}
        </ToolbarSelect>
        <ToolbarButton
          label={t(locale, 'editor.bulletLabel')}
          title={t(locale, 'editor.bulletList')}
          onClick={() => run('insertUnorderedList')}
        />
        <ToolbarButton
          label={t(locale, 'editor.numberedLabel')}
          title={t(locale, 'editor.numberedList')}
          onClick={() => run('insertOrderedList')}
        />
        <ToolbarButton label="⇥" title={t(locale, 'editor.indent')} onClick={() => run('indent')} />
        <ToolbarButton label="⇤" title={t(locale, 'editor.outdent')} onClick={() => run('outdent')} />
        <ToolbarButton label="H2" title={t(locale, 'editor.heading')} onClick={() => run('formatBlock', 'h2')} />
        <ToolbarButton label="¶" title={t(locale, 'editor.paragraph')} onClick={() => run('formatBlock', 'p')} />
        <ToolbarButton
          label={t(locale, 'editor.clear')}
          title={t(locale, 'editor.clearTitle')}
          onClick={() => run('removeFormat')}
        />
      </div>
      <div className="relative">
        {isEmpty ? (
          <span className="pointer-events-none absolute left-3.5 top-3 font-ui text-prose text-ink-muted">
            {ph}
          </span>
        ) : null}
        <div
          ref={ref}
          contentEditable={!disabled}
          role="textbox"
          aria-multiline="true"
          aria-disabled={disabled || undefined}
          aria-label={ariaLabel || ph}
          onInput={emit}
          onBlur={emit}
          onKeyDown={onKeyDown}
          className={cn(
            'rich-text-body px-3.5 py-3 font-ui text-base sm:text-sm leading-[1.55] text-ink outline-none',
            disabled ? 'cursor-wait' : 'cursor-text'
          )}
          style={{ minHeight }}
          suppressContentEditableWarning
        />
      </div>
      <style>{`
        .rich-text-body ul, .rich-text-view ul { margin: 0.35em 0; padding-left: 1.4em; list-style: disc; }
        .rich-text-body ol, .rich-text-view ol { margin: 0.35em 0; padding-left: 1.4em; list-style: decimal; }
        .rich-text-body li, .rich-text-view li { margin: 0.15em 0; }
        .rich-text-body h2, .rich-text-view h2 { font-size: 1.15em; margin: 0.5em 0 0.25em; font-weight: 600; }
        .rich-text-body p, .rich-text-view p { margin: 0.35em 0; }
        .rich-text-body blockquote, .rich-text-view blockquote { margin: 0.4em 0; padding-left: 0.8em; border-left: 3px solid ${C.border}; color: ${C.muted}; }
      `}</style>
    </div>
  );
}
