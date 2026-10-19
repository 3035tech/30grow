'use client';
import { TimeClockOperations } from '../../_components/TimeClockOperations';
import { useCallback, useEffect, useState } from 'react';
import { t, localeHtmlLang } from '../../../lib/i18n';
import { AdminPageHeader, S } from '../dashboard-shared';
import { StatusToneChip } from '../../_components/StatusToneChip';
import { InlineCallout } from '../../_components/InlineCallout';
import { useAppFeedback } from '../../_components/AppFeedback';

export function DigitalCertificateAdminTab({ locale }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [validation, setValidation] = useState(null);
  const [fileName, setFileName] = useState('');
  const { toast } = useAppFeedback();
  const load = useCallback(async (signal) => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch('/api/admin/digital-certificate', {
        cache: 'no-store',
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
          : AbortSignal.timeout(15000),
      });
      if (!res.ok) throw Error();
      const value = await res.json();
      if (!signal?.aborted) setData(value);
    } catch {
      if (!signal?.aborted) setError(true);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    const action =
      event.nativeEvent.submitter?.value === 'test' ? 'test' : 'save';
    const file = fields.get('file');
    if (!file?.size || file.size > 1024 * 1024 || !/\.(p12|pfx)$/i.test(file.name)) {
      toast(t(locale, 'digitalCertificate.fileHint'), 'error');
      return;
    }
    fields.set('action', action);
    setBusy(true);
    setValidation(null);
    let succeeded = false;
    try {
      const res = await fetch('/api/admin/digital-certificate', {
        method: 'POST',
        body: fields,
        signal: AbortSignal.timeout(90000),
      });
      if (!res.ok) throw Error();
      const value = await res.json();
      setValidation(value);
      succeeded = true;
      if (action === 'save') {
        setData(value);
        form.reset();
        setFileName('');
      }
      toast(
        t(
          locale,
          action === 'save'
            ? 'digitalCertificate.saved'
            : 'digitalCertificate.tested',
        ),
        'ok',
      );
    } catch {
      toast(t(locale, 'digitalCertificate.failed'), 'error');
    } finally {
      if (action === 'save' || !succeeded)
        form.elements.namedItem('password').value = '';
      setBusy(false);
    }
  }
  const preview = Boolean(validation && validation !== data);
  const status = validation || data;
  const certificate = status?.certificate;
  const remainingMs = certificate
    ? Date.parse(certificate.validTo) - Date.now()
    : null;
  const daysRemaining =
    remainingMs === null
      ? null
      : Math.max(0, Math.ceil(remainingMs / 86400000));
  const expired = remainingMs !== null && remainingMs <= 0;
  const expiring = !expired && daysRemaining !== null && daysRemaining <= 30;
  const formatDate = (value) =>
    new Intl.DateTimeFormat(localeHtmlLang(locale), {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  return (
    <section className="space-y-5">
      <AdminPageHeader
        title={t(locale, 'digitalCertificate.title')}
        description={t(locale, 'digitalCertificate.description')}
      />
      {loading ? (
        <p role="status">{t(locale, 'rep.loading')}</p>
      ) : error ? (
        <InlineCallout
          tone="danger"
          action={
            <button className={S.btnGhost} onClick={() => void load()}>
              {t(locale, 'rep.retry')}
            </button>
          }
        >
          {t(locale, 'rep.loadError')}
        </InlineCallout>
      ) : (
        <>
          {!data.editable ? (
            <InlineCallout tone="warning">
              {t(locale, 'digitalCertificate.setupNeeded')}
            </InlineCallout>
          ) : null}
          <p className="max-w-prose text-sm leading-6 text-ink-muted">{t(locale, 'digitalCertificate.uploadHelp')}</p>
          {certificate ? (
            <div className="rounded-card border border-ink/10 bg-surface p-5 sm:p-6">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h3 className="m-0 font-semibold">{t(locale, preview ? 'digitalCertificate.preview' : 'digitalCertificate.current')}</h3>
                <StatusToneChip tone={preview ? 'info' : expired ? 'danger' : expiring ? 'warning' : 'success'}>{t(locale, preview ? 'digitalCertificate.notSaved' : expired ? 'digitalCertificate.expiredBadge' : 'digitalCertificate.savedBadge')}</StatusToneChip>
              </div>
              <InlineCallout
                tone={expired ? 'danger' : expiring ? 'warning' : 'success'}
              >
                {t(
                  locale,
                  expired
                    ? 'digitalCertificate.expired'
                    : 'digitalCertificate.lastValidation',
                )}{' '}
                {status.validatedAt ? formatDate(status.validatedAt) : ''}
                {!expired ? (
                  <p className="mt-1 font-semibold">
                    {t(
                      locale,
                      expiring
                        ? 'digitalCertificate.expiresSoon'
                        : 'digitalCertificate.daysRemaining',
                      { days: daysRemaining },
                    )}
                  </p>
                ) : null}
              </InlineCallout>
              <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
                {[
                  'subject',
                  'issuer',
                  'validFrom',
                  'validTo',
                ].map((name) => (
                  <div key={name} className="min-w-0">
                    <dt className="text-ink-muted">
                      {t(locale, `digitalCertificate.${name}`)}
                    </dt>
                    <dd className="m-0 mt-1 whitespace-pre-line break-words font-medium text-ink">
                      {name === 'validFrom' || name === 'validTo'
                        ? formatDate(certificate[name])
                        : certificate[name]}
                    </dd>
                  </div>
                ))}
              </dl>
              <details className="mt-5 border-t border-ink/10 pt-2 text-sm">
                <summary className="min-h-touch cursor-pointer py-3 text-ink-muted focus-visible:outline-brand-500">{t(locale, 'digitalCertificate.technical')}</summary>
                <p className="m-0 text-xs text-ink-muted">{t(locale, 'digitalCertificate.fingerprint')}</p>
                <p className="mb-0 mt-2 break-all font-mono text-xs leading-6 text-ink-muted">{certificate.fingerprint}</p>
              </details>
            </div>
          ) : null}
          <form
            onSubmit={submit}
            onChange={() => setValidation(null)}
            className="rounded-card border border-ink/10 bg-surface p-5 sm:p-6"
          >
            <fieldset
              disabled={busy || !data.editable}
              className="m-0 grid min-w-0 gap-5 border-0 p-0 sm:grid-cols-2"
            >
              <legend className="mb-4 font-semibold">
                {t(locale, data.configured ? 'digitalCertificate.replace' : 'digitalCertificate.upload')}
              </legend>
              <div className="flex flex-col gap-2 text-sm sm:col-span-2">
                <span>{t(locale, 'digitalCertificate.file')}</span>
                <div className="flex min-w-0 flex-col items-start gap-3 rounded-control border border-dashed border-ink/20 bg-canvas/40 p-4 focus-within:ring-2 focus-within:ring-brand-500/35 sm:flex-row sm:items-center">
                  <input id="rep-certificate-file" name="file" type="file" accept=".p12,.pfx" required className="sr-only" aria-label={t(locale, 'digitalCertificate.file')} aria-describedby="certificate-file-help" onChange={event => setFileName(event.target.files?.[0]?.name || '')} />
                  <label htmlFor="rep-certificate-file" className={`${S.btnGhost} shrink-0`}>{t(locale, 'digitalCertificate.chooseFile')}</label>
                  <span className="min-w-0 break-all text-sm text-ink-muted" aria-live="polite">{fileName || t(locale, 'digitalCertificate.noFile')}</span>
                </div>
                <span id="certificate-file-help" className="text-xs text-ink-muted">{t(locale, 'digitalCertificate.fileHint')}</span>
              </div>
              <div className="flex flex-col gap-1 text-sm sm:col-span-2">
                <label htmlFor="rep-certificate-password">
                  {t(locale, 'digitalCertificate.password')}
                </label>
                <input
                  id="rep-certificate-password"
                  name="password"
                  type="password"
                  maxLength={1024}
                  autoComplete="new-password"
                  className={S.input}
                  aria-describedby="certificate-password-help"
                />
                <span
                  id="certificate-password-help"
                  className="text-xs text-ink-muted"
                >
                  {t(
                    locale,
                    'digitalCertificate.passwordNew',
                  )}
                </span>
              </div>
              <div className="flex flex-col-reverse gap-3 border-t border-ink/10 pt-5 sm:col-span-2 sm:flex-row sm:justify-end">
                <button
                  type="submit"
                  name="action"
                  value="test"
                  className={S.btnGhost}
                >
                  {t(
                    locale,
                    busy
                      ? 'digitalCertificate.working'
                      : 'digitalCertificate.test',
                  )}
                </button>
                <button
                  type="submit"
                  name="action"
                  value="save"
                  className={S.btnPrimary}
                >
                  {t(locale, 'digitalCertificate.save')}
                </button>
              </div>
            </fieldset>
          </form>

        </>
      )}
      <details className="rounded-card border border-ink/10 bg-surface p-5 sm:p-6">
        <summary className="cursor-pointer text-sm font-medium text-ink focus-visible:outline-brand-500">{t(locale, 'digitalCertificate.operations')}</summary>
        <div className="mt-5"><TimeClockOperations locale={locale} /></div>
      </details>
    </section>
  );
}
