import { htmlToPlainText } from './sanitize-html.js';
import { t } from './i18n.js';

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
    else if (field.maxLength && text.length > field.maxLength) errors[key] = t(locale, 'formValidation.maximumText', {limit: field.maxLength});
    else if (field.type === 'number' && text && (!Number.isFinite(Number(text)) || (field.min != null && Number(text) < Number(field.min)) || (field.max != null && Number(text) > Number(field.max)))) errors[key] = t(locale, 'formValidation.invalid');
    else { const message = field.validate?.(value, values); if (message) errors[key] = message; }
  }
  return errors;
}
