'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { t, localeHtmlLang } from '../../lib/i18n';
import { cn } from '../../lib/cn';
import { S, AdminCreateButton } from '../dashboard/dashboard-shared';
import { EmptyState } from './EmptyState';
import { AppLoading, ContentEnter } from './AppLoading';
import { useAppFeedback } from './AppFeedback';
import { StatusToneChip } from './StatusToneChip';
import { InlineCallout } from './InlineCallout';
import { CollapsibleBlock } from './CollapsibleBlock';
import { EMPLOYMENT_STATUS } from '../../lib/domain-status.js';

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

function BenefitRow({ item, locale, readOnly, busy, onEnd }) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-2 rounded-control border border-ink/10 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-ui text-sm text-ink">{item.benefitName}</span>
          <StatusToneChip tone={item.active ? 'success' : 'neutral'}>
            {item.active
              ? t(locale, 'panel.benefitAssign.statusActive')
              : t(locale, 'panel.benefitAssign.statusEnded')}
          </StatusToneChip>
        </div>
        <div className={cn(S.faint, 'mt-1')}>
          {item.categoryName ? `${item.categoryName} · ` : ''}
          {t(locale, 'panel.benefitAssign.period', {
            from: formatDate(item.startsOn, locale),
            to: item.endsOn
              ? formatDate(item.endsOn, locale)
              : t(locale, 'panel.benefitAssign.ongoing'),
          })}
          {item.valueNote ? ` · ${item.valueNote}` : ''}
        </div>
      </div>
      {item.active && !readOnly ? (
        <button
          type="button"
          className={cn(S.btnGhost, 'text-danger')}
          disabled={busy}
          onClick={() => onEnd(item)}
        >
          {t(locale, 'panel.benefitAssign.endBtn')}
        </button>
      ) : null}
    </li>
  );
}

/**
 * B-RH2-14: catalog benefits assigned to a collaborator (not payroll).
 */
