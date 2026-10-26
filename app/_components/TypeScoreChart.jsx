'use client';

import { useState } from 'react';
import { getTypeData } from '../../lib/i18n-data';
import { rankEnneagramScores } from '../../lib/assessment/enneagram-cross';
import { t } from '../../lib/i18n';
import { typeHintTooltip, typeShortLabel } from '../../lib/type-en';
import { C } from '../../lib/theme';
import { cn } from '../../lib/cn';
import { DisclosureToggle } from './CollapsibleBlock';

function MiniBar({ value, max, color, h = 6 }) {
  return (
    <div
      className="ui-meter-track w-full overflow-hidden bg-ink/[0.08]"
      style={{ height: h, borderRadius: h / 2 }}
    >
      <div
        className="ui-meter-fill h-full"
        style={{
          width: `${(value / Math.max(max, 1)) * 100}%`,
          background: color,
          borderRadius: h / 2,
        }}
      />
    </div>
  );
}

/**
 * T1–T9 score chart with type names and expandable characteristics.
 * Whole section can collapse (default open).
 */
export function TypeScoreChart({ scores, locale, highlightTypes, defaultCollapsed = false }) {
  const typeData = getTypeData(locale);
  const ranked = rankEnneagramScores(scores);
  const maxS = ranked[0]?.score || 1;
  const [openType, setOpenType] = useState(null);
  const [sectionOpen, setSectionOpen] = useState(!defaultCollapsed);
  const cluster = highlightTypes instanceof Set ? highlightTypes : null;
  const top = ranked[0];

  return (
    <div className="ui-type-score-chart">
      <button
        type="button"
        onClick={() => setSectionOpen((v) => !v)}
        aria-expanded={sectionOpen}
        className="mb-2 flex w-full min-h-touch cursor-pointer items-center justify-between gap-2 rounded-control border border-ink/12 bg-ink/[0.02] px-3 py-2 text-left"
      >
        <span className="min-w-0">
          <span className="block font-mono text-2xs uppercase tracking-wide text-ink-faint">
            {t(locale, 'panel.team.scoresByType')}
          </span>
          {!sectionOpen && top ? (
            <span className="mt-0.5 block text-xs text-ink-muted">
              {t(locale, 'panel.team.scoresCollapsedHint', {
                type: `T${top.type}`,
                name: typeShortLabel(top.type, locale),
                score: top.score,
              })}
            </span>
          ) : null}
        </span>
        <DisclosureToggle locale={locale} open={sectionOpen} />
      </button>

      {sectionOpen ? (
        <>
          <p className="mb-2.5 mt-0 text-xs leading-normal text-ink-faint">
            {t(locale, 'candidate.scoreChartHint')}
          </p>
          <div className="flex flex-col gap-2">
            {ranked.map(({ type, score }) => {
              const d = typeData[type];
              if (!d) return null;
              const highlight =
                cluster && cluster.size > 1 ? cluster.has(type) : ranked[0]?.type === type;
              const expanded = openType === type;
              const short = typeShortLabel(type, locale);
              const tip = typeHintTooltip(type, locale);
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => setOpenType(expanded ? null : type)}
                  aria-expanded={expanded}
                  title={tip}
                  aria-label={tip}
                  className={cn(
                    'block w-full cursor-pointer rounded-control px-3 py-2.5 text-left font-display',
                    highlight ? 'opacity-100' : 'opacity-[0.78]'
                  )}
                  style={{
                    border: expanded ? `1px solid ${d.color}55` : `1px solid ${C.border}`,
                    background: expanded
                      ? `${d.color}0c`
                      : highlight
                        ? `${d.color}08`
                        : 'transparent',
                  }}
                >
                  <div className="flex items-baseline justify-between gap-2.5">
                    <span className="min-w-0 text-prose font-semibold" style={{ color: d.color }}>
                      {d.emoji}{' '}
                      <span className="font-mono text-2xs tracking-wide">T{type}</span>
                      {' · '}
                      {short}
                    </span>
                    <span className="shrink-0 font-mono text-xs text-ink">{score}</span>
                  </div>
                  <p className="mb-2 mt-1 text-xs leading-[1.45] text-ink-muted">{d.team}</p>
                  <MiniBar value={score} max={maxS} color={d.color} h={highlight ? 7 : 5} />
                  {expanded ? (
                    <div className="mt-2.5 pt-2.5" style={{ borderTop: `1px solid ${d.color}33` }}>
                      <p className="mb-2 mt-0 text-prose leading-relaxed text-ink">{d.desc}</p>
                      <div className="mb-2 flex flex-wrap gap-1.5">
                        {d.strengths.map((s) => (
                          <span
                            key={s}
                            className="rounded-full px-2 py-0.5 text-2xs"
                            style={{
                              background: `${d.color}18`,
                              border: `1px solid ${d.color}35`,
                              color: d.color,
                            }}
                          >
                            {s}
                          </span>
                        ))}
                      </div>
                      <p className="m-0 text-xs italic leading-normal text-ink-muted">
                        {t(locale, 'candidate.challenge')}: {d.challenge}
                      </p>
                    </div>
                  ) : null}
                </button>
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
}
