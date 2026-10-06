'use client';

import { useCallback, useEffect, useState } from 'react';
import { t } from '../../lib/i18n';
import { cn } from '../../lib/cn';
import { AdminCreateButton, S } from '../dashboard/dashboard-shared';
import { useAppFeedback } from './AppFeedback';
import { CopyableLink } from './CopyableLink';
import { AppLoading, ContentEnter } from './AppLoading';
import { TEAM_PULSE_STATUS } from '../../lib/domain-status.js';
import { EmptyState } from './EmptyState';

/**
 * Short pulse for a saved team group (B-603).
 */
export function TeamPulseBlock({ locale, companyId, teamGroupId }) {
  const { toast, promptForm } = useAppFeedback();
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);
  const [inviteUrl, setInviteUrl] = useState('');
  const [aggregate, setAggregate] = useState(null);

  const load = useCallback(async () => {
    if (!companyId || !teamGroupId) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/admin/team-pulses?companyId=${encodeURIComponent(companyId)}&teamGroupId=${encodeURIComponent(teamGroupId)}`
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'load');
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [companyId, teamGroupId]);

  useEffect(() => {
    load();
  }, [load]);

  const createPulse = async () => {
    const values = await promptForm({
      title: t(locale, 'panel.pulse.createTitle'),
      confirmLabel: t(locale, 'panel.pulse.createConfirm'),
      fields: [
        {
          key: 'title',
          label: t(locale, 'panel.pulse.titleLabel'),
          placeholder: t(locale, 'panel.pulse.titlePh'),
          required: true,
        },
      ],
    });
    if (!values) return;
    setBusy(true);
    try {
      const res = await fetch('/api/admin/team-pulses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          teamGroupId,
          title: values.title,
          locale,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'create');
      toast(t(locale, 'panel.pulse.created'), 'ok');
      await load();
      if (data.pulse?.id) await openPulse(data.pulse.id);
    } catch (e) {
      toast(e?.message || t(locale, 'panel.common.error'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const openPulse = async (pulseId) => {
    setBusy(true);
    try {
      const res = await fetch(
          `/api/admin/team-pulses?companyId=${encodeURIComponent(companyId)}&id=${encodeURIComponent(pulseId)}&aggregate=1&locale=${encodeURIComponent(locale)}`
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'load');
      setDetail(data.pulse);
      setAggregate(data.aggregate || null);
      setInviteUrl('');
    } catch (e) {
      toast(e?.message || t(locale, 'panel.common.error'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (status) => {
    if (!detail?.id) return;
    setBusy(true);
    try {
      const res = await fetch('/api/admin/team-pulses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'status', companyId, pulseId: detail.id, status }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'status');
      setDetail(data.pulse);
      toast(t(locale, 'panel.pulse.statusUpdated'), 'ok');
      await load();
      if (status === TEAM_PULSE_STATUS.OPEN) {
        const inv = await fetch('/api/admin/team-pulses', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'invite', companyId, pulseId: detail.id }),
        });
        const invData = await inv.json().catch(() => ({}));
        if (inv.ok && invData.invite?.token) {
          const origin = typeof window !== 'undefined' ? window.location.origin : '';
          setInviteUrl(`${origin}/pulso/${invData.invite.token}`);
        }
      }
    } catch (e) {
      toast(e?.message || t(locale, 'panel.common.error'), 'error');
    } finally {
      setBusy(false);
    }
  };

  if (!companyId || !teamGroupId) return null;
  if (loading) return <AppLoading variant="inline" />;

  return (
    <section className={cn(S.cardTight, 'mt-4')} aria-label={t(locale, 'panel.pulse.sectionAria')}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className={cn(S.cardSection, 'mb-0')}>{t(locale, 'panel.pulse.title')}</h3>
          <p className={cn(S.muted, 'm-0 mt-1 text-xs')}>{t(locale, 'panel.pulse.hint')}</p>
        </div>
        <AdminCreateButton variant="secondary" label={t(locale, 'panel.pulse.createBtn')} onClick={createPulse} disabled={busy} />
      </div>

      {items.length === 0 ? (
        <ContentEnter animKey="pulse-empty">
          <EmptyState
            message={t(locale, 'panel.pulse.empty')}
            actionLabel={t(locale, 'panel.pulse.createBtn')}
            onAction={createPulse}
            actionDisabled={busy}
          />
        </ContentEnter>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {items.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-control border border-ink/12 bg-canvas/40 px-3 py-2 text-left"
                onClick={() => openPulse(p.id)}
              >
                <span className="text-sm text-ink">{p.title}</span>
                <span className="font-mono text-2xs text-ink-faint">
                  {t(locale, `panel.pulse.status.${p.status}`)} · {p.responseCount || 0}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {detail ? (
        <div className="mt-3 border-t border-ink/10 pt-3">
          <div className="mb-2 flex flex-wrap gap-2">
            {detail.status === TEAM_PULSE_STATUS.DRAFT ? (
              <button
                type="button"
                disabled={busy}
                className={S.btnBrandSoft}
                onClick={() => setStatus(TEAM_PULSE_STATUS.OPEN)}
              >
                {t(locale, 'panel.pulse.openBtn')}
              </button>
            ) : null}
            {detail.status === TEAM_PULSE_STATUS.OPEN ? (
              <button
                type="button"
                disabled={busy}
                className={S.btnGhost}
                onClick={() => setStatus(TEAM_PULSE_STATUS.CLOSED)}
              >
                {t(locale, 'panel.pulse.closeBtn')}
              </button>
            ) : null}
          </div>
          {inviteUrl ? (
            <div className="mb-2">
              <p className={cn(S.muted, 'mb-1 text-xs')}>{t(locale, 'panel.pulse.inviteHint')}</p>
              <CopyableLink url={inviteUrl} locale={locale} />
            </div>
          ) : null}
          {aggregate?.ready ? (
            <div className="rounded-control border border-ink/10 bg-canvas/50 px-3 py-2">
              <p className="m-0 font-mono text-2xs text-ink-muted">
                {t(locale, 'panel.pulse.overall', {
                  n: aggregate.overallMean,
                  r: aggregate.responseCount,
                })}
              </p>
              {aggregate.reading?.overallText ? (
                <p className="mb-0 mt-2 text-xs leading-snug text-ink-muted">
                  {aggregate.reading.overallText}
                </p>
              ) : null}
              {aggregate.reading?.mixText ? (
                <p className="mb-0 mt-1 text-2xs leading-snug text-ink-faint">
                  {aggregate.reading.mixText}
                </p>
              ) : null}
              <ul className="mt-2 m-0 list-none space-y-1 p-0">
                {(aggregate.questions || []).map((q) => (
                  <li key={q.questionId} className="text-xs text-ink-muted">
                    {q.prompt}: {q.mean}
                  </li>
                ))}
              </ul>
            </div>
          ) : aggregate ? (
            <p className={cn(S.faint, 'm-0 text-xs')}>
              {t(locale, 'panel.pulse.needMin', {
                n: aggregate.responseCount,
                min: aggregate.minResponses,
              })}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
