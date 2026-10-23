'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/cn';
import { S } from '../dashboard/dashboard-shared';

const LENGTH = 6;
const slots = value => Array.from({ length: LENGTH }, (_, index) => String(value || '')[index] || '');

/** Six accessible numeric positions; completion submits the exact newly entered code. */
export function VerificationCodeInput({ id, label, value, onChange, onComplete, disabled = false, invalid = false }) {
  const [digits, setDigits] = useState(() => slots(value));
  const inputs = useRef([]);
  const submitting = useRef(false);

  useEffect(() => {
    setDigits(current => current.join('') === value ? current : slots(value));
    if (!value) focus(0);
  }, [value]);

  function focus(index) {
    inputs.current[index]?.focus();
    inputs.current[index]?.select();
  }

  async function submit(code) {
    if (disabled || submitting.current || !/^\d{6}$/.test(code)) return;
    submitting.current = true;
    try { await onComplete(code); }
    finally { submitting.current = false; }
  }

  function update(next, nextFocus) {
    setDigits(next);
    const code = next.join('');
    onChange(code);
    if (nextFocus != null) focus(nextFocus);
    if (next.every(Boolean)) void submit(code);
  }

  function insert(raw, index) {
    const numbers = raw.replace(/\D/g, '').slice(0, LENGTH);
    if (!numbers) return;
    const start = numbers.length === LENGTH ? 0 : index;
    const next = [...digits];
    for (let offset = 0; offset < numbers.length && start + offset < LENGTH; offset++) next[start + offset] = numbers[offset];
    update(next, Math.min(start + numbers.length, LENGTH - 1));
  }

  return <div role="group" aria-label={label} className="flex w-full gap-2">
    {digits.map((digit, index) => <input
      key={index}
      ref={element => { inputs.current[index] = element; }}
      id={index === 0 ? id : `${id}-${index + 1}`}
      aria-label={`${label} ${index + 1} / ${LENGTH}`}
      aria-invalid={invalid || undefined}
      type="text"
      inputMode="numeric"
      autoComplete={index === 0 ? 'one-time-code' : 'off'}
      autoCapitalize="none"
      spellCheck={false}
      maxLength={LENGTH}
      disabled={disabled}
      value={digit}
      className={cn(S.input, 'min-h-touch min-w-0 flex-1 px-0 text-center text-xl font-semibold tabular-nums', invalid && 'border-danger')}
      onFocus={event => event.target.select()}
      onChange={event => {
        if (event.target.value) insert(event.target.value, index);
        else { const next = [...digits]; next[index] = ''; update(next); }
      }}
      onPaste={event => { event.preventDefault(); insert(event.clipboardData.getData('text'), index); }}
      onKeyDown={event => {
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        if (/^\d$/.test(event.key)) { event.preventDefault(); insert(event.key, index); }
        else if (event.key === 'Backspace' || event.key === 'Delete') {
          event.preventDefault();
          const target = event.key === 'Backspace' && !digits[index] ? Math.max(0, index - 1) : index;
          const next = [...digits]; next[target] = ''; update(next, target);
        } else if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
          event.preventDefault();
          focus(event.key === 'Home' ? 0 : event.key === 'End' ? LENGTH - 1 : Math.max(0, Math.min(LENGTH - 1, index + (event.key === 'ArrowLeft' ? -1 : 1))));
        } else if (event.key === 'Enter') { event.preventDefault(); void submit(digits.join('')); }
      }}
    />)}
  </div>;
}
