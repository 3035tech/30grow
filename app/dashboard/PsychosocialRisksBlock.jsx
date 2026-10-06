'use client';

import { useCallback, useEffect, useState } from 'react';
import { t } from '../../lib/i18n';
import { cn } from '../../lib/cn';
import {
  AdminActionsCell,
  AdminActionsTh,
  AdminCreateButton,
  AdminDeleteButton,
  AdminEditButton,
  AdminTableShell,
  AdminTh,
  S,
} from './dashboard-shared';
import { useAppFeedback } from '../_components/AppFeedback';
import { AppLoading, ContentEnter } from '../_components/AppLoading';
import { EmptyState } from '../_components/EmptyState';
import { InlineCallout } from '../_components/InlineCallout';
import { MeterBar } from '../_components/MeterBar';
import { StatusToneChip } from '../_components/StatusToneChip';
import {
  PSYCHOSOCIAL_FACTORS,
  PSYCHOSOCIAL_RISK_STATUS,
  PSYCHOSOCIAL_RISK_STATUSES,
} from '../../lib/domain-status.js';
import { openPsychosocialReportWindow, printPsychosocialReport } from '../../lib/psychosocial-report-print';

const LEVEL_TONE = { low: 'success', moderate: 'warning', high: 'danger' };
const SIGNAL_TONE = { favorable: 'success', attention: 'warning', critical: 'danger' };
const SIGNAL_BAR = { favorable: 'bg-success', attention: 'bg-warning', critical: 'bg-danger' };
const STATUS_TONE = {
  [PSYCHOSOCIAL_RISK_STATUS.IDENTIFIED]: 'neutral',
  [PSYCHOSOCIAL_RISK_STATUS.IN_PROGRESS]: 'info',
  [PSYCHOSOCIAL_RISK_STATUS.CONTROLLED]: 'success',
};

/**
 * B-2714 — NR-1 psychosocial risks (light): questionnaire summary + inventory + printable report.
 * Lives inside ClimateTab; questionnaire = climate survey with factor-tagged questions.
 */
