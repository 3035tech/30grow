'use client';

import { useState } from 'react';
import { t } from '../../../../lib/i18n';
import { cn } from '../../../../lib/cn';
import { formatDisplayDate } from '../../../../lib/format-display-date';
import { S } from '../../dashboard-shared';
import { useAppFeedback } from '../../../_components/AppFeedback';
import { AppLoading, ContentEnter } from '../../../_components/AppLoading';
import { StatusToneChip } from '../../../_components/StatusToneChip';

const REASON_TONE = {
  turnover_high: 'danger',
  retention_watch: 'warning',
  turnover_medium: 'warning',
  pdi_overdue: 'info',
  never_one_on_one: 'neutral',
  stale_one_on_one: 'neutral',
};

function reasonLabel(locale, r, staleDays) {
  return t(locale, `panel.copilot.reason.${r.code}`, {
    score: r.riskScore ?? '—',
    count: r.count ?? 0,
    date: r.lastMeeting ? formatDisplayDate(r.lastMeeting, locale) : '—',
    days: staleDays,
  });
}

/**
 * People copilot (B-3011): who is on the radar and what to bring to the next 1:1.
 * Deterministic list on demand; AI only drafts hedged agendas (optional).
 */
export default function PeopleCopilotCard({ locale = 'pt-BR', companyId, navigateDashboard }) {
  const { toast } = useAppFeedback();
  const [state, setState] = useState({ loading: false, data: null });
  const [aiBusy, setAiBusy] = useState('');
  const [ai, setAi] = useState(null);
  const [personAgenda, setPersonAgenda] = useState({});

  const ask = async (body) => {
    const res = await fetch('/api/admin/people/copilot', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyId, locale, ...body }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error || t(locale, 'panel.copilot.error'));
    return json;
  };

  const loadRadar = async () => {
    setState((s) => ({ ...s, loading: true }));
    setAi(null);
    setPersonAgenda({});
    try {
      setState({ loading: false, data: await ask({ question: 'radar' }) });
    } catch (e) {
      toast(e?.message || t(locale, 'panel.copilot.error'), 'error');
      setState({ loading: false, data: null });
    }
  };

  const draftAll = async () => {
    setAiBusy('all');
    try {
      const json = await ask({ question: 'radar', explain: true });
      setState({ loading: false, data: json });
      if (!json.ai) toast(t(locale, 'panel.copilot.aiUnavailable'), 'warning');
      setAi(json.ai || null);
    } catch (e) {
      toast(e?.message || t(locale, 'panel.copilot.error'), 'error');
    } finally {
      setAiBusy('');
    }
  };

  const preparePerson = async (person) => {
    setAiBusy(String(person.candidateId));
    try {
      const json = await ask({ question: 'person', candidateId: person.candidateId, explain: true });
      const detail = json.people?.[0];
      setPersonAgenda((m) => ({
        ...m,
        [person.candidateId]: {
          reasons: detail?.reasons || person.reasons,
          topics: json.ai?.agendas?.[person.candidateId] || null,
        },
      }));
      if (!json.ai) toast(t(locale, 'panel.copilot.aiUnavailable'), 'warning');
    } catch (e) {
      toast(e?.message || t(locale, 'panel.copilot.error'), 'error');
    } finally {
      setAiBusy('');
    }
  };

  if (!companyId) return null;
  const data = state.data;
  const people = data?.people || [];
  const failed = (data?.tools || []).filter((x) => !x.ok);

  return (
    <div className={S.cardTight}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <span className={S.label}>{t(locale, 'panel.copilot.title')}</span>
          <p className="mt-1 mb-0 text-prose leading-snug text-ink-muted">{t(locale, 'panel.copilot.intro')}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {data && people.length ? (
            <button type="button" disabled={Boolean(aiBusy)} onClick={() => void draftAll()} className={cn(S.btnGhost, 'min-h-touch text-sm')}>
              {aiBusy === 'all' ? t(locale, 'panel.copilot.aiRunning') : t(locale, 'panel.copilot.aiCta')}
            </button>
          ) : null}
          <button type="button" disabled={state.loading} onClick={() => void loadRadar()} className={cn(S.btnBrandSoft, 'min-h-touch')}>
            {data ? t(locale, 'panel.copilot.refresh') : t(locale, 'panel.copilot.cta')}
          </button>
        </div>
      </div>

      {state.loading ? (
        <div className="mt-3"><AppLoading locale={locale} variant="panel" /></div>
      ) : data ? (
        <ContentEnter animKey={`copilot|${people.length}|${ai ? 1 : 0}`}>
          {failed.length ? (
            <p className="mt-3 mb-0 text-xs text-warning">{t(locale, 'panel.copilot.partial')}</p>
          ) : null}
          {ai?.summary ? (
            <div className="mt-3 rounded-control border border-brand-500/20 bg-brand-500/[0.04] px-3 py-2.5">
              <p className="m-0 text-prose leading-snug text-ink">{ai.summary}</p>
            </div>
          ) : null}
          {people.length === 0 ? (
            <p className="mt-3 mb-0 text-prose text-ink-muted">{t(locale, 'panel.copilot.empty')}</p>
          ) : (
            <ol className="mt-3 mb-0 flex list-none flex-col gap-2 p-0">
              {people.map((p) => {
                const extra = personAgenda[p.candidateId];
                const reasons = extra?.reasons || p.reasons;
                const topics = extra?.topics || ai?.agendas?.[p.candidateId] || null;
                return (
                  <li key={p.candidateId} className="rounded-control border border-ink/10 bg-canvas px-3 py-2.5">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="m-0 font-ui text-sm font-semibold text-ink">{p.name || '—'}</p>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {reasons.map((r) => (
                            <StatusToneChip key={r.code} tone={REASON_TONE[r.code] || 'neutral'}>
                              {reasonLabel(locale, r, data.staleDays)}
                            </StatusToneChip>
                          ))}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={Boolean(aiBusy)}
                          onClick={() => void preparePerson(p)}
                          className={cn(S.btnGhost, 'min-h-touch text-sm')}
                        >
                          {aiBusy === String(p.candidateId) ? t(locale, 'panel.copilot.aiRunning') : t(locale, 'panel.copilot.prepare')}
                        </button>
                        {typeof navigateDashboard === 'function' ? (
                          <button
                            type="button"
                            onClick={() => navigateDashboard({ tab: 'team', candidate: String(p.candidateId) })}
                            className={cn(S.btnGhost, 'min-h-touch text-sm')}
                          >
                            {t(locale, 'panel.copilot.openPerson')}
                          </button>
                        ) : null}
                      </div>
                    </div>
                    <p className="mt-2 mb-0 text-2xs font-semibold uppercase tracking-wide text-ink-label">
                      {t(locale, topics ? 'panel.copilot.topicsAi' : 'panel.copilot.topicsSuggested')}
                    </p>
                    <ul className="mt-1 mb-0 list-disc pl-4 text-prose text-ink">
                      {(topics || reasons.slice(0, 3).map((r) => t(locale, `panel.copilot.topic.${r.code}`))).map((line, i) => (
                        <li key={`${p.candidateId}-${i}`}>{line}</li>
                      ))}
                    </ul>
                  </li>
                );
              })}
            </ol>
          )}
          <p className="mt-3 mb-0 text-2xs text-ink-faint">{t(locale, 'panel.copilot.disclaimer')}</p>
        </ContentEnter>
      ) : null}
    </div>
  );
}
