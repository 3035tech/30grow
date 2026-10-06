'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { EMPLOYEE_PUBLIC_PATHS } from '../../lib/employee-paths';
import { redirectEmployeeIfUnauthorized } from '../../lib/employee-client-session';
import { useLocale } from '../../lib/useLocale';
import { t } from '../../lib/i18n';
import { cn } from '../../lib/cn';
import { AppFeedbackProvider } from './AppFeedback';
import { ContentEnter } from './AppLoading';
import { EmployeeTopBar } from './EmployeeTopBar';
import { EmployeeSidebar } from './EmployeeSidebar';
import { EmployeeNavProvider } from './EmployeeNavContext';
import { Icon } from './Icon';

/**
 * Shared chrome for authenticated collaborator pages — sidebar + top bar.
 */
export function EmployeeShell({
  children,
  initialLocale = 'pt-BR',
  personName = '',
  companyName = '',
  companyLogoUrl: initialLogoUrl = '',
}) {
  const pathname = usePathname() || '';
  const router = useRouter();
  const isPublic = EMPLOYEE_PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const [locale, setLocale] = useLocale(initialLocale, { fromAccount: Boolean(personName) });
  const [displayName, setDisplayName] = useState(personName);
  const [company, setCompany] = useState(companyName);
  const [companyLogoUrl, setCompanyLogoUrl] = useState(initialLogoUrl);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const sidebarRef = useRef(null);
  const menuButtonRef = useRef(null);
  const hasServerPerson = Boolean(personName);

  useEffect(() => {
    if (!personName) return;
    setDisplayName(personName);
    setCompany(companyName);
    setCompanyLogoUrl(initialLogoUrl);
  }, [personName, companyName, initialLogoUrl]);

  useEffect(() => {
    if (isPublic || hasServerPerson) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/employee/me');
        if (redirectEmployeeIfUnauthorized(router, res.status)) return;
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setDisplayName(data.person?.fullName || '');
        setCompany(data.person?.companyName || '');
        setCompanyLogoUrl(data.person?.companyLogoUrl || '');
        if (data.person?.preferredLocale) setLocale(data.person.preferredLocale);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isPublic, hasServerPerson, setLocale, router]);

  /** Applies at once in the chrome, saves on the account, then refreshes server-rendered pages. */
  const changeLocale = useCallback(async (next) => {
    setLocale(next);
    try {
      const res = await fetch('/api/employee/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferredLocale: next }),
      });
      if (redirectEmployeeIfUnauthorized(router, res.status)) return false;
      if (!res.ok) return false;
      router.refresh();
      return true;
    } catch {
      return false;
    }
  }, [router, setLocale]);

  useEffect(() => {
    if (isPublic || !sidebarOpen) return undefined;
    const sidebar = sidebarRef.current;
    if (!sidebar) return undefined;
    const desktop = window.matchMedia('(min-width: 769px)');
    const closeOnDesktop = () => { if (desktop.matches) setSidebarOpen(false); };
    closeOnDesktop();
    desktop.addEventListener('change', closeOnDesktop);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.body.classList.add('sidebar-open');
    const focusable = () => Array.from(sidebar.querySelectorAll('a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]'))
      .filter((element) => element.getClientRects().length > 0 && !element.closest('[inert]'));
    const frame = window.requestAnimationFrame(() => focusable()[0]?.focus());
    const onKey = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); setSidebarOpen(false); return; }
      if (event.key !== 'Tab') return;
      const elements = focusable();
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (!first) { event.preventDefault(); return; }
      if (!sidebar.contains(document.activeElement) || (event.shiftKey && document.activeElement === first)) {
        event.preventDefault(); (event.shiftKey ? last : first).focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      window.cancelAnimationFrame(frame);
      desktop.removeEventListener('change', closeOnDesktop);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      document.body.classList.remove('sidebar-open');
      menuButtonRef.current?.focus({ preventScroll: true });
    };
  }, [sidebarOpen, isPublic]);

  if (isPublic) {
    return (
      <AppFeedbackProvider locale={locale}>
        <ContentEnter animKey={pathname}>{children}</ContentEnter>
      </AppFeedbackProvider>
    );
  }

  const closeSidebar = () => setSidebarOpen(false);

  return (
    <AppFeedbackProvider locale={locale}>
      <EmployeeNavProvider changeLocale={changeLocale}>
        <div className="relative min-h-screen bg-canvas font-ui text-ink">
          <button
            type="button"
            ref={menuButtonRef}
            inert={sidebarOpen || undefined}
            className={cn('db-hamburger', sidebarOpen && 'invisible')}
            onClick={() => setSidebarOpen(true)}
            aria-label={t(locale, 'common.openMenu')}
            aria-expanded={sidebarOpen}
            aria-controls="employee-sidebar"
          >
            <Icon name="menu" />
          </button>
          <div
            className={cn('db-overlay', sidebarOpen && 'db-overlay-visible')}
            onClick={closeSidebar}
            aria-hidden="true"
          />

          <div className="relative flex min-h-screen">
            <EmployeeSidebar
              locale={locale}
              companyName={company}
              companyLogoUrl={companyLogoUrl}
              open={sidebarOpen}
              onClose={closeSidebar}
              sidebarRef={sidebarRef}
            />

            <div inert={sidebarOpen || undefined} className="flex min-w-0 flex-1 flex-col">
              <EmployeeTopBar
                locale={locale}
                displayName={displayName}
                companyName={company}
              />
              <main className="emp-main min-w-0 flex-1">
                <ContentEnter animKey={pathname}>{children}</ContentEnter>
              </main>
            </div>
          </div>
        </div>
      </EmployeeNavProvider>
    </AppFeedbackProvider>
  );
}
