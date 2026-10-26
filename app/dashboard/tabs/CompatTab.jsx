'use client';

import { SelectField } from '../../_components/SelectField';

import { useState } from 'react';
import { TYPE_DATA } from '../../../lib/data';
import { PAGE_SIZE_OPTIONS } from '../../../lib/assessment/assessment-filters';
import { t } from '../../../lib/i18n';
import { personListName } from '../../../lib/person-name';
import { C } from '../../../lib/theme';
import { cn } from '../../../lib/cn';
import { CompatBadge, S, TypeBadge } from '../dashboard-shared';
import { DisclosureToggle } from '../../_components/CollapsibleBlock';
import { ContentEnter } from '../../_components/AppLoading';
import { EmptyState } from '../../_components/EmptyState';

function PersonCard({ person, locale }) {
  const d = TYPE_DATA[person.topType] || {};
  return (
    <div className="min-w-0 rounded-xl border border-ink/12 bg-ink/[0.03] p-3.5">
      <div className="mb-2 flex items-center gap-2.5">
        <div className="shrink-0 text-2xl">{d.emoji || '·'}</div>
        <div className="min-w-0">
          <div
            className="overflow-hidden text-ellipsis whitespace-nowrap text-prose text-ink"
            title={person.name}
          >
            {personListName(person.name)}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <TypeBadge type={person.topType} locale={locale} compact />
            {person.areaLabel ? (
              <span className="max-w-full break-words rounded-full border border-ink/12 bg-ink/[0.04] px-2 py-0.5 font-mono text-2xs text-ink/80">
                {person.areaLabel}
              </span>
            ) : null}
          </div>
        </div>
      </div>
      {d.team ? (
        <p className="m-0 text-xs leading-snug text-ink-faint">{d.team}</p>
      ) : null}
    </div>
  );
}

