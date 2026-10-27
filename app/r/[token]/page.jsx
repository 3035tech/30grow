'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { TYPE_DATA } from '../../../lib/data';
import { getTypeData } from '../../../lib/i18n-data';
import { errorMessage, t } from '../../../lib/i18n';
import { useLocale } from '../../../lib/useLocale';
import { C } from '../../../lib/theme';
import { cn } from '../../../lib/cn';
import { typeFullName, typeHintTooltip, typeShortLabel } from '../../../lib/type-en';
import { RichTextView } from '../../_components/RichTextView';
import { isRichTextEmpty } from '../../../lib/sanitize-html';
import { motivatorDimensionLabel } from '../../../lib/ae/motivators-dimensions';
import { recommendationFromStage } from '../../../lib/recruiting/vacancy-report-shared';
import { formatSalaryBr } from '../../../lib/br-masks';
import { BrandPulseLoading, PublicFunnyError } from '../../_components/PublicStatusScreens';
import { S } from '../../dashboard/dashboard-shared';
import { printClientReport } from '../../../lib/client-report-print';

const miniLabelClass =
  'mb-0.5 mt-0 font-mono text-2xs uppercase tracking-[0.08em] text-ink-faint';

function ScoreBars({ scores, locale }) {
  const entries = [];
  for (let i = 1; i <= 9; i += 1) {
    const v = Number(scores?.[i] ?? scores?.[String(i)] ?? 0) || 0;
    entries.push({ t: i, v });
  }
  const max = Math.max(...entries.map((e) => e.v), 1);
  return (
    <div className="flex flex-col gap-1">
      {entries.map((e) => (
        <div key={e.t} className="flex items-center gap-2" title={typeHintTooltip(e.t, locale)}>
          <span className="w-7 cursor-help font-mono text-2xs text-ink-faint">T{e.t}</span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-sm bg-ink/[0.08]">
            <div
              className="h-full rounded-sm"
              style={{
                width: `${(e.v / max) * 100}%`,
                background: TYPE_DATA[e.t]?.color || C.purple,
              }}
            />
          </div>
          <span className="w-7 text-right font-mono text-2xs text-ink-faint">{e.v}</span>
        </div>
      ))}
    </div>
  );
}

function formatTypeList(types, locale) {
  return (types || [])
    .map((n) => {
      const num = Number(n);
      if (!Number.isFinite(num)) return null;
      return `T${num} · ${typeShortLabel(num, locale)}`;
    })
    .filter(Boolean)
    .join(', ');
}

function recommendationLabel(locale, rec) {
  if (rec === 'advance') return t(locale, 'panel.report.recAdvance');
  if (rec === 'discuss') return t(locale, 'panel.report.recDiscuss');
  if (rec === 'exclude') return t(locale, 'panel.report.recExclude');
  return t(locale, 'panel.report.recBank');
}

function availabilityLabel(locale, value) {
  const map = {
    immediate: 'recruiting.availabilityImmediate',
    '15_days': 'recruiting.availability15',
    '30_days': 'recruiting.availability30',
    '60_days': 'recruiting.availability60',
    other: 'recruiting.availabilityOther',
  };
  return map[value] ? t(locale, map[value]) : value || '';
}

function profileBits(c, locale) {
  const bits = [];
  const loc = [c.city, c.state].filter(Boolean).join(' / ');
  if (loc) bits.push(loc);
  if (c.availability) bits.push(availabilityLabel(locale, c.availability));
  if (c.salaryExpectation) {
    bits.push(formatSalaryBr(c.salaryExpectation) || String(c.salaryExpectation));
  }
  return bits;
}