export function PsychosocialRisksBlock({ locale, companyId, onCreateSurvey, onOpenSurvey }) {
  const { toast, promptForm, confirm } = useAppFeedback();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const qs = companyId ? `?companyId=${encodeURIComponent(companyId)}` : '';
  const factorLabel = (f) => t(locale, `panel.nr1.factor.${f}`);
  const levelLabel = (l) => t(locale, `panel.nr1.level.${l}`);
  const statusLabel = (s) => t(locale, `panel.nr1.status.${s}`);
  const signalLabel = (s) => t(locale, `panel.nr1.signal.${s}`);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/psychosocial-risks${qs}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || t(locale, 'panel.nr1.loadError'));
      setData(json);
    } catch (e) {
      toast(e?.message || t(locale, 'panel.nr1.loadError'), 'error');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [qs, locale, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const riskFields = (risk) => [
    {
      key: 'factor',
      type: 'select',
      label: t(locale, 'panel.nr1.fieldFactor'),
      required: true,
      defaultValue: risk?.factor || PSYCHOSOCIAL_FACTORS[0],
      options: PSYCHOSOCIAL_FACTORS.map((f) => ({ value: f, label: factorLabel(f) })),
    },
    {
      key: 'hazard',
      label: t(locale, 'panel.nr1.fieldHazard'),
      placeholder: t(locale, 'panel.nr1.fieldHazardPh'),
      required: true,
      defaultValue: risk?.hazard || '',
    },
    {
      key: 'exposedGroup',
      label: t(locale, 'panel.nr1.fieldGroup'),
      placeholder: t(locale, 'panel.nr1.fieldGroupPh'),
      defaultValue: risk?.exposedGroup || '',
    },
    {
      key: 'probability',
      type: 'range',
      label: t(locale, 'panel.nr1.fieldProbability'),
      min: 1,
      max: 3,
      step: 1,
      width: 'half',
      defaultValue: String(risk?.probability ?? 2),
      minLabel: t(locale, 'panel.nr1.scaleLow'),
      maxLabel: t(locale, 'panel.nr1.scaleHigh'),
    },
    {
      key: 'severity',
      type: 'range',
      label: t(locale, 'panel.nr1.fieldSeverity'),
      min: 1,
      max: 3,
      step: 1,
      width: 'half',
      defaultValue: String(risk?.severity ?? 2),
      minLabel: t(locale, 'panel.nr1.scaleLow'),
      maxLabel: t(locale, 'panel.nr1.scaleHigh'),
    },
    {
      key: 'measures',
      type: 'textarea',
      label: t(locale, 'panel.nr1.fieldMeasures'),
      placeholder: t(locale, 'panel.nr1.fieldMeasuresPh'),
      defaultValue: risk?.measures || '',
    },
    {
      key: 'ownerUserId',
      type: 'select',
      label: t(locale, 'panel.nr1.fieldOwner'),
      width: 'half',
      defaultValue: risk?.ownerUserId ? String(risk.ownerUserId) : '',
      options: [
        { value: '', label: t(locale, 'panel.nr1.ownerNone') },
        ...(risk?.ownerUserId && !(data?.owners || []).some((u) => Number(u.id) === risk.ownerUserId)
          ? [{ value: String(risk.ownerUserId), label: risk.ownerName || `#${risk.ownerUserId}` }]
          : []),
        ...(data?.owners || []).map((u) => ({ value: String(u.id), label: u.name })),
      ],
    },
    {
      key: 'dueDate',
      type: 'date',
      label: t(locale, 'panel.nr1.fieldDue'),
      width: 'half',
      defaultValue: risk?.dueDate || '',
    },
    {
      key: 'status',
      type: 'select',
      label: t(locale, 'panel.nr1.fieldStatus'),
      defaultValue: risk?.status || PSYCHOSOCIAL_RISK_STATUS.IDENTIFIED,
      options: PSYCHOSOCIAL_RISK_STATUSES.map((s) => ({ value: s, label: statusLabel(s) })),
    },
  ];

  const saveRisk = async (risk = null) => {
    const values = await promptForm({
      title: t(locale, risk ? 'panel.nr1.editTitle' : 'panel.nr1.createTitle'),
      message: t(locale, 'panel.nr1.formHint'),
      confirmLabel: t(locale, 'panel.nr1.save'),
      fields: riskFields(risk),
    });
    if (!values) return;
    setBusy(true);
    try {
      const body = {
        ...(companyId ? { companyId: Number(companyId) } : {}),
        factor: values.factor,
        hazard: values.hazard,
        exposedGroup: values.exposedGroup || '',
        probability: Number(values.probability) || 2,
        severity: Number(values.severity) || 2,
        measures: values.measures || '',
        ownerUserId: values.ownerUserId ? Number(values.ownerUserId) : null,
        dueDate: values.dueDate || null,
        status: values.status,
        ...(risk ? {} : { surveyId: data?.summary?.survey?.id ?? null }),
      };
      const res = await fetch(
        risk ? `/api/admin/psychosocial-risks/${risk.id}` : '/api/admin/psychosocial-risks',
        { method: risk ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || t(locale, 'panel.nr1.saveError'));
      toast(t(locale, 'panel.nr1.saved'), 'ok');
      await load();
    } catch (e) {
      toast(e?.message || t(locale, 'panel.nr1.saveError'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const removeRisk = async (risk) => {
    const ok = await confirm({
      title: t(locale, 'panel.nr1.deleteTitle'),
      message: t(locale, 'panel.nr1.deleteConfirm', { hazard: risk.hazard }),
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/psychosocial-risks/${risk.id}${qs}`, { method: 'DELETE' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || t(locale, 'panel.nr1.saveError'));
      toast(t(locale, 'panel.nr1.deleted'), 'ok');
      await load();
    } catch (e) {
      toast(e?.message || t(locale, 'panel.nr1.saveError'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const exportReport = async () => {
    const win = openPsychosocialReportWindow();
    if (!win) {
      toast(t(locale, 'panel.nr1.popupBlocked'), 'error');
      return;
    }
    setBusy(true);
    try {
      const sep = qs ? '&' : '?';
      const res = await fetch(`/api/admin/psychosocial-risks${qs}${sep}export=1`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || t(locale, 'panel.nr1.loadError'));
      const summary = json.summary || {};
      const opened = printPsychosocialReport(win, {
        locale,
        data: json,
        factorLabel,
        levelLabel,
        statusLabel,
        signalLabel,
        labels: {
          product: '30Grow',
          title: t(locale, 'panel.nr1.reportTitle'),
          generatedAt: t(locale, 'panel.nr1.reportGeneratedAt', { date: new Date().toLocaleString(locale) }),
          disclaimer: t(locale, 'panel.nr1.disclaimer'),
          surveyTitle: t(locale, 'panel.nr1.surveyTitle'),
          inventoryTitle: t(locale, 'panel.nr1.inventoryTitle'),
          noSurvey: t(locale, 'panel.nr1.noSurvey'),
          suppressed: t(locale, 'panel.nr1.suppressed', { n: summary.minResponses || 0 }),
          responses: t(locale, 'panel.nr1.responses', { n: summary.responseCount || 0 }),
          colFactor: t(locale, 'panel.nr1.colFactor'),
          colFavorability: t(locale, 'panel.nr1.colFavorability'),
          colSignal: t(locale, 'panel.nr1.colSignal'),
          colHazard: t(locale, 'panel.nr1.colHazard'),
          colRisk: t(locale, 'panel.nr1.colRisk'),
          colMeasures: t(locale, 'panel.nr1.colMeasures'),
          colOwner: t(locale, 'panel.nr1.colOwner'),
          colStatus: t(locale, 'panel.nr1.colStatus'),
          noRisks: t(locale, 'panel.nr1.emptyTitle'),
          footer: t(locale, 'panel.nr1.reportFooter'),
        },
      });
      if (!opened) toast(t(locale, 'panel.nr1.popupBlocked'), 'error');
    } catch (e) {
      win.close();
      toast(e?.message || t(locale, 'panel.nr1.loadError'), 'error');
    } finally {
      setBusy(false);
    }
  };

  if (loading && !data) return <AppLoading variant="panel" />;
  if (!data) {
    return (
      <EmptyState
        title={t(locale, 'panel.nr1.loadError')}
        actionLabel={t(locale, 'panel.common.retry')}
        onAction={load}
      />
    );
  }

  const summary = data?.summary || {};
  const survey = summary.survey || null;
  const risks = data?.risks || [];

  return (
    <ContentEnter animKey={`nr1-${companyId || ''}`}>
      <div className={S.stack}>
        <InlineCallout tone="warning">{t(locale, 'panel.nr1.disclaimer')}</InlineCallout>

        <section className={S.card} aria-labelledby="nr1-survey-heading">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 id="nr1-survey-heading" className="m-0 font-ui text-base font-semibold text-ink">
                {t(locale, 'panel.nr1.surveyTitle')}
              </h3>
              <p className={cn(S.muted, 'm-0 mt-1')}>
                {survey
                  ? `${survey.title} · ${t(locale, 'panel.nr1.responses', { n: summary.responseCount || 0 })}`
                  : t(locale, 'panel.nr1.noSurvey')}
              </p>
            </div>
            {survey ? (
              <button type="button" className={S.btnGhost} onClick={() => onOpenSurvey?.(survey.id)}>
                {t(locale, 'panel.nr1.openSurvey')}
              </button>
            ) : (
              <button type="button" className={S.btnBrandSoft} disabled={busy} onClick={onCreateSurvey}>
                {t(locale, 'panel.nr1.createSurvey')}
              </button>
            )}
          </div>
          {survey && summary.suppressed ? (
            <p className={cn(S.faint, 'm-0 mt-3')}>
              {t(locale, 'panel.nr1.suppressed', { n: summary.minResponses || 0 })}
            </p>
          ) : null}
          {survey && !summary.suppressed && (summary.factors || []).length > 0 ? (
            <ul className="m-0 mt-4 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2">
              {summary.factors.map((f) => (
                <li key={f.factor} className="min-w-0">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="truncate font-ui text-sm text-ink">{factorLabel(f.factor)}</span>
                    <StatusToneChip tone={SIGNAL_TONE[f.signal] || 'neutral'}>
                      {f.favorability}% · {signalLabel(f.signal)}
                    </StatusToneChip>
                  </div>
                  <MeterBar
                    percent={f.favorability}
                    toneClass={SIGNAL_BAR[f.signal] || 'bg-ink/30'}
                    aria-label={`${factorLabel(f.factor)}: ${f.favorability}%`}
                  />
                </li>
              ))}
            </ul>
          ) : null}
          {survey && !summary.suppressed ? (
            <p className={cn(S.faint, 'm-0 mt-3')}>{t(locale, 'panel.nr1.signalHint')}</p>
          ) : null}
        </section>

        <section aria-labelledby="nr1-inventory-heading" className={S.stack}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 id="nr1-inventory-heading" className="m-0 font-ui text-base font-semibold text-ink">
              {t(locale, 'panel.nr1.inventoryTitle')}
            </h3>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={S.btnGhost} disabled={busy} onClick={exportReport}>
                {t(locale, 'panel.nr1.exportPdf')}
              </button>
              <AdminCreateButton
                variant="secondary"
                label={t(locale, 'panel.nr1.addRisk')}
                onClick={() => saveRisk(null)}
                disabled={busy}
              />
            </div>
          </div>
          {risks.length === 0 ? (
            <EmptyState
              title={t(locale, 'panel.nr1.emptyTitle')}
              message={t(locale, 'panel.nr1.emptyHint')}
              actionLabel={t(locale, 'panel.nr1.addRisk')}
              onAction={() => saveRisk(null)}
              actionDisabled={busy}
            />
          ) : (
            <AdminTableShell locale={locale} minWidth="760px" animKey={risks.length} ariaLabel={t(locale, 'panel.nr1.inventoryTitle')}>
              <thead>
                <tr>
                  <AdminTh>{t(locale, 'panel.nr1.colFactor')}</AdminTh>
                  <AdminTh>{t(locale, 'panel.nr1.colHazard')}</AdminTh>
                  <AdminTh>{t(locale, 'panel.nr1.colRisk')}</AdminTh>
                  <AdminTh>{t(locale, 'panel.nr1.colOwner')}</AdminTh>
                  <AdminTh>{t(locale, 'panel.nr1.colStatus')}</AdminTh>
                  <AdminActionsTh>{t(locale, 'panel.admin.colActions')}</AdminActionsTh>
                </tr>
              </thead>
              <tbody>
                {risks.map((r) => (
                  <tr key={r.id} className="border-b border-ink/[0.07] align-top">
                    <td className="px-4 py-3 text-ink">{factorLabel(r.factor)}</td>
                    <td className="px-4 py-3">
                      <div className="text-ink">{r.hazard}</div>
                      {r.exposedGroup ? <div className={cn(S.faint, 'mt-0.5')}>{r.exposedGroup}</div> : null}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <StatusToneChip tone={LEVEL_TONE[r.level] || 'neutral'} title={`${r.probability}×${r.severity}`}>
                        {r.riskScore} · {levelLabel(r.level)}
                      </StatusToneChip>
                    </td>
                    <td className="px-4 py-3 text-ink-muted">
                      {r.ownerName || t(locale, 'panel.nr1.ownerNone')}
                      {r.dueDate ? <div className="font-mono text-2xs text-ink-faint">{r.dueDate}</div> : null}
                    </td>
                    <td className="px-4 py-3">
                      <StatusToneChip tone={STATUS_TONE[r.status] || 'neutral'}>{statusLabel(r.status)}</StatusToneChip>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <AdminActionsCell>
                        <AdminEditButton label={t(locale, 'panel.nr1.editTitle')} onClick={() => saveRisk(r)} disabled={busy} />
                        <AdminDeleteButton label={t(locale, 'panel.nr1.deleteTitle')} onClick={() => removeRisk(r)} disabled={busy} />
                      </AdminActionsCell>
                    </td>
                  </tr>
                ))}
              </tbody>
            </AdminTableShell>
          )}
        </section>
      </div>
    </ContentEnter>
  );
}
