'use client';

import { useEffect, useState } from 'react';
import { S } from '../dashboard/dashboard-shared';
import { useAppFeedback } from './AppFeedback';
import { formatDisplayDate } from '../../lib/format-display-date';
import { InlineCallout } from './InlineCallout';
import { t as i18nT } from '../../lib/i18n.js';

export function FormalReviewResultsBlock({ candidateId, locale = 'pt-BR', onPdiChanged }) {
  const { promptForm, confirm, toast } = useAppFeedback();
  const [results, setResults] = useState([]);
  const [state, setState] = useState('loading');
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState('loading');
    fetch(`/api/admin/candidates/${candidateId}/formal-review-results`, { signal: controller.signal }).then(async response => {
      if (response.status === 401 || response.status === 403) { setState('forbidden'); return; }
      if (!response.ok) throw new Error('load');
      const data = await response.json();
      setResults(data.results || []); setState('ready');
    }).catch(error => { if (error.name !== 'AbortError') setState('error'); });
    return () => controller.abort();
  }, [candidateId, reload]);

  async function handleUseResult(result, item) {
    const values = await promptForm({
      title: i18nT(locale, 'ui.formalReviewResultsBlock.createADevelopmentGoal'),
      fields: [
        { key: 'title', label: i18nT(locale, 'ui.formalReviewResultsBlock.title'), required: true, maxLength: 200, defaultValue: item.label },
        { key: 'objective', label: i18nT(locale, 'ui.formalReviewResultsBlock.developmentAgreement'), type: 'textarea', maxLength: 4000 },
      ],
    });
    if (!values || !await confirm({ title: i18nT(locale, 'ui.formalReviewResultsBlock.useThisResultInPdi'), message: i18nT(locale, 'ui.formalReviewResultsBlock.aSeparateDevelopmentPlanWill') })) return;
    setBusy(true);
    try {
      const source = `${i18nT(locale, 'ui.formalReviewResultsBlock.source')}: ${result.cycleTitle} · ${i18nT(locale, 'ui.formalReviewResultsBlock.review')} #${result.id} · ${item.label}`;
      const response = await fetch(`/api/admin/candidates/${candidateId}/development-plans`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: values.title, objective: `${source}\n${values.objective || ''}`, seedIdeas: [values.title], status: 'active' }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || (i18nT(locale, 'ui.formalReviewResultsBlock.couldNotSave')));
      toast(i18nT(locale, 'ui.formalReviewResultsBlock.developmentPlanCreated'), 'ok');
      onPdiChanged?.();
    } catch (error) { toast(error.message, 'error'); }
    finally { setBusy(false); }
  }
  if (state === 'forbidden') return null;
  return <section className={`${S.card} ${S.stack}`} aria-label={i18nT(locale, 'ui.formalReviewResultsBlock.reviewResults')}>
    <div>
      <h3 className={S.cardSection}>{i18nT(locale, 'ui.formalReviewResultsBlock.reviewResults')}</h3>
      <p className={`m-0 ${S.muted}`}>{i18nT(locale, 'ui.formalReviewResultsBlock.reviewCompletedCyclesAndChoose')}</p>
    </div>
    {state === 'loading' ? <p role="status" className={`m-0 ${S.muted}`}>{i18nT(locale, 'ui.formalReviewResultsBlock.loadingResults')}</p> : null}
    {state === 'error' ? <InlineCallout tone="danger" role="alert">
      <p className="m-0 mb-2">{i18nT(locale, 'ui.formalReviewResultsBlock.couldNotLoadReviewResults')}</p>
      <button type="button" className={S.btnGhost} onClick={() => setReload(value => value + 1)}>{i18nT(locale, 'ui.formalReviewResultsBlock.tryAgain')}</button>
    </InlineCallout> : null}
    {state === 'ready' && !results.length ? <p className={`m-0 ${S.muted}`}>{i18nT(locale, 'ui.formalReviewResultsBlock.noCompletedReviewsYetResults')}</p> : null}
    {state === 'ready' && results.map(result => <details key={result.id} className="min-w-0 rounded-control border border-ink/10 p-3 sm:p-4">
      <summary className="cursor-pointer break-words rounded-control font-ui font-medium text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40">
        {result.cycleTitle}
        <span className={`mt-1 block font-normal ${S.cardMuted}`}>{formatDisplayDate(result.periodStart, locale)} — {formatDisplayDate(result.periodEnd, locale)}</span>
      </summary>
      <ul className="m-0 list-none divide-y divide-ink/10 p-0 pt-2">{result.items.map(item => <li key={item.id} className="flex min-w-0 flex-col gap-3 py-4 last:pb-0 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <h4 className={`m-0 break-words ${S.cardTitle}`}>{item.label}</h4>
          {item.description ? <p className={`mb-0 mt-1 whitespace-pre-wrap break-words ${S.muted}`}>{item.description}</p> : null}
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 sm:flex-col sm:items-end">
          <p className={`m-0 ${S.cardMuted}`}>{i18nT(locale, 'ui.formalReviewResultsBlock.average')} <span className={`${S.cardMetric} text-ink`}>{item.average == null ? '—' : `${item.average.toLocaleString(locale, { maximumFractionDigits: 2 })}/5`}</span></p>
          <button type="button" className={S.btnGhost} disabled={busy} onClick={() => handleUseResult(result, item)}>{i18nT(locale, 'ui.formalReviewResultsBlock.useInPdi')}</button>
        </div>
      </li>)}</ul>
    </details>)}
  </section>;
}
