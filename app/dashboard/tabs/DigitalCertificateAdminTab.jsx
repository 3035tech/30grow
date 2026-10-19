'use client';
import { TimeClockOperations } from '../../_components/TimeClockOperations';
import { useCallback, useEffect, useState } from 'react';
import { t, localeHtmlLang } from '../../../lib/i18n';
import { AdminPageHeader, S } from '../dashboard-shared';
import { InlineCallout } from '../../_components/InlineCallout';
import { useAppFeedback } from '../../_components/AppFeedback';

const FIELDS = ['bucket', 'key', 'region', 'versionId'];
export function DigitalCertificateAdminTab({ locale }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [validation, setValidation] = useState(null);
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
    const fields = Object.fromEntries(new FormData(form));
    const action =
      event.nativeEvent.submitter?.value === 'test' ? 'test' : 'save';
    setBusy(true);
    setValidation(null);
    let succeeded = false;
    try {
      const res = await fetch('/api/admin/digital-certificate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...fields, action }),
        signal: AbortSignal.timeout(90000),
      });
      if (!res.ok) throw Error();
      const value = await res.json();
      setValidation(value);
      succeeded = true;
      if (action === 'save') setData(value);
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
      <TimeClockOperations locale={locale} />
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
          <InlineCallout tone="info">
            {t(locale, 'digitalCertificate.security')}
          </InlineCallout>
          <form
            onSubmit={submit}
            onChange={() => setValidation(null)}
            className="rounded-card border border-ink/10 bg-surface p-5"
          >
            <fieldset
              disabled={busy || !data.editable}
              className="grid gap-4 sm:grid-cols-2"
            >
              <legend className="mb-4 font-semibold">
                {t(locale, 'digitalCertificate.location')}
              </legend>
              {FIELDS.map((name) => (
                <label key={name} className="flex flex-col gap-1 text-sm">
                  <span>{t(locale, `digitalCertificate.${name}`)}</span>
                  <input
                    name={name}
                    required={name !== 'versionId'}
                    defaultValue={data[name]}
                    maxLength={
                      name === 'bucket' ? 63 : name === 'region' ? 64 : 1024
                    }
                    autoComplete="off"
                    spellCheck={false}
                    className={S.input}
                  />
                </label>
              ))}
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
                    data.hasPassword
                      ? 'digitalCertificate.passwordKeep'
                      : 'digitalCertificate.passwordNew',
                  )}
                </span>
              </div>
              <div className="flex flex-wrap gap-3 sm:col-span-2">
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
          {certificate ? (
            <div className="rounded-card border border-ink/10 bg-surface p-5">
              <h3 className="mb-3 font-semibold">
                {t(locale, 'digitalCertificate.details')}
              </h3>
              <InlineCallout
                tone={expired ? 'danger' : expiring ? 'warning' : 'info'}
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
                  'fingerprint',
                ].map((name) => (
                  <div
                    key={name}
                    className={
                      name === 'fingerprint' ? 'sm:col-span-2' : undefined
                    }
                  >
                    <dt className="text-ink-muted">
                      {t(locale, `digitalCertificate.${name}`)}
                    </dt>
                    <dd className="mt-1 whitespace-pre-line break-all">
                      {name === 'validFrom' || name === 'validTo'
                        ? formatDate(certificate[name])
                        : certificate[name]}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
