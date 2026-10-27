'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { errorMessage, t } from '../../../lib/i18n';
import { useLocale } from '../../../lib/useLocale';
import { cn } from '../../../lib/cn';
import { S } from '../../dashboard/dashboard-shared';
import LanguageSelect from '../../_components/LanguageSelect';
import { BrandMark } from '../../_components/BrandMark';
import { AppLoading } from '../../_components/AppLoading';
import { FormField } from '../../_components/FormField';
import { InlineCallout } from '../../_components/InlineCallout';
import { PublicNarrowShell } from '../../_components/PublicNarrowShell';
import TurnstileField from '../../_components/TurnstileField';

function SetPasswordForm() {
  const searchParams = useSearchParams();
  const token = String(searchParams.get('token') || '').trim();
  const router = useRouter();
  const [locale, setLocale] = useLocale();
  const [emailMasked, setEmailMasked] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [tokenError, setTokenError] = useState('');
  const [requires2fa, setRequires2fa] = useState(false);
  const [challengeToken, setChallengeToken] = useState('');
  const [twoFaCode, setTwoFaCode] = useState('');
  const [turnstileToken, setTurnstileToken] = useState('');
  const [turnstileError, setTurnstileError] = useState(false);
  const [turnstileRequired, setTurnstileRequired] = useState(false);
  const [turnstileSiteKey, setTurnstileSiteKey] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/auth/captcha-config');
        const data = await res.json().catch(() => ({}));
        if (cancelled || !res.ok) return;
        setTurnstileRequired(Boolean(data.required));
        setTurnstileSiteKey(String(data.siteKey || '').trim());
      } catch {
        /* optional */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!token) {
        if (!cancelled) {
          setTokenError('INVALID_TOKEN');
          setChecking(false);
        }
        return;
      }
      setChecking(true);
      try {
        const res = await fetch(`/api/auth/employee/set-password?token=${encodeURIComponent(token)}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (!cancelled) setTokenError(data.errorCode || 'INVALID_TOKEN');
          return;
        }
        if (!cancelled) setEmailMasked(data.email || '');
      } catch {
        if (!cancelled) setTokenError('INTERNAL');
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const ensureCaptcha = () => {
    if (turnstileRequired && !turnstileToken) {
      setError(t(locale, 'errors.TURNSTILE_FAILED'));
      return false;
    }
    return true;
  };

  const verify2fa = async () => {
    if (!ensureCaptcha()) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/employee/2fa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challengeToken,
          code: twoFaCode,
          locale,
          turnstileToken: turnstileToken || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          data.errorCode
            ? errorMessage(locale, data.errorCode, data.error)
            : data.error || t(locale, 'login.connectionError')
        );
        return;
      }
      setSuccess(true);
      setTimeout(() => router.replace('/employee'), 800);
    } catch {
      setError(t(locale, 'login.connectionError'));
    } finally {
      setLoading(false);
    }
  };

  const submit = async () => {
    if (!password || password.length < 8) {
      setError(t(locale, 'errors.PASSWORD_TOO_SHORT'));
      return;
    }
    if (password !== confirm) {
      setError(t(locale, 'login.changePasswordMismatch'));
      return;
    }
    if (!ensureCaptcha()) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/employee/set-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          password,
          locale,
          turnstileToken: turnstileToken || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          data.errorCode
            ? errorMessage(locale, data.errorCode, data.error)
            : data.error || t(locale, 'login.connectionError')
        );
        return;
      }
      if (data.requires2fa && data.challengeToken) {
        setRequires2fa(true);
        setChallengeToken(data.challengeToken);
        return;
      }
      setSuccess(true);
      setTimeout(() => router.replace('/employee'), 800);
    } catch {
      setError(t(locale, 'login.connectionError'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <PublicNarrowShell variant="form" locale={locale} maxWidthClass="max-w-md" className="min-h-screen py-12">
      <div className="mb-6 flex items-center justify-between gap-3">
        <BrandMark size={32} withWordmark />
        <LanguageSelect locale={locale} onChange={setLocale} compact />
      </div>
      <h1 className={S.pageTitle}>
        {requires2fa ? t(locale, 'login.twoFaTitle') : t(locale, 'employeeHome.setPasswordTitle')}
      </h1>
      <p className={cn(S.muted, 'mt-2')}>
        {requires2fa ? t(locale, 'login.twoFaIntro') : t(locale, 'employeeHome.setPasswordHint')}
      </p>

      {checking ? (
        <div className="mt-6">
          <AppLoading variant="panel" />
        </div>
      ) : tokenError ? (
        <div className="mt-6 flex flex-col gap-3">
          <InlineCallout tone="danger" role="alert">
            {errorMessage(locale, tokenError, t(locale, 'employeeHome.invalidLink'))}
          </InlineCallout>
          <p className={S.muted}>{t(locale, 'employeeInvite.expiredHelp')}</p>
          <Link href="/employee/login?mode=forgot" className={cn(S.btnPrimary, 'min-h-touch justify-center no-underline')}>
            {t(locale, 'employeeInvite.requestLink')}
          </Link>
          <Link href="/employee/login" className={cn(S.btnBrandSoft, 'min-h-touch justify-center no-underline')}>
            {t(locale, 'employeeHome.backToLogin')}
          </Link>
        </div>
      ) : success ? (
        <InlineCallout tone="success" className="mt-6">
          {t(locale, 'employeeHome.setPasswordOk')}
        </InlineCallout>
      ) : requires2fa ? (
        <div className="mt-6 flex w-full flex-col gap-3">
          <FormField label={t(locale, 'login.twoFaCode')}>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              className={cn(S.input, 'w-full')}
              value={twoFaCode}
              onChange={(e) => setTwoFaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              onKeyDown={(e) => e.key === 'Enter' && verify2fa()}
              maxLength={6}
              disabled={loading}
            />
          </FormField>
          {turnstileRequired && turnstileSiteKey ? (
            <TurnstileField
              siteKey={turnstileSiteKey}
              onToken={setTurnstileToken}
              onError={() => setTurnstileError(true)}
              errorMessage={turnstileError ? t(locale, 'errors.TURNSTILE_FAILED') : ''}
            />
          ) : null}
          {error ? (
            <InlineCallout tone="danger" role="alert">
              {error}
            </InlineCallout>
          ) : null}
          <button
            type="button"
            disabled={loading || twoFaCode.length !== 6}
            className={cn(S.btnPrimary, 'min-h-touch w-full justify-center')}
            onClick={verify2fa}
          >
            {loading ? t(locale, 'login.twoFaVerifying') : t(locale, 'login.twoFaSubmit')}
          </button>
        </div>
      ) : (
        <div className="mt-6 flex w-full flex-col gap-3">
          {emailMasked ? (
            <p className={cn(S.faint, 'm-0')}>
              {t(locale, 'employeeHome.emailLabel')}: {emailMasked}
            </p>
          ) : null}
          <FormField label={t(locale, 'employeeHome.passwordLabel')}>
            <input
              type="password"
              autoComplete="new-password"
              className={cn(S.input, 'w-full')}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
            />
          </FormField>
          <FormField label={t(locale, 'employeeHome.confirmPasswordLabel')}>
            <input
              type="password"
              autoComplete="new-password"
              className={cn(S.input, 'w-full')}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              disabled={loading}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
            />
          </FormField>
          {turnstileRequired && turnstileSiteKey ? (
            <TurnstileField
              siteKey={turnstileSiteKey}
              onToken={setTurnstileToken}
              onError={() => setTurnstileError(true)}
              errorMessage={turnstileError ? t(locale, 'errors.TURNSTILE_FAILED') : ''}
            />
          ) : null}
          {error ? (
            <InlineCallout tone="danger" role="alert">
              {error}
            </InlineCallout>
          ) : null}
          <button
            type="button"
            disabled={loading}
            className={cn(S.btnPrimary, 'min-h-touch w-full justify-center')}
            onClick={submit}
          >
            {t(locale, 'employeeHome.setPasswordSubmit')}
          </button>
        </div>
      )}
    </PublicNarrowShell>
  );
}

export default function EmployeeSetPasswordClient() {
  return (
    <Suspense fallback={<AppLoading variant="panel" />}>
      <SetPasswordForm />
    </Suspense>
  );
}
