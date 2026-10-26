/**
 * Playbooks operacionais por persona (B-2501 packaging).
 * Checklists contextuais — reutiliza padrão do onboarding de gestor.
 */

export const PLAYBOOK_IDS = Object.freeze({
  HR_HIRING: 'hr_hiring',
  TEAM_MANAGER: 'team_manager',
  DIRECTION: 'direction',
});

/** @type {Record<string, { id: string, tabHints: string[], roles: string[], tasks: { id: string, tab: string, hash?: string }[] }>} */
export const PERSONA_PLAYBOOKS = Object.freeze({
  [PLAYBOOK_IDS.HR_HIRING]: {
    id: PLAYBOOK_IDS.HR_HIRING,
    tabHints: ['vacancies'],
    roles: ['hr', 'direction', 'admin'],
    tasks: [
      { id: 'create_vacancy', tab: 'vacancies' },
      { id: 'send_invite', tab: 'vacancies' },
      { id: 'view_ranking', tab: 'vacancies' },
      { id: 'scorecard', tab: 'vacancies' },
      { id: 'hire', tab: 'vacancies' },
      { id: 'hire_kit', tab: 'team' },
    ],
  },
  [PLAYBOOK_IDS.TEAM_MANAGER]: {
    id: PLAYBOOK_IDS.TEAM_MANAGER,
    tabHints: ['overview', 'team'],
    roles: ['hr', 'direction', 'admin'],
    tasks: [
      { id: 'view_overview', tab: 'overview' },
      { id: 'open_dossier', tab: 'team' },
      { id: 'log_one_on_one', tab: 'team' },
      { id: 'active_pdi', tab: 'team' },
    ],
  },
  [PLAYBOOK_IDS.DIRECTION]: {
    id: PLAYBOOK_IDS.DIRECTION,
    tabHints: ['analytics', 'overview'],
    roles: ['direction', 'admin'],
    tasks: [
      { id: 'view_analytics', tab: 'analytics' },
      { id: 'review_culture', tab: 'overview' },
      { id: 'review_exits', tab: 'exit-analysis' },
      { id: 'review_succession', tab: 'succession' },
    ],
  },
});

/** Map dashboard tab slug → playbooks to surface */
export const TAB_PLAYBOOKS = Object.freeze({
  vacancies: [PLAYBOOK_IDS.HR_HIRING],
  overview: [PLAYBOOK_IDS.TEAM_MANAGER, PLAYBOOK_IDS.DIRECTION],
  team: [PLAYBOOK_IDS.TEAM_MANAGER],
  analytics: [PLAYBOOK_IDS.DIRECTION],
  'exit-analysis': [PLAYBOOK_IDS.DIRECTION],
  succession: [PLAYBOOK_IDS.DIRECTION],
});

export function playbooksForTab(tab, role) {
  const ids = TAB_PLAYBOOKS[tab] || [];
  return ids
    .map((id) => PERSONA_PLAYBOOKS[id])
    .filter((pb) => pb && pb.roles.includes(role));
}
