'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { errorMessage, t } from '../../lib/i18n';
import { cn } from '../../lib/cn';
import { formatDisplayDateTime } from '../../lib/format-display-date';
import { S } from '../dashboard/dashboard-shared';
import { BrandMark } from './BrandMark';
import { DarkModeToggle } from './DarkModeProvider';
import { EmptyState } from './EmptyState';
import { Icon } from './Icon';
import { AppLoading } from './AppLoading';
import { useAppFeedback } from './AppFeedback';
import { useEmployeeNav } from './EmployeeNavContext';
import { redirectEmployeeIfUnauthorized } from '../../lib/employee-client-session';
import { EmployeeLogoutButton } from './EmployeeLogoutButton';
import { ProfileMenuTrigger, profileMenuPanelClass, profileMenuItemClass } from './ProfileUi';

/**
 * Collaborator chrome — theme, notifications, profile menu.
 * Brand lives in the sidebar; this bar stays compact for notebook/desktop.
 * Language lives in Meu perfil (saved on the account).
 */
export function EmployeeTopBar({
  locale,
  displayName,
  companyName,
}) {
  const router = useRouter();
  const { promptForm, toast } = useAppFeedback();
  const { focusSection } = useEmployeeNav();
  const [notifOpen, setNotifOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [companyChoices, setCompanyChoices] = useState([]);
  const [companyChoicesLoaded, setCompanyChoicesLoaded] = useState(false);
  const [companyChoicesLoading, setCompanyChoicesLoading] = useState(false);
  const [switchingCompany, setSwitchingCompany] = useState(false);
  const wrapRef = useRef(null);
  const pollRef = useRef(null);

  const loadNotifs = useCallback(async () => {
    try {
      const res = await fetch('/api/employee/notifications?limit=20');
      if (redirectEmployeeIfUnauthorized(router, res.status)) return;
      if (!res.ok) return;
      const data = await res.json();
      setItems(Array.isArray(data.items) ? data.items : []);
      setUnreadCount(typeof data.unreadCount === 'number' ? data.unreadCount : 0);
    } catch {
      /* ignore */
    }
  }, [router]);

  const loadCompanyChoices = useCallback(async () => {
    if (companyChoicesLoaded || companyChoicesLoading) return;
    setCompanyChoicesLoading(true);
    try {
      const res = await fetch('/api/employee/companies', { cache: 'no-store' });
      if (redirectEmployeeIfUnauthorized(router, res.status)) return;
      if (!res.ok) return;
      const data = await res.json().catch(() => ({}));
      setCompanyChoices(Array.isArray(data.items) ? data.items : []);
      setCompanyChoicesLoaded(true);
    } catch {
      /* Keep the profile menu usable when company discovery is unavailable. */
    } finally {
      setCompanyChoicesLoading(false);
    }
  }, [companyChoicesLoaded, companyChoicesLoading, router]);

  useEffect(() => {
    const clearPoll = () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
    const startPoll = () => {
      clearPoll();
      pollRef.current = setInterval(loadNotifs, 20000);
    };
    const sync = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        clearPoll();
        return;
      }
      void loadNotifs();
      startPoll();
    };
    sync();
    const onVis = () => {
      if (document.visibilityState === 'visible') sync();
      else clearPoll();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearPoll();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [loadNotifs]);

  useEffect(() => {
    const onDoc = (e) => {
      if (!wrapRef.current?.contains(e.target)) {
        setNotifOpen(false);
        setProfileOpen(false);
      }
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setNotifOpen(false);
        setProfileOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  const markReadAndGo = (item) => {
    // Navigation must not wait for the PATCH round-trip; refresh the list once it lands.
    const marked = item.readAt
      ? Promise.resolve()
      : fetch('/api/employee/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id }),
        keepalive: true,
      }).catch(() => {});
    setNotifOpen(false);
    const href = item.href || '/employee';
    const hash = href.includes('#') ? href.split('#')[1] : '';
    if (hash && (href.startsWith('/employee#') || href === `#${hash}`)) {
      router.push('/employee');
      // After navigation, focus expands + scrolls even if already on home
      window.setTimeout(() => focusSection(hash), 0);
    } else {
      router.push(href);
    }
    void marked.then(() => loadNotifs());
  };

  const markAll = async () => {
    await fetch('/api/employee/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ markAll: true }),
    });
    void loadNotifs();
  };

  const postCompanySwitch = async (payload) => {
    const res = await fetch('/api/employee/companies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, locale }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(
        data.errorCode
          ? errorMessage(locale, data.errorCode, data.error)
          : data.error || t(locale, 'employeeHome.switchCompanyError')
      );
    }
    return data;
  };

  const switchCompany = async () => {
    const targets = companyChoices.filter((item) => !item.current);
    if (!targets.length || switchingCompany) return;
    setProfileOpen(false);
    const values = await promptForm({
      title: t(locale, 'employeeHome.switchCompanyTitle'),
      message: t(locale, 'employeeHome.switchCompanyHint'),
      confirmLabel: t(locale, 'employeeHome.switchCompanyConfirm'),
      fields: [
        {
          key: 'companyId',
          type: 'select',
          label: t(locale, 'employeeHome.switchCompanyLabel'),
          defaultValue: String(targets[0].companyId),
          options: targets.map((item) => ({
            value: String(item.companyId),
            label: item.companyName || t(locale, 'employeeHome.pickCompanyFallback'),
          })),
        },
        {
          key: 'password',
          type: 'password',
          label: t(locale, 'employeeHome.switchCompanyPassword'),
          autoComplete: 'current-password',
          required: true,
          maxLength: 200,
        },
      ],
    });
    if (!values) return;
    if (!values.password) {
      toast(t(locale, 'employeeHome.switchCompanyPasswordRequired'), 'warning');
      return;
    }

    setSwitchingCompany(true);
    try {
      let result = await postCompanySwitch({
        companyId: Number(values.companyId),
        password: values.password,
      });
      if (result.requires2fa && result.challengeToken) {
        const codeValues = await promptForm({
          title: t(locale, 'login.twoFaTitle'),
          message: t(locale, 'login.twoFaIntro'),
          confirmLabel: t(locale, 'login.twoFaSubmit'),
          fields: [
            {
              key: 'code',
              label: t(locale, 'login.twoFaCode'),
              placeholder: '000000',
              maxLength: 6,
              inputMode: 'numeric',
              autoComplete: 'one-time-code',
              required: true,
            },
          ],
        });
        if (!codeValues) return;
        result = await postCompanySwitch({
          challengeToken: result.challengeToken,
          code: codeValues.code,
        });
      }
      if (result.ok && typeof window !== 'undefined') {
        window.location.assign('/employee');
      }
    } catch (err) {
      toast(err?.message || t(locale, 'employeeHome.switchCompanyError'), 'error');
      setProfileOpen(true);
    } finally {
      setSwitchingCompany(false);
    }
  };

  return (
    <header className="emp-topbar sticky top-0 z-30 border-b border-ink/10 bg-canvas/90 backdrop-blur">
      <div
        ref={wrapRef}
        className="flex min-h-[68px] flex-wrap items-center justify-between gap-2 px-4 py-2.5 pl-16 md:min-h-0 md:pl-4 lg:px-6"
      >
        <div className="flex min-w-0 items-center gap-2 md:hidden">
          <BrandMark size={22} withWordmark href="/employee" />
          {companyName ? (
            <span className="truncate font-ui text-prose text-ink-muted">{companyName}</span>
          ) : null}
        </div>
        <p className="m-0 hidden min-w-0 truncate font-ui text-prose text-ink-muted md:block">
          {displayName
            ? t(locale, 'employeeHome.hello', { name: displayName })
            : t(locale, 'employeeHome.eyebrow')}
        </p>

        <div className="ml-auto flex min-w-0 max-w-full flex-wrap items-center justify-end gap-1.5">
          <DarkModeToggle locale={locale} />

          <div className="relative">
            <button
              type="button"
              className={cn(S.btnGhost, 'relative min-h-touch px-2')}
              aria-label={t(locale, 'employeeHome.notificationsAria')}
              aria-expanded={notifOpen}
              aria-haspopup="true"
              aria-controls="employee-notif-menu"
              onClick={() => {
                setNotifOpen((v) => !v);
                setProfileOpen(false);
                void loadNotifs();
              }}
            >
              <Icon name="bell" />
              {unreadCount > 0 ? (
                <span className="absolute right-1 top-1 min-w-[16px] rounded-full bg-danger px-1 text-center font-mono text-2xs text-white">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              ) : null}
            </button>
            {notifOpen ? (
              <div
                id="employee-notif-menu"
                className="absolute right-0 z-50 mt-1 w-[min(100vw-2rem,320px)] rounded-control border border-ink/12 bg-surface p-2 shadow-card"
              >
                <div className="mb-1 flex items-center justify-between gap-2 px-1">
                  <span className={S.label}>{t(locale, 'employeeHome.notificationsTitle')}</span>
                  {unreadCount > 0 ? (
                    <button
                      type="button"
                      className={S.btnGhost}
                      onClick={markAll}
                    >
                      {t(locale, 'employeeHome.notificationsMarkAll')}
                    </button>
                  ) : null}
                </div>
                {items.length === 0 ? (
                  <EmptyState
                    className="border-0 bg-transparent px-2 py-4"
                    message={t(locale, 'employeeHome.notificationsEmpty')}
                    actionLabel={t(locale, 'employeeHome.notificationsEmptyCta')}
                    onAction={() => {
                      setNotifOpen(false);
                      router.push('/employee#tasks');
                    }}
                  />
                ) : (
                  <ul className="m-0 max-h-72 list-none overflow-y-auto p-0">
                    {items.map((item) => (
                      <li key={item.id}>
                        <button
                          type="button"
                          className={cn(
                            'w-full rounded-control border-none px-2 py-2 text-left',
                            item.readAt ? 'bg-transparent' : 'bg-brand-500/[0.06]'
                          )}
                          onClick={() => markReadAndGo(item)}
                        >
                          <div className="text-prose text-ink">
                            {t(locale, item.copy?.titleKey || 'employeeHome.notifGenericTitle', item.copy?.values)}
                          </div>
                          <div className="mt-0.5 text-2xs text-ink-muted">
                            {t(locale, item.copy?.bodyKey || 'employeeHome.notifGenericBody', item.copy?.values)}
                          </div>
                          <div className="mt-1 font-mono text-2xs text-ink-faint">
                            {formatDisplayDateTime(item.createdAt, locale, { fallback: '' })}
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}
          </div>

          <div className="relative">
            <ProfileMenuTrigger
              label={displayName}
              fallback={t(locale, 'dashboard.profile')}
              open={profileOpen}
              controls="employee-profile-menu"
              ariaLabel={t(locale, 'dashboard.profileMenuAria')}
              onClick={() => {
                const nextOpen = !profileOpen;
                setProfileOpen(nextOpen);
                setNotifOpen(false);
                if (nextOpen) void loadCompanyChoices();
              }}
            />
            {profileOpen ? (
              <div
                id="employee-profile-menu"
                className={profileMenuPanelClass}
                role="menu"
              >
                {companyName ? (
                  <div className="mb-1 border-b border-ink/8 px-2.5 py-2">
                    <span className="block text-2xs text-ink-faint">
                      {t(locale, 'employeeHome.currentCompany')}
                    </span>
                    <span className="mt-0.5 block truncate text-xs font-medium text-ink">
                      {companyName}
                    </span>
                  </div>
                ) : null}
                {companyChoicesLoading ? (
                  <div className="px-2.5 py-2">
                    <AppLoading
                      locale={locale}
                      variant="inline"
                      label={t(locale, 'employeeHome.checkingCompanies')}
                    />
                  </div>
                ) : null}
                {companyChoices.length > 1 ? (
                  <button
                    type="button"
                    role="menuitem"
                    disabled={switchingCompany}
                    className={cn(
                      S.btnGhost,
                      'flex min-h-touch w-full items-center justify-start gap-2.5 disabled:cursor-default disabled:opacity-60'
                    )}
                    onClick={() => void switchCompany()}
                  >
                    <Icon name="building" className="h-4 w-4 shrink-0 opacity-80" />
                    <span>{t(locale, 'employeeHome.switchCompany')}</span>
                  </button>
                ) : null}
                <Link
                  href="/employee/profile"
                  role="menuitem"
                  className={cn(profileMenuItemClass, 'border-b border-ink/12')}
                  onClick={() => setProfileOpen(false)}
                >
                  <Icon name="user" className="h-4 w-4 shrink-0 opacity-80" />
                  <span>{t(locale, 'dashboard.profile')}</span>
                </Link>
                <EmployeeLogoutButton locale={locale} role="menuitem" className={cn(profileMenuItemClass, 'text-danger/75 rounded-none')} onLoggedOut={() => setProfileOpen(false)} />
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  );
}