export function BenefitAssignmentsBlock({ locale, candidateId, employmentStatus }) {
  const { toast, promptForm, confirm } = useAppFeedback();
  const [items, setItems] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const readOnly = employmentStatus === EMPLOYMENT_STATUS.ALUMNI;
  const visible =
    employmentStatus === EMPLOYMENT_STATUS.EMPLOYEE ||
    employmentStatus === EMPLOYMENT_STATUS.ALUMNI;

  const activeItems = useMemo(() => items.filter((x) => x.active), [items]);
  const endedItems = useMemo(() => items.filter((x) => !x.active), [items]);

  const activeIds = useMemo(
    () => new Set(activeItems.map((x) => Number(x.benefitId))),
    [activeItems]
  );

  const load = useCallback(async () => {
    if (!candidateId || !visible) {
      setItems([]);
      setCatalog([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(
        `/api/admin/candidates/${encodeURIComponent(candidateId)}/benefit-assignments`
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || data?.errorCode || 'load');
      setItems(Array.isArray(data.items) ? data.items : []);
      setCatalog(Array.isArray(data.catalog) ? data.catalog : []);
    } catch (e) {
      toast(e?.message || t(locale, 'panel.benefitAssign.loadError'), 'error');
      setItems([]);
      setCatalog([]);
    } finally {
      setLoading(false);
    }
  }, [candidateId, locale, toast, visible]);

  useEffect(() => {
    load();
  }, [load]);

  const assign = async () => {
    const options = catalog
      .filter((b) => !activeIds.has(Number(b.id)))
      .map((b) => ({
        value: String(b.id),
        label: b.category ? `${b.name} (${b.category})` : b.name,
      }));
    if (!options.length) {
      toast(t(locale, 'panel.benefitAssign.catalogEmpty'), 'info');
      return;
    }
    const values = await promptForm({
      title: t(locale, 'panel.benefitAssign.assignTitle'),
      confirmLabel: t(locale, 'panel.benefitAssign.assignConfirm'),
      fields: [
        {
          key: 'benefitId',
          type: 'select',
          label: t(locale, 'panel.benefitAssign.benefitLabel'),
          required: true,
          options,
        },
        {
          key: 'valueNote',
          label: t(locale, 'panel.benefitAssign.valueLabel'),
          placeholder: t(locale, 'panel.benefitAssign.valuePh'),
        },
        {
          key: 'startsOn',
          type: 'date',
          label: t(locale, 'panel.benefitAssign.startsLabel'),
          defaultValue: new Date().toISOString().slice(0, 10),
        },
      ],
    });
    if (!values) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/admin/candidates/${encodeURIComponent(candidateId)}/benefit-assignments`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            benefitId: Number(values.benefitId),
            valueNote: values.valueNote || '',
            startsOn: values.startsOn || undefined,
          }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || data?.errorCode || 'save');
      toast(t(locale, 'panel.benefitAssign.assigned'), 'ok');
      await load();
    } catch (e) {
      toast(e?.message || t(locale, 'panel.benefitAssign.saveError'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const endAssignment = async (item) => {
    const ok = await confirm({
      message: t(locale, 'panel.benefitAssign.endConfirm', { name: item.benefitName || '' }),
      danger: true,
      confirmLabel: t(locale, 'panel.benefitAssign.endConfirmBtn'),
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/admin/candidates/${encodeURIComponent(candidateId)}/benefit-assignments/${encodeURIComponent(item.id)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ end: true }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || data?.errorCode || 'end');
      toast(t(locale, 'panel.benefitAssign.ended'), 'ok');
      await load();
    } catch (e) {
      toast(e?.message || t(locale, 'panel.benefitAssign.saveError'), 'error');
    } finally {
      setBusy(false);
    }
  };

  if (!visible) return null;

  return (
    <section className={cn(S.cardTight, 'mt-4')}>
      <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="m-0 font-ui text-sm font-medium text-ink">
            {t(locale, 'panel.benefitAssign.title')}
          </h3>
          <p className={cn(S.faint, 'm-0 mt-1')}>{t(locale, 'panel.benefitAssign.hint')}</p>
        </div>
        {!readOnly ? (
          <AdminCreateButton variant="secondary"
            label={t(locale, 'panel.benefitAssign.assignBtn')}
            onClick={assign}
            disabled={busy || loading}
          />
        ) : null}
      </header>

      {readOnly ? (
        <InlineCallout tone="neutral" className="mb-3">
          {t(locale, 'panel.benefitAssign.alumniReadOnly')}
        </InlineCallout>
      ) : null}

      {loading ? (
        <AppLoading variant="panel" />
      ) : activeItems.length === 0 && endedItems.length === 0 ? (
        <EmptyState
          title={t(locale, 'panel.benefitAssign.emptyTitle')}
          message={t(locale, 'panel.benefitAssign.emptyHint')}
          actionLabel={readOnly ? undefined : t(locale, 'panel.benefitAssign.assignBtn')}
          onAction={readOnly ? undefined : assign}
          actionDisabled={busy}
        />
      ) : (
        <ContentEnter>
          {catalog.length === 0 && !readOnly ? (
            <InlineCallout tone="info" className="mb-3">
              {t(locale, 'panel.benefitAssign.catalogEmpty')}
            </InlineCallout>
          ) : null}

          {activeItems.length === 0 ? (
            <p className={cn(S.muted, 'm-0 mb-3 text-sm')}>
              {t(locale, 'panel.benefitAssign.emptyTitle')}
            </p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {activeItems.map((item) => (
                <BenefitRow
                  key={item.id}
                  item={item}
                  locale={locale}
                  readOnly={readOnly}
                  busy={busy}
                  onEnd={endAssignment}
                />
              ))}
            </ul>
          )}

          {endedItems.length > 0 ? (
            <CollapsibleBlock
              locale={locale}
              title={t(locale, 'panel.benefitAssign.historyTitle')}
              count={endedItems.length}
              defaultOpen={false}
              className="mt-3"
              variant="plain"
            >
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {endedItems.map((item) => (
                  <BenefitRow
                    key={item.id}
                    item={item}
                    locale={locale}
                    readOnly
                    busy={busy}
                    onEnd={endAssignment}
                  />
                ))}
              </ul>
            </CollapsibleBlock>
          ) : null}
        </ContentEnter>
      )}
    </section>
  );
}
