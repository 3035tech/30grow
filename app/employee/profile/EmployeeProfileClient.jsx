'use client';

import { EmployeeDedicatedShell, EmployeePageLoading } from '../../_components/EmployeeDedicatedShell';
import { SelectField } from '../../_components/SelectField';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { errorMessage, t } from '../../../lib/i18n';
import { cn } from '../../../lib/cn';
import { S, PanelSubNav } from '../../dashboard/dashboard-shared';
import { useAppFeedback } from '../../_components/AppFeedback';
import { ContentEnter } from '../../_components/AppLoading';
import { DateField } from '../../_components/DateField';
import { FormField, formFieldGrowClass } from '../../_components/FormField';
import { profilePanelClass, profilePanelHeaderClass } from '../../_components/ProfileUi';
import { StatusToneChip } from '../../_components/StatusToneChip';
import { InlineCallout } from '../../_components/InlineCallout';
import { EmptyState } from '../../_components/EmptyState';
import { TotpQrCode } from '../../_components/TotpQrCode';
import LanguageSelect from '../../_components/LanguageSelect';
import { useEmployeeNav } from '../../_components/EmployeeNavContext';
import { BR_STATES } from '../../../lib/candidate-profile';
import { redirectEmployeeIfUnauthorized } from '../../../lib/employee-client-session';

