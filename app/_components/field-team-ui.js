import { localeHtmlLang, t } from '../../lib/i18n';
import { FIELD_EXPENSE_STATUS, FIELD_VISIT_STATUS } from '../../lib/domain-status.js';

/** Labels shared by the collaborator page and the DP "Field" workspace. */
export function fieldCategoryLabel(locale, category) {
  const key = `panel.field.category.${category}`;
  const label = t(locale, key);
  return label === key ? category : label;
}

export function fieldExpenseStatusLabel(locale, status) {
  const key = `panel.field.expenseStatus.${status}`;
  const label = t(locale, key);
  return label === key ? status : label;
}

export function fieldVisitStatusLabel(locale, status) {
  const key = `panel.field.visitStatus.${status}`;
  const label = t(locale, key);
  return label === key ? status : label;
}

export function fieldExpenseTone(status) {
  if (status === FIELD_EXPENSE_STATUS.APPROVED) return 'success';
  if (status === FIELD_EXPENSE_STATUS.REJECTED) return 'danger';
  if (status === FIELD_EXPENSE_STATUS.CANCELLED) return 'neutral';
  return 'warning';
}

export function fieldVisitTone(status) {
  if (status === FIELD_VISIT_STATUS.DONE) return 'success';
  if (status === FIELD_VISIT_STATUS.CHECKED_IN) return 'info';
  if (status === FIELD_VISIT_STATUS.CANCELLED) return 'neutral';
  return 'warning';
}

export function formatCents(locale, cents, currency = 'BRL') {
  const n = Number(cents) / 100;
  if (!Number.isFinite(n)) return '—';
  try {
    return n.toLocaleString(localeHtmlLang(locale), { style: 'currency', currency: currency || 'BRL' });
  } catch {
    return n.toFixed(2);
  }
}

export function formatClock(value, locale) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(localeHtmlLang(locale), { hour: '2-digit', minute: '2-digit' });
}

export function mapSearchLink(address) {
  return `https://www.openstreetmap.org/search?query=${encodeURIComponent(String(address || ''))}`;
}

/** Uploads one file (multipart `file`) and returns the parsed JSON or throws with the API message. */
export async function uploadFieldFile(url, file) {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch(url, { method: 'POST', body: fd });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || 'upload');
  return json;
}
