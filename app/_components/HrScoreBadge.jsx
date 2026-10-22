'use client';

import { cn } from '../../lib/cn';
import { t } from '../../lib/i18n';
import { Icon } from './Icon';

function riskLabel(locale, risk) {
  if (risk === 'high') return t(locale, 'turnoverRadar.riskHigh');
  if (risk === 'medium') return t(locale, 'turnoverRadar.riskMedium');
  if (risk === 'low') return t(locale, 'turnoverRadar.riskLow');
  return risk || '';
}

/**
 * Badge compacto de HR Score (+ atenção hedged). Prefer score; risk only colors/title.
 */
export function HrScoreBadge({ score, risk, size = 'sm', locale = 'pt-BR' }) {
  if (score == null && !risk) return null;

  const sizeClasses = {
    xs: 'h-4 min-w-[16px] gap-0.5 px-1 text-2xs',
    sm: 'h-5 min-w-[20px] gap-0.5 px-1.5 text-2xs',
    md: 'h-6 min-w-[24px] gap-1 px-2 text-2xs',
  };
  const iconClass = size === 'md' ? 'h-3.5 w-3.5' : 'h-3 w-3';

  const riskColors = {
    high: 'bg-danger/15 text-danger border-danger/30',
    medium: 'bg-warning/15 text-warning border-warning/30',
    low: 'bg-success/15 text-success border-success/30',
  };

  const scoreColor =
    score == null
      ? null
      : score >= 80
        ? 'bg-success/15 text-success border-success/30'
        : score >= 60
          ? 'bg-info/15 text-info border-info/30'
          : score >= 40
            ? 'bg-warning/15 text-warning border-warning/30'
            : 'bg-danger/15 text-danger border-danger/30';

  // The number uses the score scale; attention keeps its separate icon meaning.
  const toneClass = scoreColor || riskColors[risk] || riskColors.low;

  const riskText = risk ? riskLabel(locale, risk) : '';
  const valueTitle =
    score != null && risk
      ? `${t(locale, 'hrScore.badgeScoreTitle', { score })} · ${t(locale, 'hrScore.badgeRiskTitle', { risk: riskText })}`
      : score != null
        ? t(locale, 'hrScore.badgeScoreTitle', { score })
        : t(locale, 'hrScore.badgeRiskTitle', { risk: riskText });

  const title = `${valueTitle}. ${t(locale, score != null ? 'betaPeople.scorehr' : 'betaPeople.scoreattention')}${risk && score != null ? ` ${t(locale, 'betaPeople.scoreattention')}` : ''}`;

  const riskIcon =
    risk === 'high' ? 'alert' : risk === 'medium' ? 'infoCircle' : risk === 'low' ? 'check' : null;

  return (
    <span
      className={cn(
        'inline-flex items-center justify-center rounded border font-mono font-medium tabular-nums',
        sizeClasses[size],
        toneClass
      )}
      title={title}
      aria-label={title}
    >
      {score != null ? <span>{score}</span> : null}
      {riskIcon && score == null ? (
        <Icon name={riskIcon} className={iconClass} />
      ) : null}
      {riskIcon && score != null && (risk === 'high' || risk === 'medium') ? (
        <Icon name={riskIcon} className={cn(iconClass, risk === 'high' ? 'text-danger' : 'text-warning')} />
      ) : null}
    </span>
  );
}
