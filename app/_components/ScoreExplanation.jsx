'use client';

import { t } from '../../lib/i18n';

/** Explanations stay beside the value and never change scoring formulas. */
export function ScoreExplanation({ locale, kind = 'all', sampleCount }) {
  const kinds = kind === 'all' ? ['adherence', 'hr', 'attention'] : [kind];
  return <aside className="my-3 rounded-control border border-ink/12 bg-ink/[0.02] p-3 text-xs leading-relaxed text-ink-muted" aria-label={t(locale, 'betaPeople.scoreGuide')}>
    <p className="mb-1 mt-0 font-semibold text-ink">{t(locale, 'betaPeople.scoreGuide')}</p>
    {kinds.map(key => <p key={key} className="my-1">{t(locale, `betaPeople.score${key}`)}</p>)}
    {sampleCount != null ? <p className="mb-0 mt-2">{t(locale, 'betaPeople.scoreSample', { n: sampleCount })}</p> : null}
  </aside>;
}
