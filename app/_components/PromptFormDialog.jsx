'use client';

import { SelectField } from './SelectField';

import { Fragment, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../../lib/i18n';
import { cn } from '../../lib/cn';
import {
  dialogBtnGhostClass,
  dialogBtnPrimaryClass,
  dialogCardClass,
  dialogCheckboxClass,
  dialogFieldClass,
  dialogOverlayClass,
  dialogSelectClass,
  dialogTextareaClass,
} from './app-dialog-styles';
import { RichTextEditor } from './RichTextEditor';
import { DateField } from './DateField';
import { RangeField } from './RangeField';
import { TagInput } from './TagInput';
import { EntitySearchSelect } from './EntitySearchSelect';
import { parseTagList } from '../../lib/tag-list';
import { CompanyLogoCropDialog } from './CompanyLogoCropDialog';
import { FormField } from './FormField';
import { DialogCloseButton } from './DialogCloseButton';
import { COMPANY_LOGO_ACCEPT } from '../../lib/company-logo-limits';
import { digitsOnly, formatSalaryDisplay, formatCepBr, formatCpfBr, formatPhoneBr, stripCep, stripCpf, stripPhone } from '../../lib/br-masks';

/**
 * Multi-field form dialog (replaces window.prompt chains).
 * fields: [{
 *   key (or legacy name), label, defaultValue? (or legacy value?),
 *   type?: 'text'|'password'|'textarea'|'richText'|'tags'|'entitySearch'|'select'|'boolean'|'checkboxGroup'|'imageUpload'|'file'|'date'|'datetime-local'|'number'|'range'|'salary'|'cep'|'cpf'|'phone',
 *   options?: [{value,label}],
 *   suggestions?: string[], // tags
 *   maxTags?: number, tagMax?: number, // tags
 *   searchUrl?: string, minChars?: number, // entitySearch — stores id string
 *   showWhen?: (values) => boolean,
 *   disabledWhen?: (values) => boolean,
 *   whenTrue?: object, whenFalse?: object, // boolean: merge into values on toggle
 *   placeholder?: string,
 *   help?: string,
 *   required?: boolean,
 *   rows?: number,
 *   maxLength?: number, // textarea
 *   minHeight?: number, // richText
 *   min?: string, max?: string, // date / datetime-local
 *   row?: string, // same key → side-by-side on one row (e.g. start/end dates)
 *   width?: 'half', // short control alone on its row: half width from sm up
 *   rowWeight?: number, // relative width inside a `row` from sm up (default 1)
 *   section?: string, // group heading rendered above this field
 *   // cep autofill (keys of other fields in the same form):
 *   cepAutofill?: { addressLine?: string, addressCity?: string, addressState?: string, neighborhoodAppend?: boolean },
 *   // imageUpload:
 *   uploadUrl?: string,
 *   storageConfigured?: boolean,
 *   accept?: string,
 *   uploadLabel?: string,
 *   removeLabel?: string,
 *   uploadingLabel?: string,
 *   storageOffHelp?: string,
 * }]
 */
function fieldInitial(f) {
  return f.defaultValue !== undefined ? f.defaultValue : f.value;
}
function fieldKeyOf(f) {
  return f?.key || f?.name || '';
}

function fieldIsDisabled(f, values) {
  if (typeof f?.disabledWhen === 'function') {
    try {
      return Boolean(f.disabledWhen(values));
    } catch {
      return false;
    }
  }
  return Boolean(f?.disabled);
}

function fieldHasValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'boolean') return value;
  if (value && typeof value === 'object') {
    return Boolean(value.file || String(value.url || '').trim());
  }
  return String(value ?? '').trim().length > 0;
}

/** Consecutive fields sharing `row` render in a 2-col grid. */
function groupFieldsByRow(fields) {
  const groups = [];
  for (const f of fields) {
    const row = f.row != null && String(f.row).trim() ? String(f.row) : '';
    const last = groups[groups.length - 1];
    if (row && last && last.row === row) {
      last.fields.push(f);
      continue;
    }
    groups.push({ row: row || null, fields: [f] });
  }
  return groups;
}

