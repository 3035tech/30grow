'use client';

import { Children, Fragment, isValidElement, useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/cn';
import { fieldSelectClass } from './form-control-styles';

const MENU_GAP = 6;
const VIEWPORT_MARGIN = 8;
const MENU_MAX_HEIGHT = 280;
const TYPEAHEAD_RESET_MS = 700;

function optionList(children, group = '', groupDisabled = false) {
  return Children.toArray(children).flatMap((child) => {
    if (!isValidElement(child)) return [];
    if (child.type === Fragment) return optionList(child.props.children, group, groupDisabled);
    if (child.type === 'optgroup') return optionList(child.props.children, child.props.label, child.props.disabled);
    if (child.type !== 'option') return [];
    const label = Children.toArray(child.props.children).join('');
    return [{ value: String(child.props.value ?? label), label, accessibleLabel: child.props['aria-label'], group, disabled: Boolean(groupDisabled || child.props.disabled), hidden: Boolean(child.props.hidden) }];
  });
}

/**
 * Single selection with custom popup. The hidden native select only preserves
 * form submission, reset and the existing onChange event contract.
 * It never opens a browser menu. Multiple selection is intentionally unsupported.
 * `valueLabel` replaces the text on the closed trigger only; the list keeps the option labels.
 */
export function SelectField({
  children, value, defaultValue, onChange, onBlur, onFocus, onInvalid, onClick, onKeyDown, ref: forwardedRef,
  id, name, form, required, disabled, className, style, title, valueLabel,
  'aria-label': ariaLabel, 'aria-labelledby': labelledBy,
  'aria-describedby': describedBy, 'aria-invalid': ariaInvalid, ...rest
}) {
  const generatedId = useId();
  const listId = `${generatedId}-list`;
  const buttonRef = useRef(null);
  const nativeRef = useRef(null);
  const menuRef = useRef(null);
  useImperativeHandle(forwardedRef, () => buttonRef.current);
  const typeahead = useRef({ text: '', at: 0 });
  const options = optionList(children);
  const [localValue, setLocalValue] = useState(defaultValue);
  const selectedValue = value !== undefined ? value : localValue;
  const selected = options.find((option) => option.value === String(selectedValue))
    ?? options.find((option) => !option.disabled);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [position, setPosition] = useState(null);
  const available = options.map((option, index) => !option.disabled && !option.hidden ? index : -1).filter((index) => index >= 0);

  function show() {
    if (disabled || !available.length) return;
    const index = options.findIndex((option) => option === selected);
    setActive(available.includes(index) ? index : available[0]);
    setOpen(true);
  }

  function choose(index) {
    const option = options[index];
    if (!option || option.disabled || option.hidden || disabled) return;
    const select = nativeRef.current;
    setLocalValue(option.value);
    if (select.value !== option.value) {
      select.value = option.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    setOpen(false);
    buttonRef.current?.focus();
  }

  useEffect(() => {
    const select = nativeRef.current;
    const reset = () => { setLocalValue(defaultValue); setOpen(false); };
    select?.form?.addEventListener('reset', reset);
    return () => select?.form?.removeEventListener('reset', reset);
  }, [defaultValue]);

  useEffect(() => {
    if (!open) return undefined;
    function reposition() {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const below = window.innerHeight - rect.bottom - VIEWPORT_MARGIN;
      const above = rect.top - VIEWPORT_MARGIN;
      const upward = below < MENU_MAX_HEIGHT && above > below;
      setPosition({
        position: 'fixed',
        left: Math.max(VIEWPORT_MARGIN, Math.min(rect.left, window.innerWidth - rect.width - VIEWPORT_MARGIN)),
        width: 'max-content',
        minWidth: Math.min(rect.width, window.innerWidth - VIEWPORT_MARGIN * 2),
        maxWidth: window.innerWidth - VIEWPORT_MARGIN * 2,
        maxHeight: Math.max(0, Math.min(MENU_MAX_HEIGHT, (upward ? above : below) - MENU_GAP)),
        ...(upward ? { bottom: window.innerHeight - rect.top + MENU_GAP } : { top: rect.bottom + MENU_GAP }),
      });
    }
    function outside(event) {
      if (!buttonRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) setOpen(false);
    }
    reposition();
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    document.addEventListener('pointerdown', outside);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
      document.removeEventListener('pointerdown', outside);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !position || !menuRef.current) return;
    const width = menuRef.current.getBoundingClientRect().width;
    const left = Math.max(VIEWPORT_MARGIN, Math.min(buttonRef.current.getBoundingClientRect().left, window.innerWidth - width - VIEWPORT_MARGIN));
    if (left !== position.left) setPosition({ ...position, left });
  }, [open, position]);

  useEffect(() => {
    if (open) document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active, listId]);

  function keyboard(event) {
    if (event.key === 'Escape') {
      if (open) { event.preventDefault(); event.stopPropagation(); setOpen(false); }
      return;
    }
    if (event.key === 'Tab') { setOpen(false); return; }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (open) choose(active); else show();
      return;
    }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      if (!open) { show(); return; }
      const current = available.indexOf(active);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? available.length - 1
        : (current + (event.key === 'ArrowDown' ? 1 : -1) + available.length) % available.length;
      setActive(available[next] ?? -1);
      return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      const now = Date.now();
      const previous = now - typeahead.current.at < TYPEAHEAD_RESET_MS ? typeahead.current.text : '';
      const text = `${previous}${event.key}`.toLocaleLowerCase();
      typeahead.current = { text, at: now };
      const match = available.find((index) => options[index].label.toLocaleLowerCase().startsWith(text));
      if (!open) show();
      if (match !== undefined) setActive(match);
    }
  }

  const menu = open && !disabled && position ? (
    <ul ref={menuRef} id={listId} role="listbox" aria-label={ariaLabel} aria-labelledby={labelledBy || (!ariaLabel ? id || generatedId : undefined)}
      className="z-[10080] m-0 overflow-y-auto overscroll-contain rounded-control border border-ink/15 bg-surface p-1 shadow-menu [scrollbar-width:thin]"
      style={position}
      onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); }}
      onClick={(event) => event.stopPropagation()}>
      {options.map((option, index) => option.hidden ? null : (
        <li key={`${option.value}-${index}`} id={`${listId}-${index}`} role="option"
          aria-selected={selected?.value === option.value} aria-disabled={option.disabled}
          onPointerMove={() => { if (!option.disabled) setActive(index); }}
          onClick={() => choose(index)}
          aria-label={option.accessibleLabel || option.label}
          className={cn('flex min-h-touch cursor-pointer items-center justify-between gap-3 rounded-control px-3 py-2 font-ui text-prose',
            option.disabled ? 'cursor-default text-ink-faint' : active === index ? 'bg-brand-500/10 text-brand-700' : 'text-ink hover:bg-ink/[0.04]')}>
          <span className="min-w-0 whitespace-normal [overflow-wrap:anywhere]">{option.group ? <span className="mr-2 text-xs text-ink-muted">{option.group}:</span> : null}{option.label}</span>
          {selected?.value === option.value ? <span className="shrink-0" aria-hidden="true">✓</span> : null}
        </li>
      ))}
    </ul>
  ) : null;

  return <>
    <button {...rest} ref={buttonRef} id={id || generatedId} type="button" role="combobox"
      aria-label={ariaLabel} aria-labelledby={labelledBy} aria-describedby={describedBy}
      aria-invalid={ariaInvalid} aria-required={required || undefined}
      aria-expanded={open && !disabled} aria-controls={open ? listId : undefined}
      aria-haspopup="listbox" aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
      disabled={disabled} title={title} style={style} className={cn(fieldSelectClass, 'text-left', className)}
      onFocus={onFocus} onBlur={(event) => { setOpen(false); onBlur?.(event); }}
      onKeyDown={(event) => { onKeyDown?.(event); if (!event.defaultPrevented) keyboard(event); }}
      onClick={(event) => { onClick?.(event); if (!event.defaultPrevented) { if (open) setOpen(false); else show(); } }}>
      {valueLabel || selected?.label || '\u00a0'}
    </button>
    <select ref={nativeRef} hidden aria-hidden="true" tabIndex={-1} name={name} form={form}
      disabled={disabled} required={required} value={value} defaultValue={defaultValue}
      onChange={(event) => { setLocalValue(event.target.value); onChange?.(event); }}
      onInvalid={(event) => { event.preventDefault(); buttonRef.current?.focus(); show(); onInvalid?.(event); }}>
      {children}
    </select>
    {menu ? createPortal(menu, document.body) : null}
  </>;
}
