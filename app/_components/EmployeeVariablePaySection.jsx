'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { t, localeHtmlLang } from '../../lib/i18n';
import { cn } from '../../lib/cn';
import { formatSalaryDisplay } from '../../lib/br-masks';
import { S } from '../dashboard/dashboard-shared';
import { EmptyState } from './EmptyState';
import { AppLoading, ContentEnter } from './AppLoading';
import { useAppFeedback } from './AppFeedback';
import { StatusToneChip } from './StatusToneChip';
import { COMPENSATION_APPROVAL_STATUS } from '../../lib/domain-status.js';
import { redirectEmployeeIfUnauthorized } from '../../lib/employee/employee-client-session';
import { useRouter } from 'next/navigation';

function formatDate(value, locale) {
  if (!value) return t(locale, 'panel.common.notApplicable');
  const raw = String(value).slice(0, 10);
  const [y, m, d] = raw.split('-').map(Number);
  if (!y || !m || !d) return raw;
  return new Date(y, m - 1, d).toLocaleDateString(localeHtmlLang(locale), {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function eventTypeLabel(locale, type) {
  const key = `panel.compensation.type.${type}`;
  const label = t(locale, key);
  return label === key ? type : label;
}

/**
 * Collaborator-facing proposed/approved bonuses (not payslip).
 */
export function EmployeeVariablePaySection({ locale = 'pt-BR', onBadge }) {
  const router = useRouter();
  const { toast } = useAppFeedback();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const onBadgeRef = useRef(onBadge);
  onBadgeRef.current = onBadge;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/employee/compensation');
      if (redirectEmployeeIfUnauthorized(router, res.status)) return;
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'load');
      const next = Array.isArray(data.items) ? data.items : [];
      setItems(next);
      if (typeof onBadgeRef.current === 'function') {
        onBadgeRef.current(
          next.filter((i) => i.approvalStatus === COMPENSATION_APPROVAL_STATUS.PROPOSED).length
        );
      }
    } catch (e) {
      toast(e?.message || t(locale, 'panel.variablePay.employeeLoadError'), 'error');
      setItems([]);
      if (typeof onBadgeRef.current === 'function') onBadgeRef.current(0);
    } finally {
      setLoading(false);
    }
  }, [locale, router, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <AppLoading variant="panel" />;

  return (
    <ContentEnter animKey={`emp-vp|${items.length}`}>
      <p className={cn(S.muted, 'mb-3 text-xs')}>{t(locale, 'panel.variablePay.employeeHint')}</p>
      {items.length === 0 ? (
        <EmptyState message={t(locale, 'panel.variablePay.employeeEmpty')} />
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {items.map((row) => (
            <li
              key={row.id}
              className={cn(
                'flex flex-wrap items-center justify-between gap-2 rounded-control border bg-surface px-3 py-2.5',
                row.approvalStatus === COMPENSATION_APPROVAL_STATUS.PROPOSED
                  ? 'border-warning/30'
                  : 'border-ink/10'
              )}
            >
              <div className="min-w-0">
                <div className="font-ui text-sm tabular-nums text-ink">
                  {formatSalaryDisplay(row.amount, locale)}
                </div>
                <div className="mt-0.5 font-mono text-2xs text-ink-muted">
                  {formatDate(row.effectiveDate, locale)}
                  {' · '}
                  {eventTypeLabel(locale, row.eventType)}
                </div>
              </div>
              <StatusToneChip
                tone={
                  row.approvalStatus === COMPENSATION_APPROVAL_STATUS.PROPOSED
                    ? 'warning'
                    : 'success'
                }
              >
                {row.approvalStatus === COMPENSATION_APPROVAL_STATUS.PROPOSED
                  ? t(locale, 'panel.variablePay.statusProposed')
                  : t(locale, 'panel.variablePay.statusApproved')}
              </StatusToneChip>
            </li>
          ))}
        </ul>
      )}
    </ContentEnter>
  );
}
