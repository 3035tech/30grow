'use client';

import { SelectField } from '../_components/SelectField';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useLocale } from '../../lib/useLocale';
import { t, errorMessage } from '../../lib/i18n';
import { publicPricingCurrency, publicPricingTextValues } from '../../lib/pricing-currency';
import { BrandMark } from '../_components/BrandMark';
import LanguageSelect from '../_components/LanguageSelect';
import { FormField } from '../_components/FormField';
import { cn } from '../../lib/cn';
import { fieldInputClass, fieldSelectClass } from '../_components/form-control-styles';
import TurnstileField from '../_components/TurnstileField';
import { InlineCallout } from '../_components/InlineCallout';
import { S } from '../dashboard/dashboard-shared';
import { ContentEnter } from '../_components/AppLoading';
import { SIGNUP_JOB_TITLE, SIGNUP_JOB_TITLES } from '../../lib/signup-job-titles';

const TURNSTILE_SITE_KEY = String(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || '').trim();

const inputClass = `${fieldInputClass} w-full px-4 py-3 text-base placeholder:text-ink-faint focus:border-brand-300 focus:bg-white`;
const selectClass = `${fieldSelectClass} w-full px-4 py-3 text-base`;

export default function SignupPage() {
  const [locale, setLocale] = useLocale();
  const router = useRouter();
  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    companyName: '',
    jobTitle: '',
    jobTitleOther: '',
    teamSize: '',
    painPoints: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState('');
  const [turnstileError, setTurnstileError] = useState(false);

  const handleChange = (field) => (e) => {
    setFormData({ ...formData, [field]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setTurnstileError(false);

    if (TURNSTILE_SITE_KEY && !turnstileToken) {
      setError(t(locale, 'errors.TURNSTILE_FAILED'));
      setTurnstileError(true);
      setLoading(false);
      return;
    }

    try {
      // Captura sessionId de analytics se houver
      const sessionId = typeof sessionStorage !== 'undefined'
        ? sessionStorage.getItem('landing_session_id')
        : null;

      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          locale,
          sessionId,
          turnstileToken: turnstileToken || undefined,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.errorCode ? errorMessage(locale, data.errorCode) : data.error || t(locale, 'login.connectionError'));
        return;
      }

      setSuccess(true);
    } catch (err) {
      console.error('Signup error:', err);
      setError(t(locale, 'login.connectionError'));
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas p-6 font-display">
        <div className="pointer-events-none fixed inset-0 bg-radial-glow-single" />
        <div className="relative z-[1] w-full max-w-[540px] rounded-card border border-ink/12 bg-white px-8 py-10 shadow-card">
          <div className="mb-6 text-center">
            <BrandMark size={48} withWordmark />
          </div>
          <h1 className="mb-4 text-center text-2xl font-normal text-ink">
            {t(locale, 'signup.successTitle')}
          </h1>
          <p className="mb-6 text-center text-base leading-relaxed text-ink-muted">
            {t(locale, 'signup.successBody', { email: formData.email })}
          </p>
          <InlineCallout tone="info" className="mb-4 text-sm text-ink-muted">
            {t(locale, 'signup.successHint')}
          </InlineCallout>
          <button
            onClick={() => router.push('/login')}
            className={cn(S.btnPrimary, 'min-h-touch w-full justify-center')}
          >
            {t(locale, 'signup.goToLogin')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas p-6 font-display">
      <div className="pointer-events-none fixed inset-0 bg-radial-glow-single" />
      <div className="relative z-[1] w-full max-w-[540px] rounded-card border border-ink/12 bg-white px-8 py-10 shadow-card">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 [&>label>span]:hidden">
          <BrandMark size={36} withWordmark />
          <LanguageSelect locale={locale} onChange={setLocale} compact />
        </div>

        <h1 className="mb-2 text-ink text-3xl font-bold leading-tight">
          {t(locale, 'signup.title')}
        </h1>
        <p className="mb-4 text-base leading-relaxed text-ink-muted">{t(locale, 'signup.intro', publicPricingTextValues(locale))}</p>
        <p className="mb-2 text-sm leading-relaxed text-ink-muted">{t(locale, 'signup.includedBlurb')}</p>
        {publicPricingCurrency(locale) === 'BRL' ? <p className="mb-2 text-sm leading-relaxed text-ink-muted">{t(locale, 'pricing.launchSignupNote', publicPricingTextValues(locale))}</p> : null}
        <p className="mb-6">
          <Link href="/pricing" className="text-sm text-brand-600 underline-offset-2 hover:underline">
            {t(locale, 'signup.seePricing')}
          </Link>
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <FormField
            htmlFor="signup-fullname"
            label={
              <>
                {t(locale, 'signup.fullName')} <span className="text-danger">*</span>
              </>
            }
          >
            <input
              id="signup-fullname"
              type="text"
              required
              value={formData.fullName}
              onChange={handleChange('fullName')}
              className={inputClass}
              placeholder={t(locale, 'signup.fullNamePlaceholder')}
            />
          </FormField>

          <FormField
            htmlFor="signup-email"
            label={
              <>
                {t(locale, 'signup.email')} <span className="text-danger">*</span>
              </>
            }
          >
            <input
              id="signup-email"
              type="email"
              required
              autoComplete="email"
              value={formData.email}
              onChange={handleChange('email')}
              className={inputClass}
              placeholder={t(locale, 'signup.emailPlaceholder')}
            />
          </FormField>

          <FormField
            htmlFor="signup-company"
            label={
              <>
                {t(locale, 'signup.companyName')} <span className="text-danger">*</span>
              </>
            }
          >
            <input
              id="signup-company"
              type="text"
              required
              value={formData.companyName}
              onChange={handleChange('companyName')}
              className={inputClass}
              placeholder={t(locale, 'signup.companyNamePlaceholder')}
            />
          </FormField>

          <FormField htmlFor="signup-jobtitle" label={t(locale, 'signup.jobTitle')}>
            <SelectField
              id="signup-jobtitle"
              value={formData.jobTitle}
              onChange={(event) => {
                const jobTitle = event.target.value;
                setFormData((current) => ({
                  ...current,
                  jobTitle,
                  jobTitleOther:
                    jobTitle === SIGNUP_JOB_TITLE.OTHER ? current.jobTitleOther : '',
                }));
              }}
              className={selectClass}
            >
              <option value="">{t(locale, 'signup.jobTitlePlaceholder')}</option>
              {SIGNUP_JOB_TITLES.map((jobTitle) => (
                <option key={jobTitle} value={jobTitle}>
                  {t(locale, `signup.jobTitleOptions.${jobTitle}`)}
                </option>
              ))}
            </SelectField>
          </FormField>

          {formData.jobTitle === SIGNUP_JOB_TITLE.OTHER ? (
            <ContentEnter animKey="signup-job-title-other">
              <FormField
                htmlFor="signup-jobtitle-other"
                label={t(locale, 'signup.jobTitleOther')}
              >
                <input
                  id="signup-jobtitle-other"
                  type="text"
                  required
                  maxLength={120}
                  value={formData.jobTitleOther}
                  onChange={handleChange('jobTitleOther')}
                  className={inputClass}
                  placeholder={t(locale, 'signup.jobTitleOtherPlaceholder')}
                />
              </FormField>
            </ContentEnter>
          ) : null}

          <FormField htmlFor="signup-teamsize" label={t(locale, 'signup.teamSize')}>
            <SelectField
              id="signup-teamsize"
              value={formData.teamSize}
              onChange={handleChange('teamSize')}
              className={selectClass}
            >
              <option value="">{t(locale, 'signup.teamSizePlaceholder')}</option>
              <option value="1-10">1-10</option>
              <option value="11-50">11-50</option>
              <option value="51-200">51-200</option>
              <option value="201+">201+</option>
            </SelectField>
          </FormField>

          <FormField htmlFor="signup-pain" label={t(locale, 'signup.painPoints')}>
            <textarea
              id="signup-pain"
              value={formData.painPoints}
              onChange={handleChange('painPoints')}
              rows={3}
              className={cn(inputClass, 'resize-none')}
              placeholder={t(locale, 'signup.painPointsPlaceholder')}
            />
          </FormField>

          <div className="rounded-control border border-ink/8 bg-ink/[0.02] px-4 py-3 text-xs leading-relaxed text-ink-muted">
            {t(locale, 'signup.termsPrefix')}{' '}
            <Link href="/terms" target="_blank" className="font-semibold text-brand-700 underline-offset-2 hover:underline">
              {t(locale, 'signup.termsLink')}
            </Link>{' '}
            {t(locale, 'signup.privacyJoin')}{' '}
            <Link href="/privacy" target="_blank" className="font-semibold text-brand-700 underline-offset-2 hover:underline">
              {t(locale, 'signup.privacyLink')}
            </Link>.
          </div>

          {error ? (
            <InlineCallout tone="danger" role="alert">
              {error}
            </InlineCallout>
          ) : null}

          {TURNSTILE_SITE_KEY ? (
            <TurnstileField
              siteKey={TURNSTILE_SITE_KEY}
              onToken={setTurnstileToken}
              onError={() => setTurnstileError(true)}
              errorMessage={turnstileError ? t(locale, 'errors.TURNSTILE_FAILED') : ''}
            />
          ) : null}

          <button
            type="submit"
            disabled={loading}
            className={cn(S.btnPrimary, 'min-h-touch w-full justify-center', loading && 'opacity-60')}
          >
            {loading ? t(locale, 'common.loading') : t(locale, 'signup.submit')}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-ink-muted">
          {t(locale, 'signup.hasAccount')}{' '}
          <Link href="/login" className="text-brand-600 underline-offset-2 hover:underline">
            {t(locale, 'signup.goToLogin')}
          </Link>
        </p>
      </div>
    </div>
  );
}
