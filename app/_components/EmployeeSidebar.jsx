'use client';

import { usePathname, useRouter } from 'next/navigation';
import { t } from '../../lib/i18n';
import { BrandMark } from './BrandMark';
import { EmployeeLogoutButton } from './EmployeeLogoutButton';
import { SidebarNav, SidebarNavItem } from './SidebarNav';
import { useEmployeeNav } from './EmployeeNavContext';
import { employeeSectionVisible } from '../../lib/company-modules';

/** @typedef {{ id: string, href: string, icon: string, labelKey: string, hash?: string }} EmpNavItem */

export const EMPLOYEE_NAV_ITEMS = Object.freeze([
  { id: 'tasks', href: '/employee#tasks', icon: 'list', labelKey: 'employeeHome.tasksTitle', hash: 'tasks' },
  { id: 'journey', href: '/employee#journey', icon: 'sparkles', labelKey: 'employeeHome.journeyTitle', hash: 'journey' },
  { id: 'surveys', href: '/employee#surveys', icon: 'climate', labelKey: 'employeeHome.surveysTitle', hash: 'surveys' },
  { id: 'pdi', href: '/employee/pdi', icon: 'clipboard', labelKey: 'employeeHome.pdiPageTitle' },
  { id: 'formalReviews', href: '/employee#formalReviews', icon: 'clipboard', labelKey: 'dashboard.performanceReviews', hash: 'formalReviews' },
  { id: 'okr', href: '/employee#okr', icon: 'chart', labelKey: 'employeeHome.okrTitle', hash: 'okr' },
  { id: 'lms', href: '/employee/lms', icon: 'book', labelKey: 'employeeHome.lmsTitle' },
  {
    id: 'oneOnOne',
    href: '/employee#oneOnOne',
    icon: 'team',
    labelKey: 'panel.employeePortal.agreementsTitle',
    hash: 'oneOnOne',
  },
  {
    id: 'feedback',
    href: '/employee#feedback',
    icon: 'feedbackInfo',
    labelKey: 'employeeHome.feedbackTitle',
    hash: 'feedback',
  },
  { id: 'dp', href: '/employee/dp', icon: 'dp', labelKey: 'employeeHome.dpTitle' },
  {
    id: 'timeClock',
    href: '/employee/time-clock',
    icon: 'clock',
    labelKey: 'employeeHome.timeClockTitle',
  },
  { id: 'field', href: '/employee/field', icon: 'mapPin', labelKey: 'panel.field.employeeNav' },
  {
    id: 'variablePay',
    href: '/employee#variablePay',
    icon: 'salary',
    labelKey: 'employeeHome.variablePayTitle',
    hash: 'variablePay',
  },
  { id: 'feed', href: '/employee#feed', icon: 'bell', labelKey: 'employeeHome.feedTitle', hash: 'feed' },
  { id: 'kudos', href: '/employee#kudos', icon: 'gift', labelKey: 'employeeHome.kudosTitle', hash: 'kudos' },
  { id: 'company', href: '/employee#company', icon: 'building', labelKey: 'employeeHome.companyTitle', hash: 'company' },
  { id: 'profile', href: '/employee/profile', icon: 'user', labelKey: 'dashboard.profile' },
]);

/** Menu groups — same chrome idea as dashboard section labels. */
const NAV_GROUPS = Object.freeze([
  {
    id: 'today',
    icon: 'list',
    labelKey: 'employeeHome.navGroupToday',
    ids: ['tasks', 'journey', 'surveys'],
  },
  {
    id: 'grow',
    icon: 'academy',
    labelKey: 'employeeHome.navGroupGrow',
    ids: ['pdi', 'formalReviews', 'okr', 'lms', 'oneOnOne', 'feedback'],
  },
  {
    id: 'work',
    icon: 'briefcase',
    labelKey: 'employeeHome.navGroupWork',
    ids: ['dp', 'timeClock', 'field', 'variablePay', 'feed', 'kudos', 'company'],
  },
]);

function badgeFor(itemId, badges) {
  if (itemId === 'tasks') return badges.tasks;
  if (itemId === 'surveys') return badges.surveys;
  if (itemId === 'lms') return badges.lms;
  if (itemId === 'okr') return badges.okr;
  if (itemId === 'dp') return badges.dp;
  if (itemId === 'timeClock') return badges.timeClock;
  if (itemId === 'variablePay') return badges.variablePay;
  if (itemId === 'feedback') return badges.feedback;
  return 0;
}

/**
 * Left nav for authenticated collaborator chrome.
 * Always lists functionalities; empty sections open with EmptyState on the home page.
 */
