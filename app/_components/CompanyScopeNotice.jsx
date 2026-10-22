'use client';

import { t } from '../../lib/i18n';

export function CompanyScopeNotice({ locale, companyId, companyName, global = false }) {
  return <div className="mb-3 rounded-control border border-ink/12 bg-ink/[0.02] px-3 py-2 text-sm text-ink-muted">
    <span className="font-semibold text-ink">{t(locale, global ? 'betaPeople.platformScope' : 'betaPeople.companyScope')}</span>
    {' · '}{global ? t(locale, 'betaPeople.platformHint') : companyName || t(locale, companyId ? 'betaPeople.companyNumber' : 'betaPeople.chooseCompany', { id: companyId })}
  </div>;
}