export function PromptFormDialog({
  open,
  title,
  message,
  fields = [],
  locale = 'pt-BR',
  confirmLabel,
  cancelLabel,
  onSubmit,
  onCancel,
  size,
}) {
  const [mounted, setMounted] = useState(false);
  const [values, setValues] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [uploadBusyKey, setUploadBusyKey] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [cropTarget, setCropTarget] = useState(null); // { field, file }
  const [cepBusyKey, setCepBusyKey] = useState('');
  const [cepHint, setCepHint] = useState('');
  const dialogRef = useRef(null);
  const submitLockRef = useRef(false);
  const blobUrlsRef = useRef([]);
  const cepLookupRef = useRef(0);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    setCropTarget(null);
    setCepBusyKey('');
    setCepHint('');
    const init = {};
    for (const f of fields) {
      const fieldKey = fieldKeyOf(f);
      if (!fieldKey) continue;
      const initial = fieldInitial(f);
      if (f.type === 'checkboxGroup') {
        init[fieldKey] = Array.isArray(initial) ? [...initial] : [];
      } else if (f.type === 'tags') {
        init[fieldKey] = Array.isArray(initial) ? [...initial] : parseTagList(initial);
      } else if (f.type === 'boolean') {
        init[fieldKey] = initial === true || initial === 'true';
      } else if (f.type === 'imageUpload') {
        init[fieldKey] = {
          url: initial ? String(initial) : '',
          file: null,
          removed: false,
        };
      } else if (f.type === 'file') {
        init[fieldKey] = null;
      } else if (f.type === 'cep') {
        init[fieldKey] = formatCepBr(initial || '');
      } else if (f.type === 'cpf') {
        init[fieldKey] = formatCpfBr(initial || '');
      } else if (f.type === 'phone') {
        init[fieldKey] = formatPhoneBr(initial || '');
      } else {
        init[fieldKey] = initial != null ? String(initial) : '';
      }
    }
    submitLockRef.current = false;
    setSubmitting(false);
    setSubmitError('');
    setFieldErrors({});
    setValues(init);
    setUploadBusyKey('');
    setUploadError('');
    // Reset only when opening; callers pass a fresh fields array per open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape' && !e.defaultPrevented && !submitLockRef.current) onCancel?.();
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
      for (const u of blobUrlsRef.current) {
        try {
          URL.revokeObjectURL(u);
        } catch {
          /* ignore */
        }
      }
      blobUrlsRef.current = [];
    };
  }, [open, onCancel]);

  useEffect(() => {
    if (!open || !mounted) return undefined;
    const previous = document.activeElement;
    const frame = requestAnimationFrame(() => {
      const root = dialogRef.current;
      (root?.querySelector('input:not([hidden]):not(:disabled), textarea:not(:disabled)')
        || root?.querySelector('fieldset button:not(:disabled), button[type="submit"]:not(:disabled)'))?.focus();
    });
    return () => { cancelAnimationFrame(frame); if (previous?.isConnected) previous.focus(); };
  }, [open, mounted]);

  if (!mounted || !open) return null;

  const heading = title || t(locale, 'panel.common.editTitle');
  const hasWideFields = fields.some(
    (f) => f.type === 'richText' || f.type === 'tags' || f.type === 'entitySearch'
  );

  const toggleCheck = (key, value) => {
    setValues((prev) => {
      const cur = Array.isArray(prev[key]) ? prev[key] : [];
      const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
      return { ...prev, [key]: next };
    });
  };

  const setField = (key, value) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setFieldErrors({});
    setSubmitError('');
  };

  const applyCepLookup = async (fk, digits, autofill) => {
    if (!autofill || digits.length !== 8) return;
    const token = ++cepLookupRef.current;
    setCepBusyKey(fk);
    setCepHint('');
    try {
      const res = await fetch(`/api/public/br-cep?cep=${encodeURIComponent(digits)}`);
      const data = await res.json().catch(() => ({}));
      if (token !== cepLookupRef.current) return;
      if (!res.ok || !data?.ok) {
        setCepHint(
          data?.error ||
            t(locale, res.status === 404 ? 'errors.CEP_NOT_FOUND' : 'errors.CEP_LOOKUP_FAILED')
        );
        return;
      }
      setValues((prev) => {
        const next = { ...prev, [fk]: formatCepBr(digits) };
        if (autofill.addressLine) {
          const street = String(data.street || '').trim();
          const neighborhood = String(data.neighborhood || '').trim();
          const line =
            autofill.neighborhoodAppend !== false && street && neighborhood
              ? `${street}, ${neighborhood}`
              : street || prev[autofill.addressLine] || '';
          if (line) next[autofill.addressLine] = line.slice(0, 240);
        }
        if (autofill.addressCity && data.city) {
          next[autofill.addressCity] = String(data.city).slice(0, 120);
        }
        if (autofill.addressState && data.state) {
          next[autofill.addressState] = String(data.state).toUpperCase().slice(0, 2);
        }
        return next;
      });
      setCepHint(t(locale, 'panel.dp.cepFound'));
    } catch {
      if (token === cepLookupRef.current) {
        setCepHint(t(locale, 'errors.CEP_LOOKUP_FAILED'));
      }
    } finally {
      if (token === cepLookupRef.current) setCepBusyKey('');
    }
  };

  const visibleFields = fields.filter((f) => {
    if (typeof f.showWhen !== 'function') return true;
    try {
      return Boolean(f.showWhen(values));
    } catch {
      return true;
    }
  });
  const fieldGroups = groupFieldsByRow(visibleFields);
  const missingRequired = visibleFields.some((f) => {
    if (!f.required || fieldIsDisabled(f, values)) return false;
    return !fieldHasValue(values[fieldKeyOf(f)]);
  });

  const renderFieldBlock = (f, inRow = false) => {
    if (f.type === 'boolean') {
      return (
        <div key={fieldKeyOf(f)} className="block min-w-0">
          {renderControl(f)}
          {f.help ? (
            <p className="ml-7 mt-1.5 mb-0 text-xs leading-[1.45] text-ink-muted">{f.help}</p>
          ) : null}
        </div>
      );
    }
    return (
      <FormField
        key={fieldKeyOf(f)}
        as={f.type === 'imageUpload' || f.type === 'file' || f.type === 'richText' || f.type === 'date' || f.type === 'datetime-local' || f.type === 'tags' || f.type === 'entitySearch' || f.type === 'checkboxGroup' || f.type === 'range' ? 'div' : 'label'}
        label={f.label}
        hint={
          f.type === 'cep' && cepBusyKey === fieldKeyOf(f)
            ? t(locale, 'panel.dp.cepLooking')
            : f.type === 'cep' && cepHint
              ? cepHint
              : f.help || null
        }
        className={cn('w-full', f.width === 'half' && !inRow && 'sm:max-w-[calc(50%-0.625rem)]')}
      >
        {renderControl(f)}
        {fieldErrors[fieldKeyOf(f)] ? <p id={`prompt-error-${fieldKeyOf(f)}`} role="alert" className="m-0 mt-1 text-sm text-danger">{fieldErrors[fieldKeyOf(f)]}</p> : null}
      </FormField>
    );
  };

  const onImageFile = async (f, file) => {
    if (!file) return;
    const fk = fieldKeyOf(f);
    setUploadError('');
    if (f.uploadUrl && f.storageConfigured !== false) {
      setUploadBusyKey(fk);
      try {
        const fd = new FormData();
        fd.append('file', file);
        const res = await fetch(f.uploadUrl, { method: 'POST', body: fd });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || t(locale, 'panel.common.error'));
        setField(fk, { url: data.logoUrl || data.url || '', file: null, removed: false });
      } catch (e) {
        setUploadError(e?.message || t(locale, 'panel.common.error'));
      } finally {
        setUploadBusyKey('');
      }
      return;
    }
    const localUrl = URL.createObjectURL(file);
    blobUrlsRef.current.push(localUrl);
    setField(fk, { url: localUrl, file, removed: false });
  };

  const onImageRemove = async (f) => {
    const fk = fieldKeyOf(f);
    setUploadError('');
    if (f.uploadUrl && f.storageConfigured !== false) {
      setUploadBusyKey(fk);
      try {
        const res = await fetch(f.uploadUrl, { method: 'DELETE' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || t(locale, 'panel.common.error'));
        setField(fk, { url: '', file: null, removed: true });
      } catch (e) {
        setUploadError(e?.message || t(locale, 'panel.common.error'));
      } finally {
        setUploadBusyKey('');
      }
      return;
    }
    setField(fk, { url: '', file: null, removed: true });
  };

  const renderControl = (f) => {
    const fk = fieldKeyOf(f);
    const disabled = fieldIsDisabled(f, values);
    if (f.type === 'imageUpload') {
      const cur = values[fk] && typeof values[fk] === 'object' ? values[fk] : { url: '', file: null };
      const preview = String(cur.url || '').trim();
      const busy = uploadBusyKey === fk;
      const off = f.storageConfigured === false;
      return (
        <div className="mt-1.5">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex h-[72px] w-[72px] flex-shrink-0 items-center justify-center overflow-hidden rounded-xl border border-ink/12 bg-ink/[0.03]">
              {preview ? (
                <img src={preview} alt="" width={72} height={72} className="object-contain" />
              ) : (
                <span className="font-mono text-2xs text-ink-faint">—</span>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <label
                className={cn(
                  dialogBtnGhostClass,
                  'm-0 inline-flex min-h-touch items-center justify-center px-3 py-2',
                  off || busy ? 'cursor-not-allowed opacity-55' : 'cursor-pointer'
                )}
              >
                <input
                  type="file"
                  accept={f.accept || COMPANY_LOGO_ACCEPT}
                  disabled={off || busy}
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (file) setCropTarget({ field: f, file });
                  }}
                />
                {busy
                  ? f.uploadingLabel || t(locale, 'common.loading')
                  : f.uploadLabel || t(locale, 'panel.admin.companyLogoChoose')}
              </label>
              {preview ? (
                <button
                  type="button"
                  disabled={off || busy}
                  onClick={() => void onImageRemove(f)}
                  className={cn(dialogBtnGhostClass, 'min-h-touch', (off || busy) && 'opacity-55')}
                >
                  {f.removeLabel || t(locale, 'panel.admin.companyLogoRemove')}
                </button>
              ) : null}
            </div>
          </div>
          {off && f.storageOffHelp ? (
            <p className="mb-0 mt-2 text-xs leading-[1.45] text-ink-muted">
              {f.storageOffHelp}
            </p>
          ) : null}
          {uploadError ? (
            <p className="mb-0 mt-2 text-xs leading-[1.45] text-danger">
              {uploadError}
            </p>
          ) : null}
        </div>
      );
    }

    if (f.type === 'file') {
      const file = typeof File !== 'undefined' && values[fk] instanceof File ? values[fk] : null;
      return (
        <label
          className={cn(
            dialogBtnGhostClass,
            'm-0 inline-flex min-h-touch w-full cursor-pointer items-center justify-center px-3 py-2',
            disabled && 'cursor-not-allowed opacity-55'
          )}
        >
          <input
            type="file"
            accept={f.accept}
            disabled={disabled}
            className="hidden"
            onChange={(event) => setField(fk, event.target.files?.[0] || null)}
          />
          {file?.name || f.uploadLabel || t(locale, 'panel.common.chooseFile')}
        </label>
      );
    }

    if (f.type === 'checkboxGroup') {
      return (
        <div
          role="group"
          aria-label={f.label}
          className="prompt-checkbox-grid mt-2 grid max-h-[220px] grid-cols-2 gap-x-3 gap-y-2 overflow-y-auto rounded-control border border-ink/12 bg-ink/[0.03] px-3 py-2.5"
        >
          {(f.options || []).map((opt) => {
            const checked = Array.isArray(values[fk]) && values[fk].includes(opt.value);
            return (
              <label
                key={opt.value}
                className="flex cursor-pointer items-center gap-2 font-ui text-sm text-ink"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleCheck(fk, opt.value)}
                  className={dialogCheckboxClass}
                />
                {opt.label}
              </label>
            );
          })}
        </div>
      );
    }

    if (f.type === 'select') {
      return (
        <SelectField
          value={values[fk] ?? ''}
          onChange={(e) => setField(fk, e.target.value)}
          disabled={Boolean(f.disabled)}
          required={Boolean(f.required)}
          aria-required={Boolean(f.required)}
          className={cn(dialogSelectClass, f.disabled && 'cursor-default opacity-60')}
        >
          {(f.options || []).map((opt) => (
            <option key={String(opt.value)} value={String(opt.value)}>
              {opt.label}
            </option>
          ))}
        </SelectField>
      );
    }

    if (f.type === 'boolean') {
      const checked = values[fk] === true || values[fk] === 'true';
      return (
        <label
          className={cn(
            'flex cursor-pointer items-start gap-2.5 font-ui text-sm leading-[1.45] text-ink',
            !f.help && 'mt-1'
          )}
        >
          <input
            type="checkbox"
            checked={checked}
            disabled={disabled}
            onChange={(e) => {
              const nextChecked = e.target.checked;
              setValues((prev) => {
                const next = { ...prev, [fk]: nextChecked };
                const patch = nextChecked ? f.whenTrue : f.whenFalse;
                if (patch && typeof patch === 'object') Object.assign(next, patch);
                return next;
              });
            }}
            className={dialogCheckboxClass}
          />
          <span>{f.label}</span>
        </label>
      );
    }

    if (f.type === 'richText') {
      return (
        <div className="mt-1.5">
          <RichTextEditor
            value={values[fk] ?? ''}
            onChange={(html) => setField(fk, html)}
            placeholder={f.placeholder || ''}
            minHeight={f.minHeight || 100}
            locale={locale}
            aria-label={f.label}
          />
        </div>
      );
    }

    if (f.type === 'tags') {
      return (
        <TagInput
          value={Array.isArray(values[fk]) ? values[fk] : []}
          onChange={(next) => setField(fk, next)}
          placeholder={f.placeholder || ''}
          locale={locale}
          maxTags={f.maxTags || 12}
          tagMax={f.tagMax || 40}
          suggestions={f.suggestions || []}
          aria-label={f.label}
          disabled={Boolean(f.disabled)}
        />
      );
    }

    if (f.type === 'entitySearch') {
      return (
        <EntitySearchSelect
          value={values[fk] ?? ''}
          onChange={(id) => setField(fk, id)}
          searchUrl={f.searchUrl}
          initialSelection={f.initialSelection}
          locale={locale}
          placeholder={f.placeholder || ''}
          minChars={f.minChars != null ? f.minChars : 1}
          aria-label={f.label}
          disabled={Boolean(f.disabled)}
        />
      );
    }

    if (f.type === 'textarea') {
      return (
        <textarea
          value={values[fk] ?? ''}
          onChange={(e) => setField(fk, e.target.value)}
          placeholder={f.placeholder || ''}
          rows={f.rows || 4}
          maxLength={f.maxLength || undefined}
          required={Boolean(f.required)}
          aria-required={Boolean(f.required)}
          className={dialogTextareaClass}
        />
      );
    }

    if (f.type === 'salary') {
      const display = formatSalaryDisplay(values[fk] ?? '', locale);
      return (
        <input
          type="text"
          inputMode="numeric"
          value={display}
          onChange={(e) => setField(fk, digitsOnly(e.target.value).slice(0, 15))}
          placeholder={f.placeholder || ''}
          disabled={Boolean(f.disabled)}
          className={cn(dialogFieldClass, f.disabled && 'cursor-default opacity-60')}
          aria-label={f.label}
        />
      );
    }

    if (f.type === 'cep') {
      return (
        <input
          type="text"
          inputMode="numeric"
          autoComplete="postal-code"
          value={values[fk] ?? ''}
          onChange={(e) => {
            const digits = stripCep(e.target.value) || '';
            setField(fk, formatCepBr(digits));
            setCepHint('');
            if (digits.length === 8) {
              void applyCepLookup(fk, digits, f.cepAutofill || null);
            }
          }}
          placeholder={f.placeholder || '00000-000'}
          disabled={Boolean(f.disabled) || cepBusyKey === fk}
          className={cn(dialogFieldClass, (f.disabled || cepBusyKey === fk) && 'opacity-60')}
          aria-label={f.label}
          aria-busy={cepBusyKey === fk}
        />
      );
    }

    if (f.type === 'cpf') {
      return (
        <input
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={values[fk] ?? ''}
          onChange={(e) => {
            const digits = stripCpf(e.target.value) || '';
            setField(fk, formatCpfBr(digits));
          }}
          placeholder={f.placeholder || '000.000.000-00'}
          disabled={Boolean(f.disabled)}
          className={cn(dialogFieldClass, f.disabled && 'opacity-60')}
          aria-label={f.label}
        />
      );
    }

    if (f.type === 'phone') {
      return (
        <input
          type="text"
          inputMode="tel"
          autoComplete="tel"
          value={values[fk] ?? ''}
          onChange={(e) => {
            const digits = stripPhone(e.target.value) || '';
            setField(fk, formatPhoneBr(digits));
          }}
          placeholder={f.placeholder || '(11) 99999-9999'}
          disabled={Boolean(f.disabled)}
          className={cn(dialogFieldClass, f.disabled && 'opacity-60')}
          aria-label={f.label}
        />
      );
    }

    if (f.type === 'range') {
      return (
        <RangeField
          value={values[fk]}
          onChange={(v) => setField(fk, v)}
          min={f.min != null ? Number(f.min) : 0}
          max={f.max != null ? Number(f.max) : 100}
          step={f.step != null ? Number(f.step) : 1}
          suffix={f.suffix || ''}
          minLabel={f.minLabel}
          midLabel={f.midLabel}
          maxLabel={f.maxLabel}
          label={f.label}
          disabled={disabled}
        />
      );
    }

    if (f.type === 'date' || f.type === 'datetime-local') {
      return (
        <DateField
          locale={locale}
          mode={f.type === 'datetime-local' ? 'datetime-local' : 'date'}
          value={values[fk] ?? ''}
          onChange={(e) => setField(fk, e.target.value)}
          min={f.min}
          max={f.max}
          disabled={disabled}
          required={Boolean(f.required)}
          aria-label={f.label}
          className={dialogFieldClass}
        />
      );
    }

    return (
      <input
        type={f.type === 'password' ? 'password' : f.type === 'number' ? 'number' : 'text'}
        value={values[fk] ?? ''}
        onChange={(e) => setField(fk, e.target.value)}
        placeholder={f.placeholder || ''}
        className={dialogFieldClass}
        autoComplete={f.autoComplete || (f.type === 'password' ? 'new-password' : 'off')}
        inputMode={f.inputMode}
        min={f.min}
        max={f.max}
        step={f.step}
        aria-label={f.label}
        aria-invalid={Boolean(fieldErrors[fk]) || undefined}
        aria-describedby={fieldErrors[fk] ? `prompt-error-${fk}` : undefined}
        maxLength={f.maxLength}
        disabled={disabled}
        required={Boolean(f.required)}
        aria-required={Boolean(f.required)}
      />
    );
  };

  return createPortal(
    <>
      <div
        className={cn('app-dialog-overlay', dialogOverlayClass)}
        role="presentation"
        onClick={(e) => {
          if (e.target === e.currentTarget && !submitLockRef.current) onCancel?.();
        }}
      >
        <form
          ref={dialogRef}
          onSubmit={async (event) => {
            event.preventDefault();
            if (submitLockRef.current || uploadBusyKey || missingRequired) return;
            const errors = Object.fromEntries(visibleFields.map(f => [fieldKeyOf(f), f.validate?.(values[fieldKeyOf(f)], values)]).filter(([, message]) => message));
            setFieldErrors(errors);
            if (Object.keys(errors).length) {
              const key = Object.keys(errors)[0];
              dialogRef.current?.querySelector(`[aria-label="${CSS.escape(fields.find(f => fieldKeyOf(f) === key)?.label || '')}"]`)?.focus();
              return;
            }
            submitLockRef.current = true;
            setSubmitting(true); setSubmitError('');
            try { await onSubmit?.(values); }
            catch (error) { setSubmitError(error?.message || t(locale, 'panel.common.error')); }
            finally { submitLockRef.current = false; setSubmitting(false); }
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Tab' || !event.currentTarget.contains(event.target)) return;
            const controls = [...event.currentTarget.querySelectorAll('button:not(:disabled), input:not([hidden]):not(:disabled), textarea:not(:disabled), [tabindex="0"]')]
              .filter(el => el.tabIndex >= 0 && el.getClientRects().length);
            const first = controls[0], last = controls.at(-1);
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
            if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="prompt-form-title"
          className={cn(
            'prompt-form-card',
            dialogCardClass,
            'max-h-[90vh] overflow-y-auto',
            size === 'wide' ? 'max-w-[760px]' : hasWideFields ? 'max-w-[560px]' : 'max-w-[520px]'
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-3">
            <h2
              id="prompt-form-title"
              className="m-0 min-w-0 break-words pt-1.5 font-ui text-xl font-semibold leading-snug text-ink"
            >
              {heading}
            </h2>
            <DialogCloseButton onClick={onCancel} locale={locale} disabled={submitting} className="-mr-2 -mt-1" />
          </div>
          {message ? (
            <p className="mb-0 mt-3 text-sm leading-[1.55] text-ink-muted">{message}</p>
          ) : null}
          <fieldset disabled={submitting} className="m-0 mt-4 flex min-w-0 flex-col gap-5 border-0 p-0">
            {fieldGroups.map((group, gi) => {
              const section = group.fields[0]?.section;
              const weights = group.fields.map((f) => Number(f.rowWeight) > 0 ? Number(f.rowWeight) : 1);
              const weighted = weights.some((w) => w !== 1);
              const body = group.row && group.fields.length > 1 ? (
                <div
                  key={`row-${group.row}-${gi}`}
                  className={cn('grid grid-cols-1 items-start gap-5', weighted ? 'sm:[grid-template-columns:var(--prompt-row-cols)]' : 'sm:grid-cols-2')}
                  style={weighted ? { '--prompt-row-cols': weights.map((w) => `minmax(0,${w}fr)`).join(' ') } : undefined}
                >
                  {group.fields.map((f) => renderFieldBlock(f, true))}
                </div>
              ) : (
                group.fields.map((f) => renderFieldBlock(f))
              );
              return section ? (
                <Fragment key={`section-${gi}`}>
                  <h3 className={cn('m-0 border-t border-ink/10 pt-4 font-ui text-sm font-semibold text-ink', gi === 0 && 'border-t-0 pt-0')}>{section}</h3>
                  {body}
                </Fragment>
              ) : body;
            })}
          </fieldset>
          {submitError ? <p role="alert" className="mt-4 rounded-control border border-danger/30 p-3 text-sm text-danger">{submitError}</p> : null}
          <div className="mt-[22px] flex flex-wrap justify-end gap-2.5">
            <button type="button" onClick={onCancel} className={dialogBtnGhostClass} disabled={submitting || Boolean(uploadBusyKey)}>
              {cancelLabel || t(locale, 'panel.common.cancel')}
            </button>
            <button
              type="submit"
              disabled={submitting || Boolean(uploadBusyKey) || missingRequired}
              className={cn(
                dialogBtnPrimaryClass,
                (uploadBusyKey || missingRequired) && 'cursor-not-allowed opacity-55'
              )}
            >
              {submitting ? t(locale, 'common.loading') : confirmLabel || t(locale, 'panel.common.save')}
            </button>
          </div>
        </form>
      </div>
      <CompanyLogoCropDialog
        open={Boolean(cropTarget?.file)}
        file={cropTarget?.file || null}
        locale={locale}
        onCancel={() => setCropTarget(null)}
        onApply={(processed) => {
          const field = cropTarget?.field;
          setCropTarget(null);
          if (field) void onImageFile(field, processed);
        }}
      />
    </>,
    document.body
  );
}
