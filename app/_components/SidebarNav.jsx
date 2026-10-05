'use client';

import { useEffect, useId, useState } from 'react';
import Link from 'next/link';
import { cn } from '../../lib/cn';
import { t } from '../../lib/i18n';
import { Icon } from './Icon';
import { DisclosureToggle } from './CollapsibleBlock';
import { SidebarRailButton } from './SidebarRail';

/**
 * @typedef {{
 *   id: string, label: string, icon: string, active?: boolean, badge?: boolean|number,
 *   href?: string, onClick?: Function, onIntent?: Function, domId?: string,
 *   tone?: 'default'|'danger', disabled?: boolean,
 * }} SidebarNavItemDef
 * @typedef {{ id: string, label: string, items: SidebarNavItemDef[] }} SidebarNavGroupDef
 */

function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(true);
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const mq = window.matchMedia('(min-width: 769px)');
    const sync = () => setIsDesktop(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  return isDesktop;
}

function readClosedGroups(storageKey) {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) || '[]');
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function writeClosedGroups(storageKey, ids) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(ids));
  } catch {
    /* storage blocked */
  }
}

/** Closed groups persist per browser; the group of the current page always reopens. */
function useClosedGroups(storageKey, activeGroupId) {
  const [closed, setClosed] = useState([]);

  useEffect(() => {
    const saved = readClosedGroups(storageKey);
    setClosed(activeGroupId ? saved.filter((id) => id !== activeGroupId) : saved);
  }, [storageKey]); // eslint-disable-line react-hooks/exhaustive-deps -- load once per key

  useEffect(() => {
    if (!activeGroupId) return;
    setClosed((prev) => {
      if (!prev.includes(activeGroupId)) return prev;
      const next = prev.filter((id) => id !== activeGroupId);
      writeClosedGroups(storageKey, next);
      return next;
    });
  }, [activeGroupId, storageKey]);

  const toggle = (groupId) => {
    const next = closed.includes(groupId) ? closed.filter((id) => id !== groupId) : [...closed, groupId];
    writeClosedGroups(storageKey, next);
    setClosed(next);
  };

  return { closed, toggle };
}

function ItemBadge({ badge }) {
  if (typeof badge === 'number') {
    if (badge < 1) return null;
    return (
      <span className="ml-auto min-w-[18px] rounded-full bg-action px-1.5 text-center font-mono text-2xs text-action-ink">
        {badge > 9 ? '9+' : badge}
      </span>
    );
  }
  return badge ? <span className="ml-auto inline-block h-[7px] w-[7px] flex-shrink-0 rounded-full bg-brand-500" aria-hidden /> : null;
}

/** One menu row (expanded) or icon button with tooltip (collapsed). */
export function SidebarNavItem({ item, collapsed = false }) {
  const { label, icon, active = false, badge, href, onClick, onIntent, domId, tone = 'default', disabled = false } = item;
  if (collapsed) {
    return (
      <SidebarRailButton
        id={domId}
        icon={icon}
        label={label}
        active={active}
        badge={typeof badge === 'number' ? badge > 0 : Boolean(badge)}
        href={href}
        onClick={onClick}
        onIntent={onIntent}
        tone={tone}
        disabled={disabled}
      />
    );
  }
  const className = cn(
    'relative mb-0.5 flex min-h-touch w-full cursor-pointer items-center gap-2.5 rounded-control border-none py-2 pl-3 pr-3 text-left font-ui text-sm font-medium no-underline transition-colors',
    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-500 disabled:cursor-default disabled:opacity-55',
    active
      ? 'bg-brand-50 text-brand-800'
      : tone === 'danger'
        ? 'bg-transparent text-ink-muted hover:bg-danger/10 hover:text-danger'
        : 'bg-transparent text-ink-muted hover:bg-ink/[0.04] hover:text-ink'
  );
  const content = (
    <>
      {active ? <span className="absolute bottom-2 left-0 top-2 w-[3px] rounded-full bg-brand-700" aria-hidden /> : null}
      <Icon name={icon} className="h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <ItemBadge badge={badge} />
    </>
  );
  const shared = {
    id: domId,
    onClick,
    onMouseEnter: onIntent,
    onFocus: onIntent,
    onTouchStart: onIntent,
    'aria-current': active ? 'page' : undefined,
    className,
  };
  return href ? (
    <Link href={href} {...shared}>
      {content}
    </Link>
  ) : (
    <button type="button" disabled={disabled} {...shared}>
      {content}
    </button>
  );
}

