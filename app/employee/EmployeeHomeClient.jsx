'use client';

import { EmployeePageLoading } from '../_components/EmployeeDedicatedShell';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { t } from '../../lib/i18n';
import { cn } from '../../lib/cn';
import { formatDisplayDate, formatDisplayDateTime } from '../../lib/format-display-date';
import { S } from '../dashboard/dashboard-shared';
import { useAppFeedback } from '../_components/AppFeedback';
import { ContentEnter } from '../_components/AppLoading';
import { FormField } from '../_components/FormField';
import { RichTextView } from '../_components/RichTextView';
import { DEVELOPMENT_PLAN_ITEM_STATUS, OKR_CYCLE_STATUS, OKR_WEIGHT_DEFAULT } from '../../lib/domain-status';
import { EmployeeOnboardingJourneySection } from '../_components/EmployeeOnboardingJourneySection';
import { EmployeeSurveysSection } from '../_components/EmployeeSurveysSection';
import { CollapsibleBlock } from '../_components/CollapsibleBlock';
import { EmptyState } from '../_components/EmptyState';
import { MeterBar } from '../_components/MeterBar';
import { StatusToneChip } from '../_components/StatusToneChip';
import { useEmployeeNav } from '../_components/EmployeeNavContext';
import { InlineCallout } from '../_components/InlineCallout';
import { EmployeeVariablePaySection } from '../_components/EmployeeVariablePaySection';
import { EmployeeFeedbackSection } from '../_components/ContinuousFeedbackBlock';
import { EmployeeFeedPanel, EmployeeKudosPanel } from '../_components/EmployeeFeedKudosSections';
import { Icon } from '../_components/Icon';
import { EmployeeFormalReviewsSection } from '../_components/EmployeeFormalReviewsSection';
import { EmployeeWelcomeCard } from '../_components/EmployeeWelcomeCard';
import { EmployeeDedicatedShell } from '../_components/EmployeeDedicatedShell';
import { EMPLOYEE_NAV_ITEMS } from '../_components/EmployeeSidebar';
import { redirectEmployeeIfUnauthorized } from '../../lib/employee-client-session';
import { employeeSectionAllowedByCompanyModules, employeeSectionVisible } from '../../lib/company-modules';

/** Home sections (dedicated LMS/DP/ponto live on their own routes). */
const SECTION_KEYS = [
  'tasks',
  'journey',
  'surveys',
  'pdi',
  'formalReviews',
  'okr',
  'oneOnOne',
  'feedback',
  'variablePay',
  'feed',
  'kudos',
  'company',
];
const COLLAPSE_STORAGE = 'team30_employee_sections';
/** Today view keeps only these; every other section opens alone (no long scroll). */
const TODAY_SECTION_KEYS = ['tasks', 'journey', 'surveys'];
const DETAIL_SECTION_KEYS = SECTION_KEYS.filter((key) => !TODAY_SECTION_KEYS.includes(key));

function taskLabel(locale, task) {
  return t(locale, task.titleKey, task.titleValues || {});
}

function countedMessageKey(baseKey, count) {
  return `employeeHome.${baseKey}${count === 1 ? 'Singular' : 'Plural'}`;
}

function okrUrgencyTone(urgency) {
  if (urgency === 'overdue' || urgency === 'critical') return 'danger';
  if (urgency === 'warn') return 'warning';
  if (urgency === 'done') return 'success';
  return 'neutral';
}

function okrMeterTone(act) {
  if (act.urgency === 'overdue' || act.urgency === 'critical') return 'bg-danger';
  if (act.urgency === 'warn') return 'bg-warning';
  const n = Number(act.progressPct) || 0;
  if (n >= 75) return 'bg-success';
  if (n >= 40) return 'bg-info';
  return 'bg-warning';
}

function taskIsOverdue(task) {
  return task.kind === 'lms_overdue' || Boolean(task.dueDate && new Date(`${String(task.dueDate).slice(0, 10)}T23:59:59`) < new Date());
}

function taskTone(task) {
  if (taskIsOverdue(task)) return 'danger';
  return 'info';
}

/** Group assigned activities by cycle for scanability. */
function groupOkrByCycle(items) {
  const order = [];
  const map = new Map();
  for (const act of items || []) {
    const key = Number(act.cycleId) || 0;
    if (!map.has(key)) {
      map.set(key, {
        cycleId: key,
        cycleTitle: act.cycleTitle || '',
        cycleStatus: act.cycleStatus,
        items: [],
      });
      order.push(key);
    }
    map.get(key).items.push(act);
  }
  return order.map((k) => map.get(k));
}

