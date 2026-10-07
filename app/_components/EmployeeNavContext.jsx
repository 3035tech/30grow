'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

const EmployeeNavContext = createContext(null);

const COLLAPSE_KEY = 'team30_employee_nav_collapsed';

function readCollapsed() {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Home section hashes the sidebar can focus (dedicated modules use their own routes). */
export const EMPLOYEE_SECTION_IDS = Object.freeze([
  'tasks',
  'journey',
  'surveys',
  'pdi',
  'formalReviews',
  'okr',
  'oneOnOne',
  'variablePay',
  'feedback',
  'feed',
  'kudos',
  'company',
]);

/**
 * Shared nav state for collaborator chrome (badges, scroll-spy, collapse, section focus).
 * Menu always lists functionalities; empty sections show EmptyState when focused.
 */
export function EmployeeNavProvider({ children, changeLocale = null }) {
  const [activeSection, setActiveSection] = useState('tasks');
  const [badges, setBadges] = useState({});
  const [navCollapsed, setNavCollapsedState] = useState(false);
  /** { id, nonce } — nonce bumps so re-clicking the same item still opens + scrolls. */
  const [sectionFocus, setSectionFocus] = useState(null);
  const focusNonce = useRef(0);
  /** null = unrestricted (all modules). */
  const [companyModules, setCompanyModules] = useState(null);
  /** null = unknown (show); false = collaborator without time clock. */
  const [timeClockEnabled, setTimeClockEnabled] = useState(null);

  useEffect(() => {
    setNavCollapsedState(readCollapsed());
  }, []);

  const setNavCollapsed = useCallback((next) => {
    setNavCollapsedState((prev) => {
      const value = typeof next === 'function' ? next(prev) : next;
      try {
        localStorage.setItem(COLLAPSE_KEY, value ? '1' : '0');
      } catch {
        /* ignore */
      }
      return value;
    });
  }, []);

  const setNavMeta = useCallback(({ badges: nextBadges, active, companyModules: nextModules, timeClockEnabled: nextTimeClock } = {}) => {
    if (nextBadges) {
      setBadges((prev) => {
        let changed = false;
        for (const key of Object.keys(nextBadges)) {
          if (prev[key] !== nextBadges[key]) {
            changed = true;
            break;
          }
        }
        return changed ? { ...prev, ...nextBadges } : prev;
      });
    }
    if (active) setActiveSection(active);
    if (nextModules !== undefined) setCompanyModules(nextModules);
    if (nextTimeClock !== undefined) setTimeClockEnabled(nextTimeClock);
  }, []);

  const focusSection = useCallback((id) => {
    if (!id || !EMPLOYEE_SECTION_IDS.includes(id)) return;
    if (typeof window !== 'undefined' && window.location.pathname === '/employee') {
      const hash = `#${id}`;
      if (window.location.hash !== hash) window.history.pushState(window.history.state, '', hash);
    }
    setActiveSection(id);
    setSectionFocus({ id, nonce: ++focusNonce.current });
  }, []);

  const consumeSectionFocus = useCallback((nonce) => {
    setSectionFocus((current) => current?.nonce === nonce ? null : current);
  }, []);

  const value = useMemo(
    () => ({
      activeSection,
      setActiveSection,
      badges,
      setNavMeta,
      navCollapsed,
      setNavCollapsed,
      sectionFocus,
      focusSection,
      consumeSectionFocus,
      companyModules,
      timeClockEnabled,
      changeLocale,
    }),
    [
      changeLocale,
      activeSection,
      badges,
      setNavMeta,
      navCollapsed,
      setNavCollapsed,
      sectionFocus,
      focusSection,
      consumeSectionFocus,
      companyModules,
      timeClockEnabled,
    ]
  );

  return <EmployeeNavContext.Provider value={value}>{children}</EmployeeNavContext.Provider>;
}

export function useEmployeeNav() {
  const ctx = useContext(EmployeeNavContext);
  if (!ctx) {
    return {
      activeSection: 'tasks',
      setActiveSection: () => {},
      badges: {},
      setNavMeta: () => {},
      navCollapsed: false,
      setNavCollapsed: () => {},
      sectionFocus: null,
      focusSection: () => {},
      consumeSectionFocus: () => {},
      companyModules: null,
      timeClockEnabled: null,
      changeLocale: null,
    };
  }
  return ctx;
}
