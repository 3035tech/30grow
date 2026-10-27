export const ONBOARDING_STAGES = Object.freeze(['arrival', 'd30', 'd60', 'd90']);

export function normalizeOnboardingStages(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > ONBOARDING_STAGES.length || new Set(value).size !== value.length || value.some(stage => !ONBOARDING_STAGES.includes(stage))) return null;
  return ONBOARDING_STAGES.filter(stage => value.includes(stage));
}

export function onboardingStageOptions(locale, t) {
  return ONBOARDING_STAGES.map(value => ({ value, label: t(locale, `onboardingStages.${value}`) }));
}
