'use client';

import { useEffect, useState } from 'react';
import { cn } from '../../../lib/cn';
import { t } from '../../../lib/i18n';
import { AdminCreateButton, S } from '../dashboard-shared';
import { useAppFeedback } from '../../_components/AppFeedback';
import { CopyableLink } from '../../_components/CopyableLink';
import { Spinner } from '../../_components/AppLoading';

const BTN_GHOST =
  'min-h-[36px] rounded-control border border-ink/12 bg-transparent px-2.5 py-2 font-mono text-2xs text-ink-muted disabled:cursor-default disabled:opacity-60';

export function VacancyReferralBlock({ vacancyId, locale, publicPagePath, appUrl = '' }) {
  const { promptForm, confirm, toast } = useAppFeedback();
  const [codes, setCodes] = useState([]);
  const [analytics, setAnalytics] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [showInactive, setShowInactive] = useState(false);

  const load = async () => {
    setLoading(true);
    setErr('');
    try {
      const qs = new URLSearchParams({ vacancyId: String(vacancyId) });
      const [codesRes, analyticsRes] = await Promise.all([
        fetch(`/api/admin/referral-codes?${qs.toString()}`),
        fetch(`/api/admin/referral-codes/analytics?${qs.toString()}`),
      ]);
      const codesJson = await codesRes.json().catch(() => ({}));
      const analyticsJson = await analyticsRes.json().catch(() => ({}));
      if (!codesRes.ok) throw new Error(codesJson?.error || t(locale, 'panel.common.error'));
      if (!analyticsRes.ok) throw new Error(analyticsJson?.error || t(locale, 'panel.common.error'));
      setCodes(Array.isArray(codesJson.items) ? codesJson.items : []);
      setAnalytics(Array.isArray(analyticsJson.items) ? analyticsJson.items : []);
    } catch (e) {
      setErr(e?.message || t(locale, 'panel.common.error'));
      setCodes([]);
      setAnalytics([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [vacancyId]); // eslint-disable-line react-hooks/exhaustive-deps

  const metricsByCode = Object.fromEntries(
    (analytics || []).map((row) => [String(row.code || '').toUpperCase(), row])
  );

  const visibleCodes = showInactive ? codes : codes.filter((c) => c.active !== false);

  const shareUrlFor = (code) => {
    if (!publicPagePath || !code) return '';
    const base = appUrl ? `${appUrl}${publicPagePath}` : publicPagePath;
    const sep = base.includes('?') ? '&' : '?';
    return `${base}${sep}ref=${encodeURIComponent(code)}`;
  };

  const createCode = async () => {
    const values = await promptForm({
      title: t(locale, 'recruiting.referralCreateTitle'),
      confirmLabel: t(locale, 'recruiting.referralCreateSubmit'),
      fields: [
        {
          key: 'code',
          label: t(locale, 'recruiting.referralCodeLabel'),
          placeholder: t(locale, 'recruiting.referralCodePlaceholder'),
          defaultValue: '',
        },
        {
          key: 'label',
          label: t(locale, 'recruiting.referralLabelLabel'),
          placeholder: t(locale, 'recruiting.referralLabelPlaceholder'),
          defaultValue: '',
        },
        {
          key: 'companyWide',
          type: 'boolean',
          label: t(locale, 'recruiting.referralCompanyWide'),
          defaultValue: false,
        },
      ],
    });
    if (!values) return;
    setBusy(true);
    setErr('');
    try {
      const companyWide = values.companyWide === true || values.companyWide === 'true';
      const res = await fetch('/api/admin/referral-codes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vacancyId: companyWide ? null : vacancyId,
          code: String(values.code || '').trim() || undefined,
          label: String(values.label || '').trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || t(locale, 'recruiting.referralCreateFailed'));
      await load();
      if (toast) toast(t(locale, 'recruiting.referralCreated'));
    } catch (e) {
      setErr(e?.message || t(locale, 'panel.common.error'));
    } finally {
      setBusy(false);
    }
  };

  const setActive = async (row, active) => {
    if (!active) {
      const ok = await confirm({
        message: t(locale, 'recruiting.referralDeactivateConfirm', { code: row.code }),
        danger: true,
      });
      if (!ok) return;
    }
    setBusy(true);
    setErr('');
    try {
      const res = await fetch(`/api/admin/referral-codes/${encodeURIComponent(row.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || t(locale, 'panel.common.error'));
      await load();
    } catch (e) {
      setErr(e?.message || t(locale, 'panel.common.error'));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className={cn(S.cardShell, 'flex items-center gap-2.5 p-5')}>
        <Spinner size={18} />
        <span className="text-prose text-ink-muted">{t(locale, 'common.loading')}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3.5">
      <div className={cn(S.card, 'px-[18px] py-4')}>
        <div className="flex flex-wrap items-start justify-between gap-2.5">
          <div className="min-w-0 flex-[1_1_220px]">
            <div className="mb-1.5 text-prose font-semibold text-ink">
              {t(locale, 'recruiting.referralTitle')}
            </div>
            <p className="m-0 text-prose leading-[1.55] text-ink-muted">
              {t(locale, 'recruiting.referralIntro')}
            </p>
            {!publicPagePath ? (
              <p className="mb-0 mt-2 text-xs text-ink-faint">
                {t(locale, 'recruiting.referralNeedPublicPage')}
              </p>
            ) : null}
          </div>
          <AdminCreateButton variant="secondary" label={t(locale, 'recruiting.referralNewBtn')} onClick={createCode} disabled={busy} />
        </div>

        {err ? (
          <p className="mb-0 mt-3 text-prose text-danger">{err}</p>
        ) : null}

        <label className="mt-3.5 inline-flex cursor-pointer items-center gap-2 font-mono text-xs text-ink-muted">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          {t(locale, 'recruiting.referralShowInactive')}
        </label>

        {visibleCodes.length === 0 ? (
          <p className="mb-0 mt-3.5 text-prose italic text-ink-muted">
            {t(locale, 'recruiting.referralEmpty')}
          </p>
        ) : (
          <div className="db-table-scroll mt-3 overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-xs">
              <thead>
                <tr className="text-left text-ink-muted">
                  <th className="p-2 font-medium">{t(locale, 'recruiting.referralColCode')}</th>
                  <th className="p-2 font-medium">{t(locale, 'recruiting.referralColScope')}</th>
                  <th className="p-2 font-medium">{t(locale, 'recruiting.analyticsViews')}</th>
                  <th className="p-2 font-medium">{t(locale, 'recruiting.analyticsApplications')}</th>
                  <th className="p-2 font-medium">{t(locale, 'recruiting.analyticsHires')}</th>
                  <th className="p-2 text-right font-medium">
                    {t(locale, 'recruiting.referralColActions')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleCodes.map((row) => {
                  const m = metricsByCode[String(row.code || '').toUpperCase()] || {};
                  const share = shareUrlFor(row.code);
                  const companyWide = row.vacancyId == null;
                  return (
                    <tr
                      key={row.id}
                      className={cn(
                        'border-t border-ink/12',
                        row.active === false && 'opacity-55'
                      )}
                    >
                      <td className="px-2 py-2.5 align-top">
                        <div className="font-mono font-semibold text-ink">{row.code}</div>
                        {row.label ? (
                          <div className="mt-0.5 text-2xs text-ink-muted">{row.label}</div>
                        ) : null}
                        {row.active === false ? (
                          <div className="mt-0.5 font-mono text-2xs text-ink-faint">
                            {t(locale, 'recruiting.referralInactive')}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-2 py-2.5 align-top font-mono text-ink-muted">
                        {companyWide
                          ? t(locale, 'recruiting.referralScopeCompany')
                          : t(locale, 'recruiting.referralScopeVacancy')}
                      </td>
                      <td className="px-2 py-2.5 align-top font-mono text-ink-muted">
                        {Number(m.views) || 0}
                      </td>
                      <td className="px-2 py-2.5 align-top font-mono text-ink-muted">
                        {Number(m.applications) || 0}
                      </td>
                      <td className="px-2 py-2.5 align-top font-mono text-ink-muted">
                        {Number(m.hires) || 0}
                      </td>
                      <td className="px-2 py-2.5 align-top text-right">
                        <div className="flex flex-col items-end gap-1.5">
                          <CopyableLink
                            url={share}
                            locale={locale}
                            compact
                            iconOnly
                            label={t(locale, 'recruiting.referralCopyLink')}
                            disabled={busy || !share || row.active === false}
                          />
                          <div className="flex flex-wrap justify-end gap-1.5">
                          {row.active !== false ? (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => setActive(row, false)}
                              className={cn(BTN_GHOST, busy ? 'cursor-default' : 'cursor-pointer')}
                            >
                              {t(locale, 'recruiting.referralDeactivate')}
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => setActive(row, true)}
                              className={cn(BTN_GHOST, busy ? 'cursor-default' : 'cursor-pointer')}
                            >
                              {t(locale, 'recruiting.referralReactivate')}
                            </button>
                          )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
