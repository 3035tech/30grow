'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '../../../lib/cn';
import { t, localeHtmlLang } from '../../../lib/i18n';
import { ONBOARDING_FUNNEL_DAY_OPTIONS } from '../../../lib/onboarding-funnel';
import { AdminTableShell, AdminTh, S } from '../dashboard-shared';
import { AdminListFilters, AdminListFilterSelect } from '../../_components/AdminListFilters';
import { AppLoading, ContentEnter } from '../../_components/AppLoading';
import { EmptyState } from '../../_components/EmptyState';
import { MeterBar } from '../../_components/MeterBar';
import { StatMetricTile } from '../../_components/StatMetricTile';
import { StatusToneChip } from '../../_components/StatusToneChip';

/** Funil do assistente de primeiro acesso + primeiro valor por empresa (MVP-08). Só super admin. */
export function OnboardingFunnelAdminPanel({ locale }) {
  const [days, setDays] = useState(String(ONBOARDING_FUNNEL_DAY_OPTIONS[0]));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const seq = useRef(0);
  const lang = localeHtmlLang(locale);
  const numberFmt = useMemo(() => new Intl.NumberFormat(lang), [lang]);
  const dateFmt = useMemo(() => new Intl.DateTimeFormat(lang, { day: '2-digit', month: 'short' }), [lang]);
  const fmtDate = (v) => (v ? dateFmt.format(new Date(v)) : '–');

  useEffect(() => {
    const mySeq = ++seq.current;
    setLoading(true);
    setError('');
    fetch(`/api/admin/onboarding-funnel?days=${encodeURIComponent(days)}`)
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body?.error || t(locale, 'panel.admin.onboardingFunnelLoadFailed'));
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
  }, [days, locale]);

  const steps = Array.isArray(data?.steps) ? data.steps : [];
  const companies = Array.isArray(data?.companies) ? data.companies : [];
  const fv = data?.firstValue || {};
  const started = Number(data?.startedUsers) || 0;
  const objectives = data?.objectives || {};
  const objectiveEntries = Object.entries(objectives).filter(([, n]) => n > 0);
  const medianLabel =
    fv.medianHours == null
      ? '–'
      : fv.medianHours < 48
        ? t(locale, 'panel.admin.onboardingFunnelHours', { n: numberFmt.format(Math.round(fv.medianHours)) })
        : t(locale, 'panel.admin.onboardingFunnelDays', { n: numberFmt.format(Math.round(fv.medianHours / 24)) });

  const companyStatus = (c) => {
    if (c.firstVacancyAt || c.firstAnalysisAt) return { tone: 'success', key: 'statusValue' };
    if (c.reachedDone) return { tone: 'info', key: 'statusFinished' };
    if (c.skipped) return { tone: 'warning', key: 'statusSkipped' };
    return { tone: 'neutral', key: 'statusInProgress' };
  };

  return (
    <div className="flex flex-col gap-4">
      <p className={cn(S.muted, 'm-0')}>{t(locale, 'panel.admin.onboardingFunnelIntro')}</p>

      <div className={S.card} aria-busy={loading}>
        <AdminListFilters
          aria-label={t(locale, 'panel.admin.onboardingFunnelTitle')}
          locale={locale}
          onClear={() => setDays(String(ONBOARDING_FUNNEL_DAY_OPTIONS[0]))}
          clearEnabled={days !== String(ONBOARDING_FUNNEL_DAY_OPTIONS[0])}
        >
          <AdminListFilterSelect label={t(locale, 'panel.admin.onboardingFunnelPeriod')} value={days} onChange={setDays}>
            {ONBOARDING_FUNNEL_DAY_OPTIONS.map((d) => (
              <option key={d} value={String(d)}>
                {t(locale, 'panel.admin.onboardingFunnelLastDays', { n: d })}
              </option>
            ))}
          </AdminListFilterSelect>
        </AdminListFilters>

        {error ? <p className="m-0 mt-3 font-mono text-xs text-danger">{error}</p> : null}

        {loading && !data ? (
          <div className="mt-3">
            <AppLoading locale={locale} variant="panel" />
          </div>
        ) : !error && started === 0 ? (
          <div className="mt-3">
            <EmptyState message={t(locale, 'panel.admin.onboardingFunnelEmpty')} />
          </div>
        ) : data ? (
          <ContentEnter
            animKey={`funnel-${data.days}`}
            className={cn('transition-opacity', loading && 'pointer-events-none opacity-60')}
          >
            <div className="mt-3 grid grid-cols-2 gap-2.5 md:grid-cols-4">
              <StatMetricTile value={numberFmt.format(started)} label={t(locale, 'panel.admin.onboardingFunnelStarted')} />
              <StatMetricTile
                value={numberFmt.format(Number(data.finishedUsers) || 0)}
                label={t(locale, 'panel.admin.onboardingFunnelFinished')}
              />
              <StatMetricTile
                value={`${numberFmt.format(fv.withAny || 0)} / ${numberFmt.format(fv.companies || 0)}`}
                label={t(locale, 'panel.admin.onboardingFunnelFirstValue')}
                hint={t(locale, 'panel.admin.onboardingFunnelFirstValueHint', {
                  vacancies: fv.withVacancy || 0,
                  analyses: fv.withAnalysis || 0,
                })}
              />
              <StatMetricTile value={medianLabel} label={t(locale, 'panel.admin.onboardingFunnelMedian')} />
            </div>

            {objectiveEntries.length ? (
              <p className={cn(S.faint, 'm-0 mt-3')}>
                {t(locale, 'panel.admin.onboardingFunnelObjectives')}{' '}
                {objectiveEntries
                  .map(([id, n]) => `${t(locale, `onboarding.objective.${id}Title`)} ${numberFmt.format(n)}`)
                  .join(' · ')}
              </p>
            ) : null}

            <AdminTableShell
              locale={locale}
              minWidth="640px"
              className="mt-4"
              ariaLabel={t(locale, 'panel.admin.onboardingFunnelStepsAria')}
              animKey={`steps-${data.days}`}
            >
              <thead>
                <tr className="bg-ink/[0.02]">
                  <AdminTh>{t(locale, 'panel.admin.onboardingFunnelColStep')}</AdminTh>
                  <AdminTh>{t(locale, 'panel.admin.onboardingFunnelColReach')}</AdminTh>
                  <AdminTh align="right">{t(locale, 'panel.admin.onboardingFunnelColCompleted')}</AdminTh>
                  <AdminTh align="right">{t(locale, 'panel.admin.onboardingFunnelColSkipped')}</AdminTh>
                  <AdminTh align="right">{t(locale, 'panel.admin.onboardingFunnelColAbandoned')}</AdminTh>
                </tr>
              </thead>
              <tbody>
                {steps.map((s) => (
                  <tr key={s.step} className="border-b border-ink/[0.06] last:border-b-0">
                    <td className="px-4 py-3 text-ink">{t(locale, `panel.admin.onboardingFunnelStep.${s.step}`)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <MeterBar
                          percent={s.reachPct}
                          toneClass="bg-info"
                          className="max-w-[160px]"
                          aria-label={t(locale, 'panel.admin.onboardingFunnelColReach')}
                        />
                        <span className="whitespace-nowrap font-mono text-2xs tabular-nums text-ink-muted">
                          {numberFmt.format(s.viewed)} · {s.reachPct}%
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-ink">{numberFmt.format(s.completed)}</td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-ink-muted">{numberFmt.format(s.skipped)}</td>
                    <td
                      className={cn(
                        'px-4 py-3 text-right font-mono tabular-nums',
                        s.abandoned > 0 ? 'text-danger' : 'text-ink-muted'
                      )}
                    >
                      {numberFmt.format(s.abandoned)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </AdminTableShell>
            <p className={cn(S.faint, 'm-0 mt-2')}>{t(locale, 'panel.admin.onboardingFunnelAbandonHint')}</p>

            {companies.length ? (
              <>
                <p className={cn(S.label, 'm-0 mb-2 mt-5')}>
                  {t(locale, 'panel.admin.onboardingFunnelCompanies', { n: data.companyCap })}
                </p>
                <AdminTableShell
                  locale={locale}
                  minWidth="720px"
                  ariaLabel={t(locale, 'panel.admin.onboardingFunnelCompaniesAria')}
                  animKey={`companies-${data.days}`}
                >
                  <thead>
                    <tr className="bg-ink/[0.02]">
                      <AdminTh>{t(locale, 'panel.admin.aiUsageCompany')}</AdminTh>
                      <AdminTh>{t(locale, 'panel.admin.onboardingFunnelColStarted')}</AdminTh>
                      <AdminTh>{t(locale, 'panel.admin.onboardingFunnelColFurthest')}</AdminTh>
                      <AdminTh>{t(locale, 'panel.admin.onboardingFunnelColStatus')}</AdminTh>
                      <AdminTh>{t(locale, 'panel.admin.onboardingFunnelColFirstVacancy')}</AdminTh>
                      <AdminTh>{t(locale, 'panel.admin.onboardingFunnelColFirstAnalysis')}</AdminTh>
                    </tr>
                  </thead>
                  <tbody>
                    {companies.map((c) => {
                      const st = companyStatus(c);
                      return (
                        <tr key={c.companyId} className="border-b border-ink/[0.06] last:border-b-0">
                          <td className="px-4 py-3 text-ink">{c.companyName || `#${c.companyId}`}</td>
                          <td className="px-4 py-3 font-mono text-2xs tabular-nums text-ink-muted">{fmtDate(c.startedAt)}</td>
                          <td className="px-4 py-3 text-ink-muted">
                            {c.furthestStep ? t(locale, `panel.admin.onboardingFunnelStep.${c.furthestStep}`) : '–'}
                          </td>
                          <td className="px-4 py-3">
                            <StatusToneChip tone={st.tone}>
                              {t(locale, `panel.admin.onboardingFunnel.${st.key}`)}
                            </StatusToneChip>
                          </td>
                          <td className="px-4 py-3 font-mono text-2xs tabular-nums text-ink-muted">{fmtDate(c.firstVacancyAt)}</td>
                          <td className="px-4 py-3 font-mono text-2xs tabular-nums text-ink-muted">{fmtDate(c.firstAnalysisAt)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </AdminTableShell>
              </>
            ) : null}
          </ContentEnter>
        ) : null}
      </div>
    </div>
  );
}