function CandidateCard({ c, locale, vacancyTitle, hasRubric }) {
  const [openBars, setOpenBars] = useState(false);
  const typeData = getTypeData(locale);
  const d = c.topType != null ? typeData[c.topType] : null;
  const aligned = hasRubric ? formatTypeList(c.fitAlignedTypes, locale) : '';
  const gaps = hasRubric ? formatTypeList(c.fitGapTypes, locale) : '';
  const rec = c.recommendation || recommendationFromStage(c.pipelineStage);
  const meta = profileBits(c, locale);
  const why = c.why || c.consultantNote;
  const motivators = Array.isArray(c.motivatorsTop) ? c.motivatorsTop : [];
  const roleReading =
    c.topType != null && vacancyTitle
      ? hasRubric && aligned
        ? t(locale, 'panel.report.roleReadingAligned', {
            vacancy: vacancyTitle,
            type: c.topType,
            typeName: typeShortLabel(c.topType, locale),
            types: aligned,
            score: c.vacancyFitScore010 != null ? Number(c.vacancyFitScore010).toFixed(1) : '—',
          })
        : hasRubric
          ? t(locale, 'panel.report.roleReading', {
              vacancy: vacancyTitle,
              type: c.topType,
              typeName: typeShortLabel(c.topType, locale),
              score: c.vacancyFitScore010 != null ? Number(c.vacancyFitScore010).toFixed(1) : '—',
            })
          : t(locale, 'panel.report.roleReadingNoFit', {
              vacancy: vacancyTitle,
              type: c.topType,
              typeName: typeShortLabel(c.topType, locale),
            })
      : null;

  return (
    <article className="rounded-xl border border-ink/12 bg-surface p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="m-0 font-display text-base text-ink">{c.name}</h3>
        <span className="font-mono text-2xs text-brand-500">{recommendationLabel(locale, rec)}</span>
      </div>
      <p
        className={cn(
          'mb-0 mt-2 font-mono text-xs text-ink-muted',
          c.topType != null && 'cursor-help'
        )}
        title={c.topType != null ? typeHintTooltip(c.topType, locale) : undefined}
      >
        {c.topType != null ? typeFullName(c.topType, locale) : '—'}
        {hasRubric && c.vacancyFitScore010 != null
          ? ` · ${t(locale, 'panel.report.fitLabel', { score: Number(c.vacancyFitScore010).toFixed(1) })}`
          : ''}
      </p>
      {meta.length ? (
        <p className="mb-0 mt-1.5 text-xs leading-[1.45] text-ink-muted">{meta.join(' · ')}</p>
      ) : null}

      {why || c.watchOut || c.interviewProbe ? (
        <div className="mt-3.5 flex flex-col gap-2.5">
          {why ? (
            <div className="min-h-[46px]">
              <div className={miniLabelClass}>{t(locale, 'panel.report.fieldWhy')}</div>
              <p className="m-0 text-prose leading-[1.55] text-ink">{why}</p>
            </div>
          ) : null}
          {c.watchOut ? (
            <div className="min-h-[46px]">
              <div className={miniLabelClass}>{t(locale, 'panel.report.fieldWatch')}</div>
              <p className="m-0 text-prose leading-[1.55] text-ink">{c.watchOut}</p>
            </div>
          ) : null}
          {c.interviewProbe ? (
            <div className="min-h-[46px]">
              <div className={miniLabelClass}>{t(locale, 'panel.report.fieldProbe')}</div>
              <p className="m-0 text-prose leading-[1.55] text-ink">{c.interviewProbe}</p>
            </div>
          ) : null}
        </div>
      ) : null}

      {motivators.length ? (
        <div className="mt-3">
          <div className={miniLabelClass}>{t(locale, 'panel.report.motivatorsTitle')}</div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {motivators.map((m) => (
              <span
                key={m.key}
                className="rounded-full border border-ink/12 px-2 py-1 font-mono text-2xs text-ink-muted"
              >
                {motivatorDimensionLabel(m.key, locale)}
                {m.score != null ? ` ${m.score}` : ''}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {roleReading ? (
        <p className="mb-0 mt-2.5 text-prose leading-[1.55] text-ink">{roleReading}</p>
      ) : null}
      {d?.desc ? (
        <p className="mb-0 mt-2 text-xs leading-[1.55] text-ink-muted">{d.desc}</p>
      ) : null}
      {aligned ? (
        <p className="mb-0 mt-2.5 text-xs leading-normal text-ink-muted">
          {t(locale, 'panel.report.fitAligned', { types: aligned })}
        </p>
      ) : null}
      {gaps ? (
        <p className="mb-0 mt-1 text-xs leading-normal text-ink-muted">
          {t(locale, 'panel.report.fitGaps', { types: gaps })}
        </p>
      ) : null}
      <button
        type="button"
        onClick={() => setOpenBars((v) => !v)}
        className="mt-3 cursor-pointer border-none bg-transparent p-0 font-mono text-xs text-brand-500 underline"
      >
        {openBars ? t(locale, 'panel.report.hideScoreMap') : t(locale, 'panel.report.showScoreMap')}
      </button>
      {openBars ? (
        <div className="mt-2.5">
          <ScoreBars scores={c.scores} locale={locale} />
        </div>
      ) : null}
    </article>
  );
}

function FitCompareChart({ candidates, locale }) {
  const ranked = (Array.isArray(candidates) ? candidates : [])
    .filter((c) => c.vacancyFitScore010 != null)
    .slice()
    .sort((a, b) => Number(b.vacancyFitScore010) - Number(a.vacancyFitScore010))
    .slice(0, 6);
  if (ranked.length < 2) return null;
  const max = Math.max(...ranked.map((c) => Number(c.vacancyFitScore010) || 0), 1);
  return (
    <section className="mb-5 rounded-xl border border-ink/12 bg-ink/[0.02] px-4 py-3.5">
      <p className="mb-3 mt-0 font-mono text-2xs uppercase tracking-[0.12em] text-ink-label">
        {t(locale, 'panel.report.fitCompareTitle')}
      </p>
      <div className="flex flex-col gap-2">
        {ranked.map((c, i) => {
          const score = Number(c.vacancyFitScore010) || 0;
          const pct = Math.round((score / 10) * 100);
          return (
            <div key={`${c.name}-${i}`} className="flex items-center gap-2.5">
              <span
                className="w-[120px] shrink-0 overflow-hidden text-ellipsis whitespace-nowrap text-xs text-ink"
                title={c.name}
              >
                {c.name}
              </span>
              <div className="h-2.5 flex-1 overflow-hidden rounded-[5px] bg-ink/[0.08]">
                <div
                  className={cn('h-full rounded-[5px]', i === 0 ? 'bg-success' : 'bg-brand-500')}
                  style={{
                    width: `${Math.min(100, Math.round((score / max) * 100))}%`,
                    minWidth: score > 0 ? '4px' : 0,
                  }}
                />
              </div>
              <span className="w-[52px] text-right font-mono text-xs text-ink-muted">
                {score.toFixed(1)}
                <span className="text-2xs text-ink-faint"> ({pct}%)</span>
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Shell({ children }) {
  return (
    <div className="min-h-screen bg-canvas font-display text-ink">
      <style>{`
        @media print {
          .r-no-print { display: none !important; }
          body { background: #fff !important; }
          .r-glow { display: none !important; }
        }
      `}</style>
      <div className="r-glow pointer-events-none fixed inset-0 bg-radial-glow-single" />
      <main className="relative mx-auto max-w-[880px] px-5 pb-16 pt-10">{children}</main>
    </div>
  );
}

function ReportInner() {
  const params = useParams();
  const token = typeof params?.token === 'string' ? params.token : Array.isArray(params?.token) ? params.token[0] : '';
  const [locale] = useLocale();
  const [state, setState] = useState({ loading: true, error: '', data: null });

  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);
    return () => {
      try {
        document.head.removeChild(meta);
      } catch {
        /* ignore */
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const tokenValue = String(token || '').trim();
      if (!tokenValue) {
        if (!cancelled) setState({ loading: false, error: t(locale, 'panel.report.publicInvalid'), data: null });
        return;
      }
      try {
        const res = await fetch(`/api/public/vacancy-report?token=${encodeURIComponent(tokenValue)}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(
            data?.errorCode === 'EXPIRED_LINK'
              ? t(locale, 'panel.report.publicExpired')
              : data?.errorCode
                ? errorMessage(locale, data.errorCode, data.error)
                : data?.error || t(locale, 'panel.report.publicInvalid')
          );
        }
        if (!cancelled) setState({ loading: false, error: '', data });
      } catch (e) {
        if (!cancelled) setState({ loading: false, error: e?.message || t(locale, 'errors.INTERNAL'), data: null });
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [token, locale]);

  const snap = state.data?.snapshot || {};
  const candidates = useMemo(() => (Array.isArray(snap.candidates) ? snap.candidates : []), [snap.candidates]);
  const rubricSummary = snap.rubricSummary || null;

  const compareLine = useMemo(() => {
    if (!rubricSummary?.hasRubric) return '';
    const ranked = candidates
      .filter((c) => c.vacancyFitScore010 != null)
      .slice()
      .sort((a, b) => Number(b.vacancyFitScore010) - Number(a.vacancyFitScore010));
    if (ranked.length < 2) return '';
    const lead = ranked[0];
    const second = ranked[1];
    const last = ranked[ranked.length - 1];
    if (ranked.length === 2) {
      return t(locale, 'panel.report.compareTwo', {
        a: lead.name,
        aFit: Number(lead.vacancyFitScore010).toFixed(1),
        b: second.name,
        bFit: Number(second.vacancyFitScore010).toFixed(1),
      });
    }
    return t(locale, 'panel.report.compareMany', {
      a: lead.name,
      aFit: Number(lead.vacancyFitScore010).toFixed(1),
      b: second.name,
      bFit: Number(second.vacancyFitScore010).toFixed(1),
      c: last.name,
      cFit: Number(last.vacancyFitScore010).toFixed(1),
    });
  }, [candidates, locale, rubricSummary?.hasRubric]);

  if (state.loading) {
    return (
      <Shell>
        <BrandPulseLoading locale={locale} label={t(locale, 'panel.report.publicLoading')} fullPage />
      </Shell>
    );
  }

  if (state.error || !state.data) {
    return (
      <Shell>
        <PublicFunnyError
          locale={locale}
          title={t(locale, 'panel.report.publicUnavailable')}
          message={state.error || t(locale, 'panel.report.funnyErrorBody')}
          onRetry={() => {
            if (typeof window !== 'undefined') window.location.reload();
          }}
        />
      </Shell>
    );
  }

  const vacancy = snap.vacancy || {};
  const note = state.data.executiveNote || snap.executiveNote;
  const expiresAt = state.data.expiresAt ? new Date(state.data.expiresAt) : null;
  const generatedAt = snap.generatedAt
    ? new Date(snap.generatedAt)
    : state.data.createdAt
      ? new Date(state.data.createdAt)
      : null;
  const weightedTypes = Array.isArray(rubricSummary?.weightedTypes) ? rubricSummary.weightedTypes : [];
  const rubricTypesLabel = formatTypeList(
    weightedTypes.map((w) => w.type),
    locale
  );

  return (
    <Shell>
      <header className="mb-7">
        {vacancy.companyLogoUrl ? (
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <img
              src={vacancy.companyLogoUrl}
              alt=""
              width={48}
              height={48}
              className="h-12 w-12 rounded-control object-contain"
            />
            {vacancy.companyName ? (
              <p className="m-0 font-mono text-2xs font-semibold uppercase tracking-[0.16em] text-ink-label">
                {vacancy.companyName}
              </p>
            ) : null}
          </div>
        ) : vacancy.companyName ? (
          <p className="mb-2 mt-0 font-mono text-2xs font-semibold uppercase tracking-[0.16em] text-ink-label">
            {vacancy.companyName}
          </p>
        ) : (
          <p className="mb-2 mt-0 font-mono text-2xs font-semibold uppercase tracking-[0.2em] text-brand-500">
            30Grow
          </p>
        )}
        <h1 className="mb-1.5 mt-0 font-display text-3xl font-semibold text-ink">
          {state.data.title || vacancy.title || t(locale, 'panel.report.publicTitle')}
        </h1>
        <p className="m-0 text-sm text-ink-muted">
          {[
            vacancy.companyLogoUrl ? vacancy.companyName : null,
            vacancy.positionsCount != null
              ? t(locale, 'panel.report.positions', { n: vacancy.positionsCount })
              : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
        <p className="mb-0 mt-2.5 font-mono text-xs text-ink-faint">
          {generatedAt ? t(locale, 'panel.report.generatedAt', { date: generatedAt.toLocaleString(locale) }) : ''}
          {expiresAt ? ` · ${t(locale, 'panel.report.expiresAt', { date: expiresAt.toLocaleString(locale) })}` : ''}
        </p>
        <button
          type="button"
          className={cn('r-no-print', S.btnGhost, 'mt-3.5')}
          onClick={() => {
            const cands = state.data.candidates || [];
            const ok = printClientReport({
              locale,
              data: {
                ...state.data,
                executiveNote: state.data.note || state.data.executiveNote,
                candidates: cands.map((c) => ({
                  ...c,
                  recommendation: recommendationLabel(
                    locale,
                    c.recommendation || recommendationFromStage(c.pipelineStage)
                  ),
                  fitScore010: c.vacancyFitScore010,
                  whyFit: c.why || c.consultantNote || '',
                })),
              },
              labels: {
                product: '30Grow',
                publicTitle: t(locale, 'panel.report.publicTitle'),
                executiveNote: t(locale, 'panel.report.executiveNote'),
                shortlistTitle: t(locale, 'panel.report.shortlistTitle', { n: cands.length }),
                colName: t(locale, 'panel.report.colName'),
                colRec: t(locale, 'panel.report.colRec'),
                colFit: t(locale, 'panel.report.colFit'),
                colType: t(locale, 'panel.report.colType'),
                colWhy: t(locale, 'panel.report.colWhy'),
                footer: t(locale, 'panel.report.printFooterPowered'),
                empty: '—',
              },
            });
            if (!ok) window.print();
          }}
        >
          {t(locale, 'panel.report.printPdf')}
        </button>
      </header>

      {!rubricSummary?.hasRubric ? (
        <section className="mb-5 rounded-xl border border-danger/30 bg-danger/[0.05] px-4 py-3.5">
          <p className="m-0 text-prose leading-[1.55] text-danger">{t(locale, 'panel.report.noRubricBanner')}</p>
        </section>
      ) : null}

      {(rubricSummary?.hasRubric && rubricTypesLabel) || vacancy.description || rubricSummary?.notes ? (
        <section className="mb-5 rounded-xl border border-ink/12 bg-ink/[0.02] px-4 py-3.5">
          <p className="mb-1.5 mt-0 font-mono text-2xs uppercase tracking-[0.12em] text-ink-label">
            {t(locale, 'panel.report.vacancySeeksTitle')}
          </p>
          {rubricSummary?.hasRubric && rubricTypesLabel ? (
            <p className="mb-2 mt-0 text-sm leading-[1.55] text-ink">
              {t(locale, 'panel.report.vacancySeeksBody', { types: rubricTypesLabel })}
            </p>
          ) : null}
          {rubricSummary?.notes ? (
            <p className="mb-2 mt-0 text-prose leading-[1.55] text-ink-muted">{rubricSummary.notes}</p>
          ) : null}
          {!isRichTextEmpty(vacancy.description) ? (
            <div className="mt-1">
              <p className={miniLabelClass}>{t(locale, 'panel.report.vacancyDescLabel')}</p>
              <RichTextView html={vacancy.description} className="m-0 text-prose" />
            </div>
          ) : null}
          {rubricSummary?.hasRubric ? (
            <p className="mb-0 mt-2 text-xs leading-[1.45] text-ink-muted">{t(locale, 'panel.report.fitExplain')}</p>
          ) : null}
        </section>
      ) : null}

      {!isRichTextEmpty(note) ? (
        <section className={cn(S.cardTight, 'mb-6 px-[18px] py-4')}>
          <p className="mb-1.5 mt-0 font-mono text-2xs uppercase tracking-[0.12em] text-ink-label">
            {t(locale, 'panel.report.executiveNote')}
          </p>
          <RichTextView html={note} className="m-0 text-sm" />
        </section>
      ) : null}

      {compareLine ? (
        <p className="mb-3 mt-0 text-prose leading-[1.55] text-ink-muted">{compareLine}</p>
      ) : null}

      {rubricSummary?.hasRubric ? <FitCompareChart candidates={candidates} locale={locale} /> : null}

      <section className="mb-7">
        <h2 className="mb-3 mt-0 font-display text-lg font-semibold text-ink">
          {t(locale, 'panel.report.shortlistTitle', { n: candidates.length })}
        </h2>
        <div className="overflow-x-auto rounded-xl border border-ink/12 bg-surface">
          <table className="w-full border-collapse text-prose">
            <thead>
              <tr className="text-left font-mono text-2xs text-ink-muted">
                <th className="px-3.5 py-2.5">{t(locale, 'panel.report.colName')}</th>
                <th className="px-3.5 py-2.5">{t(locale, 'panel.report.colRec')}</th>
                {rubricSummary?.hasRubric ? (
                  <th className="px-3.5 py-2.5">{t(locale, 'panel.report.colFit')}</th>
                ) : null}
                <th className="px-3.5 py-2.5">{t(locale, 'panel.report.colType')}</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((c, i) => {
                const rec = c.recommendation || recommendationFromStage(c.pipelineStage);
                return (
                  <tr key={`${c.name}-${i}`} className="border-t border-ink/12">
                    <td className="px-3.5 py-2.5 text-ink">{c.name}</td>
                    <td className="px-3.5 py-2.5 font-mono text-ink-muted">{recommendationLabel(locale, rec)}</td>
                    {rubricSummary?.hasRubric ? (
                      <td className="px-3.5 py-2.5 font-mono font-semibold">
                        {c.vacancyFitScore010 != null ? `${Number(c.vacancyFitScore010).toFixed(1)}/10` : '—'}
                      </td>
                    ) : null}
                    <td
                      className={cn('px-3.5 py-2.5 font-mono', c.topType != null && 'cursor-help')}
                      title={c.topType != null ? typeHintTooltip(c.topType, locale) : undefined}
                    >
                      {c.topType != null ? `T${c.topType} · ${typeShortLabel(c.topType, locale)}` : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-3.5 mt-0 font-display text-lg font-semibold text-ink">{t(locale, 'panel.report.profilesTitle')}</h2>
        <div className="flex flex-col gap-[18px]">
          {candidates.map((c, i) => (
            <CandidateCard
              key={`card-${c.name}-${i}`}
              c={c}
              locale={locale}
              vacancyTitle={vacancy.title || state.data.title || ''}
              hasRubric={Boolean(rubricSummary?.hasRubric)}
            />
          ))}
        </div>
      </section>

      <footer className="mt-9 border-t border-ink/12 pt-4">
        <p className="m-0 text-2xs leading-[1.55] text-ink-faint">{t(locale, 'panel.report.disclaimer')}</p>
        <p className="mb-0 mt-2 font-mono text-2xs text-ink-faint">
          {t(locale, 'panel.report.poweredBy')}
        </p>
      </footer>
    </Shell>
  );
}

export default function VacancyReportPage() {
  return (
    <Suspense
      fallback={
        <Shell>
          <BrandPulseLoading locale="pt-BR" label="…" fullPage />
        </Shell>
      }
    >
      <ReportInner />
    </Suspense>
  );
}
