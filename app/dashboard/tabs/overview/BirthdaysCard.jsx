'use client';

import { useEffect, useState } from 'react';
import { t, localeHtmlLang } from '../../../../lib/i18n';
import { cn } from '../../../../lib/cn';
import { AdminIconButton, S } from '../../dashboard-shared';
import { AppLoading } from '../../../_components/AppLoading';

/**
 * Overview card — upcoming birthdays + work anniversaries (+ company anniversary).
 */
export default function BirthdaysCard({ locale = 'pt-BR', companyId, navigateDashboard, initialData = null }) {
  const [data, setData] = useState(initialData);
  const [loading, setLoading] = useState(!initialData);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    if (initialData) {
      setData(initialData);
      setLoading(false);
      setError(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(false);
    fetch(`/api/admin/upcoming-anniversaries?companyId=${encodeURIComponent(companyId)}&daysAhead=14`)
      .then(async (res) => {
        if (!res.ok) throw new Error('fetch_failed');
        return res.json();
      })
      .then((json) => {
        if (!cancelled) setData(json);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [companyId, initialData]);

  const dateLocale = localeHtmlLang(locale);
  const formatNext = (iso) => {
    if (!iso) return '—';
    const d = new Date(`${iso}T12:00:00`);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(dateLocale, { day: '2-digit', month: 'short' });
  };

  if (loading) {
    return (
      <div className={cn(S.card, 'h-full')}>
        <AppLoading locale={locale} variant="inline" label={t(locale, 'panel.birthdays.loading')} />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className={cn(S.card, 'h-full')}>
        <p className={S.cardFaint}>{t(locale, 'panel.birthdays.loadError')}</p>
      </div>
    );
  }

  const items = Array.isArray(data.items) ? data.items : [];
  const company = data.company || null;
  const empty = items.length === 0 && !company;

  return (
    <div className={cn(S.card, 'h-full')}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className={cn(S.cardTitle, 'mb-1')}>{t(locale, 'panel.birthdays.title')}</h3>
          <p className="m-0 text-xs leading-snug text-ink-muted">
            {t(locale, 'panel.birthdays.subtitle', { days: data.windowDays || 14 })}
          </p>
        </div>
        {typeof navigateDashboard === 'function' ? (
          <AdminIconButton
            label={t(locale, 'panel.birthdays.openTeam')}
            icon="team"
            onClick={() => navigateDashboard({ tab: 'team', roster: 'internal' })}
          />
        ) : (
          <AdminIconButton
            href="/dashboard?tab=team"
            label={t(locale, 'panel.birthdays.openTeam')}
            icon="team"
          />
        )}
      </div>

      {company ? (
        <div className="mb-2.5 rounded-control border border-brand-500/20 bg-brand-500/[0.06] px-3 py-2.5">
          <p className="m-0 font-mono text-2xs uppercase tracking-wide text-brand-600">
            {t(locale, 'panel.birthdays.kindCompany')}
          </p>
          <p className="mt-1 mb-0 text-sm text-ink">
            {company.name}
            <span className="ml-2 font-mono text-xs text-ink-muted">{formatNext(company.nextOn)}</span>
            {company.years ? (
              <span className="ml-2 font-mono text-xs text-ink-faint">
                {t(locale, 'panel.birthdays.years', { n: company.years })}
              </span>
            ) : null}
          </p>
        </div>
      ) : null}

      {empty ? (
        <p className="m-0 text-prose italic text-ink-faint">{t(locale, 'panel.birthdays.empty')}</p>
      ) : (
        <ul className="m-0 max-h-[20rem] list-none divide-y divide-ink/8 overflow-y-auto p-0 pr-1">
          {items.map((row) => (
            <li
              key={`${row.kind}-${row.candidateId}-${row.nextOn}`}
              className="flex items-start justify-between gap-3 px-1 py-2.5 first:pt-1 last:pb-0"
            >
              <div className="flex min-w-0 flex-1 flex-col items-start">
                {typeof navigateDashboard === 'function' ? (
                  <button
                    type="button"
                    className="max-w-full cursor-pointer truncate rounded-sm border-none bg-transparent p-0 text-left text-sm font-medium text-ink hover:text-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/35"
                    onClick={() =>
                      navigateDashboard({
                        tab: 'team',
                        candidate: String(row.candidateId),
                        section: 'profile',
                      })
                    }
                  >
                    {row.fullName}
                  </button>
                ) : (
                  <span className="max-w-full truncate text-sm font-medium text-ink">{row.fullName}</span>
                )}
                <span className="mt-0.5 font-mono text-2xs uppercase tracking-wide text-ink-muted">
                  {row.kind === 'birth'
                    ? t(locale, 'panel.birthdays.kindBirth')
                    : t(locale, 'panel.birthdays.kindWork')}
                </span>
              </div>
              <div className="flex shrink-0 flex-col items-end font-mono text-xs text-ink/80">
                <span>{formatNext(row.nextOn)}</span>
                {row.kind === 'work' && row.years ? (
                  <span className="mt-0.5 text-2xs text-ink-muted">
                    {t(locale, 'panel.birthdays.years', { n: row.years })}
                  </span>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
