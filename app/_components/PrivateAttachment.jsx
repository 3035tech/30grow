'use client';

import { useRef, useState } from 'react';
import { t, localeHtmlLang } from '../../lib/i18n';
import { cn } from '../../lib/cn';
import { S } from '../dashboard/dashboard-shared';
import { Icon } from './Icon';
import { EmployeeIconButton } from './EmployeeIconButton';

const DOWNLOAD_TIMEOUT_MS = 30 * 1000;
const OBJECT_URL_LIFETIME_MS = 60 * 1000;

/** An authenticated app endpoint, never a storage URL or a shareable link. */
export function PrivateAttachment({ href, fileName, updatedAt, locale = 'pt-BR', iconOnly = false }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const pending = useRef(false);
  const name = fileName || t(locale, 'panel.dp.docHasFile');
  const extension = String(fileName || '').split('.').pop().toLowerCase();
  const typeLabel = ['pdf', 'jpg', 'jpeg', 'png'].includes(extension) ? extension.toUpperCase() : '';
  const updated = updatedAt ? new Date(updatedAt) : null;
  const updatedLabel = updated && !Number.isNaN(updated.getTime())
    ? updated.toLocaleString(localeHtmlLang(locale), { dateStyle: 'short', timeStyle: 'short' }) : '';

  async function download() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setFailed(false);
    try {
      if (!href?.startsWith('/api/')) throw new Error('Invalid attachment endpoint');
      const response = await fetch(href, {
        credentials: 'same-origin', cache: 'no-store', redirect: 'error',
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      });
      if (!response.ok || !response.headers.get('content-disposition')?.startsWith('attachment;')) {
        throw new Error('Attachment unavailable');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName || 'attachment';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), OBJECT_URL_LIFETIME_MS);
    } catch {
      setFailed(true);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="w-full min-w-0 rounded-control border border-ink/12 bg-ink/[0.025] p-3">
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <Icon name="dp" className="h-6 w-6 shrink-0 text-ink-muted" />
        <div className="min-w-0 flex-1 basis-32">
          <p className="m-0 break-all text-prose font-medium text-ink">{name}</p>
          <p className="mb-0 mt-1 text-xs text-ink-muted">{t(locale, 'panel.dp.docHasFile')}</p>
          {updatedLabel ? (
            <p className="mb-0 mt-1 text-xs text-ink-muted">
              {typeLabel ? `${typeLabel} · ` : ''}{t(locale, 'panel.dp.docUpdatedAt', { value: updatedLabel })}
            </p>
          ) : null}
        </div>
        {iconOnly ? (
          <EmployeeIconButton
            label={`${t(locale, busy ? 'panel.dp.docDownloading' : 'panel.dp.docDownload')}: ${name}`}
            mobileLabel={t(locale, busy ? 'panel.dp.docDownloading' : 'panel.dp.docDownload')}
            icon="download"
            disabled={busy}
            busy={busy}
            onClick={() => void download()}
            tint="brand"
          />
        ) : (
          <button type="button" className={cn(S.btnGhost, 'min-h-touch gap-2')} onClick={() => void download()}
            disabled={busy} aria-busy={busy} aria-label={`${t(locale, 'panel.dp.docDownload')}: ${name}`}>
            <Icon name="download" />
            <span aria-live="polite">{t(locale, busy ? 'panel.dp.docDownloading' : 'panel.dp.docDownload')}</span>
          </button>
        )}
      </div>
      {failed ? <p role="alert" className="mb-0 mt-2 text-xs text-danger">{t(locale, 'panel.dp.docDownloadError')}</p> : null}
    </div>
  );
}
