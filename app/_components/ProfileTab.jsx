'use client';

import { useEffect, useState } from 'react';
import { errorMessage, t } from '../../lib/i18n';
import { cn } from '../../lib/cn';
import { profilePanelClass as panelClass, profilePanelHeaderClass as panelHeaderClass } from './ProfileUi';
import { PanelSubNav, S as dashS } from '../dashboard/dashboard-shared';
import LanguageSelect from './LanguageSelect';
import { FormField } from './FormField';
import { CompanyModulesField } from './CompanyModulesField';
import { InlineCallout } from './InlineCallout';
import { AppLoading, ContentEnter } from './AppLoading';
import { TotpQrCode } from './TotpQrCode';
import { CompanyLicenseSummary } from './CompanyLicenseSummary';
import { BillingTab } from './BillingTab';
import { useAppFeedbackOptional } from './AppFeedback';
import {
  modulesSelectionEqual,
  modulesSelectionForPersist,
  modulesSelectionForUi,
} from '../../lib/company-modules';

const inputClass = dashS.input;

/**
 * Tela de perfil do usuário logado (hr / direction / admin — dados próprios).
 * Gestor vinculado a uma empresa também edita os módulos comerciais do tenant.
 */
export function ProfileTab({ locale, onLocaleChange, onProfileSaved }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [companyId, setCompanyId] = useState(null);
  const [license, setLicense] = useState(null);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newPassword2, setNewPassword2] = useState('');
  const [twoFaCanUse, setTwoFaCanUse] = useState(false);
  const [twoFaEnabled, setTwoFaEnabled] = useState(false);
  const [twoFaSetupSecret, setTwoFaSetupSecret] = useState('');
  const [twoFaSetupUrl, setTwoFaSetupUrl] = useState('');
  const [twoFaCode, setTwoFaCode] = useState('');
  const [twoFaDisablePassword, setTwoFaDisablePassword] = useState('');
  const [twoFaBusy, setTwoFaBusy] = useState(false);
  const [canEditCompanyModules, setCanEditCompanyModules] = useState(false);
  const [companyModuleIds, setCompanyModuleIds] = useState([]);
  const [companyModulesBaseline, setCompanyModulesBaseline] = useState([]);
  const [modulesSaving, setModulesSaving] = useState(false);
  const [profileSection, setProfileSection] = useState('account');
  const feedback = useAppFeedbackOptional();
  const toast = feedback?.toast;

  const load2fa = async () => {
    try {
      const res = await fetch('/api/me/2fa');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return;
      setTwoFaCanUse(Boolean(data.canUse2Fa));
      setTwoFaEnabled(Boolean(data.enabled));
    } catch {
      /* ignore */
    }
  };

  const load = async () => {
    setLoading(true);
    setProfileLoaded(false);
    setError('');
    try {
      const [res, modRes] = await Promise.all([
        fetch('/api/me'),
        fetch('/api/me/company-modules'),
      ]);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || t(locale, 'panel.common.loadFailed'));
      const u = data.user || {};
      setEmail(u.email || '');
      setDisplayName(u.displayName || '');
      setRole(u.role || '');
      setCompanyName(u.companyName || '');
      setCompanyId(u.companyId ?? null);
      setLicense(data.license || null);
      setProfileLoaded(true);
      await load2fa();

      if (modRes.ok) {
        const mod = await modRes.json().catch(() => ({}));
        const ids = modulesSelectionForUi(mod.enabledModules);
        setCanEditCompanyModules(Boolean(mod.canEdit));
        setCompanyModuleIds(ids);
        setCompanyModulesBaseline(ids);
      } else {
        setCanEditCompanyModules(false);
        setCompanyModuleIds([]);
        setCompanyModulesBaseline([]);
      }
    } catch (e) {
      setError(e?.message || t(locale, 'panel.common.error'));
    } finally {
      setLoading(false);
    }
  };

  const modulesDirty = !modulesSelectionEqual(companyModuleIds, companyModulesBaseline);
  const removedModuleNames = companyModulesBaseline
    .filter((moduleId) => !companyModuleIds.includes(moduleId))
    .map((moduleId) => t(locale, `onboarding.modules.item.${moduleId}.title`));

  const saveCompanyModules = async () => {
    if (!modulesDirty) {
      toast?.(t(locale, 'dashboard.profileModulesNoChange'), 'info');
      return;
    }
    if (removedModuleNames.length && feedback?.confirm) {
      const confirmed = await feedback.confirm({
        title: t(locale, 'dashboard.profileModulesConfirmTitle'),
        message: t(locale, 'dashboard.profileModulesConfirmRemoveList', {
          modules: removedModuleNames.join(', '),
        }),
        confirmLabel: t(locale, 'dashboard.profileModulesSave'),
        danger: true,
      });
      if (!confirmed) return;
    }
    setModulesSaving(true);
    setError('');
    setMsg('');
    try {
      const toStore = modulesSelectionForPersist(companyModuleIds);
      const res = await fetch('/api/me/company-modules', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modules: toStore }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          data.errorCode ? errorMessage(locale, data.errorCode) : data.error || t(locale, 'panel.common.error')
        );
      }
      const next = modulesSelectionForUi(data.enabledModules);
      setCompanyModuleIds(next);
      setCompanyModulesBaseline(next);
      toast?.(t(locale, 'dashboard.profileModulesSaved'), 'ok');
      setTimeout(() => {
        if (typeof window !== 'undefined') window.location.reload();
      }, 500);
    } catch (e) {
      setError(e?.message || t(locale, 'panel.common.error'));
      toast?.(e?.message || t(locale, 'panel.common.error'), 'error');
    } finally {
      setModulesSaving(false);
    }
  };

  const start2faSetup = async () => {
    setTwoFaBusy(true);
    setError('');
    setMsg('');
    try {
      const res = await fetch('/api/me/2fa', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.errorCode ? errorMessage(locale, data.errorCode) : data.error || t(locale, 'panel.common.error'));
      }
      setTwoFaSetupSecret(data.secret || '');
      setTwoFaSetupUrl(data.otpauthUrl || '');
      setTwoFaCode('');
      setMsg('');
    } catch (e) {
      setError(e?.message || t(locale, 'panel.common.error'));
    } finally {
      setTwoFaBusy(false);
    }
  };

  const confirmEnable2fa = async () => {
    if (!twoFaCode.trim()) return;
    setTwoFaBusy(true);
    setError('');
    setMsg('');
    try {
      const res = await fetch('/api/me/2fa', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: twoFaCode.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.errorCode ? errorMessage(locale, data.errorCode) : data.error || t(locale, 'panel.common.error'));
      }
      setTwoFaEnabled(true);
      setTwoFaSetupSecret('');
      setTwoFaSetupUrl('');
      setTwoFaCode('');
      setMsg(t(locale, 'dashboard.profile2faEnabledOk'));
    } catch (e) {
      setError(e?.message || t(locale, 'panel.common.error'));
    } finally {
      setTwoFaBusy(false);
    }
  };

  const disable2fa = async () => {
    if (!twoFaCode.trim() || !twoFaDisablePassword) return;
    setTwoFaBusy(true);
    setError('');
    setMsg('');
    try {
      const res = await fetch('/api/me/2fa', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: twoFaCode.trim(), password: twoFaDisablePassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.errorCode ? errorMessage(locale, data.errorCode) : data.error || t(locale, 'panel.common.error'));
      }
      setTwoFaEnabled(false);
      setTwoFaSetupSecret('');
      setTwoFaSetupUrl('');
      setTwoFaCode('');
      setTwoFaDisablePassword('');
      setMsg(t(locale, 'dashboard.profile2faDisabledOk'));
    } catch (e) {
      setError(e?.message || t(locale, 'panel.common.error'));
    } finally {
      setTwoFaBusy(false);
    }
  };

  useEffect(() => { load(); }, [locale]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    setSaving(true);
    setError('');
    setMsg('');
    try {
      if (newPassword || newPassword2) {
        if (newPassword !== newPassword2) {
          throw new Error(t(locale, 'dashboard.profilePasswordMismatch'));
        }
      }
      const body = {
        email,
        displayName,
        locale,
      };
      if (newPassword) {
        body.currentPassword = currentPassword;
        body.newPassword = newPassword;
      }
      const res = await fetch('/api/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || t(locale, 'dashboard.profileSaveError'));
      setCurrentPassword('');
      setNewPassword('');
      setNewPassword2('');
      setMsg(t(locale, 'dashboard.profileSaved'));
      if (data.user?.displayName != null) setDisplayName(data.user.displayName || '');
      if (data.user?.email) setEmail(data.user.email);
      if (typeof onProfileSaved === 'function') onProfileSaved(data.user);
      setTimeout(() => setMsg(''), 3000);
    } catch (e) {
      setError(e?.message || t(locale, 'panel.common.error'));
    } finally {
      setSaving(false);
    }
  };

  const hasBillingSection = ['admin', 'hr'].includes(role);
  const saveAccountDisabled = saving || !email.trim();
  const savePasswordDisabled = saving || !currentPassword || !newPassword || !newPassword2;

  return (
    <div className="flex w-full items-start justify-center">
      <div className={cn(dashS.card, 'box-border w-full max-w-4xl p-5 sm:p-7')}>
        <p className="m-0 max-w-2xl text-prose leading-[1.55] text-ink-muted">
          {t(locale, 'dashboard.profileIntro')}
        </p>

        {loading ? (
          <div className="mt-5"><AppLoading variant="panel" /></div>
        ) : !profileLoaded ? (
          <InlineCallout tone="danger" role="alert" className="mt-5">
            <p className="m-0">{error}</p>
            <button type="button" onClick={load} className={cn(dashS.btnGhost, 'mt-3')}>
              {t(locale, 'common.retry')}
            </button>
          </InlineCallout>
        ) : (
          <ContentEnter animKey="profile-ready">
            <div className="mt-5">
              {companyName ? <CompanyLicenseSummary license={license} locale={locale} /> : null}
              <PanelSubNav
                ariaLabel={t(locale, 'dashboard.profileSectionsAria')}
                active={profileSection}
                onChange={setProfileSection}
                tabs={[
                  { id: 'account', label: t(locale, 'dashboard.profileSectionAccount') },
                  { id: 'security', label: t(locale, 'dashboard.profileSectionSecurity') },
                  ...(canEditCompanyModules
                    ? [{ id: 'modules', label: t(locale, 'dashboard.profileSectionModules') }]
                    : []),
                  ...(hasBillingSection
                    ? [{ id: 'billing', label: t(locale, 'dashboard.profileSectionBilling') }]
                    : []),
                ]}
              />

              <ContentEnter animKey={profileSection}>
                {profileSection === 'account' ? (
                  <section className={panelClass} role="tabpanel">
                    <div className={panelHeaderClass}>
                      <h2 className="m-0 font-ui text-base font-semibold text-ink">
                        {t(locale, 'dashboard.profileAccountTitle')}
                      </h2>
                      <p className="mb-0 mt-1 text-sm leading-relaxed text-ink-muted">
                        {t(locale, 'dashboard.profileAccountHint')}
                      </p>
                    </div>
                    <div className="grid items-start gap-4 sm:grid-cols-2">
                      <FormField label={t(locale, 'dashboard.profileDisplayName')}>
                        <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className={inputClass} maxLength={120} />
                      </FormField>
                      <FormField label={t(locale, 'dashboard.profileEmail')}>
                        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
                      </FormField>
                      <FormField as="div" label={t(locale, 'dashboard.profileLocale')}>
                        <LanguageSelect locale={locale} onChange={onLocaleChange} persistUser bare />
                      </FormField>
                      <div className="self-end rounded-control border border-ink/10 bg-surface px-3.5 py-3">
                        <p className="m-0 font-ui text-xs text-ink-muted">{t(locale, 'dashboard.profileRole')}</p>
                        <p className="mb-0 mt-1 font-ui text-sm font-medium text-ink">
                          {role ? t(locale, `common.roles.${role}`) : ''}{companyName ? ` · ${companyName}` : ''}
                        </p>
                      </div>
                    </div>
                    <div className="mt-6 flex justify-end border-t border-ink/10 pt-4">
                      <button type="button" onClick={save} disabled={saveAccountDisabled} className={dashS.btnPrimary}>
                        {saving ? t(locale, 'panel.common.loading') : t(locale, 'dashboard.profileSave')}
                      </button>
                    </div>
                  </section>
                ) : null}

                {canEditCompanyModules && profileSection === 'modules' ? (
                  <section className={panelClass} role="tabpanel">
                    <div className={panelHeaderClass}>
                      <h2 className="m-0 font-ui text-base font-semibold text-ink">
                        {t(locale, 'dashboard.profileModulesTitle')}
                      </h2>
                      <p className="mb-0 mt-1 text-sm leading-relaxed text-ink-muted">
                        {t(locale, 'dashboard.profileModulesScope')}
                      </p>
                    </div>
                    <InlineCallout tone="info" className="text-xs text-ink-muted">
                      {t(locale, 'dashboard.profileModulesHint')}
                    </InlineCallout>
                    <div className="mt-4">
                      <CompanyModulesField
                        locale={locale}
                        selectedIds={companyModuleIds}
                        onChange={setCompanyModuleIds}
                        disabled={modulesSaving}
                        maxHeightClass="max-h-none"
                      />
                    </div>
                    {removedModuleNames.length ? (
                      <InlineCallout tone="warning" role="status" className="mt-4 text-xs">
                        {t(locale, 'dashboard.profileModulesPendingRemoval', {
                          modules: removedModuleNames.join(', '),
                        })}
                      </InlineCallout>
                    ) : null}
                    <div className="mt-6 flex flex-wrap justify-end gap-2 border-t border-ink/10 pt-4">
                      {modulesDirty ? (
                        <button type="button" disabled={modulesSaving} onClick={() => setCompanyModuleIds([...companyModulesBaseline])} className={dashS.btnGhost}>
                          {t(locale, 'panel.common.cancel')}
                        </button>
                      ) : null}
                      <button type="button" onClick={() => void saveCompanyModules()} disabled={modulesSaving || !modulesDirty} className={dashS.btnPrimary}>
                        {modulesSaving ? t(locale, 'panel.common.loading') : t(locale, 'dashboard.profileModulesSave')}
                      </button>
                    </div>
                  </section>
                ) : null}

                {hasBillingSection && profileSection === 'billing' ? (
                  <BillingTab
                    locale={locale}
                    role={role}
                    companyId={companyId}
                    companyName={companyName}
                    license={license}
                  />
                ) : null}

                {profileSection === 'security' ? (
                  <div className="flex flex-col gap-4" role="tabpanel">
                    <section className={panelClass}>
                      <div className={panelHeaderClass}>
                        <h2 className="m-0 font-ui text-base font-semibold text-ink">
                          {t(locale, 'dashboard.profilePasswordSection')}
                        </h2>
                        <p className="mb-0 mt-1 text-sm leading-relaxed text-ink-muted">
                          {t(locale, 'dashboard.profilePasswordHint')}
                        </p>
                      </div>
                      <div className="grid items-start gap-4 lg:grid-cols-3">
                        <FormField label={t(locale, 'dashboard.profileCurrentPassword')}>
                          <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" className={inputClass} />
                        </FormField>
                        <FormField label={t(locale, 'dashboard.profileNewPassword')}>
                          <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" className={inputClass} />
                        </FormField>
                        <FormField label={t(locale, 'dashboard.profileConfirmPassword')}>
                          <input type="password" value={newPassword2} onChange={(e) => setNewPassword2(e.target.value)} autoComplete="new-password" className={inputClass} />
                        </FormField>
                      </div>
                      <div className="mt-6 flex justify-end border-t border-ink/10 pt-4">
                        <button type="button" onClick={save} disabled={savePasswordDisabled} className={dashS.btnPrimary}>
                          {saving ? t(locale, 'panel.common.loading') : t(locale, 'dashboard.profilePasswordSave')}
                        </button>
                      </div>
                    </section>

                    {twoFaCanUse ? (
                      <section className={panelClass}>
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <h2 className="m-0 font-ui text-base font-semibold text-ink">{t(locale, 'dashboard.profile2faSection')}</h2>
                          <span className="rounded-full border border-ink/12 bg-ink/[0.04] px-2 py-0.5 font-ui text-xs text-ink-muted">
                            {t(locale, 'dashboard.profile2faOptionalBadge')}
                          </span>
                        </div>
                        <p className="mb-4 mt-0 text-sm leading-relaxed text-ink-muted">{t(locale, 'dashboard.profile2faIntro')}</p>
                        {twoFaEnabled ? (
                          <div className="flex flex-col gap-4">
                            <p className="m-0 font-ui text-sm font-medium text-success">{t(locale, 'dashboard.profile2faEnabled')}</p>
                            <div className="grid items-start gap-4 sm:grid-cols-2">
                              <FormField label={t(locale, 'dashboard.profile2faCode')}>
                                <input inputMode="numeric" autoComplete="one-time-code" value={twoFaCode} onChange={(e) => setTwoFaCode(e.target.value.replace(/\D/g, '').slice(0, 6))} className={inputClass} maxLength={6} />
                              </FormField>
                              <FormField label={t(locale, 'dashboard.profile2faDisablePassword')}>
                                <input type="password" autoComplete="current-password" value={twoFaDisablePassword} onChange={(e) => setTwoFaDisablePassword(e.target.value)} className={inputClass} />
                              </FormField>
                            </div>
                            <button type="button" onClick={disable2fa} disabled={twoFaBusy || twoFaCode.length !== 6 || !twoFaDisablePassword} className={cn('min-h-touch self-start rounded-control border border-danger/30 bg-danger/10 px-4 py-2.5 font-ui text-sm font-medium text-danger', (twoFaBusy || twoFaCode.length !== 6 || !twoFaDisablePassword) && 'cursor-default opacity-60')}>
                              {twoFaBusy ? t(locale, 'panel.common.loading') : t(locale, 'dashboard.profile2faDisable')}
                            </button>
                          </div>
                        ) : twoFaSetupSecret ? (
                          <div className="flex flex-col gap-4">
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
                            <div className="max-w-sm">
                              <p className="mb-2 mt-0 font-ui text-sm font-semibold text-ink">{t(locale, 'dashboard.profile2faConfirmStep')}</p>
                              <FormField label={t(locale, 'dashboard.profile2faCode')}>
                                <input inputMode="numeric" autoComplete="one-time-code" value={twoFaCode} onChange={(e) => setTwoFaCode(e.target.value.replace(/\D/g, '').slice(0, 6))} className={inputClass} maxLength={6} />
                              </FormField>
                            </div>
                            <button type="button" onClick={confirmEnable2fa} disabled={twoFaBusy || twoFaCode.length !== 6} className={dashS.btnBrandSoft}>
                              {twoFaBusy ? t(locale, 'panel.common.loading') : t(locale, 'dashboard.profile2faConfirmEnable')}
                            </button>
                          </div>
                        ) : (
                          <div className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-ink/10 bg-surface px-4 py-3">
                            <p className="m-0 text-sm text-ink-muted">{t(locale, 'dashboard.profile2faDisabled')}</p>
                            <button type="button" onClick={start2faSetup} disabled={twoFaBusy} className={dashS.btnBrandSoft}>
                              {twoFaBusy ? t(locale, 'panel.common.loading') : t(locale, 'dashboard.profile2faSetupStart')}
                            </button>
                          </div>
                        )}
                      </section>
                    ) : null}
                  </div>
                ) : null}

                {error ? <p className="mb-0 mt-4 font-ui text-sm text-danger">{error}</p> : null}
                {msg ? <p className="mb-0 mt-4 font-ui text-sm text-success">{msg}</p> : null}
              </ContentEnter>
            </div>
          </ContentEnter>
        )}
      </div>
    </div>
  );
}
