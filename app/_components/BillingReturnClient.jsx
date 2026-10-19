'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { t } from '../../lib/i18n';
import { S } from '../dashboard/dashboard-shared';

export function BillingReturnClient({ locale, sessionId, companyId }) {
  const [status, setStatus] = useState('returnWorking');
  const [retry, setRetry] = useState(0);
  const copy = key => t(locale, `billing.${key}`);
  useEffect(() => {
    const controller = new AbortController();
    let timer, attempts = 0;
    async function confirm() {
      if (!/^cs_[a-zA-Z0-9_]+$/.test(sessionId) || !companyId) { setStatus('returnError'); return; }
      try {
        const response = await fetch('/api/admin/billing/confirm', { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId, companyId }) });
        const result = await response.json();
        if (controller.signal.aborted) return;
        if (!response.ok) { setStatus('returnError'); return; }
        if (!result.pending) { setStatus('returnSuccess'); return; }
        setStatus('returnPending');
        if (++attempts < 5) timer = setTimeout(confirm, 2000);
      } catch (e) { if (e.name !== 'AbortError') setStatus('returnError'); }
    }
    setStatus('returnWorking');
    confirm();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [sessionId, companyId, retry]);
  return <main className="flex min-h-screen items-center justify-center bg-canvas p-6"><section className="w-full max-w-xl rounded-card border border-ink/10 bg-surface p-8"><h1 className="m-0 text-2xl font-semibold">{copy('returnTitle')}</h1><p className="my-5 text-sm leading-7 text-ink-muted" role="status">{copy(status)}</p><div className="flex flex-wrap gap-3"><Link href="/dashboard?tab=profile&section=billing" className={S.btnPrimary}>{copy('backBilling')}</Link>{status !== 'returnSuccess' ? <button type="button" className={S.btnGhost} onClick={() => setRetry(n => n + 1)}>{copy('refresh')}</button> : null}</div></section></main>;
}