function loadCollapsed() {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(COLLAPSE_STORAGE);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function CollapsibleSection({ id, title, count, open, onToggle, children, locale = 'pt-BR', hidden = false, standalone = false }) {
  if (standalone) return <section id={id} hidden={hidden} aria-labelledby="employee-detail-title">{children}</section>;
  return (
    <section id={id} hidden={hidden} className="mt-6 scroll-mt-24">
      <CollapsibleBlock
        locale={locale}
        title={title}
        count={count}
        open={open}
        onOpenChange={(next) => {
          if (next !== open) onToggle();
        }}
        variant="card"
        bordered={false}
        titleClassName={S.sectionTitle}
      >
        <div className="px-3 sm:px-4">
          {children}
        </div>
      </CollapsibleBlock>
    </section>
  );
}

function EmpEmpty({ children }) {
  return (
    <div data-emp-empty tabIndex={-1} className="outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40">
      {children}
    </div>
  );
}

/**
 * Authenticated collaborator home: “Hoje” scroll + teasers for dedicated modules.
 */
export function EmployeeHomeClient({ locale = 'pt-BR' }) {
  const router = useRouter();
  const { toast, promptForm } = useAppFeedback();
  const [okrNotice, setOkrNotice] = useState('');
  const okrNumber = value => new Intl.NumberFormat(locale, {maximumFractionDigits:2}).format(value);
  const { activeSection, setNavMeta, setActiveSection, sectionFocus, focusSection, consumeSectionFocus } = useEmployeeNav();
  const focusFrame = useRef(null);
  const detailView = DETAIL_SECTION_KEYS.includes(activeSection) ? activeSection : null;
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [surveyMeta, setSurveyMeta] = useState({ openCount: null, hasAny: true });
  const [dpBadge, setDpBadge] = useState(0);
  const [timeClockBadge, setTimeClockBadge] = useState(0);
  const [variablePayBadge, setVariablePayBadge] = useState(0);
  const [feedbackBadge, setFeedbackBadge] = useState(0);
  const [feedTotal, setFeedTotal] = useState(0);
  const [kudosTotal, setKudosTotal] = useState(0);
  const [openMap, setOpenMap] = useState(() => {
    const saved = loadCollapsed();
    const hasSaved = Object.keys(saved).length > 0;
    const next = {};
    for (const k of SECTION_KEYS) {
      if (hasSaved) {
        next[k] = typeof saved[k] === 'boolean' ? saved[k] : k === 'tasks';
      } else {
        // B-RH2-01: first visit keeps pendencies (tasks) open; rest collapsed.
        next[k] = k === 'tasks';
      }
    }
    return next;
  });
  const [prepNote, setPrepNote] = useState('');
  const [loadFailed, setLoadFailed] = useState(false);
  const [welcomeDismissed, setWelcomeDismissed] = useState(false);

  const dismissWelcome = useCallback(() => {
    setWelcomeDismissed(true);
    // Best effort: if it fails, the card simply returns on the next visit.
    void fetch('/api/employee/home', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'dismissWelcome' }),
    }).catch(() => {});
  }, []);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetch(`/api/employee/home?locale=${encodeURIComponent(locale)}`);
      if (redirectEmployeeIfUnauthorized(router, res.status)) return;
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || 'load');
      setData(json);
      setFeedTotal(json?.feed?.total || 0);
      setKudosTotal(json?.kudos?.total || 0);
      setPrepNote(json?.oneOnOnePrep?.noteToManager || '');
      setLoadFailed(false);
    } catch (e) {
      toast(e?.message || t(locale, 'employeeHome.loadError'), 'error');
      if (!silent) {
        setData(null);
        setLoadFailed(true);
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [locale, router, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  // Soft refresh when the tab becomes visible again (keeps session UX fresh)
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const onVis = () => {
      if (document.visibilityState === 'visible') void load({ silent: true });
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [load]);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const prev = document.title;
    const section = EMPLOYEE_NAV_ITEMS.find((item) => item.id === detailView);
    document.title = section ? `${t(locale, section.labelKey)} · 30Grow` : t(locale, 'employeeHome.documentTitle');
    return () => {
      document.title = prev;
    };
  }, [locale, detailView]);

  // Legacy hashes → dedicated modules
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const h = (window.location.hash || '').replace(/^#/, '');
    if (h === 'dp') router.replace('/employee/dp');
    else if (h === 'timeClock') router.replace('/employee/time-clock');
    else if (h === 'lms') router.replace('/employee/lms');
  }, [router]);

  // Light badge fetch for dedicated modules (avoid mounting heavy sections on home)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [dpRes, tcRes] = await Promise.all([
          fetch('/api/employee/dp'),
          fetch('/api/employee/time-clock'),
        ]);
        if (cancelled) return;
        if (dpRes.ok) {
          const json = await dpRes.json().catch(() => ({}));
          setDpBadge(Number(json.badge) || 0);
        }
        if (tcRes.ok) {
          const json = await tcRes.json().catch(() => ({}));
          setTimeClockBadge(json.open ? 1 : 0);
        }
      } catch {
        /* ignore badge errors */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // The collapsed section is unmounted; its summary must not depend on opening it.
  useEffect(() => {
    if (!data || !employeeSectionAllowedByCompanyModules(data.companyModules, 'surveys')) return;
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch(`/api/employee/surveys?locale=${encodeURIComponent(locale)}`, { signal: controller.signal });
        if (!res.ok) return;
        const json = await res.json();
        if (controller.signal.aborted) return;
        const openCount = (json.openClimate?.length || 0) + (json.openPulse?.length || 0);
        setSurveyMeta({ openCount, hasAny: openCount > 0 || Boolean(json.history?.length) });
      } catch { /* Keep the summary unknown; the section offers its own error state. */ }
    })();
    return () => controller.abort();
  }, [Boolean(data), data?.companyModules, locale]);

  const toggleSection = (key) => {
    setOpenMap((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try {
        localStorage.setItem(COLLAPSE_STORAGE, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const prepAction = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/employee/home', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'submitOneOnOnePrep', noteToManager: prepNote }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || 'prep');
      setData((prev) =>
        prev
          ? {
              ...prev,
              oneOnOnePrep: json.oneOnOnePrep || prev.oneOnOnePrep,
            }
          : prev
      );
      toast(t(locale, 'panel.employeePortal.prepDone'), 'ok');
    } catch (e) {
      toast(e?.message || t(locale, 'panel.employeePortal.prepError'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const refreshJourney = useCallback(
    (nextJourney) => {
      if (nextJourney) {
        setData((prev) => (prev ? { ...prev, journey: nextJourney } : prev));
      } else {
        void load();
      }
    },
    [load]
  );

  const submitOkrCheckin = async (act) => {
    await promptForm({
      title: t(locale, 'employeeHome.okrCheckinTitle'),
      confirmLabel: t(locale, 'employeeHome.okrCheckinConfirm'),
      fields: [
        act.keyResultId ? {
          key: 'currentValue', type: 'number', required: true, step: 0.01,
          label: `${locale === 'pt-BR' ? 'Valor atual' : 'Current value'} (${act.unit})`,
          defaultValue: String(act.currentValue),
        } : {
          key: 'progressPct',
          type: 'range',
          label: t(locale, 'panel.okr.progressPctLabel'),
          defaultValue: String(act.progressPct ?? 0),
          min: 0,
          max: 100,
          step: 1,
          suffix: '%',
          minLabel: '0%',
          midLabel: '50%',
          maxLabel: '100%',
        },
        {
          key: 'note',
          type: 'textarea',
          label: t(locale, 'panel.okr.checkinNoteLabel'),
          defaultValue: '',
          maxLength: 500,
          rows: 3,
        },
      ],
      submit: async values => {
        setBusy(true);
        try {
          const res = await fetch('/api/employee/okr/checkins', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...(act.keyResultId ? {keyResultId:act.keyResultId,currentValue:Number(values.currentValue)} : {activityId:act.id,progressPct:Number(values.progressPct) || 0}),
              note: values.note || '',
            }),
          });
          if (redirectEmployeeIfUnauthorized(router, res.status)) return;
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data?.error || t(locale, 'employeeHome.loadError'));
          setOkrNotice(t(locale, 'employeeHome.okrCheckinSaved'));
          await load({ silent: true });
        } catch (e) {
          throw new Error(e instanceof TypeError ? t(locale, 'employeeHome.loadError') : e?.message || t(locale, 'employeeHome.loadError'));
        } finally {
          setBusy(false);
        }
      },
    });
  };

  const onSurveyMeta = useCallback((meta) => {
    setSurveyMeta(meta || { openCount: 0, hasAny: false });
  }, []);

  const openSection = useCallback((key) => {
    if (!SECTION_KEYS.includes(key)) return;
    setOpenMap((prev) => {
      if (prev[key] !== false) return prev;
      const next = { ...prev, [key]: true };
      try {
        localStorage.setItem(COLLAPSE_STORAGE, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const scrollToSection = useCallback((id) => {
    if (typeof window === 'undefined') return;
    window.cancelAnimationFrame(focusFrame.current);
    focusFrame.current = window.requestAnimationFrame(() => {
      const hash = window.location.hash.slice(1);
      const currentSection = SECTION_KEYS.includes(hash) ? hash : 'tasks';
      // A newer click or browser navigation wins over pending focus work.
      if (window.location.pathname !== '/employee' || currentSection !== id) return;
      if (DETAIL_SECTION_KEYS.includes(id)) {
        window.scrollTo({ top: 0, behavior: 'auto' });
        document.getElementById('employee-detail-title')?.focus({ preventScroll: true });
        return;
      }
      const section = document.getElementById(id);
      section?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
      section?.querySelector('button[aria-expanded]')?.focus({ preventScroll: true });
    });
  }, []);

  useEffect(() => () => window.cancelAnimationFrame(focusFrame.current), []);

  // Menu / deep-link focus: always expand + scroll (even if same section re-clicked)
  useEffect(() => {
    if (!sectionFocus?.id || loading) return;
    const id = sectionFocus.id;
    if ((window.location.hash.slice(1) || 'tasks') === id) {
      openSection(id);
      scrollToSection(id);
    }
    consumeSectionFocus(sectionFocus.nonce);
  }, [sectionFocus, loading, openSection, scrollToSection, consumeSectionFocus]);

  // Nav badges only (menu always lists all functionalities)
  useEffect(() => {
    if (!data) return;
    const tasks = data.tasks || [];
    const courses = data.courses || [];
    const lmsOverdue = courses.filter((c) => c.overdue).length;
    setNavMeta({
      companyModules: data.companyModules ?? null,
      timeClockEnabled: data.timeClockEnabled ?? null,
      badges: {
        tasks: tasks.length,
        surveys: surveyMeta.openCount || 0,
        lms: lmsOverdue,
        okr: (data.okrActivities || []).filter(
          (a) => a.urgency === 'overdue' || a.urgency === 'critical'
        ).length,
        dp: dpBadge,
        timeClock: timeClockBadge,
        variablePay: variablePayBadge,
        feed: 0,
        kudos: 0,
        feedback: feedbackBadge,
      },
    });
  }, [
    data,
    surveyMeta,
    dpBadge,
    timeClockBadge,
    variablePayBadge,
    feedTotal,
    kudosTotal,
    feedbackBadge,
    setNavMeta,
  ]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onHash = () => {
      const hash = window.location.hash.slice(1);
      const id = SECTION_KEYS.includes(hash) ? hash : 'tasks';
      setActiveSection(id);
      openSection(id);
      scrollToSection(id);
    };
    onHash();
    window.addEventListener('hashchange', onHash);
    window.addEventListener('popstate', onHash);
    return () => {
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener('popstate', onHash);
    };
  }, [loading, openSection, scrollToSection, setActiveSection]);

  if (loading) return <EmployeePageLoading locale={locale} />;

  if (loadFailed || !data) {
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

  const tasks = data.tasks || [];
  const journey = data.journey;
  const courses = data.courses || [];
  const plans = data.plans || [];
  const okrActivities = data.okrActivities || [];
  const agreements = data.recentAgreements || [];
  const prompts = data.oneOnOnePrompts || [];
  const company = data.company;
  const companyModules = data.companyModules ?? null;
  const sectionOk = (id) => employeeSectionVisible(companyModules, id, { timeClockEnabled: data.timeClockEnabled });
  const hasJourney = Boolean(journey?.preItems?.length || journey?.checkins?.length);
  const hasCompany = company && (company.aboutHtml || company.website);
  const lmsOverdueCount = courses.filter((c) => c.overdue).length;
  const okrUrgentCount = okrActivities.filter(
    (a) => a.urgency === 'overdue' || a.urgency === 'critical'
  ).length;
  const attentionCount = (sectionOk('okr') ? okrUrgentCount : 0) + (sectionOk('lms') ? lmsOverdueCount : 0) + (sectionOk('dp') ? dpBadge : 0) + (sectionOk('timeClock') ? timeClockBadge : 0);
  const startHere =
    sectionOk('tasks') && tasks.length > 0
      ? { href: '#tasks', labelKey: countedMessageKey('startHereTasks', tasks.length), count: tasks.length }
      : sectionOk('surveys') && surveyMeta.openCount > 0
        ? { href: '#surveys', labelKey: countedMessageKey('startHereSurveys', surveyMeta.openCount), count: surveyMeta.openCount }
        : sectionOk('okr') && okrUrgentCount > 0
          ? { href: '#okr', labelKey: countedMessageKey('startHereOkr', okrUrgentCount), count: okrUrgentCount }
          : sectionOk('dp') && dpBadge > 0
            ? { href: '/employee/dp', labelKey: countedMessageKey('startHereDp', dpBadge), count: dpBadge }
            : sectionOk('timeClock') && timeClockBadge > 0
              ? {
                  href: '/employee/time-clock',
                  labelKey: 'employeeHome.startHereTimeClock',
                  count: 1,
                }
              : sectionOk('lms') && lmsOverdueCount > 0
                ? {
                    href: '/employee/lms',
                    labelKey: countedMessageKey('startHereLms', lmsOverdueCount),
                    count: lmsOverdueCount,
                  }
                : null;

  const containerProps = detailView ? {
    locale,
    title: t(locale, EMPLOYEE_NAV_ITEMS.find((item) => item.id === detailView)?.labelKey || 'employeeHome.sectionNavAria'),
    headingId: 'employee-detail-title',
    backLabel: t(locale, 'employeeHome.backToToday'),
    onBack: () => focusSection('tasks'),
  } : { locale };

  return (
    <ContentEnter animKey="ready">
      <EmployeeDedicatedShell {...containerProps} showHeader={Boolean(detailView)}>
        {data.showWelcome && !welcomeDismissed && !detailView ? (
          <EmployeeWelcomeCard
            locale={locale}
            firstName={String(data.person?.fullName || '').trim().split(/\s+/)[0] || ''}
            isAvailable={(id) => (id === 'journey' ? sectionOk('journey') && hasJourney : sectionOk(id))}
            onDismiss={dismissWelcome}
            onShortcut={(id, href) => {
              dismissWelcome();
              if (href.startsWith('#')) {
                focusSection(id);
              } else {
                router.push(href);
              }
            }}
          />
        ) : null}
        <div className="mb-6" hidden={Boolean(detailView)}>
          <h1 className={cn(S.pageTitle, 'm-0 font-ui text-2xl font-semibold tracking-tight')}>
            {t(locale, 'employeeHome.hello', { name: data.person?.fullName || '' })}
          </h1>
          <p className={cn(S.muted, 'm-0 mt-2 max-w-[58ch]')}>{t(locale, 'employeeHome.hint')}</p>
          <section className="mt-5 grid grid-cols-1 gap-2.5 sm:grid-cols-3" aria-label={t(locale, 'employeeHome.todaySummary')}>
            <a href="#tasks" onClick={() => focusSection('tasks')} className="rounded-control border border-ink/12 bg-surface px-3 py-3 no-underline hover:border-brand-500/40 focus-visible:outline-brand-500">
              <div className="font-ui text-2xl font-semibold tabular-nums text-ink">{tasks.length}</div>
              <div className="mt-1 text-prose font-medium text-ink-muted">{t(locale, 'employeeHome.todaySummaryTasks')}</div>
            </a>
            {sectionOk('surveys') ? <a href="#surveys" onClick={() => focusSection('surveys')} className="rounded-control border border-ink/12 bg-surface px-3 py-3 no-underline hover:border-brand-500/40 focus-visible:outline-brand-500">
              <div className="font-ui text-2xl font-semibold tabular-nums text-ink">{surveyMeta.openCount ?? '—'}</div>
              <div className="mt-1 text-prose font-medium text-ink-muted">{t(locale, 'employeeHome.todaySummarySurveys')}</div>
            </a> : null}
            <div className={cn('rounded-control border px-3 py-3', attentionCount > 0 ? 'border-warning/25 bg-warning/[0.045]' : 'border-success/20 bg-success/[0.04]')}>
              <div className="font-ui text-2xl font-semibold tabular-nums text-ink">{attentionCount}</div>
              <div className="mt-1 text-prose font-medium text-ink-muted">{t(locale, 'employeeHome.todaySummaryAttention')}</div>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-prose">
                {[
                  ['okr', okrUrgentCount, '#okr', 'employeeHome.okrTitle'],
                  ['lms', lmsOverdueCount, '/employee/lms', 'employeeHome.lmsTitle'],
                  ['dp', dpBadge, '/employee/dp', 'employeeHome.dpTitle'],
                  ['timeClock', timeClockBadge, '/employee/time-clock', 'employeeHome.timeClockTitle'],
                ].filter(([id, count]) => count > 0 && sectionOk(id)).map(([id, count, href, label]) => (
                  <a key={id} href={href} onClick={() => { if (href.startsWith('#')) focusSection(id); }} className={S.cardLink}>{t(locale, label)}: {count}</a>
                ))}
              </div>
            </div>
          </section>
          {startHere && !(startHere.href === '#tasks' && openMap.tasks !== false) ? (
            <InlineCallout
              tone="info"
              className="mt-3"
              action={(
                <a href={startHere.href} onClick={() => { if (startHere.href.startsWith('#')) focusSection(startHere.href.slice(1)); }} className={cn(S.btnBrandSoft, 'min-h-touch no-underline')}>
                  {t(locale, 'employeeHome.startHereCta')}
                </a>
              )}
            >
              {t(locale, startHere.labelKey, { count: startHere.count })}
            </InlineCallout>
          ) : null}
        </div>

        {!detailView ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink/12 pb-2">
          <h2 className="m-0 font-ui text-base font-semibold">{t(locale, 'employeeHome.sectionNavAria')}</h2>
          <button type="button" className={S.btnGhost} onClick={() => {
            const next = { ...openMap, ...Object.fromEntries(TODAY_SECTION_KEYS.map(key => [key, false])) };
            setOpenMap(next);
            try { localStorage.setItem(COLLAPSE_STORAGE, JSON.stringify(next)); } catch { /* optional preference */ }
          }}>{t(locale, 'employeeHome.collapseSections')}</button>
        </div>
        ) : null}

        {sectionOk('tasks') ? (
        <CollapsibleSection
          id="tasks"
          standalone={DETAIL_SECTION_KEYS.includes('tasks')}
          hidden={Boolean(detailView)}
          title={t(locale, 'employeeHome.tasksTitle')}
          count={tasks.length}
          open={openMap.tasks !== false}
          onToggle={() => toggleSection('tasks')}
          locale={locale}
        >
          {tasks.length === 0 ? (
            <EmpEmpty>
              <EmptyState
                message={t(locale, 'employeeHome.tasksEmpty')}
                actionLabel={
                  courses.length
                    ? t(locale, 'employeeHome.emptyGoLms')
                    : plans.length
                      ? t(locale, 'employeeHome.emptyGoPdi')
                      : undefined
                }
                actionHref={courses.length ? '/employee/lms' : plans.length ? '/employee/pdi' : undefined}
              />
            </EmpEmpty>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {tasks.map((task) => (
                <li key={task.id} className="rounded-control border border-ink/12 bg-canvas/50 px-3 py-2.5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className={S.cardBody}>{taskLabel(locale, task)}</div>
                    <StatusToneChip tone={taskTone(task)}>
                      {taskIsOverdue(task) ? t(locale, 'employeeHome.taskOverdue') : t(locale, 'employeeHome.taskOpen')}
                    </StatusToneChip>
                  </div>
                  {task.dueDate ? (
                    <div
                      className={cn(
                        'mt-1 text-prose',
                        taskIsOverdue(task) ? 'text-red-800 dark:text-danger' : 'text-ink/75'
                      )}
                    >
                      {t(locale, 'employeeHome.dueBy', {
                        date: formatDisplayDate(task.dueDate, locale),
                      })}
                    </div>
                  ) : null}
                  {task.href && task.href.startsWith('http') ? (
                    <a
                      href={task.href}
                      target="_blank"
                      rel="noreferrer"
                      className={cn(S.cardLink, 'mt-2')}
                    >
                      {t(locale, 'employeeHome.openTask')}
                    </a>
                  ) : task.href?.startsWith('/employee') ? (
                    <a href={task.href} className={cn(S.cardLink, 'mt-2')}>
                      {task.href.startsWith('/employee/lms')
                        ? t(locale, 'employeeHome.goToLms')
                        : task.href.startsWith('/employee/pdi')
                          ? t(locale, 'employeeHome.goToPdi')
                        : task.href.startsWith('/employee/dp')
                          ? t(locale, 'employeeHome.dpOpenPage')
                          : task.href.startsWith('/employee/time-clock')
                            ? t(locale, 'employeeHome.timeClockOpenPage')
                            : t(locale, 'employeeHome.openTask')}
                    </a>
                  ) : task.href?.startsWith('#') ? (
                    <a href={task.href} className={cn(S.cardLink, 'mt-2')}>
                      {task.href === '#pdi'
                        ? t(locale, 'employeeHome.goToPdi')
                        : task.href === '#journey'
                          ? t(locale, 'employeeHome.goToJourney')
                          : t(locale, 'employeeHome.openTask')}
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CollapsibleSection>
        ) : null}

        {sectionOk('journey') ? (
        <CollapsibleSection
          id="journey"
          standalone={DETAIL_SECTION_KEYS.includes('journey')}
          hidden={Boolean(detailView)}
          title={t(locale, 'employeeHome.journeyTitle')}
          open={openMap.journey !== false}
          onToggle={() => toggleSection('journey')}
          locale={locale}
        >
          {hasJourney ? (
            <EmployeeOnboardingJourneySection
              locale={locale}
              journey={journey}
              onChanged={refreshJourney}
            />
          ) : (
            <EmpEmpty>
              <EmptyState message={t(locale, 'employeeHome.journeyEmptyHint')} />
            </EmpEmpty>
          )}
        </CollapsibleSection>
        ) : null}

        {sectionOk('surveys') ? (
        <CollapsibleSection
          id="surveys"
          standalone={DETAIL_SECTION_KEYS.includes('surveys')}
          hidden={Boolean(detailView)}
          title={t(locale, 'employeeHome.surveysTitle')}
          count={surveyMeta.openCount || undefined}
          open={openMap.surveys !== false}
          onToggle={() => toggleSection('surveys')}
          locale={locale}
        >
          <EmployeeSurveysSection locale={locale} onMeta={onSurveyMeta} />
        </CollapsibleSection>
        ) : null}

        {sectionOk('pdi') ? (
        <CollapsibleSection
          id="pdi"
          standalone={DETAIL_SECTION_KEYS.includes('pdi')}
          hidden={detailView !== 'pdi'}
          title={t(locale, 'employeeHome.pdiPageTitle')}
          count={plans.length}
          open={openMap.pdi !== false}
          onToggle={() => toggleSection('pdi')}
          locale={locale}
        >
          {plans.length === 0 ? (
            <EmpEmpty>
              <EmptyState message={t(locale, 'employeeHome.pdiEmptyHint')} />
            </EmpEmpty>
          ) : (
            <>
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {plans.map((plan) => {
                const items = plan.items || [];
                const doneN = items.filter((it) => it.status === DEVELOPMENT_PLAN_ITEM_STATUS.DONE).length;
                const pct = items.length ? Math.round((doneN / items.length) * 100) : 0;
                return (
                  <li key={plan.id} className="rounded-control border border-ink/12 bg-canvas/50 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className={S.cardBody}>{plan.title}</div>
                      {items.length > 0 ? (
                        <StatusToneChip tone={pct >= 100 ? 'success' : 'brand'}>{pct}%</StatusToneChip>
                      ) : null}
                    </div>
                    {plan.objective ? (
                      <p className={cn(S.muted, 'mt-1 m-0')}>{plan.objective}</p>
                    ) : null}
                    {items.length > 0 ? (
                      <>
                        <MeterBar
                          percent={pct}
                          height={6}
                          className="mt-3"
                          toneClass={pct >= 100 ? 'bg-success' : 'bg-brand-500'}
                          aria-label={`${plan.title}: ${pct}%`}
                        />
                        <p className={cn(S.cardMuted, 'mb-0 mt-2')}>
                          {t(locale, countedMessageKey('pdiProgressCount', items.length), { done: doneN, total: items.length })}
                        </p>
                      </>
                    ) : (
                      <p className={cn(S.cardMuted, 'mb-0 mt-2')}>
                        {t(locale, 'employeeHome.pdiNoItems')}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
            {plans.length > 0 ? (
              <a href="/employee/pdi" className={cn(S.btnBrandSoft, 'mt-3 inline-flex min-h-touch no-underline')}>
                {t(locale, 'employeeHome.pdiOpenPage')}
              </a>
            ) : null}
            </>
          )}
        </CollapsibleSection>
        ) : null}

        {sectionOk('formalReviews') ? (
        <CollapsibleSection
          id="formalReviews"
          standalone={DETAIL_SECTION_KEYS.includes('formalReviews')}
          hidden={detailView !== 'formalReviews'}
          title={t(locale, 'performanceReviews.formal.employeeSection')}
          open={openMap.formalReviews !== false}
          onToggle={() => toggleSection('formalReviews')}
          locale={locale}
        >
          <EmployeeFormalReviewsSection locale={locale} />
        </CollapsibleSection>
        ) : null}

        {sectionOk('okr') ? (
        <CollapsibleSection
          id="okr"
          standalone={DETAIL_SECTION_KEYS.includes('okr')}
          hidden={detailView !== 'okr'}
          title={t(locale, 'employeeHome.okrTitle')}
          count={okrActivities.length || undefined}
          open={openMap.okr !== false}
          onToggle={() => toggleSection('okr')}
          locale={locale}
        >
          {okrActivities.length === 0 ? (
            <EmpEmpty>
              <EmptyState message={t(locale, 'employeeHome.okrEmptyHint')} />
            </EmpEmpty>
          ) : (
            <div className="flex flex-col gap-4">
              {okrNotice ? <p role="status" className="m-0 text-sm text-ink">{okrNotice}</p> : null}
              <p className={cn(S.muted, 'm-0 text-prose')}>{t(locale, 'employeeHome.okrHint')}</p>
              {groupOkrByCycle(okrActivities).map((group) => (
                <div key={group.cycleId || 'x'} className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={S.label}>{group.cycleTitle || t(locale, 'employeeHome.okrTitle')}</span>
                    {group.cycleStatus === OKR_CYCLE_STATUS.CLOSED ? (
                      <StatusToneChip tone="neutral">
                        {t(locale, 'panel.okr.status.closed')}
                      </StatusToneChip>
                    ) : null}
                  </div>
                  <ul className="m-0 flex list-none flex-col gap-2 p-0">
                    {group.items.map((act) => (
                      <li
                        key={act.id}
                        className={cn(
                          'rounded-control border bg-canvas/50 px-3 py-2.5',
                          act.urgency === 'overdue' || act.urgency === 'critical'
                            ? 'border-danger/30'
                            : act.urgency === 'warn'
                              ? 'border-warning/30'
                              : 'border-ink/12'
                        )}
                      >
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={cn(S.cardBody, 'break-words')}>{act.title}</span>
                              {act.urgency && act.urgency !== 'none' ? (
                                <StatusToneChip tone={okrUrgencyTone(act.urgency)}>
                                  {t(locale, `panel.okr.urgency.${act.urgency}`)}
                                </StatusToneChip>
                              ) : null}
                            </div>
                            <p className={cn(S.faint, 'mb-0 mt-1 break-words')}>
                              {act.areaTitle || t(locale, 'panel.common.notApplicable')}
                              {act.objectiveTitle ? ` → ${act.objectiveTitle}` : ''}
                              {act.deadline
                                ? ` · ${t(locale, 'employeeHome.okrDeadline')}: ${formatDisplayDate(act.deadline, locale)}`
                                : ''}
                              {` · ${t(locale, 'employeeHome.okrImportanceValue', {
                                pct: act.progressPct ?? 0,
                              })}`}
                              {` · ${t(locale, 'panel.okr.weightChip', {
                                n: act.weight ?? OKR_WEIGHT_DEFAULT,
                              })}`}
                            </p>
                            {act.keyResultId ? <p className="text-sm text-ink-muted">{locale === 'pt-BR' ? 'Inicial' : 'Baseline'}: {okrNumber(act.startValue)} → {locale === 'pt-BR' ? 'Meta' : 'Target'}: {okrNumber(act.targetValue)} {act.unit} · {locale === 'pt-BR' ? 'Atual' : 'Current'}: {okrNumber(act.currentValue)} {act.unit}</p> : null}
                          </div>
                          {group.cycleStatus !== OKR_CYCLE_STATUS.CLOSED ? (
                            <button
                              type="button"
                              disabled={busy}
                              className={cn(S.btnBrandSoft, 'min-h-touch shrink-0 self-start')}
                              onClick={() => void submitOkrCheckin(act)}
                            >
                              {t(locale, 'employeeHome.okrCheckinBtn')}
                            </button>
                          ) : null}
                        </div>
                        <MeterBar
                          percent={act.progressPct ?? 0}
                          height={6}
                          className="mt-2"
                          toneClass={okrMeterTone(act)}
                          aria-label={`${act.title}: ${act.progressPct ?? 0}%`}
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </CollapsibleSection>
        ) : null}


        {sectionOk('oneOnOne') ? (
        <CollapsibleSection
          id="oneOnOne"
          standalone={DETAIL_SECTION_KEYS.includes('oneOnOne')}
          hidden={detailView !== 'oneOnOne'}
          title={t(locale, 'panel.employeePortal.agreementsTitle')}
          count={agreements.length + (prompts.length ? 1 : 0)}
          open={openMap.oneOnOne !== false}
          onToggle={() => toggleSection('oneOnOne')}
          locale={locale}
        >
          {agreements.length === 0 ? (
            <EmpEmpty>
              <EmptyState message={t(locale, 'panel.employeePortal.agreementsEmpty')} />
            </EmpEmpty>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {agreements.map((a) => (
                <li key={a.id} className="rounded-control border border-ink/12 bg-canvas/50 px-3 py-2.5">
                  {a.meetingDate ? (
                    <div className="mb-1 text-prose text-ink-muted">
                      {formatDisplayDate(a.meetingDate, locale)}
                    </div>
                  ) : null}
                  <div className={cn(S.cardMuted, 'break-words whitespace-pre-wrap')}>
                    <RichTextView html={a.nextSteps} />
                  </div>
                </li>
              ))}
            </ul>
          )}
          {agreements.length === 0 && !prompts.length ? (
            <InlineCallout tone="info" className="mt-3">
              {t(locale, 'employeeHome.oneOnOneEmptyHint')}
            </InlineCallout>
          ) : null}
          {prompts.length > 0 ? (
            <div className="mt-4">
              <h3 className={cn(S.cardSection, 'mb-1 mt-0')}>
                {t(locale, 'panel.employeePortal.oneOnOneReflectionTitle')}
              </h3>
              <p className={cn(S.muted, 'mb-2 mt-0 text-sm')}>{t(locale, 'panel.employeePortal.prepHint')}</p>
              <ul className="m-0 list-disc space-y-1 pl-5 text-sm leading-relaxed text-ink-muted">
                {prompts.map((p, i) => (
                  <li key={i}>{typeof p === 'string' ? p : p.text || p.prompt || String(p)}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="mt-5 rounded-control border border-brand-500/20 bg-brand-500/[0.045] p-3.5">
            <h3 className={cn(S.cardSection, 'mb-1 mt-0')}>{t(locale, 'panel.employeePortal.oneOnOnePrepTitle')}</h3>
            <p className={cn(S.muted, 'mb-3 mt-0 text-sm')}>{t(locale, 'panel.employeePortal.prepActionHint')}</p>
            <FormField label={t(locale, 'panel.employeePortal.noteLabel')}>
              <textarea
                className={cn(S.input, 'min-h-[80px] w-full')}
                value={prepNote}
                onChange={(e) => setPrepNote(e.target.value)}
                maxLength={2000}
                placeholder={t(locale, 'panel.employeePortal.notePh')}
                disabled={busy}
              />
            </FormField>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={prepAction}
                className={cn(S.btnPrimary, 'min-h-touch')}
              >
                {data?.oneOnOnePrep?.preparedAt
                  ? t(locale, 'panel.employeePortal.prepUpdate')
                  : t(locale, 'panel.employeePortal.prepConfirm')}
              </button>
              {data?.oneOnOnePrep?.preparedAt ? (
                <span className="text-prose text-success">
                  {t(locale, 'panel.employeePortal.prepUpdatedAt', {
                    when: formatDisplayDateTime(data.oneOnOnePrep.preparedAt, locale),
                  })}
                </span>
              ) : null}
            </div>
            <p className={cn(S.faint, 'mb-0 mt-2 text-prose')}>
              {t(locale, 'panel.employeePortal.prepManagerSees')}
            </p>
          </div>
        </CollapsibleSection>
        ) : null}

        {sectionOk('feedback') ? (
        <CollapsibleSection
          id="feedback"
          standalone={DETAIL_SECTION_KEYS.includes('feedback')}
          hidden={detailView !== 'feedback'}
          title={t(locale, 'employeeHome.feedbackTitle')}
          count={feedbackBadge || null}
          open={openMap.feedback !== false}
          onToggle={() => toggleSection('feedback')}
          locale={locale}
        >
          <EmployeeFeedbackSection locale={locale} onBadge={setFeedbackBadge} />
        </CollapsibleSection>
        ) : null}


        {sectionOk('variablePay') ? (
        <CollapsibleSection
          id="variablePay"
          standalone={DETAIL_SECTION_KEYS.includes('variablePay')}
          hidden={detailView !== 'variablePay'}
          title={t(locale, 'employeeHome.variablePayTitle')}
          count={variablePayBadge || null}
          open={openMap.variablePay !== false}
          onToggle={() => toggleSection('variablePay')}
          locale={locale}
        >
          <EmployeeVariablePaySection locale={locale} onBadge={setVariablePayBadge} />
        </CollapsibleSection>
        ) : null}

        {sectionOk('feed') ? (
        <CollapsibleSection
          id="feed"
          standalone={DETAIL_SECTION_KEYS.includes('feed')}
          hidden={detailView !== 'feed'}
          title={t(locale, 'employeeHome.feedTitle')}
          count={feedTotal || null}
          open={openMap.feed !== false}
          onToggle={() => toggleSection('feed')}
          locale={locale}
        >
          <EmployeeFeedPanel
            locale={locale}
            items={data?.feed?.items || []}
            total={data?.feed?.total || 0}
            onTotalChange={setFeedTotal}
          />
        </CollapsibleSection>
        ) : null}

        {sectionOk('kudos') ? (
        <CollapsibleSection
          id="kudos"
          standalone={DETAIL_SECTION_KEYS.includes('kudos')}
          hidden={detailView !== 'kudos'}
          title={t(locale, 'employeeHome.kudosTitle')}
          count={kudosTotal || null}
          open={openMap.kudos !== false}
          onToggle={() => toggleSection('kudos')}
          locale={locale}
        >
          <EmployeeKudosPanel
            locale={locale}
            items={data?.kudos?.items || []}
            total={data?.kudos?.total || 0}
            onChanged={setKudosTotal}
          />
        </CollapsibleSection>
        ) : null}

        {sectionOk('company') ? (
        <CollapsibleSection
          id="company"
          standalone={DETAIL_SECTION_KEYS.includes('company')}
          hidden={detailView !== 'company'}
          title={t(locale, 'employeeHome.companyTitle')}
          open={openMap.company !== false}
          onToggle={() => toggleSection('company')}
          locale={locale}
        >
          {!hasCompany ? (
            <EmpEmpty>
              <EmptyState message={t(locale, 'employeeHome.companyEmptyHint')} />
            </EmpEmpty>
          ) : (
            <>
              {company.aboutHtml ? (
                <div className="mb-3 rounded-control border border-ink/12 bg-canvas/50 px-3 py-2 text-prose text-ink">
                  <RichTextView html={company.aboutHtml} />
                </div>
              ) : null}
              {company.website ? (
                <a
                  href={company.website}
                  target="_blank"
                  rel="noreferrer"
                  className="mb-3 inline-flex font-mono text-prose text-brand-600"
                >
                  {company.website}
                </a>
              ) : null}
            </>
          )}
        </CollapsibleSection>
        ) : null}
      </EmployeeDedicatedShell>
    </ContentEnter>
  );
}
