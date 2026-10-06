'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { t, localeHtmlLang } from '../../lib/i18n';
import { cn } from '../../lib/cn';
import { formatSalaryDisplay } from '../../lib/br-masks';
import {
  S,
  AdminTableShell,
  AdminTh,
} from '../dashboard/dashboard-shared';
import { EmptyState } from './EmptyState';
import { AppLoading, ContentEnter } from './AppLoading';
import { useAppFeedback } from './AppFeedback';
import { FormField } from './FormField';
import { InlineCallout } from './InlineCallout';
import { RangeField } from './RangeField';
import { CollapsibleBlock } from './CollapsibleBlock';
import { SegmentedControl } from './SegmentedControl';
import { StackedSegmentBar } from './StackedSegmentBar';
import { ChartPanel, ChartLegend } from './ChartPanel';
import { CHART_MIN_N, salaryBandTotals } from '../../lib/chart-aggregates';

/**
 * B-3002 — Analytic salary map by job role + simple % raise simulation.
 * B-3021 — stacked below / in-band / above above the table.
 */
export function SalaryMapBlock({ locale = 'pt-BR', companyId }) {
  const { toast } = useAppFeedback();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(() => Boolean(companyId));
  const [pct, setPct] = useState('5');
  const [simulation, setSimulation] = useState(null);
  const [simBusy, setSimBusy] = useState(false);
  const [scope, setScope] = useState('active'); // active | all

  const money = (n) => formatSalaryDisplay(n, locale);

  const load = useCallback(async () => {
    if (!companyId) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(
        `/api/admin/compensation/salary-map?companyId=${encodeURIComponent(companyId)}`
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'load');
      setItems(Array.isArray(data.items) ? data.items : []);
      setSimulation(null);
    } catch (e) {
      toast(e?.message || t(locale, 'panel.salaryMap.loadError'), 'error');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [companyId, locale, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    const rows = [...items].sort((a, b) => {
      const hb = (Number(b.headcount) || 0) - (Number(a.headcount) || 0);
      if (hb !== 0) return hb;
      return String(a.name || '').localeCompare(String(b.name || ''), localeHtmlLang(locale));
    });
    if (scope === 'all') return rows;
    return rows.filter((r) => (Number(r.headcount) || 0) > 0);
  }, [items, locale, scope]);

  const belowTotal = useMemo(
    () => visible.reduce((n, r) => n + (Number(r.below) || 0), 0),
    [visible]
  );

  const bandTotals = useMemo(() => salaryBandTotals(visible), [visible]);

  const bandedRows = useMemo(() => {
    return visible.filter(
      (r) => (Number(r.below) || 0) + (Number(r.inBand) || 0) + (Number(r.above) || 0) > 0
    );
  }, [visible]);

  const chartRows = useMemo(() => bandedRows.slice(0, 12), [bandedRows]);

  const showBandChart = bandTotals.banded >= CHART_MIN_N;

  const bandSegments = (row) => [
    {
      id: 'below',
      value: Number(row.below) || 0,
      toneClass: 'bg-warning',
      label: t(locale, 'panel.salaryMap.colBelow'),
    },
    {
      id: 'inBand',
      value: Number(row.inBand) || 0,
      toneClass: 'bg-success',
      label: t(locale, 'panel.salaryMap.colInBand'),
    },
    {
      id: 'above',
      value: Number(row.above) || 0,
      toneClass: 'bg-info',
      label: t(locale, 'panel.salaryMap.colAbove'),
    },
  ];

  const runSimulate = async () => {
    if (!companyId) return;
    const value = Number(pct);
    if (!Number.isFinite(value) || value < 0) {
      toast(t(locale, 'panel.salaryMap.pctInvalid'), 'error');
      return;
    }
    setSimBusy(true);
    try {
      const params = new URLSearchParams({
        companyId: String(companyId),
        simulate: '1',
        mode: 'pct',
        value: String(value),
      });
      const res = await fetch(`/api/admin/compensation/salary-map?${params}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'sim');
      setItems(Array.isArray(data.items) ? data.items : items);
      setSimulation(data.simulation || null);
    } catch (e) {
      toast(e?.message || t(locale, 'panel.salaryMap.simError'), 'error');
    } finally {
      setSimBusy(false);
    }
  };

  if (!companyId) return null;

  return (
    <CollapsibleBlock
      locale={locale}
      title={t(locale, 'panel.salaryMap.title')}
      count={!loading ? visible.length : null}
      defaultOpen
      variant="card"
      collapsedHint={
        !loading && belowTotal > 0
          ? t(locale, 'panel.salaryMap.belowHint', { n: belowTotal })
          : t(locale, 'panel.salaryMap.hint')
      }
    >
      {loading ? (
        <AppLoading variant="panel" />
      ) : (
      <ContentEnter animKey={`smap|${companyId}|${items.length}|${scope}`}>
        <p className={cn(S.muted, 'mb-3 text-prose')}>{t(locale, 'panel.salaryMap.hint')}</p>

        <div className="mb-3">
          <SegmentedControl
            aria-label={t(locale, 'panel.salaryMap.scopeAria')}
            value={scope}
            onChange={setScope}
            size="sm"
            options={[
              { id: 'active', label: t(locale, 'panel.salaryMap.scopeActive') },
              { id: 'all', label: t(locale, 'panel.salaryMap.scopeAll') },
            ]}
          />
        </div>

        {showBandChart ? (
          <ChartPanel
            className="mb-4"
            title={t(locale, 'panel.salaryMap.chartTitle')}
            hint={t(locale, 'panel.salaryMap.chartHint', { n: bandTotals.banded })}
          >
            <StackedSegmentBar
              segments={bandSegments(bandTotals)}
              height={12}
              className="mb-2"
              aria-label={t(locale, 'panel.salaryMap.chartSummaryAria', {
                below: bandTotals.below,
                inBand: bandTotals.inBand,
                above: bandTotals.above,
              })}
            />
            <ChartLegend
              className="mb-3"
              total={bandTotals.banded}
              items={[
                {
                  id: 'below',
                  toneClass: 'bg-warning',
                  label: t(locale, 'panel.salaryMap.colBelow'),
                  value: bandTotals.below,
                },
                {
                  id: 'inBand',
                  toneClass: 'bg-success',
                  label: t(locale, 'panel.salaryMap.colInBand'),
                  value: bandTotals.inBand,
                },
                {
                  id: 'above',
                  toneClass: 'bg-info',
                  label: t(locale, 'panel.salaryMap.colAbove'),
                  value: bandTotals.above,
                },
              ]}
            />
            {chartRows.length > 0 ? (
              <>
                <div className="mb-1.5 flex items-center gap-3 font-mono text-2xs text-ink-faint">
                  <span className="w-[7.5rem] shrink-0 sm:w-[9.5rem]">
                    {t(locale, 'panel.salaryMap.colRole')}
                  </span>
                  <span className="min-w-0 flex-1">
                    {t(locale, 'panel.salaryMap.chartMix')}
                  </span>
                  <span className="w-8 shrink-0 text-right">
                    {t(locale, 'panel.salaryMap.colHeadcountShort')}
                  </span>
                </div>
                <ul className="m-0 flex list-none flex-col gap-2 p-0">
                  {chartRows.map((row) => (
                    <li key={`chart-${row.jobRoleId}`} className="flex items-center gap-3">
                      <div
                        className="w-[7.5rem] shrink-0 truncate text-prose text-ink sm:w-[9.5rem]"
                        title={row.name}
                      >
                        {row.name}
                      </div>
                      <StackedSegmentBar
                        segments={bandSegments(row)}
                        height={8}
                        className="min-w-0 flex-1"
                        aria-label={t(locale, 'panel.salaryMap.chartRowAria', {
                          name: row.name,
                          below: row.below,
                          inBand: row.inBand,
                          above: row.above,
                        })}
                      />
                      <span className="w-8 shrink-0 text-right font-mono text-2xs tabular-nums text-ink-muted">
                        {row.headcount}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            {bandedRows.length > chartRows.length ? (
              <p className="mb-0 mt-2.5 font-mono text-2xs text-ink-faint">
                {t(locale, 'panel.salaryMap.chartCap', {
                  shown: chartRows.length,
                  total: bandedRows.length,
                })}
              </p>
            ) : null}
          </ChartPanel>
        ) : null}

        <div className="mb-4 flex flex-wrap items-end gap-3">
          <FormField as="div" label={t(locale, 'panel.salaryMap.pctLabel')} className="min-w-[14rem] max-w-sm flex-1">
            <RangeField
              value={pct}
              onChange={setPct}
              min={0}
              max={100}
              step={0.5}
              suffix="%"
              hideScale
              label={t(locale, 'panel.salaryMap.pctLabel')}
            />
          </FormField>
          <button
            type="button"
            className={cn(S.btnBrandSoft, 'min-h-touch text-prose')}
            disabled={simBusy || visible.length === 0}
            onClick={() => void runSimulate()}
          >
            {simBusy
              ? t(locale, 'panel.salaryMap.simulateBusy')
              : t(locale, 'panel.salaryMap.simulateBtn')}
          </button>
        </div>

        {simulation ? (
          <InlineCallout tone="info" className="mb-4">
            {t(locale, 'panel.salaryMap.simResult', {
              delta: money(simulation.delta),
              next: money(simulation.nextPayroll),
              people: simulation.people,
            })}
          </InlineCallout>
        ) : null}

        {visible.length === 0 ? (
          <EmptyState
            title={t(locale, 'panel.salaryMap.emptyTitle')}
            message={t(locale, 'panel.salaryMap.emptyHint')}
          />
        ) : (
          <AdminTableShell minWidth="560px" animKey={`roles|${scope}|${visible.length}`}>
            <thead className="border-b border-ink/10 bg-canvas-alt">
              <tr>
                <AdminTh>{t(locale, 'panel.salaryMap.colRole')}</AdminTh>
                <AdminTh>{t(locale, 'panel.salaryMap.colHeadcount')}</AdminTh>
                <AdminTh>{t(locale, 'panel.salaryMap.colBelow')}</AdminTh>
                <AdminTh>{t(locale, 'panel.salaryMap.colInBand')}</AdminTh>
                <AdminTh>{t(locale, 'panel.salaryMap.colAbove')}</AdminTh>
                <AdminTh>{t(locale, 'panel.salaryMap.colPayroll')}</AdminTh>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/5">
              {visible.map((row) => (
                <tr
                  key={row.jobRoleId}
                  className={cn(
                    'hover:bg-canvas-alt/50',
                    row.below > 0 && 'bg-warning/[0.04]'
                  )}
                >
                  <td className="px-4 py-2.5 text-sm text-ink">{row.name}</td>
                  <td className="px-4 py-2.5 font-mono text-prose text-ink-muted">
                    {row.headcount}
                  </td>
                  <td
                    className={cn(
                      'px-4 py-2.5 font-mono text-prose',
                      row.below > 0 ? 'font-medium text-warning' : 'text-ink-muted'
                    )}
                  >
                    {row.below}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-prose text-success">
                    {row.inBand}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-prose text-info">
                    {row.above}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-prose tabular-nums text-ink">
                    {money(row.payrollSum)}
                  </td>
                </tr>
              ))}
            </tbody>
          </AdminTableShell>
        )}
      </ContentEnter>
      )}
    </CollapsibleBlock>
  );
}
