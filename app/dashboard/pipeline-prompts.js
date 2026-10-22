'use client';

import { REJECTION_REASONS, rejectionReasonLabelKey } from '../../lib/pipeline';
import { t } from '../../lib/i18n';

export function rejectionReasonLabel(locale, code) {
  if (!code) return null;
  const reasons = Array.isArray(code) ? code : [code];
  return reasons.map((reason) => t(locale, rejectionReasonLabelKey(reason))).join(' · ');
}

export { REJECTION_REASONS };