function Glossary({ locale, open, onToggle }) {
  const items = [
    { level: 'tension', color: C.tension, titleKey: 'panel.compat.glossTensionTitle', bodyKey: 'panel.compat.glossTensionBody' },
    { level: 'synergy', color: C.synergy, titleKey: 'panel.compat.glossSynergyTitle', bodyKey: 'panel.compat.glossSynergyBody' },
    { level: 'neutral', color: C.neutral, titleKey: 'panel.compat.glossNeutralTitle', bodyKey: 'panel.compat.glossNeutralBody' },
  ];
  return (
    <div className="mb-4">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={cn(
          'flex min-h-touch w-full max-w-md cursor-pointer items-center justify-between gap-3 rounded-control border border-ink/12 bg-transparent px-3 py-2 text-left',
          open && 'mb-2.5'
        )}
      >
        <span className="font-mono text-xs text-ink-muted">
          {t(locale, 'panel.compat.glossaryTitle')}
        </span>
        <DisclosureToggle locale={locale} open={open} />
      </button>
      {open ? (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-2.5">
          {items.map((item) => (
            <div
              key={item.level}
              className="rounded-xl px-3.5 py-3"
              style={{
                border: `1px solid ${item.color}35`,
                background: `${item.color}0a`,
              }}
            >
              <div className="mb-1.5 flex items-center gap-2">
                <CompatBadge level={item.level} locale={locale} />
                <span className="font-mono text-xs" style={{ color: item.color }}>
                  {t(locale, item.titleKey)}
                </span>
              </div>
              <p className="m-0 text-xs leading-snug text-ink-muted">
                {t(locale, item.bodyKey)}
              </p>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function CompatTab({
  tensions,
  synergies,
  pairs,
  pairTotals = null,
  compatPage = 1,
  compatPageSize = 20,
  onCompatPagination,
  locale = 'pt-BR',
  needsCompanyScope = false,
}) {
  const [section, setSection] = useState('tensions');
  const [adviceOpen, setAdviceOpen] = useState(false);
  const [glossaryOpen, setGlossaryOpen] = useState(false);

  if (needsCompanyScope) {
    return (
      <div className={cn(S.card, 'p-5 sm:px-6')}>
        <span className={S.label}>{t(locale, 'panel.compat.needsCompanyScopeTitle')}</span>
        <p className="mt-2.5 mb-0 max-w-[62ch] text-prose leading-relaxed text-ink-muted">
          {t(locale, 'panel.compat.needsCompanyScopeBody')}
        </p>
      </div>
    );
  }

  const goSection = (id) => {
    setSection(id);
    if (onCompatPagination) onCompatPagination({ page: 1, pageSize: compatPageSize });
  };

  const tensionCount = pairTotals?.tensions ?? tensions.length;
  const synergyCount = pairTotals?.synergies ?? synergies.length;
  const pairCount = pairTotals?.pairs ?? pairs.length;

  const summaryCards = [
    {
      id: 'tensions',
      l: t(locale, 'panel.compat.cardTensionPairs'),
      n: tensionCount,
      c: C.tension,
      d: t(locale, 'panel.compat.cardTensionHint'),
      action: t(locale, 'panel.compat.cardTensionAction'),
    },
    {
      id: 'synergies',
      l: t(locale, 'panel.compat.cardSynergyPairs'),
      n: synergyCount,
      c: C.synergy,
      d: t(locale, 'panel.compat.cardSynergyHint'),
      action: t(locale, 'panel.compat.cardSynergyAction'),
    },
    {
      id: 'all',
      l: t(locale, 'panel.compat.cardTotalPairs'),
      n: pairCount,
      c: C.purpleLight,
      d: t(locale, 'panel.compat.cardTotalHint'),
      action: t(locale, 'panel.compat.cardTotalAction'),
    },
  ];

  const display = section === 'tensions' ? tensions : section === 'synergies' ? synergies : pairs;
  const listLen = display.length;
  const totalPg = Math.max(1, Math.ceil(listLen / compatPageSize));
  const pg = Math.min(Math.max(1, compatPage || 1), totalPg);
  const sliced = listLen === 0 ? [] : display.slice((pg - 1) * compatPageSize, pg * compatPageSize);
  const topRisks = tensions.slice(0, 3);
  const topWins = synergies.slice(0, 3);

  const playbook =
    section === 'tensions'
      ? { title: t(locale, 'panel.compat.decisionTitle'), body: t(locale, 'panel.compat.tensionAdvice'), color: C.tension }
      : section === 'synergies'
        ? { title: t(locale, 'panel.compat.opportunityTitle'), body: t(locale, 'panel.compat.synergyAdvice'), color: C.synergy }
        : null;

  return (
    <div>
      <div className={cn(S.card, 'mb-3.5 px-7 py-[22px]')}>
        <span className={S.label}>{t(locale, 'dashboard.compatibility')}</span>
        <h2 className="mt-2 mb-0 font-ui text-2xl font-semibold font-normal leading-tight text-ink">
          {t(locale, 'panel.compat.headline')}
        </h2>
        <p className="mt-2.5 mb-0 max-w-[64ch] text-sm leading-relaxed text-ink-muted">
          {t(locale, 'panel.compat.intro')}
        </p>
        <p className="mt-2 mb-0 max-w-[64ch] text-xs leading-snug text-ink-faint">
          {t(locale, 'panel.compat.whyTeam')}
        </p>
        <p className="mt-3 mb-0 text-xs leading-snug text-ink-faint">
          {t(locale, 'panel.compat.methodologyBody')}
        </p>
      </div>

      <Glossary locale={locale} open={glossaryOpen} onToggle={() => setGlossaryOpen((v) => !v)} />

      <p className="mb-2.5 mt-0 font-mono text-xs text-ink-faint">
        {t(locale, 'panel.compat.filterByCardsHint')}
      </p>

      <div className="mb-4 grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3">
        {summaryCards.map((x) => {
          const active = section === x.id;
          return (
            <button
              key={x.id}
              type="button"
              onClick={() => goSection(x.id)}
              aria-pressed={active}
              className="cursor-pointer rounded-card border bg-surface px-5 py-[18px] text-left"
              style={{
                borderColor: active ? x.c : `${x.c}25`,
                boxShadow: active ? `0 0 0 2px ${x.c}22` : 'none',
              }}
            >
              <div className="mb-1 font-display text-3xl font-semibold" style={{ color: x.c }}>{x.n}</div>
              <div className="mb-1.5 font-mono text-2xs uppercase tracking-wide text-ink-muted">
                {x.l}
              </div>
              <div className="mb-2.5 text-xs text-ink-faint">{x.d}</div>
              <div className="font-mono text-2xs font-semibold text-ink/80">{x.action}</div>
            </button>
          );
        })}
      </div>

      {section === 'tensions' && topRisks.length > 0 ? (
        <div className={cn(S.card, 'mb-3.5 border-danger/30 bg-danger/[0.04]')}>
          <span className={cn(S.label, 'text-danger')}>{t(locale, 'panel.compat.topRisksTitle')}</span>
          <p className="mb-3.5 mt-2 text-prose leading-snug text-ink-muted">
            {t(locale, 'panel.compat.topRisksIntro')}
          </p>
          <div className="flex flex-col gap-2.5">
            {topRisks.map((pair, i) => (
              <div
                key={`risk-${pair.a?.assessmentId}-${pair.b?.assessmentId}-${i}`}
                className="flex flex-wrap items-center gap-2.5 rounded-control border border-ink/12 bg-surface px-3 py-2.5"
              >
                <span className="min-w-[18px] font-mono text-2xs text-danger">
                  {i + 1}.
                </span>
                <span className="text-prose text-ink">
                  {personListName(pair.a.name)} × {personListName(pair.b.name)}
                </span>
                <TypeBadge type={pair.a.topType} locale={locale} compact />
                <TypeBadge type={pair.b.topType} locale={locale} compact />
                <span className="min-w-0 flex-[1_1_160px] text-xs text-ink-muted">{pair.compat.title}</span>
                <span className="font-mono text-xs text-danger">
                  {t(locale, 'panel.compat.topRiskNext')}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {section === 'synergies' && topWins.length > 0 ? (
        <div className={cn(S.card, 'mb-3.5 border-success/30 bg-success/[0.04]')}>
          <span className={cn(S.label, 'text-success')}>{t(locale, 'panel.compat.topWinsTitle')}</span>
          <p className="mb-3.5 mt-2 text-prose leading-snug text-ink-muted">
            {t(locale, 'panel.compat.topWinsIntro')}
          </p>
          <div className="flex flex-col gap-2.5">
            {topWins.map((pair, i) => (
              <div
                key={`win-${pair.a?.assessmentId}-${pair.b?.assessmentId}-${i}`}
                className="flex flex-wrap items-center gap-2.5 rounded-control border border-ink/12 bg-surface px-3 py-2.5"
              >
                <span className="min-w-[18px] font-mono text-2xs text-success">
                  {i + 1}.
                </span>
                <span className="text-prose text-ink">
                  {personListName(pair.a.name)} × {personListName(pair.b.name)}
                </span>
                <TypeBadge type={pair.a.topType} locale={locale} compact />
                <TypeBadge type={pair.b.topType} locale={locale} compact />
                <span className="min-w-0 flex-[1_1_160px] text-xs text-ink-muted">{pair.compat.title}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {playbook ? (
        <div
          className="mb-3.5 overflow-hidden rounded-xl"
          style={{
            border: `1px solid ${playbook.color}30`,
            background: `${playbook.color}08`,
          }}
        >
          <button
            type="button"
            onClick={() => setAdviceOpen((v) => !v)}
            className="flex w-full cursor-pointer items-center justify-between gap-3 border-none bg-transparent px-4 py-3 text-left"
            aria-expanded={adviceOpen}
          >
            <span className="font-mono text-xs" style={{ color: playbook.color }}>
              {playbook.title}: {t(locale, 'panel.compat.playbookToggle')}
            </span>
            <DisclosureToggle locale={locale} open={adviceOpen} />
          </button>
          {adviceOpen ? (
            <p className="mx-4 mb-3.5 mt-0 text-prose leading-relaxed text-ink-muted">{playbook.body}</p>
          ) : null}
        </div>
      ) : null}

      {display.length === 0 ? (
        <ContentEnter animKey={`empty-${section}`}>
          <EmptyState
            title={t(locale, 'panel.compat.emptyCategory')}
            message={t(locale, 'panel.compat.emptyHint')}
          />
        </ContentEnter>
      ) : (
        <ContentEnter animKey={`${section}|${pg}|${compatPageSize}`}>
          <p className="mb-3 mt-0 font-mono text-xs text-ink-faint">
            {t(locale, 'panel.compat.listHint')}
          </p>
          {sliced.map((pair, i) => {
            const { a, b, compat } = pair;
            const pairKey = `${String(a?.assessmentId ?? 'a')}_${String(b?.assessmentId ?? 'b')}_${i}`;
            const lc = { synergy: C.synergy, tension: C.tension, neutral: C.neutral }[compat.level];

            return (
              <div
                key={pairKey}
                className="mb-3 rounded-card border bg-surface p-[18px]"
                style={{ borderColor: `${lc}30` }}
              >
                <div className="mb-3.5 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div
                      className="mb-1 font-mono text-prose uppercase tracking-wide"
                      style={{ color: lc }}
                    >
                      {compat.title}
                    </div>
                    <div className="text-2xs text-ink-faint">
                      {t(locale, 'panel.compat.whyLabel')}
                    </div>
                  </div>
                  <CompatBadge level={compat.level} locale={locale} />
                </div>

                <div className="grid grid-cols-[1fr_40px_1fr] items-stretch gap-2.5">
                  <PersonCard person={a} locale={locale} />
                  <div className="flex items-center justify-center font-mono text-base text-ink-faint">
                    ×
                  </div>
                  <PersonCard person={b} locale={locale} />
                </div>

                <p className="mt-3.5 mb-0 text-prose leading-relaxed text-ink-muted">{compat.desc}</p>
              </div>
            );
          })}
          {onCompatPagination && listLen > 0 ? (
            <div className={cn(S.card, 'mt-2 flex flex-wrap items-center justify-between gap-3 px-[18px] py-3')}>
              <span className="font-mono text-xs text-ink-muted">
                {t(locale, 'panel.compat.pairsPage', { page: pg, total: totalPg })}
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <SelectField
                  value={String(compatPageSize)}
                  onChange={(e) => {
                    const ps = parseInt(e.target.value, 10);
                    onCompatPagination({ page: 1, pageSize: ps });
                  }}
                  className={S.selectCompact}
                >
                  {PAGE_SIZE_OPTIONS.map((n) => (
                    <option key={n} value={String(n)}>
                      {t(locale, 'panel.compat.perPageShort', { n })}
                    </option>
                  ))}
                </SelectField>
                <button
                  type="button"
                  disabled={pg <= 1}
                  onClick={() => onCompatPagination({ page: pg - 1, pageSize: compatPageSize })}
                  className={cn(
                    'rounded-control border px-3 py-1.5 font-mono text-2xs',
                    pg <= 1
                      ? 'cursor-default border-ink/12 bg-transparent text-ink-faint'
                      : 'cursor-pointer border-brand-500/40 bg-brand-500/[0.09] text-brand-500'
                  )}
                >
                  {t(locale, 'dashboard.previous')}
                </button>
                <button
                  type="button"
                  disabled={pg >= totalPg}
                  onClick={() => onCompatPagination({ page: pg + 1, pageSize: compatPageSize })}
                  className={cn(
                    'rounded-control border px-3 py-1.5 font-mono text-2xs',
                    pg >= totalPg
                      ? 'cursor-default border-ink/12 bg-transparent text-ink-faint'
                      : 'cursor-pointer border-brand-500/40 bg-brand-500/[0.09] text-brand-500'
                  )}
                >
                  {t(locale, 'dashboard.next')}
                </button>
              </div>
            </div>
          ) : null}
        </ContentEnter>
      )}
    </div>
  );
}
