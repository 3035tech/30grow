'use client';

import { SelectField } from '../../_components/SelectField';

import { useEffect, useState } from 'react';
import { t } from '../../../lib/i18n';
import { PAGE_SIZE_OPTIONS } from '../../../lib/assessment/assessment-filters';
import { cn } from '../../../lib/cn';
import { S } from '../dashboard-shared';
import { CompareTab } from './CompareTab';
import { RosterEmptyHint } from '../../_components/RosterEmptyHint';
import { AppLoading, ContentEnter } from '../../_components/AppLoading';
import { ROSTER_SCOPE } from '../../../lib/domain-status';

export function CompareTabLoader({
  filterQueryString,
  comparePage,
  comparePageSize,
  onComparePagination,
  locale = 'pt-BR',
  search = '',
  onSearch,
  roster,
  navigateDashboard,
}) {
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ total: 0, totalPages: 1, page: 1 });
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr('');
    const q = new URLSearchParams(filterQueryString || '');
    q.set('comparePage', String(comparePage));
    q.set('comparePageSize', String(comparePageSize));
    fetch(`/api/admin/assessment-rows?${q.toString()}`)
      .then(async (r) => {
        const raw = await r.text();
        let d = {};
        if (raw && raw.trim()) {
          try {
            d = JSON.parse(raw);
          } catch {
            d = {};
          }
        }
        return { ok: r.ok, d, status: r.status };
      })
      .then(({ ok, d }) => {
        if (cancelled) return;
        if (!ok) throw new Error(d?.error || t(locale, 'panel.compare.loadError'));
        setRows(Array.isArray(d.rows) ? d.rows : []);
        setMeta({
          total: typeof d.total === 'number' ? d.total : (Array.isArray(d.rows) ? d.rows.length : 0),
          totalPages: typeof d.totalPages === 'number' ? d.totalPages : 1,
          page: typeof d.page === 'number' ? d.page : comparePage,
        });
      })
      .catch((e) => {
        if (!cancelled) setErr(e?.message || t(locale, 'panel.common.error'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [filterQueryString, comparePage, comparePageSize, locale]);

  if (loading) {
    return <AppLoading locale={locale} variant="panel" label={t(locale, 'panel.compare.loading')} />;
  }
  if (err) {
    return (
      <div className={cn(S.card, 'p-10 text-center')}>
        <p className="m-0 text-danger">{err}</p>
      </div>
    );
  }

  const effPage = meta.page;
  const totPg = meta.totalPages;

  return (
    <ContentEnter animKey="ready">
    <div className="flex flex-col gap-3.5">
      {meta.total === 0 && !(search || '').trim() ? (
        <RosterEmptyHint
          locale={locale}
          roster={roster || ROSTER_SCOPE.INTERNAL}
          navigateDashboard={navigateDashboard}
        />
      ) : (
        <CompareTab
          results={rows}
          locale={locale}
          search={search}
          onSearch={onSearch}
          listTotal={meta.total}
          roster={roster}
          navigateDashboard={navigateDashboard}
        />
      )}
      {meta.total > 0 ? (
        <div className={cn(S.card, 'flex flex-wrap items-center justify-between gap-3 px-5 py-3.5')}>
          <span className="font-mono text-xs text-ink-muted">
            {t(locale, 'panel.compare.listMeta', { n: meta.total })}
          </span>
          <div className="flex flex-wrap items-center gap-2.5">
            <SelectField
              value={String(comparePageSize)}
              onChange={(e) => {
                const ps = parseInt(e.target.value, 10);
                onComparePagination({ page: 1, pageSize: ps });
              }}
              className={S.selectCompact}
            >
              {PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={String(n)}>{t(locale, 'dashboard.perPage', { n })}</option>
              ))}
            </SelectField>
            <button
              type="button"
              disabled={effPage <= 1}
              onClick={() => onComparePagination({ page: effPage - 1, pageSize: comparePageSize })}
              className={cn(
                'rounded-control border px-3.5 py-2 font-mono text-xs',
                effPage <= 1
                  ? 'cursor-default border-ink/12 bg-transparent text-ink-faint'
                  : 'cursor-pointer border-brand-500/40 bg-brand-500/[0.09] text-brand-500'
              )}
            >
              {t(locale, 'dashboard.previous')}
            </button>
            <span className="min-w-[90px] text-center font-mono text-xs text-ink-muted">
              {effPage} / {totPg}
            </span>
            <button
              type="button"
              disabled={effPage >= totPg}
              onClick={() => onComparePagination({ page: effPage + 1, pageSize: comparePageSize })}
              className={cn(
                'rounded-control border px-3.5 py-2 font-mono text-xs',
                effPage >= totPg
                  ? 'cursor-default border-ink/12 bg-transparent text-ink-faint'
                  : 'cursor-pointer border-brand-500/40 bg-brand-500/[0.09] text-brand-500'
              )}
            >
              {t(locale, 'dashboard.next')}
            </button>
          </div>
        </div>
      ) : null}
    </div>
    </ContentEnter>
  );
}
