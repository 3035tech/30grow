'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { sanitizeLoginRedirect } from '../../lib/identity/sanitize-login-redirect';
import { errorMessage, t } from '../../lib/i18n';
import { useLocale } from '../../lib/useLocale';
import { cn } from '../../lib/cn';
import { S } from '../dashboard/dashboard-shared';
import { AuthShell } from '../_components/AuthShell';
import { VerificationCodeInput } from '../_components/VerificationCodeInput';
import { FormField } from '../_components/FormField';
import { InlineCallout } from '../_components/InlineCallout';
import TurnstileField from '../_components/TurnstileField';

function LoginForm() {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [requires2fa, setRequires2fa] = useState(false);
  const [challengeToken, setChallengeToken] = useState('');
  const [twoFaCode, setTwoFaCode] = useState('');
  const [turnstileToken, setTurnstileToken] = useState('');
  const [turnstileError, setTurnstileError] = useState(false);
  const [turnstileRequired, setTurnstileRequired] = useState(false);
  const [turnstileSiteKey, setTurnstileSiteKey] = useState('');
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = sanitizeLoginRedirect(searchParams.get('redirect'));
  const sessionReason = String(searchParams.get('reason') || '').slice(0, 40);
  const [locale, setLocale] = useLocale();

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const prev = document.title;
    document.title = t(locale, 'login.documentTitle');
    return () => {
      document.title = prev;
    };
  }, [locale]);

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
        /* Turnstile opcional — login segue sem CAPTCHA */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/auth/session-edge', { cache: 'no-store' });
        if (!cancelled && res.ok) router.replace(redirect);
      } catch {
        /* stay on login */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [redirect, router]);

  const login = async () => {
    if (!email || !password) return;
    setLoading(true); setError(''); setSuccess('');
    setTurnstileError(false);
    if (turnstileRequired && !turnstileToken) {
      setError(t(locale, 'errors.TURNSTILE_FAILED'));
      setTurnstileError(true);
      setLoading(false);
      return;
    }
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, rememberMe, turnstileToken: turnstileToken || undefined }),
      });
      const data = await res.json();
      if (res.ok) {
        if (data.requires2fa && data.challengeToken) {
          setRequires2fa(true);
          setChallengeToken(data.challengeToken);
          setTwoFaCode('');
          return;
        }
        if (data.mustChangePassword) {
          setCurrentPassword(password);
          setMustChangePassword(true);
        } else {
          router.push(redirect);
        }
      } else {
        setError(data.errorCode ? errorMessage(locale, data.errorCode, data.error) : data.error || t(locale, 'login.wrongPassword'));
      }
    } catch {
      setError(t(locale, 'login.connectionError'));
    } finally {
      setLoading(false);
    }
  };

  const verify2fa = async (completedCode) => {
    const code = typeof completedCode === 'string' ? completedCode : twoFaCode;
    if (loading || !/^\d{6}$/.test(code)) return;
    if (!challengeToken) return;
    setLoading(true);
    setError('');
    setTurnstileError(false);
    if (turnstileRequired && !turnstileToken) {
      setError(t(locale, 'errors.TURNSTILE_FAILED'));
      setTurnstileError(true);
      setLoading(false);
      return;
    }
    try {
      const res = await fetch('/api/auth/2fa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challengeToken,
          code,
          turnstileToken: turnstileToken || undefined,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        if (data.mustChangePassword) {
          setRequires2fa(false);
          setCurrentPassword(password);
          setMustChangePassword(true);
        } else {
          router.push(redirect);
        }
      } else {
        if (data.errorCode === 'TOTP_INVALID') setTwoFaCode('');
        setError(data.errorCode ? errorMessage(locale, data.errorCode, data.error) : data.error || t(locale, 'login.connectionError'));
      }
    } catch {
      setError(t(locale, 'login.connectionError'));
    } finally {
      setLoading(false);
    }
  };

  const requestReset = async () => {
    if (!email) {
      setError(errorMessage(locale, 'EMAIL_REQUIRED'));
      return;
    }
    setLoading(true);
    setError('');
    setSuccess('');
    setTurnstileError(false);
    if (turnstileRequired && !turnstileToken) {
      setError(t(locale, 'errors.TURNSTILE_FAILED'));
      setTurnstileError(true);
      setLoading(false);
      return;
    }
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, locale, turnstileToken: turnstileToken || undefined }),
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
      setSuccess(t(locale, 'login.forgotOk'));
    } catch {
      setError(t(locale, 'login.connectionError'));
    } finally {
      setLoading(false);
    }
  };

  const changePassword = async () => {
    if (!currentPassword || !newPassword) return;
    if (newPassword !== confirmPassword) {
      setError(t(locale, 'login.changePasswordMismatch'));
      return;
    }
    setLoading(true); setError(''); setSuccess('');
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.errorCode ? errorMessage(locale, data.errorCode, data.error) : data.error || t(locale, 'login.connectionError'));
        return;
      }
      setSuccess(t(locale, 'login.changePasswordOk'));
      setTimeout(() => router.push(redirect), 500);
    } catch {
      setError(t(locale, 'login.connectionError'));
    } finally {
      setLoading(false);
    }
  };

  const titleKey = mustChangePassword
    ? 'login.changePasswordTitle'
    : requires2fa
      ? 'login.twoFaTitle'
      : mode === 'forgot'
        ? 'login.forgotTitle'
        : 'login.title';

  const primaryAction = mustChangePassword
    ? changePassword
    : requires2fa
      ? verify2fa
      : mode === 'forgot'
        ? requestReset
        : login;

  return (
    <AuthShell
      locale={locale}
      onLocaleChange={setLocale}
      context={t(locale, 'login.restricted')}
      title={(
        <>
          {t(locale, titleKey).split('\n').map((line, i) => (
            <span key={line}>{i > 0 ? <br /> : null}{line}</span>
          ))}
        </>
      )}
      intro={requires2fa
        ? t(locale, 'login.twoFaAutoIntro')
        : !mustChangePassword
          ? t(locale, mode === 'forgot' ? 'login.forgotIntro' : 'login.intro')
          : null}
    >

        {sessionReason === 'expired' ? (
          <InlineCallout tone="warning" emphasis className="mb-5">
            {t(locale, 'login.sessionExpired')}
          </InlineCallout>
        ) : null}
        {sessionReason === 'logout' ? (
          <InlineCallout tone="info" emphasis className="mb-5">
            {t(locale, 'login.logoutOk')}
          </InlineCallout>
        ) : null}

        {error ? (
          <InlineCallout
            tone="danger"
            role="alert"
            emphasis
            title={t(locale, 'login.errorTitle')}
            className="mb-5"
          >
            {error}
          </InlineCallout>
        ) : null}
        {success ? (
          <InlineCallout tone="success" emphasis className="mb-5">
            {success}
          </InlineCallout>
        ) : null}

        <div className="mb-4 flex w-full flex-col gap-3">
          {mustChangePassword ? (
            <>
              <FormField htmlFor="login-current-password" label={t(locale, 'login.changePasswordCurrent')}>
                <input
                  id="login-current-password"
                  type="password"
                  autoComplete="current-password"
                  className={S.input}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                />
              </FormField>
              <FormField htmlFor="login-new-password" label={t(locale, 'login.changePasswordNew')}>
                <input
                  id="login-new-password"
                  type="password"
                  autoComplete="new-password"
                  className={S.input}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </FormField>
              <FormField htmlFor="login-confirm-password" label={t(locale, 'login.changePasswordConfirm')}>
                <input
                  id="login-confirm-password"
                  type="password"
                  autoComplete="new-password"
                  className={cn(S.input, error && 'border-danger')}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && changePassword()}
                />
              </FormField>
            </>
          ) : requires2fa ? (
            <FormField htmlFor="login-2fa-code" label={t(locale, 'login.twoFaCode')}>
              <VerificationCodeInput id="login-2fa-code" label={t(locale, 'login.twoFaCode')}
                value={twoFaCode} onChange={setTwoFaCode} onComplete={verify2fa} disabled={loading} invalid={Boolean(error)} />
            </FormField>
          ) : mode === 'forgot' ? (
            <FormField htmlFor="login-email" label={t(locale, 'login.email')}>
              <input
                id="login-email"
                type="email"
                autoComplete="username"
                className={S.input}
                value={email}
                placeholder={t(locale, 'login.emailPlaceholder')}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && requestReset()}
              />
            </FormField>
          ) : (
            <>
              <FormField htmlFor="login-email" label={t(locale, 'login.email')}>
                <input
                  id="login-email"
                  type="email"
                  autoComplete="username"
                  className={S.input}
                  value={email}
                  placeholder={t(locale, 'login.emailPlaceholder')}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && login()}
                />
              </FormField>
              <FormField htmlFor="login-password" label={t(locale, 'login.password')}>
                <input
                  id="login-password"
                  type="password"
                  autoComplete="current-password"
                  className={cn(S.input, error && 'border-danger')}
                  value={password}
                  placeholder={t(locale, 'login.passwordPlaceholder')}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && login()}
                />
              </FormField>
              <label className="flex min-h-touch cursor-pointer items-start gap-3 text-sm text-ink">
                <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} disabled={loading} className="mt-1 h-4 w-4 accent-brand-700" />
                <span>{t(locale, 'login.rememberMe')}<span className="mt-1 block text-xs leading-5 text-ink-muted">{t(locale, 'login.rememberMeHint')}</span></span>
              </label>
            </>
          )}
        </div>

        {turnstileRequired && turnstileSiteKey && !mustChangePassword ? (
          <div className="mb-4 w-full">
            <TurnstileField
              siteKey={turnstileSiteKey}
              onToken={setTurnstileToken}
              onError={() => setTurnstileError(true)}
              errorMessage={turnstileError ? t(locale, 'errors.TURNSTILE_FAILED') : ''}
            />
          </div>
        ) : null}

        <button
          type="button"
          className={cn(S.btnPrimary, 'mb-4 min-h-touch w-full justify-center', loading && 'opacity-60')}
          onClick={primaryAction}
          disabled={loading || (requires2fa && twoFaCode.length !== 6)}
        >
          {loading
            ? (requires2fa
              ? t(locale, 'login.twoFaVerifying')
              : mode === 'forgot'
                ? t(locale, 'login.forgotSending')
                : t(locale, 'login.entering'))
            : mustChangePassword
              ? t(locale, 'login.changePasswordSubmit')
              : requires2fa
                ? t(locale, 'login.twoFaSubmit')
                : mode === 'forgot'
                  ? t(locale, 'login.forgotSubmit')
                  : t(locale, 'login.enter')}
        </button>

        <div className="flex w-full flex-col gap-2 text-left">
          {requires2fa ? (
            <button
              type="button"
              onClick={() => {
                setRequires2fa(false);
                setChallengeToken('');
                setTwoFaCode('');
                setError('');
              }}
              className="cursor-pointer border-none bg-transparent p-0 text-left font-ui text-prose text-ink-muted"
            >
              {t(locale, 'login.forgotBack')}
            </button>
          ) : null}
          {!mustChangePassword && !requires2fa && mode === 'login' ? (
            <>
              <button
                type="button"
                onClick={() => { setMode('forgot'); setError(''); setSuccess(''); }}
                className="cursor-pointer border-none bg-transparent p-0 text-left font-ui text-prose text-brand-600"
              >
                {t(locale, 'login.forgotPassword')}
              </button>
              <a
                href="/employee/login"
                className="font-ui text-prose text-ink-muted underline-offset-2 hover:text-brand-600 hover:underline"
              >
                {t(locale, 'login.employeeLogin')}
              </a>
            </>
          ) : null}
          {!mustChangePassword && !requires2fa && mode === 'forgot' ? (
            <button
              type="button"
              onClick={() => { setMode('login'); setError(''); setSuccess(''); }}
              className="cursor-pointer border-none bg-transparent p-0 text-left font-ui text-prose text-ink-muted"
            >
              {t(locale, 'login.forgotBack')}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => router.push('/')}
            className="cursor-pointer border-none bg-transparent p-0 text-left font-ui text-prose text-ink-muted"
          >
            {t(locale, 'login.backToTest')}
          </button>
        </div>
    </AuthShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
