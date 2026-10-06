'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { t } from '../../lib/i18n';
import { cn } from '../../lib/cn';
import { employeeLoginUrl } from '../../lib/employee-client-session';
import { Icon } from './Icon';
import { Spinner } from './AppLoading';
import { useAppFeedback } from './AppFeedback';
import { SidebarNavItem } from './SidebarNav';

/** Both employee menus share the same logout and failure behavior. */
export function EmployeeLogoutButton({ locale, compact = false, role, onLoggedOut, onBeforeLogout, className, variant }) {
  const router = useRouter();
  const { toast, confirm } = useAppFeedback();
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const label = t(locale, 'employeeHome.logout');
  const logout = async () => {
    if (pending.current) return;
    pending.current = true;
    onBeforeLogout?.();
    try {
      const confirmed = await confirm({
        title: t(locale, 'employeeHome.logoutConfirmTitle'),
        message: t(locale, 'employeeHome.logoutConfirmBody'),
        confirmLabel: t(locale, 'employeeHome.logoutConfirmAction'),
        danger: true,
      });
      if (!confirmed) return;

      setBusy(true);
      try {
        const response = await fetch('/api/auth/employee/session', { method: 'DELETE' });
        if (!response.ok) throw new Error('logout');
        onLoggedOut?.();
        router.replace(employeeLoginUrl({ reason: 'logout' }));
      } catch {
        toast(t(locale, 'employeeHome.logoutFailed'), 'error');
        setBusy(false);
      }
    } finally {
      pending.current = false;
    }
  };
  if (variant === 'nav') {
    return <SidebarNavItem collapsed={compact} item={{
      id: 'logout', icon: 'logout', tone: 'danger', disabled: busy, onClick: logout,
      label: busy ? t(locale, 'employeeHome.loggingOut') : label,
    }} />;
  }
  return <button type="button" role={role} onClick={logout} disabled={busy} aria-busy={busy}
    aria-label={busy ? t(locale, 'employeeHome.loggingOut') : label} title={compact ? label : undefined}
    className={cn('flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-control border-0 bg-transparent py-3 font-ui text-sm font-medium text-ink-muted transition-colors hover:bg-danger/10 hover:text-danger focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:cursor-default disabled:opacity-55', compact ? 'justify-center px-0' : 'justify-start px-2.5', className)}>
    {busy ? <Spinner /> : <Icon name="logout" className="h-4 w-4 shrink-0 opacity-80" />}
    {!compact ? <span>{busy ? t(locale, 'employeeHome.loggingOut') : label}</span> : null}
  </button>;
}