export function EmployeeProfileClient({ locale = 'pt-BR' }) {
  const router = useRouter();
  const { toast } = useAppFeedback();
  const { changeLocale } = useEmployeeNav();
  const [uiLocale, setUiLocale] = useState(locale);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [profileSection, setProfileSection] = useState('account');
  const [form, setForm] = useState({
    fullName: '',
    email: '',
    phone: '',
    linkedinUrl: '',
    city: '',
    state: '',
    birthDate: '',
  });
  const [pwd, setPwd] = useState({ current: '', next: '', confirm: '' });
  const [twoFaEnabled, setTwoFaEnabled] = useState(null);
  const [twoFaStatus, setTwoFaStatus] = useState('loading');
  const [twoFaSetupSecret, setTwoFaSetupSecret] = useState('');
  const [twoFaSetupUrl, setTwoFaSetupUrl] = useState('');
  const [twoFaCode, setTwoFaCode] = useState('');
  const [twoFaDisablePassword, setTwoFaDisablePassword] = useState('');
  const [twoFaBusy, setTwoFaBusy] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  const load2fa = useCallback(async () => {
    setTwoFaStatus('loading');
    setTwoFaEnabled(null);
    try {
      const res = await fetch('/api/employee/me/2fa');
      const data = await res.json().catch(() => ({}));
      if (redirectEmployeeIfUnauthorized(router, res.status)) return;
      if (!res.ok || typeof data.enabled !== 'boolean') throw new Error('2fa status unavailable');
      setTwoFaEnabled(data.enabled);
      setTwoFaStatus('ready');
    } catch {
      setTwoFaStatus('error');
    }
  }, [router]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const res = await fetch('/api/employee/me');
      if (redirectEmployeeIfUnauthorized(router, res.status)) return;
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'load');
      const p = data.person || {};
      setForm({
        fullName: p.fullName || '',
        email: p.email || '',
        phone: p.phone || '',
        linkedinUrl: p.linkedinUrl || '',
        city: p.city || '',
        state: p.state || '',
        birthDate: p.birthDate || '',
      });
      await load2fa();
    } catch (e) {
      toast(e?.message || t(locale, 'employeeHome.loadError'), 'error');
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [locale, router, toast, load2fa]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setUiLocale(locale);
  }, [locale]);

  const onLocalePick = async (next) => {
    setUiLocale(next);
    const ok = changeLocale ? await changeLocale(next) : false;
    toast(
      t(locale, ok ? 'employeeHome.profileLocaleSaved' : 'employeeHome.profileSaveError'),
      ok ? 'ok' : 'error'
    );
  };

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const prev = document.title;
    document.title = t(locale, 'employeeHome.profileDocumentTitle');
    return () => {
      document.title = prev;
    };
  }, [locale]);

  const start2faSetup = async () => {
    setTwoFaBusy(true);
    try {
      const res = await fetch('/api/employee/me/2fa', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.errorCode ? errorMessage(locale, data.errorCode) : data.error || 'setup');
      }
      setTwoFaSetupSecret(data.secret || '');
      setTwoFaSetupUrl(data.otpauthUrl || '');
      setTwoFaCode('');
    } catch (e) {
      toast(e?.message || t(locale, 'employeeHome.profileSaveError'), 'error');
    } finally {
      setTwoFaBusy(false);
    }
  };

  const confirmEnable2fa = async () => {
    setTwoFaBusy(true);
    try {
      const res = await fetch('/api/employee/me/2fa', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: twoFaCode }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.errorCode ? errorMessage(locale, data.errorCode) : data.error || 'enable');
      }
      setTwoFaSetupSecret('');
      setTwoFaSetupUrl('');
      setTwoFaCode('');
      setTwoFaEnabled(true);
      toast(t(locale, 'dashboard.profile2faEnabledOk'), 'ok');
    } catch (e) {
      toast(e?.message || t(locale, 'employeeHome.profileSaveError'), 'error');
    } finally {
      setTwoFaBusy(false);
    }
  };

  const disable2fa = async () => {
    setTwoFaBusy(true);
    try {
      const res = await fetch('/api/employee/me/2fa', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: twoFaCode, password: twoFaDisablePassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.errorCode ? errorMessage(locale, data.errorCode) : data.error || 'disable');
      }
      setTwoFaEnabled(false);
      setTwoFaCode('');
      setTwoFaDisablePassword('');
      toast(t(locale, 'dashboard.profile2faDisabledOk'), 'ok');
    } catch (e) {
      toast(e?.message || t(locale, 'employeeHome.profileSaveError'), 'error');
    } finally {
      setTwoFaBusy(false);
    }
  };

  const saveProfile = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch('/api/employee/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: form.fullName,
          phone: form.phone,
          linkedinUrl: form.linkedinUrl,
          city: form.city,
          state: form.state || null,
          birthDate: form.birthDate || null,
        }),
      });
      if (redirectEmployeeIfUnauthorized(router, res.status)) return;
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'save');
      toast(t(locale, 'employeeHome.profileSaved'), 'ok');
      await load();
    } catch (err) {
      toast(err?.message || t(locale, 'employeeHome.profileSaveError'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const changePassword = async (e) => {
    e.preventDefault();
    if (pwd.next.length < 8) {
      toast(t(locale, 'errors.PASSWORD_TOO_SHORT'), 'error');
      return;
    }
    if (pwd.next !== pwd.confirm) {
      toast(t(locale, 'login.changePasswordMismatch'), 'error');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/employee/me/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword: pwd.current,
          newPassword: pwd.next,
        }),
      });
      if (redirectEmployeeIfUnauthorized(router, res.status)) return;
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || t(locale, 'employeeHome.loginError'));
      setPwd({ current: '', next: '', confirm: '' });
      toast(t(locale, 'employeeHome.passwordChanged'), 'ok');
    } catch (err) {
      toast(err?.message || t(locale, 'employeeHome.passwordChangeError'), 'error');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <EmployeePageLoading locale={locale} titleKey="employeeHome.profileTitle" />;

  if (loadFailed) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
        <EmptyState
          message={t(locale, 'employeeHome.loadError')}
          actionLabel={t(locale, 'employeeHome.loadRetry')}
          onAction={() => void load()}
        />
      </div>
    );
  }

  return (
    <ContentEnter animKey="ready">
      <EmployeeDedicatedShell locale={locale} title={t(locale, 'employeeHome.profileTitle')} hint={t(locale, 'employeeHome.profileHint')}>
        <div className={cn(S.cardShell, 'max-w-4xl p-4 sm:p-6')}>
          <div className="mt-5">
            <PanelSubNav
              ariaLabel={t(locale, 'dashboard.profileSectionsAria')}
              active={profileSection}
              onChange={setProfileSection}
              tabs={[
                { id: 'account', label: t(locale, 'dashboard.profileSectionAccount') },
                { id: 'security', label: t(locale, 'dashboard.profileSectionSecurity') },
              ].map(tab => ({ ...tab, tabId: `employee-profile-tab-${tab.id}`, panelId: `employee-profile-panel-${tab.id}` }))}
            />
          </div>
          <section hidden={profileSection !== 'account'} role="tabpanel" id="employee-profile-panel-account" aria-labelledby="employee-profile-tab-account" className={profilePanelClass}>
            <div className={profilePanelHeaderClass}>
              <h2 className="m-0 font-ui text-base font-semibold text-ink">{t(locale, 'dashboard.profileAccountTitle')}</h2>
              <p className="mb-0 mt-1 text-sm leading-relaxed text-ink-muted">{t(locale, 'employeeHome.profileSectionContact')}</p>
            </div>
            <form className="flex flex-col gap-3" onSubmit={saveProfile}>
              <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2">
                <FormField
                  label={t(locale, 'employeeHome.fullNameLabel')}
                  className={formFieldGrowClass}
                >
                  <input
                    className={cn(S.input, 'w-full')}
                    value={form.fullName}
                    onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))}
                    required
                    disabled={busy}
                  />
                </FormField>
                <FormField label={t(locale, 'employeeHome.emailLabel')} className={formFieldGrowClass}>
                  <input
                    className={cn(S.input, 'w-full')}
                    value={form.email}
                    disabled
                    readOnly
                  />
                </FormField>
              </div>
              <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2">
                <FormField label={t(locale, 'employeeHome.phoneLabel')} className={formFieldGrowClass}>
                  <input
                    className={cn(S.input, 'w-full')}
                    value={form.phone}
                    onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                    disabled={busy}
                  />
                </FormField>
                <FormField
                  label={t(locale, 'employeeHome.linkedinLabel')}
                  className="min-w-0"
                >
                  <input
                    className={cn(S.input, 'w-full')}
                    value={form.linkedinUrl}
                    onChange={(e) => setForm((f) => ({ ...f, linkedinUrl: e.target.value }))}
                    disabled={busy}
                  />
                </FormField>
              </div>
              <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_minmax(5.5rem,0.5fr)_minmax(0,1fr)]">
                <FormField label={t(locale, 'employeeHome.cityLabel')} className="min-w-0">
                  <input
                    className={cn(S.input, 'w-full')}
                    value={form.city}
                    onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
                    disabled={busy}
                  />
                </FormField>
                <FormField label={t(locale, 'employeeHome.stateLabel')} className="min-w-0">
                  <SelectField
                    className={cn(S.select, 'w-full')}
                    value={form.state}
                    onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))}
                    disabled={busy}
                  >
                    <option value="">{t(locale, 'panel.common.notApplicable')}</option>
                    {BR_STATES.map((s) => (
                      <option key={s.uf} value={s.uf}>
                        {s.uf}
                      </option>
                    ))}
                  </SelectField>
                </FormField>
                <FormField as="div" label={t(locale, 'employeeHome.birthDateLabel')} className="min-w-0">
                  <DateField
                    className={cn(S.input, 'w-full')}
                    value={form.birthDate}
                    onChange={(e) => setForm((f) => ({ ...f, birthDate: e.target.value || '' }))}
                    disabled={busy}
                  />
                </FormField>
              </div>
              <div className="mt-3 flex justify-end border-t border-ink/10 pt-4">
                <button type="submit" disabled={busy} className={S.btnPrimary}>{t(locale, 'employeeHome.saveProfile')}</button>
              </div>
            </form>
          </section>

          <section hidden={profileSection !== 'account'} className={cn(profilePanelClass, 'mt-4')} aria-labelledby="employee-profile-locale-title">
            <div className={profilePanelHeaderClass}>
              <h2 id="employee-profile-locale-title" className="m-0 font-ui text-base font-semibold text-ink">{t(locale, 'employeeHome.profilePreferencesTitle')}</h2>
              <p className="mb-0 mt-1 text-sm leading-relaxed text-ink-muted">{t(locale, 'employeeHome.profileLocaleHint')}</p>
            </div>
            <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2">
              <FormField as="div" label={t(locale, 'dashboard.profileLocale')}>
                <LanguageSelect locale={uiLocale} onChange={(next) => void onLocalePick(next)} bare />
              </FormField>
            </div>
          </section>

          <div hidden={profileSection !== 'security'} role="tabpanel" id="employee-profile-panel-security" aria-labelledby="employee-profile-tab-security">
          <section className={profilePanelClass}>
            <div className={profilePanelHeaderClass}>
              <h2 className="m-0 font-ui text-base font-semibold text-ink">{t(locale, 'dashboard.profilePasswordSection')}</h2>
              <p className="mb-0 mt-1 text-sm leading-relaxed text-ink-muted">{t(locale, 'dashboard.profilePasswordHint')}</p>
            </div>
            <form className="grid items-start gap-4 lg:grid-cols-3" onSubmit={changePassword}>
              <FormField label={t(locale, 'employeeHome.currentPasswordLabel')}>
                <input
                  type="password"
                  autoComplete="current-password"
                  className={cn(S.input, 'w-full')}
                  value={pwd.current}
                  onChange={(e) => setPwd((p) => ({ ...p, current: e.target.value }))}
                  disabled={busy}
                  required
                />
              </FormField>
              <FormField label={t(locale, 'employeeHome.passwordLabel')}>
                <input
                  type="password"
                  autoComplete="new-password"
                  className={cn(S.input, 'w-full')}
                  value={pwd.next}
                  onChange={(e) => setPwd((p) => ({ ...p, next: e.target.value }))}
                  disabled={busy}
                  required
                />
              </FormField>
              <FormField label={t(locale, 'employeeHome.confirmPasswordLabel')}>
                <input
                  type="password"
                  autoComplete="new-password"
                  className={cn(S.input, 'w-full')}
                  value={pwd.confirm}
                  onChange={(e) => setPwd((p) => ({ ...p, confirm: e.target.value }))}
                  disabled={busy}
                  required
                />
              </FormField>
              <div className="mt-2 flex justify-end border-t border-ink/10 pt-4 lg:col-span-3">
                <button type="submit" disabled={busy || !pwd.current || !pwd.next || !pwd.confirm} className={S.btnPrimary}>{t(locale, 'dashboard.profilePasswordSave')}</button>
              </div>
            </form>
          </section>

          <section className={cn(profilePanelClass, 'mt-4')}>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h2 className="m-0 font-ui text-base font-semibold text-ink">{t(locale, 'dashboard.profile2faSection')}</h2>
              <StatusToneChip tone={twoFaEnabled ? 'success' : 'neutral'} bordered={false}>{t(locale, 'dashboard.profile2faOptionalBadge')}</StatusToneChip>
            </div>
            <InlineCallout tone="info" className="mb-3">
              {t(locale, 'dashboard.profile2faIntro')}
            </InlineCallout>
            {twoFaStatus === 'loading' ? (
              <p className={S.muted} role="status">{t(locale, 'employeeHome.twoFaLoading')}</p>
            ) : twoFaStatus === 'error' ? (
              <InlineCallout tone="warning" role="alert" action={
                <button type="button" className={S.btnGhost} onClick={() => void load2fa()}>{t(locale, 'common.retry')}</button>
              }>{t(locale, 'employeeHome.twoFaLoadError')}</InlineCallout>
            ) : twoFaEnabled ? (
              <div className="flex flex-col gap-3">
                <p className="m-0 font-ui text-sm text-success" role="status">{t(locale, 'dashboard.profile2faEnabled')}</p>
                <FormField label={t(locale, 'dashboard.profile2faCode')}>
                  <input
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    className={cn(S.input, 'w-full')}
                    value={twoFaCode}
                    onChange={(e) => setTwoFaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    maxLength={6}
                    disabled={twoFaBusy}
                  />
                </FormField>
                <FormField label={t(locale, 'dashboard.profile2faDisablePassword')}>
                  <input
                    type="password"
                    autoComplete="current-password"
                    className={cn(S.input, 'w-full')}
                    value={twoFaDisablePassword}
                    onChange={(e) => setTwoFaDisablePassword(e.target.value)}
                    disabled={twoFaBusy}
                  />
                </FormField>
                <button
                  type="button"
                  disabled={twoFaBusy || twoFaCode.length !== 6 || !twoFaDisablePassword}
                  className={cn(S.btnBrandSoft, 'min-h-touch justify-center border-danger/30 text-danger')}
                  onClick={disable2fa}
                >
                  {twoFaBusy ? t(locale, 'panel.common.loading') : t(locale, 'dashboard.profile2faDisable')}
                </button>
              </div>
            ) : twoFaSetupSecret ? (
              <div className="flex flex-col gap-3">
                <TotpQrCode
                  otpauthUrl={twoFaSetupUrl}
                  secret={twoFaSetupSecret}
                  alt={t(locale, 'dashboard.profile2faQrAlt')}
                  scanHint={t(locale, 'dashboard.profile2faSecretHint')}
                  scanStepLabel={t(locale, 'dashboard.profile2faScanStep')}
                  manualLabel={t(locale, 'dashboard.profile2faManualKey')}
                  copyLabel={t(locale, 'dashboard.profile2faCopyKey')}
                  copiedLabel={t(locale, 'dashboard.profile2faKeyCopied')}
                  privateHint={t(locale, 'dashboard.profile2faPrivateHint')}
                  loadingLabel={t(locale, 'dashboard.profile2faQrLoading')}
                />
                <p className="mb-0 mt-1 font-ui text-sm font-semibold text-ink">{t(locale, 'dashboard.profile2faConfirmStep')}</p>
                <FormField label={t(locale, 'dashboard.profile2faCode')}>
                  <input
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    className={cn(S.input, 'w-full')}
                    value={twoFaCode}
                    onChange={(e) => setTwoFaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    maxLength={6}
                    disabled={twoFaBusy}
                  />
                </FormField>
                <button
                  type="button"
                  disabled={twoFaBusy || twoFaCode.length !== 6}
                  className={cn(S.btnPrimary, 'min-h-touch justify-center')}
                  onClick={confirmEnable2fa}
                >
                  {twoFaBusy ? t(locale, 'panel.common.loading') : t(locale, 'dashboard.profile2faConfirmEnable')}
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <p className={cn(S.muted, 'm-0')}>{t(locale, 'dashboard.profile2faDisabled')}</p>
                <button
                  type="button"
                  disabled={twoFaBusy}
                  className={cn(S.btnBrandSoft, 'min-h-touch justify-center')}
                  onClick={start2faSetup}
                >
                  {twoFaBusy ? t(locale, 'panel.common.loading') : t(locale, 'dashboard.profile2faSetupStart')}
                </button>
              </div>
            )}
          </section>
          </div>
        </div>
      </EmployeeDedicatedShell>
    </ContentEnter>
  );
}
