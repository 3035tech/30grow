'use client';
import { useEffect, useRef, useState } from 'react';
import { t, localeHtmlLang } from '../../lib/i18n';
import { S } from '../dashboard/dashboard-shared';
import { useAppFeedback } from './AppFeedback';

export function RepEmployeeTools({ locale, timezone, revision }) {
  const [items, setItems] = useState([]);
  const [next, setNext] = useState(null);
  const [display, setDisplay] = useState('—');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const anchor = useRef(null);
  const epoch = useRef(0);
  const { toast } = useAppFeedback();
  useEffect(() => {
    const generation = ++epoch.current;
    const controller = new AbortController();
    anchor.current = null;
    setDisplay('—');
    setItems([]);
    setNext(null);
    setLoading(true);
    setBusy(false);
    setLoadError(false);
    let pending = false;
    const load = async () => {
      if (pending) return;
      pending = true;
      try {
        const res = await fetch('/api/employee/time-clock/receipts', {
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(10000),
          ]),
        });
        if (!res.ok) throw Error();
        const data = await res.json();
        if (controller.signal.aborted) return;
        if (!Number.isFinite(Date.parse(data.serverTime))) throw Error();
        setLoadError(false);
        setItems(data.items || []);
        setNext(data.next);
        anchor.current = {
          time: Date.parse(data.serverTime),
          mono: performance.now(),
        };
      } catch {
        if (!controller.signal.aborted) setLoadError(true);
      } finally {
        pending = false;
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    const refresh = setInterval(load, 60000);
    const tick = setInterval(() => {
      const a = anchor.current;
      if (!a || performance.now() - a.mono > 180000) {
        setDisplay('—');
        return;
      }
      setDisplay(
        new Intl.DateTimeFormat(localeHtmlLang(locale), {
          timeZone: timezone || 'America/Sao_Paulo',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hourCycle: 'h23',
        }).format(new Date(a.time + performance.now() - a.mono)),
      );
    }, 1000);
    return () => {
      controller.abort();
      if (epoch.current === generation) epoch.current += 1;
      clearInterval(refresh);
      clearInterval(tick);
    };
  }, [locale, timezone, revision]);
  const more = async () => {
    if (busy || next == null) return;
    const generation = epoch.current;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/employee/time-clock/receipts?after=${next}`,
        { cache: 'no-store', signal: AbortSignal.timeout(15000) },
      );
      if (!res.ok) throw Error();
      const data = await res.json();
      if (generation !== epoch.current) return;
      setItems((old) => [...old, ...data.items]);
      setNext(data.next);
    } catch {
      if (generation === epoch.current)
        toast(t(locale, 'rep.loadError'), 'error');
    } finally {
      if (generation === epoch.current) setBusy(false);
    }
  };
  const download = async (item) => {
    if (busy) return;
    const generation = epoch.current;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/employee/time-clock/receipts?establishmentId=${item.establishmentId}&nsr=${item.nsr}`,
        { cache: 'no-store', signal: AbortSignal.timeout(30000) },
      );
      if (!res.ok) throw Error();
      const blob = await res.blob();
      if (generation !== epoch.current) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `comprovante-${item.nsr}.pdf`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      if (generation === epoch.current)
        toast(t(locale, 'rep.downloadError'), 'error');
    } finally {
      if (generation === epoch.current) setBusy(false);
    }
  };
  return (
    <div className="mb-4 rounded-card border border-ink/10 bg-canvas p-4">
      <p className={S.label}>{t(locale, 'rep.clock')}</p>
      <time className="font-mono text-2xl tabular-nums">{display}</time>
      <h4 className="mt-4 font-semibold">{t(locale, 'rep.receipts')}</h4>
      <p className="mt-1 text-sm text-ink-muted" role="status">
        {t(
          locale,
          loading
            ? 'rep.loading'
            : loadError
              ? 'rep.loadError'
              : items.length === 0
                ? 'rep.emptyReceipts'
                : 'rep.receiptWindow',
        )}
      </p>
      {items.length > 0 ? (
        <>
          <ul>
            {items.map((item) => (
              <li
                key={`${item.establishmentId}-${item.nsr}`}
                className="mt-2 flex flex-wrap items-center justify-between gap-2"
              >
                <span className="text-sm">
                  {new Intl.DateTimeFormat(localeHtmlLang(locale), {
                    timeZone: timezone || 'America/Sao_Paulo',
                    dateStyle: 'short',
                    timeStyle: 'short',
                  }).format(new Date(item.punchedAt))}{' '}
                  · NSR {item.nsr}
                </span>
                <button
                  type="button"
                  className={S.btnGhost}
                  disabled={busy}
                  onClick={() => void download(item)}
                >
                  {t(locale, 'rep.receipt')}
                </button>
              </li>
            ))}
          </ul>
          {next ? (
            <button
              type="button"
              className={S.btnGhost}
              disabled={busy}
              onClick={() => void more()}
            >
              {t(locale, 'rep.loadMore')}
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