export function EmployeeSidebar({
  locale,
  companyName = '',
  companyLogoUrl = '',
  open = false,
  onClose,
  sidebarRef,
}) {
  const pathname = usePathname() || '';
  const router = useRouter();
  const onHome = pathname === '/employee' || pathname === '/employee/';
  const onProfile = pathname.startsWith('/employee/profile');
  const onLms = pathname.startsWith('/employee/lms');
  const onPdi = pathname.startsWith('/employee/pdi');
  const onDp = pathname.startsWith('/employee/dp');
  const onTimeClock = pathname.startsWith('/employee/time-clock');
  const onField = pathname.startsWith('/employee/field');
  const { activeSection, badges, navCollapsed, setNavCollapsed, focusSection, companyModules, timeClockEnabled } =
    useEmployeeNav();

  const itemById = Object.fromEntries(EMPLOYEE_NAV_ITEMS.map((it) => [it.id, it]));
  const allowedGroups = NAV_GROUPS.map((g) => ({
    ...g,
    ids: g.ids.filter((id) => employeeSectionVisible(companyModules, id, { timeClockEnabled })),
  })).filter((g) => g.ids.length > 0);

  const isDedicatedRoute = (itemId) =>
    itemId === 'profile' || itemId === 'pdi' || itemId === 'lms' || itemId === 'dp' || itemId === 'timeClock' || itemId === 'field';

  const isActive = (item) => {
    if (item.id === 'profile') return onProfile;
    if (item.id === 'pdi') return onPdi;
    if (item.id === 'lms') return onLms;
    if (item.id === 'dp') return onDp;
    if (item.id === 'timeClock') return onTimeClock;
    if (item.id === 'field') return onField;
    if (onHome) return activeSection === item.hash || activeSection === item.id;
    return false;
  };

  const goItem = (item, e) => {
    // Keep native link behavior for opening a section in another tab/window.
    if (e && (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0)) return;
    onClose?.();
    if (isDedicatedRoute(item.id)) {
      if (!e) router.push(item.href);
      return; // let Link navigate
    }
    e?.preventDefault();
    if (onHome) {
      focusSection(item.hash || item.id);
      return;
    }
    router.push(item.href);
  };

  const groupsWithItems = allowedGroups
    .map((group) => ({ ...group, items: group.ids.map((id) => itemById[id]).filter(Boolean) }))
    .filter((group) => group.items.length > 0);
  const sidebarGroups = groupsWithItems.map((group) => ({
    id: group.id,
    label: t(locale, group.labelKey),
    items: group.items.map((item) => ({
      id: item.id,
      label: t(locale, item.labelKey),
      icon: item.icon,
      href: item.href,
      active: isActive(item),
      badge: badgeFor(item.id, badges),
      onClick: (e) => goItem(item, e),
    })),
  }));

  const companyHeader = companyName || companyLogoUrl ? (
    <div className="flex min-w-0 items-center gap-2">
      {companyLogoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- remote company logo URL from S3
        <img
          src={companyLogoUrl}
          alt=""
          width={18}
          height={18}
          className="h-[18px] w-[18px] flex-shrink-0 rounded object-contain"
        />
      ) : null}
      {companyName ? (
        <span className="truncate font-ui text-sm font-semibold text-ink" title={companyName}>
          {companyName}
        </span>
      ) : null}
    </div>
  ) : (
    <p className="m-0 truncate font-ui text-sm font-semibold text-ink">
      {t(locale, 'employeeHome.sidebarLabel')}
    </p>
  );

  return (
    <SidebarNav
      id="employee-sidebar"
      sidebarRef={sidebarRef}
      mobileModal
      locale={locale}
      ariaLabel={t(locale, 'employeeHome.sectionNavAria')}
      storageKey="30team_employee_nav_closed_groups"
      collapsed={navCollapsed}
      onToggleCollapsed={() => setNavCollapsed((v) => !v)}
      open={open}
      onCloseMobile={onClose}
      groups={sidebarGroups}
      headerExtra={companyHeader}
      brand={(iconOnly) => (
        <BrandMark
          size={26}
          withWordmark={!iconOnly}
          href="/employee"
          onClick={onClose}
          title={t(locale, 'employeeHome.eyebrow')}
          aria-label={t(locale, 'employeeHome.eyebrow')}
        />
      )}
      footer={(iconOnly) => (
        <>
          <SidebarNavItem
            collapsed={iconOnly}
            item={{
              id: 'profile',
              icon: 'user',
              href: '/employee/profile',
              label: t(locale, 'dashboard.profile'),
              active: onProfile,
              onClick: onClose,
            }}
          />
          <EmployeeLogoutButton locale={locale} variant="nav" compact={iconOnly} onBeforeLogout={onClose} onLoggedOut={onClose} />
        </>
      )}
    />
  );
}
