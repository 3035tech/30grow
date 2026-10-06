'use client';

import { useEffect, useLayoutEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/cn';
import { t } from '../../lib/i18n';
import { fieldInputClass } from './form-control-styles';
import { SelectField } from './SelectField';
import { Icon } from './Icon';
import { S } from '../dashboard/dashboard-shared';

const CALENDAR_WIDTH = 336;
const VIEWPORT_MARGIN = 8;
const DAYS_IN_WEEK = 7;
const CALENDAR_CELLS = 42;
const pad = (n) => String(n).padStart(2, '0');
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localDay = (s) => { const [y, m, d] = s.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
function validDateKey(value) {
  const raw = String(value || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return '';
  const date = localDay(raw);
  return Number.isFinite(date.getTime()) && dayKey(date) === raw ? raw : '';
}

/** Custom calendar. Hidden input preserves ISO form values and native constraints,
 * without showing a browser picker. Escape cancels; selection returns focus. */
export function DateField({
  mode = 'date', value = '', onChange, id, name, className = '', disabled = false,
  required = false, min, max, step, placeholder, bare = false, locale: localeProp,
  'aria-label': ariaLabel, 'aria-describedby': describedBy, title,
}) {
  const uid = useId();
  const popupId = `${uid}-calendar`;
  const buttonRef = useRef(null);
  const inputRef = useRef(null);
  const popupRef = useRef(null);
  const [locale, setLocale] = useState(localeProp || 'pt-BR');
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [active, setActive] = useState('');
  const [month, setMonth] = useState('');
  const [position, setPosition] = useState(null);
  const [invalid, setInvalid] = useState(false);
  const withTime = mode === 'datetime-local';
  const inputType = withTime ? 'datetime-local' : 'date';
  const includeSeconds = withTime && (step === 'any' || (Number(step) > 0 && Number(step) < 60));
  const message = (key) => t(locale, `common.calendar.${key}`);

  useEffect(() => { setLocale(localeProp || document.documentElement.lang || 'pt-BR'); }, [localeProp]);
  useEffect(() => { setInvalid(false); }, [value]);

  function close() { setOpen(false); buttonRef.current?.focus(); }
  function show() {
    if (disabled) return;
    const date = validDateKey(value);
    const time = String(value || '').slice(10);
    let initial = date && withTime && /^T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?$/.test(time)
      ? `${date}${time}` : date || dayKey(new Date());
    if (min && initial.slice(0, 10) < min.slice(0, 10)) initial = min;
    if (max && initial.slice(0, 10) > max.slice(0, 10)) initial = max;
    setDraft(withTime ? (initial.includes('T') ? initial : `${initial}T00:00`) : initial);
    setActive(initial.slice(0, 10));
    setMonth(initial.slice(0, 7));
    setOpen(true);
  }

  function allowed(candidate) {
    const input = inputRef.current;
    const previous = input.value;
    input.value = candidate;
    const valid = input.validity.valid;
    input.value = previous;
    return valid;
  }

  function commit(next) {
    if (!allowed(next)) { setInvalid(true); return; }
    const input = inputRef.current;
    input.value = next;
    // onInput receives a real event/target, preserving existing field consumers.
    input.dispatchEvent(new Event('input', { bubbles: true }));
    setInvalid(false);
    close();
  }

  useLayoutEffect(() => {
    if (!open) return undefined;
    const reposition = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(CALENDAR_WIDTH, window.innerWidth - VIEWPORT_MARGIN * 2);
      const height = Math.min(popupRef.current?.offsetHeight || 440, window.innerHeight - VIEWPORT_MARGIN * 2);
      const next = {
        position: 'fixed', width,
        left: Math.max(VIEWPORT_MARGIN, Math.min(rect.left, window.innerWidth - width - VIEWPORT_MARGIN)),
        top: Math.max(VIEWPORT_MARGIN, Math.min(rect.bottom + VIEWPORT_MARGIN, window.innerHeight - height - VIEWPORT_MARGIN)),
        maxHeight: window.innerHeight - VIEWPORT_MARGIN * 2,
      };
      setPosition(previous => previous && Object.keys(next).every(key => previous[key] === next[key]) ? previous : next);
    };
    const outside = (event) => {
      if (!buttonRef.current?.contains(event.target) && !popupRef.current?.contains(event.target)) setOpen(false);
    };
    reposition();
    const frame = requestAnimationFrame(reposition);
    const observer = new ResizeObserver(reposition);
    if (popupRef.current) observer.observe(popupRef.current);
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open, withTime, Boolean(position)]);

  useEffect(() => {
    if (open && position) popupRef.current?.querySelector(`[data-day="${active}"]`)?.focus();
  }, [open, active, month, Boolean(position)]);

  function moveMonth(amount) {
    const date = localDay(`${month}-01`);
    date.setMonth(date.getMonth() + amount);
    const key = dayKey(date);
    setMonth(key.slice(0, 7));
    setActive(key);
  }

  function calendarKey(event) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (event.key === 'Tab') {
      const focusable = [...popupRef.current.querySelectorAll('button:not(:disabled), input:not(:disabled)')].filter(el => el.tabIndex >= 0);
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      return;
    }
    if (!event.target.dataset.day) return;
    const offsets = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -DAYS_IN_WEEK, ArrowDown: DAYS_IN_WEEK };
    if (event.key === 'PageUp' || event.key === 'PageDown') {
      event.preventDefault(); moveMonth(event.key === 'PageUp' ? -1 : 1); return;
    }
    let offset = offsets[event.key];
    const date = localDay(active);
    if (event.key === 'Home') offset = -date.getDay();
    if (event.key === 'End') offset = DAYS_IN_WEEK - 1 - date.getDay();
    if (offset === undefined) return;
    event.preventDefault();
    date.setDate(date.getDate() + offset);
    const key = dayKey(date);
    setActive(key); setMonth(key.slice(0, 7));
  }

  let display = placeholder || message('choose');
  const safeValue = withTime ? String(value || '') : validDateKey(value);
  if (safeValue) {
    const parsed = withTime ? new Date(safeValue) : localDay(safeValue);
    if (!Number.isNaN(parsed.getTime())) display = parsed.toLocaleString(locale, {
      day: '2-digit', month: '2-digit', year: 'numeric',
      ...(withTime ? { hour: '2-digit', minute: '2-digit', ...(includeSeconds ? { second: '2-digit' } : {}) } : {}),
    });
  }
  const first = month ? localDay(`${month}-01`) : new Date();
  const start = new Date(first); start.setDate(1 - first.getDay());
  const timeParts = (draft.split('T')[1] || '00:00:00').split(':');
  const timeValue = `${timeParts[0] || '00'}:${timeParts[1] || '00'}${includeSeconds ? `:${timeParts[2]?.split('.')[0] || '00'}` : ''}`;
  const popup = open && !disabled && position ? (
    <div ref={popupRef} id={popupId} role="dialog" aria-label={message('choose')}
      style={position} className="z-[10080] overflow-auto rounded-card border border-ink/15 bg-surface p-3 text-ink shadow-dialog"
      onClick={e => e.stopPropagation()} onKeyDown={calendarKey}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <button type="button" className={S.btnGhost} aria-label={message('previous')} onClick={() => moveMonth(-1)}>‹</button>
        <div className="text-center font-ui text-sm font-medium" aria-live="polite">
          {first.toLocaleDateString(locale, { month: 'long', year: 'numeric' })}
        </div>
        <button type="button" className={S.btnGhost} aria-label={message('next')} onClick={() => moveMonth(1)}>›</button>
      </div>
      <label className="mb-2 flex items-center justify-between gap-2 font-ui text-xs text-ink-muted">
        {message('year')}
        <input type="text" inputMode="numeric" aria-label={message('year')} key={month} defaultValue={first.getFullYear()}
          className={cn(fieldInputClass, 'w-24 text-center')}
          onBlur={e => { if (/^\d{4}$/.test(e.target.value) && Number(e.target.value) >= 1000) { const key = `${e.target.value}-${month.slice(5)}-01`; setMonth(key.slice(0, 7)); setActive(key); } else e.target.value = first.getFullYear(); }} />
      </label>
      <div className="grid grid-cols-7">
        {Array.from({ length: DAYS_IN_WEEK }, (_, n) => <span key={n} className="py-2 text-center font-ui text-xs text-ink-muted" aria-hidden="true">{new Date(2026, 0, 4 + n).toLocaleDateString(locale, { weekday: 'short' })}</span>)}
        {Array.from({ length: CALENDAR_CELLS }, (_, n) => {
          const date = new Date(start); date.setDate(start.getDate() + n);
          const key = dayKey(date);
          const unavailable = Boolean((min && key < min.slice(0, 10)) || (max && key > max.slice(0, 10)));
          return <button key={key} type="button" data-day={key} tabIndex={key === active ? 0 : -1}
            aria-label={date.toLocaleDateString(locale, { dateStyle: 'full' })} aria-disabled={unavailable}
            aria-pressed={draft.slice(0, 10) === key} aria-current={key === dayKey(new Date()) ? 'date' : undefined}
            className={cn('min-h-touch rounded-control font-ui text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500',
              unavailable ? 'cursor-not-allowed text-ink-faint' : draft.slice(0, 10) === key ? 'bg-action text-action-ink' : 'hover:bg-brand-500/10',
              key.slice(0, 7) !== month && 'opacity-50')}
            onClick={() => { if (unavailable) return; if (withTime) { setDraft(`${key}T${timeValue}`); setActive(key); setMonth(key.slice(0, 7)); } else commit(key); }}>
            {date.getDate()}
          </button>;
        })}
      </div>
      {withTime ? <div className="mt-3 flex items-end gap-2">
        {['hour', 'minute', ...(includeSeconds ? ['second'] : [])].map((part, index) => <label key={part} className="min-w-0 flex-1 font-ui text-xs text-ink-muted">{message(part)}
          <SelectField aria-label={message(part)} className="mt-1 w-full" value={timeValue.split(':')[index]}
            onChange={e => { const parts = timeValue.split(':'); parts[index] = e.target.value; setDraft(`${draft.slice(0, 10)}T${parts.join(':')}`); }}>
            {Array.from({ length: index === 0 ? 24 : 60 }, (_, n) => <option key={n} value={pad(n)}>{pad(n)}</option>)}
          </SelectField>
        </label>)}
      </div> : null}
      {invalid ? <p role="alert" className="mt-2 font-ui text-xs text-danger">{message('invalid')}</p> : null}
      <div className="mt-3 flex flex-wrap justify-end gap-2 border-t border-ink/10 pt-3">
        {!required ? <button type="button" className={S.btnGhost} onClick={() => commit('')}>{message('clear')}</button> : null}
        <button type="button" className={S.btnGhost} onClick={close}>{message('close')}</button>
        {withTime ? <button type="button" className={S.btnPrimary} onClick={() => commit(draft)}>{message('apply')}</button> : null}
      </div>
    </div>
  ) : null;

  return <>
    <button ref={buttonRef} type="button" id={id || uid} disabled={disabled} title={title}
      aria-label={ariaLabel} aria-describedby={describedBy} aria-haspopup="dialog"
      aria-expanded={open && !disabled} aria-controls={open ? popupId : undefined}
      aria-invalid={invalid || undefined} aria-required={required || undefined}
      onClick={() => open ? close() : show()}
      className={cn(bare ? 'ui-field min-h-touch border-none bg-transparent text-ink-muted' : fieldInputClass, 'w-full cursor-pointer text-left', className, 'inline-flex items-center justify-between gap-2')}>
      <span className={cn('min-w-0 truncate', !safeValue && 'text-ink-faint')}>{display}</span>
      <Icon name={withTime ? 'calendarClock' : 'calendar'} className="h-4 w-4 shrink-0 text-ink-muted" />
    </button>
    <input ref={inputRef} type={inputType} hidden tabIndex={-1} aria-hidden="true" name={name}
      value={value ?? ''} disabled={disabled} required={required} min={min} max={max} step={step}
      onChange={() => {}} onInput={onChange}
      onInvalid={e => { e.preventDefault(); setInvalid(true); buttonRef.current?.focus(); show(); }} />
    {popup ? createPortal(popup, document.body) : null}
  </>;
}
