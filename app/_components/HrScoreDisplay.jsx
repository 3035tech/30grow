'use client';

import { ScoreExplanation } from './ScoreExplanation';

import { useState, useEffect } from 'react';
import { t } from '../../lib/i18n';
import { cn } from '../../lib/cn';
import { Icon } from './Icon';
import { MeterBar } from './MeterBar';
import { StatusToneChip, statusToneClass } from './StatusToneChip';

/**
 * Display HR Score com gauge visual e breakdown opcional
 * 
 * Modes:
 * - compact: apenas número + gauge pequeno
 * - full: gauge grande + breakdown de sinais + predições
 */
export default function HrScoreDisplay({ candidateId, locale, mode = 'compact', className }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!candidateId) return;

    const fetchScore = async () => {
      try {
        setLoading(true);
        setError(false);
        const res = await fetch(`/api/admin/hr-score/${candidateId}`);
        if (!res.ok) throw new Error('fetch_failed');
        const json = await res.json();
        setData(json);
      } catch (err) {
        console.error('[HrScoreDisplay] Fetch error:', err);
        setError(true);
      } finally {
        setLoading(false);
      }
    };

    fetchScore();
  }, [candidateId]);

  if (loading) {
    return (
      <div className={cn('flex items-center gap-2 text-ink-muted', className)}>
        <Icon name="loader" className="h-4 w-4 animate-spin" />
        <span className="text-sm">{t(locale, 'hrScore.calculating')}</span>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className={cn('text-sm text-ink-faint', className)}>
        {t(locale, 'hrScore.notAvailable')}
      </div>
    );
  }

  const { score, signals, turnoverRisk, turnoverReasons, pdiGapAreas } = data;

  const scoreTone = (s) => {
    if (s >= 75) return 'success';
    if (s >= 50) return 'warning';
    return 'danger';
  };

  const riskTone = (risk) => {
    if (risk === 'low') return 'success';
    if (risk === 'medium') return 'warning';
    return 'danger';
  };

  if (mode === 'compact') {
    return (
      <div title={t(locale, 'betaPeople.scorehr')} className={cn('inline-flex items-center gap-2', className)}>
        <div
          className={cn(
            'flex h-8 w-16 items-center justify-center rounded-control border font-mono text-sm font-medium',
            statusToneClass(scoreTone(score))
          )}
        >
          {score}
        </div>
        <span className="text-xs text-ink-muted">{t(locale, 'hrScore.title')}</span>
      </div>
    );
  }

  // Mode: full
  return (
    <div className={cn('space-y-4', className)}>
      {/* Header com gauge grande */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-medium text-ink">{t(locale, 'hrScore.title')}</h3>
          <p className="text-sm text-ink-muted">{t(locale, 'hrScore.subtitle')}</p>
        </div>
        <div className="text-center">
          <div
            className={cn(
              'mb-1 flex h-20 w-20 items-center justify-center rounded-full border-4 font-mono text-2xl font-bold',
              statusToneClass(scoreTone(score))
            )}
          >
            {score}
          </div>
          <div className="text-xs text-ink-muted">0-100</div>
        </div>
      </div>

      <ScoreExplanation locale={locale} kind="hr" />
      <ScoreExplanation locale={locale} kind="attention" />
      {/* Breakdown dos sinais */}
      <div className="space-y-2">
        <h4 className="text-sm font-medium text-ink">{t(locale, 'hrScore.breakdown')}</h4>
        <div className="space-y-2 text-sm">
          {Object.entries(signals).map(([key, signal]) => (
            <div key={key} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-ink">{t(locale, `hrScore.${key}`)}</span>
                <span className="text-xs text-ink-faint">
                  ({Math.round((signal.weight || 0) * 100)}%)
                </span>
              </div>
              <div className="flex items-center gap-2">
                <MeterBar
                  percent={signal.score}
                  height={6}
                  className="w-24"
                  toneClass="bg-brand-500"
                />
                <span className="w-8 text-right font-mono text-xs text-ink-muted">
                  {signal.score}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Predições */}
      {(turnoverRisk || pdiGapAreas?.length > 0) && (
        <div className="space-y-3 rounded-card border border-ink/8 bg-ink/[0.02] p-4">
          <h4 className="text-sm font-medium text-ink">{t(locale, 'hrScore.predictions')}</h4>

          {turnoverRisk && (
            <div>
              <div className="mb-1 flex items-center gap-2">
                <span className="text-xs text-ink-muted">
                  {t(locale, 'hrScore.turnoverRisk')}:
                </span>
                <StatusToneChip tone={riskTone(turnoverRisk)} bordered={false}>
                  {t(locale, `hrScore.turnover${turnoverRisk.charAt(0).toUpperCase() + turnoverRisk.slice(1)}`)}
                </StatusToneChip>
              </div>
              {turnoverReasons?.length > 0 && (
                <ul className="ml-4 space-y-0.5 text-xs text-ink-muted">
                  {turnoverReasons.map((reason, i) => (
                    <li key={i}>• {reason.replace(/_/g, ' ')}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {pdiGapAreas?.length > 0 && (
            <div>
              <div className="mb-1 text-xs text-ink-muted">
                {t(locale, 'hrScore.pdiGaps')}:
              </div>
              <ul className="ml-4 space-y-1 text-xs">
                {pdiGapAreas.slice(0, 3).map((gap, i) => (
                  <li key={i} className="text-ink-muted">
                    • <span className="text-ink">{t(locale, `hrScore.area${gap.area.charAt(0).toUpperCase() + gap.area.slice(1).replace(/_/g, '')}`) || gap.area}</span>{' '}
                    <span className="text-ink-faint">
                      ({t(locale, `hrScore.pdiGapPriority${gap.priority.charAt(0).toUpperCase() + gap.priority.slice(1)}`)})
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Hedging note */}
      <p className="text-xs italic text-ink-faint">
        {t(locale, 'hrScore.hedgingNote')}
      </p>
    </div>
  );
}