function NavGroup({ group, open, onToggle, locale, collapsed, isActiveGroup }) {
  const listId = useId();
  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-1" role="group" aria-label={group.label}>
        <div className="my-1.5 h-px w-8 bg-ink/12" aria-hidden />
        {group.items.map((item) => (
          <SidebarNavItem key={item.id} item={item} collapsed />
        ))}
      </div>
    );
  }
  return (
    <div className="mb-1">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={listId}
        className="group sticky top-0 z-[1] flex min-h-touch w-full cursor-pointer items-center justify-between gap-2 rounded-control border-0 bg-surface pl-3 pr-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-500"
      >
        <span className={cn('min-w-0 truncate text-2xs font-semibold uppercase tracking-wide', isActiveGroup ? 'text-ink' : 'text-ink-label')}>
          {group.label}
          {!open ? <span className="font-normal normal-case tracking-normal text-ink-faint"> · {group.items.length}</span> : null}
        </span>
        <span aria-hidden className="flex-shrink-0">
          <DisclosureToggle
            locale={locale}
            open={open}
            labelClassName="sr-only group-hover:not-sr-only group-focus-visible:not-sr-only"
          />
        </span>
      </button>
      {open ? (
        <ul id={listId} className="m-0 list-none p-0">
          {group.items.map((item) => (
            <li key={item.id}>
              <SidebarNavItem item={item} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * App shell sidebar: one column, groups with collapsible headers (state kept per browser),
 * icon-only mode on desktop. Mobile renders the same column inside the drawer.
 *
 * @param {{
 *   id: string, locale: string, ariaLabel: string,
 *   brand: import('react').ReactNode | ((collapsed: boolean) => import('react').ReactNode),
 *   groups: SidebarNavGroupDef[], storageKey: string, collapsed?: boolean,
 *   onToggleCollapsed?: Function, open?: boolean, onCloseMobile?: Function,
 *   headerExtra?: import('react').ReactNode, footer?: (collapsed: boolean) => import('react').ReactNode,
 *   navRef?: import('react').Ref<HTMLElement>,
 * }} props
 */
export function SidebarNav({
  id,
  locale,
  ariaLabel,
  brand,
  groups,
  storageKey,
  collapsed = false,
  onToggleCollapsed,
  open = false,
  onCloseMobile,
  headerExtra = null,
  footer,
  navRef,
}) {
  const isDesktop = useIsDesktop();
  const iconOnly = collapsed && isDesktop;
  const activeGroupId = groups.find((g) => g.items.some((item) => item.active))?.id || null;
  const { closed, toggle } = useClosedGroups(storageKey, activeGroupId);

  return (
    <aside
      id={id}
      className={cn(
        'db-sidebar flex flex-shrink-0 flex-col border-r border-ink/12 bg-surface',
        open && 'db-sidebar-open',
        iconOnly ? 'db-sidebar-collapsed w-16' : 'w-[264px]'
      )}
    >
      <div className={cn('db-sidebar-head flex flex-shrink-0 items-center gap-2 pb-2 pt-4', iconOnly ? 'flex-col px-2' : 'justify-between pl-4 pr-2')}>
        <div className="flex h-10 min-w-0 items-center">{typeof brand === 'function' ? brand(iconOnly) : brand}</div>
        <div className={cn('flex items-center gap-1', iconOnly && 'flex-col')}>
          {onToggleCollapsed ? (
            <SidebarRailButton
              icon={iconOnly ? 'expand' : 'collapse'}
              label={iconOnly ? t(locale, 'dashboard.expandSidebar') : t(locale, 'dashboard.collapseSidebar')}
              className="db-sidebar-collapse-toggle"
              onClick={onToggleCollapsed}
            />
          ) : null}
          {onCloseMobile ? (
            <button
              type="button"
              className="db-sidebar-close-mobile h-10 w-10 flex-shrink-0 cursor-pointer items-center justify-center rounded-control border border-ink/12 bg-transparent text-ink-muted"
              onClick={onCloseMobile}
              aria-label={t(locale, 'common.closeMenu')}
            >
              <Icon name="close" />
            </button>
          ) : null}
        </div>
      </div>
      {!iconOnly && headerExtra ? <div className="flex-shrink-0 px-4 pb-2">{headerExtra}</div> : null}
      <nav
        ref={navRef}
        aria-label={ariaLabel}
        className="db-sidebar-nav relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-4 [-webkit-overflow-scrolling:touch]"
      >
        {groups.map((group) => (
          <NavGroup
            key={group.id}
            group={group}
            open={!closed.includes(group.id)}
            onToggle={() => toggle(group.id)}
            locale={locale}
            collapsed={iconOnly}
            isActiveGroup={group.id === activeGroupId}
          />
        ))}
      </nav>
      {footer ? (
        <div className={cn('db-sidebar-foot flex flex-shrink-0 flex-col border-t border-ink/10 py-2', iconOnly ? 'items-center gap-1 px-2' : 'px-2')}>
          {footer(iconOnly)}
        </div>
      ) : null}
    </aside>
  );
}
