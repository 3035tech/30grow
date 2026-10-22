'use client';

import { useEffect, useState } from 'react';
import { t } from '../../../../lib/i18n';
import { cn } from '../../../../lib/cn';
import { S } from '../../dashboard-shared';
import { useAppFeedback } from '../../../_components/AppFeedback';
import { AppLoading } from '../../../_components/AppLoading';

const SEV = {
  info: 'border-info/25 bg-info/[0.06]',
  watch: 'border-warning/25 bg-warning/[0.06]',
  alert: 'border-danger/25 bg-danger/[0.06]',
};

/**
 * Workbench multi-sinal na Overview (B-1903) + IA (B-1904).
 */
export default function MultiSignalWorkbenchCard({ locale = 'pt-BR', companyId, navigateDashboard }) {
  const { toast } = useAppFeedback();
  const [loading, setLoading] = useState(true);
  const [workbench, setWorkbench] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [ai, setAi] = useState(null);

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/admin/multi-signal-workbench?companyId=${encodeURIComponent(companyId)}`,
          { credentials: 'include' }
        );
        const data = await res.json().catch(() => ({}));
        if (!cancelled) setWorkbench(data?.workbench || null);
      } catch {
        if (!cancelled) setWorkbench(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const go = (tab) => {
    if (typeof navigateDashboard === 'function') navigateDashboard({ tab });
  };

  const runAi = async () => {
    setAiLoading(true);
    setAi(null);
    try {
      const res = await fetch('/api/admin/people/interpret-ai', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'workbench', companyId, locale }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || t(locale, 'panel.workbench.aiError'));
      setAi(data);
    } catch (e) {
      toast(e?.message || t(locale, 'panel.workbench.aiError'), 'error');
    } finally {
      setAiLoading(false);
    }
  };

  if (!companyId) return null;

  return (
    <div className={S.cardTight}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <span className={S.label}>{t(locale, 'panel.workbench.title')}</span>
          <p className="mt-1 mb-0 text-prose leading-snug text-ink-muted">
            {t(locale, 'panel.workbench.intro')}
          </p>
        </div>
        <button
          type="button"
          disabled={aiLoading || loading}
          onClick={runAi}
          className={cn(S.btnBrandSoft, 'min-h-touch shrink-0')}
        >
          {aiLoading ? t(locale, 'panel.workbench.aiRunning') : t(locale, 'panel.workbench.aiCta')}
        </button>
      </div>

      {loading ? (
        <div className="mt-3">
          <AppLoading locale={locale} variant="inline" />
        </div>
      ) : !workbench || workbench.empty ? (
        <p className="mt-3 mb-0 text-prose text-ink-muted">{t(locale, 'panel.workbench.empty')}</p>
      ) : (
        <ul className="mt-3 mb-0 flex list-none flex-col gap-2 p-0">
          {workbench.patterns.map((p) => (
            <li
              key={p.id}
              className={cn('rounded-control border px-3 py-2.5', SEV[p.severity] || SEV.info)}
            >
              <div className="font-ui text-xs text-ink-muted">
                {(p.signals || []).map(signal => t(locale, `formValidation.signal_${signal}`)).join(' · ')}
              </div>
              <p className="mt-1 mb-0 text-prose leading-snug text-ink">
                {t(locale, `panel.workbench.pattern.${p.id}`)}
              </p>
            </li>
          ))}
        </ul>
      )}

      {ai?.summary ? (
        <div className="mt-3 rounded-control border border-brand-500/20 bg-brand-500/[0.04] px-3 py-2.5">
          <p className="m-0 text-prose leading-snug text-ink">{ai.summary}</p>
          {Array.isArray(ai.recommendations) && ai.recommendations.length > 0 ? (
            <ul className="mt-2 mb-0 list-disc pl-4 text-xs text-ink">
              {ai.recommendations.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          ) : null}
          <p className="mt-2 mb-0 text-2xs text-ink-faint">{t(locale, 'panel.workbench.aiDisclaimer')}</p>
        </div>
      ) : null}

      {workbench && !workbench.empty ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {(workbench.ctas || []).map((c) => (
            <button
              key={c}
              type="button"
              className={cn(S.btnGhost, 'min-h-touch text-sm')}
              onClick={() =>
                go(
                  c === 'compat'
                    ? 'compatibility'
                    : c === 'performance'
                      ? 'performance-reviews'
                      : c === 'overview'
                        ? 'overview'
                        : c
                )
              }
            >
              {t(locale, `panel.workbench.cta.${c}`)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
