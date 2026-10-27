'use client';

/**
 * Optional guided tour — targets real sidebar `id={tab}-tab` anchors.
 */

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale } from '../../lib/useLocale';
import { t } from '../../lib/i18n';
import { cn } from '../../lib/cn';
import { canAccessDashboardTab } from '../../lib/identity/permissions';
import { S } from '../dashboard/dashboard-shared';

const TOUR_STORAGE_KEY = 'team30_tour_completed';

const TOUR_STEP_DEFS = [
  { id: 'overview', target: '#overview-tab', tab: 'overview', titleKey: 'panel.tour.stepOverviewTitle', messageKey: 'panel.tour.stepOverviewBody' },
  { id: 'vacancies', target: '#vacancies-tab', tab: 'vacancies', titleKey: 'panel.tour.stepVacanciesTitle', messageKey: 'panel.tour.stepVacanciesBody' },
  { id: 'team', target: '#team-tab', tab: 'team', titleKey: 'panel.tour.stepTeamTitle', messageKey: 'panel.tour.stepTeamBody' },
  { id: 'help', target: '#help-tab', tab: 'help', titleKey: 'panel.tour.stepHelpTitle', messageKey: 'panel.tour.stepHelpBody' },
];

export function OnboardingTour({ auth = null, onComplete }) {
  const [isOpen, setIsOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState(-1);
  const [mounted, setMounted] = useState(false);
  const router = useRouter();
  const [locale] = useLocale();
  const TOUR_STEPS = useMemo(
    () => (auth ? TOUR_STEP_DEFS.filter((s) => canAccessDashboardTab(auth, s.tab)) : TOUR_STEP_DEFS),
    [auth]
  );

  useEffect(() => {
    setMounted(true);
    if (typeof window === 'undefined') return undefined;
    const completed = localStorage.getItem(TOUR_STORAGE_KEY);
    if (!completed) {
      const timer = setTimeout(() => setIsOpen(true), 1000);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, []);

  const handleStart = () => {
    setCurrentStep(0);
    const step = TOUR_STEPS[0];
    if (step?.tab) router.push(`/dashboard?tab=${step.tab}`);
  };

  const handleNext = () => {
    if (currentStep < TOUR_STEPS.length - 1) {
      const nextStep = currentStep + 1;
      setCurrentStep(nextStep);
      const step = TOUR_STEPS[nextStep];
      if (step?.tab) router.push(`/dashboard?tab=${step.tab}`);
    } else {
      handleFinish();
    }
  };

  const handlePrevious = () => {
    if (currentStep > 0) {
      const prevStep = currentStep - 1;
      setCurrentStep(prevStep);
      const step = TOUR_STEPS[prevStep];
      if (step?.tab) router.push(`/dashboard?tab=${step.tab}`);
    }
  };

  const handleFinish = () => {
    setIsOpen(false);
    if (typeof window !== 'undefined') {
      localStorage.setItem(TOUR_STORAGE_KEY, 'true');
    }
    if (onComplete) onComplete();
  };

  if (!mounted) return null;

  if (isOpen && currentStep === -1) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4">
        <div className="w-full max-w-md rounded-card border border-ink/10 bg-surface p-6 shadow-dialog">
          <h2 className="m-0 mb-2 font-display text-xl font-semibold text-ink">
            {t(locale, 'panel.tour.welcomeTitle')}
          </h2>
          <p className="m-0 mb-6 text-sm text-ink-muted">{t(locale, 'panel.tour.welcomeBody')}</p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <button type="button" className={S.btnPrimary} onClick={handleStart}>
              {t(locale, 'panel.tour.start')}
            </button>
            <button type="button" className={S.btnGhost} onClick={handleFinish}>
              {t(locale, 'panel.tour.skip')}
            </button>
          </div>
          <p className="mt-4 mb-0 text-xs text-ink-faint">{t(locale, 'panel.tour.helpHint')}</p>
        </div>
      </div>
    );
  }

  if (isOpen && currentStep >= 0 && currentStep < TOUR_STEPS.length) {
    const step = TOUR_STEPS[currentStep];
    return (
      <>
        <div className="fixed inset-0 z-40 bg-ink/40" onClick={handleFinish} aria-hidden />
        <div className="fixed bottom-4 left-1/2 z-50 mx-4 w-full max-w-md -translate-x-1/2">
          <div className="overflow-hidden rounded-card border border-ink/12 bg-surface shadow-dialog">
            <div className="h-1 bg-ink/10">
              <div
                className="h-full bg-brand-500 transition-all duration-300"
                style={{ width: `${((currentStep + 1) / TOUR_STEPS.length) * 100}%` }}
              />
            </div>
            <div className="p-4">
              <div className="mb-2 flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className={cn(S.label, 'mb-1')}>
                    {t(locale, 'panel.tour.stepOf', {
                      n: currentStep + 1,
                      total: TOUR_STEPS.length,
                    })}
                  </div>
                  <h3 className="m-0 font-display text-lg font-semibold text-ink">{t(locale, step.titleKey)}</h3>
                </div>
                <button
                  type="button"
                  className={S.btnGhost}
                  onClick={handleFinish}
                  aria-label={t(locale, 'panel.tour.closeAria')}
                >
                  ×
                </button>
              </div>
              <p className="mb-4 mt-0 text-sm text-ink-muted">{t(locale, step.messageKey)}</p>
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  className={S.btnGhost}
                  onClick={handlePrevious}
                  disabled={currentStep === 0}
                >
                  {t(locale, 'panel.tour.prev')}
                </button>
                <div className="flex gap-1">
                  {TOUR_STEPS.map((s, idx) => (
                    <div
                      key={s.id}
                      className={cn(
                        'h-2 w-2 rounded-full',
                        idx === currentStep ? 'bg-brand-500' : 'bg-ink/20'
                      )}
                    />
                  ))}
                </div>
                <button type="button" className={S.btnPrimary} onClick={handleNext}>
                  {currentStep === TOUR_STEPS.length - 1
                    ? t(locale, 'panel.tour.finish')
                    : t(locale, 'panel.tour.next')}
                </button>
              </div>
            </div>
          </div>
        </div>
      </>
    );
  }

  return null;
}

export function resetTour() {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(TOUR_STORAGE_KEY);
  }
}
