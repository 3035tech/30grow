import { htmlToPlainText } from './sanitize-html.js';
import { t } from './i18n.js';
import { digitsOnly } from './br-masks.js';

export function isValidWebUrl(value) {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && Boolean(url.hostname);
  } catch {
    return false;
  }
}

export function isValidPhoneBr(value) {
  if (/[^0-9()+\-\s]/.test(String(value))) return false;
  const digits = digitsOnly(value);
  const local = digits.startsWith('55') && digits.length >= 12 ? digits.slice(2) : digits;
  return [10, 11].includes(local.length);
}

function validNumberField(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number)) return false;
  if (field.min != null && number < Number(field.min)) return false;
  if (field.max != null && number > Number(field.max)) return false;
  const step = field.step == null || field.step === 'any' ? null : Number(field.step);
  if (step && Number.isFinite(step) && step > 0) {
    const base = field.min != null ? Number(field.min) : 0;
    if (Math.abs((number - base) / step - Math.round((number - base) / step)) > 1e-8) return false;
  }
  return true;
}

// Never echo submitted values, custom refinements or provider messages to the client.
export function validationFields(error, locale = 'pt-BR') {
  const fields = {};
  for (const issue of (error?.issues || []).slice(0, 30)) {
    const path = (issue.path || []).filter(part => typeof part === 'string' || typeof part === 'number').join('.');
    if (!path || fields[path]) continue;
    let key = 'invalid';
    const values = {};
    if (issue.code === 'too_small') { key = issue.origin === 'string' ? 'minimumText' : 'minimum'; values.limit = issue.minimum; }
    else if (issue.code === 'too_big') { key = issue.origin === 'string' ? 'maximumText' : 'maximum'; values.limit = issue.maximum; }
    else if (issue.code === 'invalid_format' && issue.format === 'email') key = 'email';
    else if (issue.code === 'invalid_type') key = 'required';
    else if (issue.code === 'invalid_value') key = 'choice';
    fields[path] = t(locale, `formValidation.${key}`, values);
  }
  return fields;
}

export function validateFormFields(fields, values, locale) {
  const errors = {};
  for (const field of fields) {
    if (field.disabled || field.disabledWhen?.(values)) continue;
    const key = field.key || field.name;
    const value = values[key];
    const text = (field.type === 'richText' ? htmlToPlainText(value || '') : String(value ?? '')).trim();
    const filled = Array.isArray(value) ? value.length > 0 : value && typeof value === 'object' ? Boolean(value.file || String(value.url || '').trim()) : typeof value === 'boolean' ? value : Boolean(text);
    if (field.required && !filled) errors[key] = t(locale, 'formValidation.required');
    else if (text && field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) errors[key] = t(locale, 'formValidation.email');
    else if (text && field.type === 'phone' && !isValidPhoneBr(text)) errors[key] = t(locale, 'formValidation.phone');
    else if (text && field.type === 'cpf' && (/[^0-9.\-\s]/.test(text) || digitsOnly(text).length !== 11)) errors[key] = t(locale, 'formValidation.cpf');
    else if (text && field.type === 'cep' && (/[^0-9\-\s]/.test(text) || digitsOnly(text).length !== 8)) errors[key] = t(locale, 'formValidation.cep');
    else if (text && field.type === 'url' && !isValidWebUrl(text)) errors[key] = t(locale, 'formValidation.url');
    else if (text && field.type === 'time' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(text)) errors[key] = t(locale, 'formValidation.time');
    else if (field.maxLength && text.length > field.maxLength) errors[key] = t(locale, 'formValidation.maximumText', {limit: field.maxLength});
    else if (field.type === 'number' && text && !validNumberField(text, field)) errors[key] = t(locale, 'formValidation.invalid');
    else { const message = field.validate?.(value, values); if (message) errors[key] = message; }
  }
  return errors;
}

/**
 * Validate browser form constraints without triggering native browser UI.
 * Pair this with `noValidate` and render the returned localized message in the app.
 */
export function validateFormElementValues(form, locale = 'pt-BR') {
  if (!form?.elements) return '';
  const elements = Array.from(form.elements);

  for (const field of elements) {
    if (!field || field.disabled || !field.willValidate) continue;
    const labelElement = field.labels?.[0];
    const label = String(
      labelElement?.firstElementChild?.textContent ||
        labelElement?.textContent ||
        field.getAttribute?.('aria-label') ||
        field.name ||
        '',
    ).replace(/\s+/g, ' ').trim().replace(/\s*\*$/, '');
    const values = { field: label || t(locale, 'formValidation.fieldFallback') };
    const validity = field.validity;
    const textValue = String(field.value ?? '');

    if (
      validity?.valueMissing ||
      (field.required && ['text', 'email', 'url', 'search', 'tel', 'password'].includes(field.type) && !textValue.trim())
    ) {
      return t(locale, 'formValidation.requiredField', values);
    }
    if (validity?.typeMismatch) {
      if (field.type === 'email') return t(locale, 'formValidation.emailField', values);
      if (field.type === 'url') return t(locale, 'formValidation.urlField', values);
      return t(locale, 'formValidation.invalidField', values);
    }
    if (
      validity?.badInput ||
      validity?.patternMismatch ||
      validity?.rangeOverflow ||
      validity?.rangeUnderflow ||
      validity?.stepMismatch ||
      validity?.tooLong ||
      validity?.tooShort
    ) {
      return t(locale, 'formValidation.invalidField', values);
    }
  }

  return '';
}
