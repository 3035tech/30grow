'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '../../../lib/cn';
import { t, localeHtmlLang } from '../../../lib/i18n';
import { AI_FEATURE } from '../../../lib/ai-usage';
import { AdminListPager, AdminTableShell, AdminTh, S } from '../dashboard-shared';
import { AdminListFilters, AdminListFilterSelect } from '../../_components/AdminListFilters';
import { AppLoading, ContentEnter } from '../../_components/AppLoading';
import { EmptyState } from '../../_components/EmptyState';
import { StatMetricTile } from '../../_components/StatMetricTile';

const MONTHS_BACK = 12;
const FEATURE_IDS = Object.values(AI_FEATURE);

function recentMonths(locale, now = new Date()) {
  const fmt = new Intl.DateTimeFormat(localeHtmlLang(locale), { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const out = [];
  for (let i = 0; i < MONTHS_BACK; i += 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const id = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    out.push({ id, label: fmt.format(d) });
  }
  return out;
}

/** Consumo de IA por empresa/mês (B-2706). Dentro de Empresas, só admin. */
export function AiUsageAdminPanel({ locale }) {
  const months = useMemo(() => recentMonths(locale), [locale]);
  const [month, setMonth] = useState(months[0].id);
  const [companyId, setCompanyId] = useState('');
  const [feature, setFeature] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [companies, setCompanies] = useState([]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const seq = useRef(0);

  const numberFmt = useMemo(() => new Intl.NumberFormat(localeHtmlLang(locale)), [locale]);
  const costFmt = useMemo(
    () =>
      new Intl.NumberFormat(localeHtmlLang(locale), {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 4,
      }),
    [locale]
  );
  const cost = (micros) => costFmt.format((Number(micros) || 0) / 1e6);

  useEffect(() => {
    let alive = true;
    fetch('/api/admin/companies?forSelect=1')
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => {
        if (alive) setCompanies(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const mySeq = ++seq.current;
    setLoading(true);
    setError('');
    const qs = new URLSearchParams({ month, page: String(page), pageSize: String(pageSize) });
    if (companyId) qs.set('companyId', companyId);
    if (feature) qs.set('feature', feature);
    fetch(`/api/admin/ai-usage?${qs.toString()}`)
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body?.error || t(locale, 'panel.admin.aiUsageLoadFailed'));
        return body;
      })
      .then((body) => {
        if (mySeq === seq.current) setData(body);
      })
      .catch((e) => {
        if (mySeq === seq.current) setError(e?.message || t(locale, 'panel.common.error'));
      })
      .finally(() => {
        if (mySeq === seq.current) setLoading(false);
      });
  }, [month, companyId, feature, page, pageSize, locale]);

  const resetTo = (setter) => (value) => {
    setter(value);
    setPage(1);
  };
  const hasFilter = Boolean(companyId || feature || month !== months[0].id);
  const totals = data?.totals || { calls: 0, promptTokens: 0, completionTokens: 0, costMicros: 0 };
  const items = Array.isArray(data?.items) ? data.items : [];
  const features = Array.isArray(data?.features) ? data.features : [];
  const total = Number(data?.total) || 0;

  return (
    <div className="flex flex-col gap-4">
      <p className={cn(S.muted, 'm-0')}>{t(locale, 'panel.admin.aiUsageIntro', { limit: data?.defaultLimit ?? '–' })}</p>

      <div className={S.card}>
        <AdminListFilters
          aria-label={t(locale, 'panel.admin.aiUsageTitle')}
          locale={locale}
          onClear={() => {
            setMonth(months[0].id);
            setCompanyId('');
            setFeature('');
            setPage(1);
          }}
          clearEnabled={hasFilter}
        >
          <AdminListFilterSelect label={t(locale, 'panel.admin.aiUsageMonth')} value={month} onChange={resetTo(setMonth)}>
            {months.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </AdminListFilterSelect>
          <AdminListFilterSelect label={t(locale, 'panel.admin.aiUsageCompany')} value={companyId} onChange={resetTo(setCompanyId)}>
            <option value="">{t(locale, 'panel.admin.filterAll')}</option>
            {companies.map((c) => (
              <option key={c.id} value={String(c.id)}>
                {c.name}
              </option>
            ))}
          </AdminListFilterSelect>
          <AdminListFilterSelect label={t(locale, 'panel.admin.aiUsageFeature')} value={feature} onChange={resetTo(setFeature)}>
            <option value="">{t(locale, 'panel.admin.filterAll')}</option>
            {FEATURE_IDS.map((id) => (
              <option key={id} value={id}>
                {t(locale, `panel.admin.aiFeatures.${id}`)}
              </option>
            ))}
          </AdminListFilterSelect>
        </AdminListFilters>

        {error ? <p className="m-0 mt-3 font-mono text-xs text-danger">{error}</p> : null}

        {loading && !data ? (
          <div className="mt-3">
            <AppLoading locale={locale} variant="panel" />
          </div>
        ) : (
          <ContentEnter animKey={`${month}|${companyId}|${feature}`}>
            <div className="mt-3 grid grid-cols-2 gap-2.5 md:grid-cols-4">
              <StatMetricTile value={numberFmt.format(totals.calls)} label={t(locale, 'panel.admin.aiUsageCalls')} />
              <StatMetricTile value={numberFmt.format(totals.promptTokens)} label={t(locale, 'panel.admin.aiUsagePromptTokens')} />
              <StatMetricTile value={numberFmt.format(totals.completionTokens)} label={t(locale, 'panel.admin.aiUsageCompletionTokens')} />
              <StatMetricTile
                value={cost(totals.costMicros)}
                label={t(locale, 'panel.admin.aiUsageCost')}
                hint={t(locale, 'panel.admin.aiUsageCostHint')}
              />
            </div>

            {features.length ? (
              <div className="mt-4">
                <p className={cn(S.label, 'm-0 mb-2')}>{t(locale, 'panel.admin.aiUsageByFeature')}</p>
                <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
                  {features.map((f) => (
                    <li
                      key={f.feature}
                      className="rounded-control border border-ink/10 bg-ink/[0.02] px-3 py-2 font-mono text-2xs text-ink"
                    >
                      {t(locale, `panel.admin.aiFeatures.${f.feature}`)}
                      <span className="ml-2 tabular-nums text-ink-muted">
                        {numberFmt.format(f.calls)} · {cost(f.costMicros)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </ContentEnter>
        )}

        {!loading && total === 0 && !error ? (
          <div className="mt-3">
            <EmptyState message={t(locale, hasFilter ? 'panel.admin.aiUsageEmptyFiltered' : 'panel.admin.aiUsageEmpty')} />
          </div>
        ) : null}

        {total > 0 ? (
          <>
            <AdminTableShell
              locale={locale}
              minWidth="760px"
              className="mt-4"
              ariaLabel={t(locale, 'panel.admin.aiUsageTitle')}
              animKey={`${month}|${companyId}|${feature}|${page}|${pageSize}`}
            >
              <thead>
                <tr className="bg-ink/[0.02]">
                  <AdminTh>{t(locale, 'panel.admin.aiUsageCompany')}</AdminTh>
                  <AdminTh align="right">{t(locale, 'panel.admin.aiUsageCallsOfLimit')}</AdminTh>
                  <AdminTh align="right">{t(locale, 'panel.admin.aiUsagePromptTokens')}</AdminTh>
                  <AdminTh align="right">{t(locale, 'panel.admin.aiUsageCompletionTokens')}</AdminTh>
                  <AdminTh align="right">{t(locale, 'panel.admin.aiUsageCost')}</AdminTh>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr key={row.companyId ?? 'none'} className="border-b border-ink/[0.06] last:border-b-0">
                    <td className="px-4 py-3 text-ink">
                      {row.companyId != null
                        ? row.companyName || `#${row.companyId}`
                        : t(locale, 'panel.admin.aiUsageNoCompany')}
                    </td>
                    <td
                      className={cn(
                        'px-4 py-3 text-right font-mono tabular-nums',
                        row.reached ? 'text-danger' : 'text-ink'
                      )}
                    >
                      {numberFmt.format(row.calls)}
                      {row.limit != null ? ` / ${numberFmt.format(row.limit)}` : ''}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-ink-muted">
                      {numberFmt.format(row.promptTokens)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-ink-muted">
                      {numberFmt.format(row.completionTokens)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-ink">{cost(row.costMicros)}</td>
                  </tr>
                ))}
              </tbody>
            </AdminTableShell>
            <AdminListPager
              locale={locale}
              page={page}
              pageSize={pageSize}
              total={total}
              loading={loading}
              onPageChange={setPage}
              onPageSizeChange={(ps) => {
                setPageSize(ps);
                setPage(1);
              }}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}
