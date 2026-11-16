'use client';

import { useRef, useState } from 'react';
import { cn } from '../../lib/cn';
import { t } from '../../lib/i18n';
import { parseTagList } from '../../lib/tag-list';

/**
 * Visual tag/chip input — Enter or comma commits; chips are removable.
 * Value is always string[] (no commas shown between chips).
 */
export function TagInput({
  value = [],
  onChange,
  placeholder = '',
  disabled = false,
  locale = 'pt-BR',
  maxTags = 12,
  tagMax = 40,
  suggestions = [],
  required = false,
  'aria-label': ariaLabel,
  className,
}) {
  const [draft, setDraft] = useState('');
  const inputRef = useRef(null);
  const tags = Array.isArray(value) ? value : parseTagList(value);

  const removeLabel = t(locale, 'panel.common.remove');

  function commit(raw) {
    const nextParts = parseTagList(raw, { tagMax });
    if (!nextParts.length) {
      setDraft('');
      return;
    }
    const seen = new Set(tags.map((t) => t.toLowerCase()));
    const merged = [...tags];
    for (const t of nextParts) {
      if (merged.length >= maxTags) break;
      const key = t.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(t);
    }
    onChange?.(merged);
    setDraft('');
  }

  function removeAt(index) {
    onChange?.(tags.filter((_, i) => i !== index));
  }

  function onKeyDown(e) {
    if (disabled) return;
    if (e.key === 'Enter' || e.key === ',' || e.key === ';') {
      e.preventDefault();
      commit(draft);
      return;
    }
    if (e.key === 'Backspace' && !draft && tags.length) {
      e.preventDefault();
      removeAt(tags.length - 1);
    }
  }

  function onPaste(e) {
    const text = e.clipboardData?.getData('text');
    if (!text || !/[,;\n]/.test(text)) return;
    e.preventDefault();
    commit(`${draft}${text}`);
  }

  const suggestionPool = (suggestions || [])
    .map((s) => String(s || '').trim())
    .filter(Boolean)
    .filter((s) => !tags.some((t) => t.toLowerCase() === s.toLowerCase()))
    .slice(0, 8);

  return (
    <div className={cn('mt-1.5', className)} role="group" aria-required={required || undefined}>
      <div
        className={cn(
          'flex min-h-touch flex-wrap items-center gap-1.5 rounded-control border border-ink/12 bg-ink/[0.05] px-2 py-1.5',
          disabled && 'opacity-60'
        )}
        onClick={() => inputRef.current?.focus()}
      >
        {tags.map((tag, i) => (
          <span
            key={`${tag}-${i}`}
            className="inline-flex max-w-full items-center gap-1 rounded-control border border-ink/15 bg-surface px-2 py-0.5 font-mono text-xs text-ink"
          >
            <span className="truncate">{tag}</span>
            {!disabled ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  removeAt(i);
                }}
                className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-ink-muted hover:bg-ink/10 hover:text-danger"
                aria-label={`${removeLabel} ${tag}`}
                title={`${removeLabel} ${tag}`}
              >
                ×
              </button>
            ) : null}
          </span>
        ))}
        {!disabled && tags.length < maxTags ? (
          <input
            ref={inputRef}
            type="text"
            value={draft}
            disabled={disabled}
            placeholder={tags.length ? '' : placeholder}
            aria-label={ariaLabel}
            aria-required={required || undefined}
            maxLength={tagMax}
            onChange={(e) => setDraft(e.target.value.replace(/,/g, ''))}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            onBlur={() => {
              if (draft.trim()) commit(draft);
            }}
            className="min-w-[7rem] flex-1 border-0 bg-transparent py-1 font-ui text-prose text-ink outline-none placeholder:text-ink-faint"
          />
        ) : null}
      </div>
      {suggestionPool.length > 0 && !disabled ? (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {suggestionPool.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => commit(s)}
              className="rounded-control border border-dashed border-ink/20 bg-transparent px-2 py-0.5 font-mono text-2xs text-ink-muted hover:border-brand-500/40 hover:text-brand-600"
            >
              + {s}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Read-only chip list for tables / summaries.
 */
export function TagChips({ tags, empty = '—', className }) {
  const list = Array.isArray(tags) ? tags : parseTagList(tags);
  if (!list.length) {
    return <span className={cn('text-sm text-ink-muted', className)}>{empty}</span>;
  }
  return (
    <div className={cn('flex flex-wrap gap-1', className)}>
      {list.map((tag) => (
        <span
          key={tag}
          className="inline-flex rounded-control border border-ink/12 bg-canvas px-2 py-0.5 font-mono text-2xs text-ink-muted"
        >
          {tag}
        </span>
      ))}
    </div>
  );
}
