'use client';

import { buildEnneagramCross } from '../../lib/assessment/enneagram-cross';
import { t } from '../../lib/i18n';
import { typeHintTooltip, typeShortLabel } from '../../lib/type-en';
import { C } from '../../lib/theme';
import { cn } from '../../lib/cn';
import { S } from '../dashboard/dashboard-shared';

function levelColor(level) {
  if (level === 'synergy') return C.synergy;
  if (level === 'tension') return C.warning;
  return C.info;
}

function levelKey(level) {
  if (level === 'synergy') return 'candidate.crossLevelSynergy';
  if (level === 'tension') return 'candidate.crossLevelTension';
  return 'candidate.crossLevelNeutral';
}

function TypeChip({ type, locale, typeData }) {
  const d = typeData[type];
  if (!d) return null;
  const tip = typeHintTooltip(type, locale);
  return (
    <span
      title={tip}
      aria-label={tip}
      className="inline-flex cursor-help items-center gap-1 rounded-full px-2.5 py-0.5 font-mono text-xs"
      style={{
        background: `${d.color}18`,
        border: `1px solid ${d.color}44`,
        color: d.color,
      }}
    >
      {d.emoji} {typeShortLabel(type, locale)}
    </span>
  );
}

function BlendCard({ pair, locale }) {
  const { blend, a, b } = pair;
  const color = levelColor(blend.level);
  return (
    <div
      className="rounded-control px-3.5 py-3"
      style={{
        background: `${color}0c`,
        border: `1px solid ${color}28`,
      }}
    >
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <span className="text-prose font-medium text-ink">
          {t(locale, 'candidate.crossPairLabel', { a: a.type, b: b.type })}
          {' · '}
          {blend.title}
        </span>
        <span
          className="rounded-full px-2 py-0.5 font-mono text-2xs uppercase tracking-wide"
          style={{
            background: `${color}18`,
            color,
          }}
        >
          {t(locale, levelKey(blend.level))}
        </span>
      </div>
      <p className="m-0 text-prose leading-[1.65] text-ink-muted">{blend.reading}</p>
    </div>
  );
}

/**
 * Combinations among T1–T9 types that sit close together in this result.
 */
export function EnneagramCross({ scores, locale, showChallenge = true }) {
  const cross = buildEnneagramCross(scores, locale);
  if (!cross) return null;

  const { primary, secondary, cluster, close, typeData, strengths, challenge, pairs, teamCross } = cross;
  const primaryData = typeData[primary.type];
  const clusterLabels = cluster.map((item) => typeShortLabel(item.type, locale)).join(', ');

  return (
    <div>
      <div className="mb-4 grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4">
        <div>
          <span className={cn(S.label, 'mb-2')}>{t(locale, 'candidate.strengths')}</span>
          <div className="flex flex-wrap gap-1.5">
            {strengths.map((s) => {
              const d = typeData[s.type];
              return (
                <span
                  key={`${s.role}-${s.type}-${s.text}`}
                  title={s.role !== 'primary' ? t(locale, 'candidate.strengthFromType', { type: s.type }) : undefined}
                  className="rounded-full px-2.5 py-0.5 text-2xs"
                  style={{
                    background: `${d.color}15`,
                    border: `1px solid ${d.color}35`,
                    color: d.color,
                    opacity: s.role === 'primary' ? 1 : 0.92,
                  }}
                >
                  {s.text}
                </span>
              );
            })}
          </div>
        </div>
        <div>
          <span className={cn(S.label, 'mb-2')}>
            {close ? t(locale, 'candidate.combinedProfile') : t(locale, 'candidate.wing')}
          </span>
          {close ? (
            <div className="flex flex-wrap items-center gap-1.5">
              {cluster.map((item) => (
                <TypeChip key={item.type} type={item.type} locale={locale} typeData={typeData} />
              ))}
            </div>
          ) : secondary ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <TypeChip type={secondary.type} locale={locale} typeData={typeData} />
            </div>
          ) : (
            <p className="m-0 text-xs italic text-ink-faint">
              {t(locale, 'candidate.crossNoSecondary')}
            </p>
          )}
        </div>
      </div>

      {pairs.length > 0 ? (
        <div className="mb-4">
          <span className={cn(S.label, 'mb-2')}>{t(locale, 'candidate.crossTitle')}</span>
          <p className="mb-2.5 mt-0 text-xs leading-[1.55] text-ink-faint">
            {cluster.length > 2
              ? t(locale, 'candidate.crossNoteCluster', { list: clusterLabels })
              : t(locale, 'candidate.crossNoteClose', {
                  a: typeShortLabel(cluster[0].type, locale),
                  b: typeShortLabel(cluster[1].type, locale),
                })}
          </p>
          <div className="flex flex-col gap-2.5">
            {pairs.map((pair) => (
              <BlendCard
                key={`${pair.a.type}-${pair.b.type}`}
                pair={pair}
                locale={locale}
              />
            ))}
          </div>
        </div>
      ) : secondary ? (
        <p className="mb-4 mt-0 text-xs leading-[1.55] text-ink-faint">
          {t(locale, 'candidate.crossNoteWing', {
            main: typeShortLabel(primary.type, locale),
            wing: typeShortLabel(secondary.type, locale),
          })}
        </p>
      ) : null}

      {showChallenge && challenge ? (
        <div className="mb-4">
          <span className={cn(S.label, 'mb-2')}>{t(locale, 'candidate.challenge')}</span>
          <p className="m-0 text-prose italic leading-[1.65] text-ink-muted">
            “{challenge}”
          </p>
        </div>
      ) : null}

      <div
        className="mb-4 rounded-control px-4 py-3.5"
        style={{
          background: `${primaryData.color}0a`,
          border: `1px solid ${primaryData.color}20`,
        }}
      >
        <span
          className={cn(S.label, 'mb-1.5')}
          style={{ color: `${primaryData.color}70` }}
        >
          {t(locale, 'candidate.teamContribution')}
        </span>
        <p className="m-0 text-prose leading-[1.65] text-ink-muted">{teamCross}</p>
      </div>
    </div>
  );
}
