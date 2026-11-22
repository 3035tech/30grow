'use client';

import { useEffect, useRef } from 'react';

/** Consume a task deep-link once, then remove it from the dashboard URL. */
export function useConsumeOnboardingAction({ action, activationAction, tab, navigateDashboard, onAction, ready = true }) {
  const consumedActionRef = useRef(null);

  useEffect(() => {
    if (activationAction !== action) {
      consumedActionRef.current = null;
      return;
    }
    if (!ready) return;
    if (consumedActionRef.current === action) return;

    consumedActionRef.current = action;
    navigateDashboard?.({ tab, onboardingAction: null, scroll: false, clientOnly: true });
    void onAction();
  }, [action, activationAction, navigateDashboard, onAction, ready, tab]);
}
