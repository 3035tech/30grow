'use client';

import { useEffect, useState } from 'react';
import { t, localeNumberLocale } from '../../lib/i18n';
import { LAUNCH_PRICE } from '../../lib/billing/catalog';
import { publicPricingCurrency } from '../../lib/pricing-currency';
import { S } from '../dashboard/dashboard-shared';
import { InlineCallout } from './InlineCallout';
import { StatusToneChip } from './StatusToneChip';

const panelClass = 'rounded-card border border-ink/10 bg-canvas/35 p-5 sm:p-6';

export function BillingTab({ locale, role, companyId, companyName, onLicenseChange }) {
  const platform = role === 'admin' && !companyId;
  const [data, setData] = useState(null);
  const [currency, setCurrency] = useState(() => publicPricingCurrency(locale).toLowerCase());
  const [launch, setLaunch] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const copy = (key, values) => t(locale, `billing.${key}`, values);
  const date = value => value ? new Date(value).toLocaleDateString(localeNumberLocale(locale)) : '—';
  const money = (amount, code) => new Intl.NumberFormat(localeNumberLocale(locale), { style: 'currency', currency: code.toUpperCase() }).format(amount / 100);

  async function load(signal) {
    setLoading(true);
    setError('');
    try {
      const endpoint = platform ? '/api/admin/billing/config' : `/api/admin/billing?companyId=${companyId}&currency=${currency}`;
      const response = await fetch(endpoint, { signal, cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || copy('notConfigured'));
      setData(result);
      if (result.license && onLicenseChange) onLicenseChange(result.license);
    } catch (e) { if (e.name !== 'AbortError') setError(e.message); }
    finally { if (!signal?.aborted) setLoading(false); }
  }
  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
    // Locale changes only format existing data; currency is a commercial choice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, platform, currency]);

  async function open(action, planKey) {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/admin/billing/${action}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, ...(planKey ? { planKey } : {}), ...(action === 'checkout' ? { launch: launch && planKey === 'brl_small_monthly' } : {}) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || copy('notConfigured'));
      const target = new URL(result.url);
      if (target.protocol !== 'https:' || !['checkout.stripe.com', 'billing.stripe.com'].includes(target.hostname)) throw new Error(copy('notConfigured'));
      window.location.assign(target.href);
    } catch (e) { setError(e.message); setBusy(false); }
  }
  async function updateCancellation(cancel) {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/admin/billing/cancel', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, cancel, confirmed: true }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || copy('notConfigured'));
      setCancelConfirm(false);
      await load();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  const hasSubscription = Boolean(data?.subscriptionId) && !['canceled', 'incomplete_expired'].includes(data?.status);
  const currentPlan = data?.planKey === LAUNCH_PRICE.key ? LAUNCH_PRICE : data?.plans?.find(plan => plan.key === data.planKey);
  return (
    <div className="grid gap-5" aria-busy={loading || busy}>
      <section className={panelClass}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h2 className="m-0 text-lg font-semibold text-ink">{copy(platform ? 'platform' : 'title')}</h2><p className="mb-0 mt-2 text-sm text-ink-muted">{platform ? copy('platformIntro') : companyName || copy('intro')}</p></div>
          <button type="button" className={S.btnGhost} disabled={loading || busy} onClick={() => load()}>{copy('refresh')}</button>
        </div>
        {loading ? <p role="status">{copy('loading')}</p> : null}
        {error ? <div className="mt-4" role="alert"><InlineCallout tone="danger">{error}</InlineCallout></div> : null}
        {data && !loading && (platform || !data.configured) ? <div className="mt-4"><StatusToneChip tone={data.configured ? 'success' : 'neutral'}>{copy(data.configured ? 'connected' : 'disconnected')}</StatusToneChip></div> : null}
        {data && data.livemode === false ? <p className="mb-0 mt-4 text-xs text-ink-muted">{copy('testMode')}</p> : null}
        {data && !data.configured ? <p className="mt-4 text-sm text-ink-muted">{copy('notConfigured')}</p> : null}
        {platform && data ? <dl className="mt-5 grid gap-5 sm:grid-cols-2"><div><dt className="text-sm text-ink-muted">{copy('activeCompanies')}</dt><dd className="m-0 mt-2 text-lg font-semibold">{data.activeCompanies}</dd></div><div><dt className="text-sm text-ink-muted">{copy('lastWebhook')}</dt><dd className="m-0 mt-2">{data.lastWebhookAt ? date(data.lastWebhookAt) : copy('noWebhook')}</dd></div></dl> : null}
        {!platform && data?.status ? <>
          <dl className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {[[copy('status'), copy(`status_${data.status}`)], [copy('employeeCount'), data.employeeCount], [copy(hasSubscription ? 'nextDate' : 'trialEnds'), date(hasSubscription ? data.periodEnd : data.trialEndsAt)]].map(([label, value]) => <div key={label}><dt className="text-sm text-ink-muted">{label}</dt><dd className="m-0 mt-2 font-semibold text-ink">{value}</dd></div>)}
          </dl>
          {!data.access && !hasSubscription ? <InlineCallout tone="warning">{copy('trialExpired')}</InlineCallout> : null}
          {['past_due', 'unpaid', 'incomplete'].includes(data.status) ? <InlineCallout tone="warning">{copy('paymentAttention')}</InlineCallout> : null}
          {data.cancelAtPeriodEnd ? <InlineCallout tone="info">{copy('cancellation')}</InlineCallout> : null}
          {data.scheduled ? <InlineCallout tone="info">{copy('scheduled')}</InlineCallout> : null}
          {data.canOpenPortal ? <button type="button" className={`${S.btnPrimary} mt-5 w-full sm:w-auto`} disabled={busy} onClick={() => open('portal')}>{copy('manage')}</button> : null}
          {hasSubscription && ['active', 'trialing', 'past_due'].includes(data.status) ? <div className="mt-4">
            {data.cancelAtPeriodEnd ? <button type="button" className={S.btnGhost} disabled={busy} onClick={() => updateCancellation(false)}>{copy('resume')}</button> : <button type="button" className={S.btnGhost} disabled={busy} onClick={() => setCancelConfirm(true)}>{copy('cancel')}</button>}
            {cancelConfirm ? <div className="mt-4 rounded-control border border-warning/30 p-4">
              <p className="m-0 text-sm leading-6">{copy('cancelHint', { date: date(data.periodEnd) })}</p>
              <div className="mt-4 flex flex-wrap gap-3"><button type="button" className={S.btnGhost} disabled={busy} onClick={() => setCancelConfirm(false)}>{copy('cancelBack')}</button><button type="button" className={S.btnDanger} disabled={busy} onClick={() => updateCancellation(true)}>{copy('cancelConfirm')}</button></div>
            </div> : null}
          </div> : null}
        </> : null}
      </section>
      {!platform && data?.configured ? <section className={panelClass}>
        <h2 className="m-0 mb-4 text-lg font-semibold text-ink">{copy(hasSubscription ? 'currentPlan' : 'choosePlan')}</h2>
        {!hasSubscription ? <label className="mb-5 flex max-w-sm flex-col gap-2 text-sm"><span>{copy('currency')}</span><select value={currency} onChange={e => { setCurrency(e.target.value); setLaunch(false); }} className="rounded-control border border-ink/20 bg-surface px-3 py-2"><option value="brl">{copy('brl')}</option><option value="usd">{copy('usd')}</option></select></label> : null}
        {data.launchAvailable && currency === 'brl' && !hasSubscription ? <label className="mb-6 flex items-start gap-3 text-sm leading-6"><input type="checkbox" checked={launch} onChange={e => setLaunch(e.target.checked)} className="mt-1 h-4 w-4 shrink-0" /><span>{copy('launch')}</span></label> : null}
        {hasSubscription && currentPlan ? <div className="mb-5 rounded-control border border-brand-500/25 bg-brand-500/[0.05] p-5">
          <p className="m-0 text-sm font-medium text-ink">{currentPlan.maxEmployees ? copy('upTo', { n: currentPlan.maxEmployees }) : copy('allCompany')}</p>
          <p className="mb-0 mt-2 text-3xl font-semibold tracking-tight text-ink">{money(currentPlan.amount, currentPlan.currency)} <span className="text-sm font-normal tracking-normal text-ink-muted">{copy(currentPlan.interval === 'year' ? 'annual' : 'monthly')}</span></p>
        </div> : null}
        <details open={!hasSubscription} className="group">
          <summary className="min-h-touch cursor-pointer py-3 text-sm font-medium text-ink focus-visible:outline-brand-500">{copy(hasSubscription ? 'otherPlans' : 'availablePlans')}</summary>
        <div className="mt-2 grid gap-4 sm:grid-cols-2">
          {data.plans.filter(plan => !hasSubscription || plan.currency === data.currency).map(plan => <article key={plan.key} className="flex flex-col rounded-control border border-ink/10 bg-surface p-4">
            <h3 className="m-0 text-base font-semibold">{plan.maxEmployees ? copy('upTo', { n: plan.maxEmployees }) : copy('allCompany')}</h3>
            <p className="mb-0 mt-3 text-xl font-semibold">{money(launch && !hasSubscription && plan.key === 'brl_small_monthly' ? LAUNCH_PRICE.amount : plan.amount, plan.currency)} <span className="text-sm font-normal text-ink-muted">{copy(plan.interval === 'year' ? 'annual' : 'monthly')}</span></p>
            {hasSubscription && (data.planKey === plan.key || (data.planKey === 'brl_launch_monthly' && plan.key === 'brl_small_monthly')) ? <p className="mb-0 mt-3 text-sm text-brand-700">{copy('currentPlan')}</p> : <button type="button" className={`${S.btnBrandSoft} mt-4`} disabled={busy || !plan.eligible || (hasSubscription && (data.scheduled || !['active', 'trialing'].includes(data.status)))} onClick={() => open(hasSubscription ? 'portal' : 'checkout', plan.key)}>{copy(hasSubscription ? 'changePlan' : 'subscribe')}</button>}
          </article>)}
        </div>
        </details>
        {!hasSubscription ? <p className="mb-0 mt-5 text-xs leading-6 text-ink-muted">{copy('remainingTrial')}</p> : null}
      </section> : null}
      {!platform ? <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
        <a href="/terms#cancelamento-e-reembolso" target="_blank" rel="noopener noreferrer" className="inline-flex min-h-touch items-center text-brand-700 underline underline-offset-4">{copy('policiesHint')}</a>
        <a href="mailto:contact@3035tech.com?subject=Cancelamento%20ou%20reembolso%2030Grow" className="inline-flex min-h-touch items-center text-brand-700 underline underline-offset-4">{copy('refundRequest')}</a>
      </div> : null}
      {!platform && data ? <section className={panelClass}>
        <h2 className="m-0 text-lg font-semibold">{copy('invoices')}</h2>
        {data.invoicesUnavailable ? <p role="status">{copy('invoiceUnavailable')}</p> : null}
        {!data.invoices.length ? <p className="mb-0 mt-4 rounded-control border border-dashed border-ink/15 p-5 text-sm leading-6 text-ink-muted">{copy('noInvoices')}</p> : <ul className="mb-0 mt-4 list-none divide-y divide-ink/10 p-0">{data.invoices.map(invoice => <li key={invoice.id} className="flex flex-wrap items-center justify-between gap-3 py-4 text-sm"><div><p className="m-0 font-semibold">{invoice.number || copy('invoice')} · {money(invoice.amount, invoice.currency)}</p><p className="mb-0 mt-1 text-ink-muted">{date(invoice.createdAt)} · {copy(`status_${invoice.status}`)}</p></div>{invoice.url ? <a href={invoice.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-touch items-center text-brand-700 underline-offset-4 hover:underline">{copy('openInvoice')}</a> : null}</li>)}</ul>}
      </section> : null}
    </div>
  );
}
