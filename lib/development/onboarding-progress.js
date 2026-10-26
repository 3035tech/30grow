/**
 * Onboarding Progress — Track completion de tarefas críticas
 * Melhoria #1 (Sprint Quick Wins)
 */

import { asDb } from '../ae/as-db.js';

/**
 * Tarefas críticas de onboarding (order matters)
 */
export const ONBOARDING_TASKS = {
  CREATE_VACANCY: {
    id: 'create_vacancy',
    title: 'Criar primeira vaga',
    description: 'Configure uma vaga com rubrica T1-T9',
    weight: 20,
  },
  SEND_ASSESSMENT: {
    id: 'send_assessment',
    title: 'Enviar assessment',
    description: 'Convide um candidato para fazer o teste T1-T9',
    weight: 20,
  },
  VIEW_RESULT: {
    id: 'view_result',
    title: 'Ver resultado',
    description: 'Confira o perfil de um candidato no dashboard',
    weight: 15,
  },
  MOVE_PIPELINE: {
    id: 'move_pipeline',
    title: 'Mover no pipeline',
    description: 'Arraste um card no kanban ou mude estágio',
    weight: 15,
  },
  CREATE_CLIMATE: {
    id: 'create_climate',
    title: 'Criar pesquisa de clima',
    description: 'Lance uma pesquisa para o time',
    weight: 10,
  },
  VIEW_ANALYTICS: {
    id: 'view_analytics',
    title: 'Explorar Analytics',
    description: 'Acesse métricas e tendências',
    weight: 10,
  },
  INVITE_MANAGER: {
    id: 'invite_manager',
    title: 'Convidar gestor',
    description: 'Adicione outro usuário ao painel',
    weight: 10,
  },
};

/**
 * Calcula progresso de onboarding de uma empresa
 * 
 * @param {Function} dbFn - query function
 * @param {number} companyId
 * @returns {Promise<{ completed: string[], progress: number, tasks: object[] }>}
 */
export async function getOnboardingProgress(dbFn, companyId) {
  const db = asDb(dbFn);
  const cid = Number(companyId);

  // Check each task
  const [
    hasVacancy,
    hasAssessment,
    hasResultViewed, // Aproximação: se tem assessment completed
    hasPipelineMove,
    hasClimate,
    hasAnalyticsAccess, // Aproximação: se tem hr_scores
    hasMultipleManagers,
  ] = await Promise.all([
    // CREATE_VACANCY
    db.query(
      `SELECT EXISTS(SELECT 1 FROM vacancies WHERE company_id = $1 AND deleted = FALSE) AS exists`,
      [cid]
    ).then(r => r.rows[0]?.exists || false),

    // SEND_ASSESSMENT
    db.query(
      `SELECT EXISTS(
         SELECT 1 FROM assessments ass
         JOIN candidates c ON c.id = ass.candidate_id
         WHERE c.company_id = $1
       ) AS exists`,
      [cid]
    ).then(r => r.rows[0]?.exists || false),

    // VIEW_RESULT (proxy: assessment submetido gera resultado autoritativo com top_type)
    db.query(
      `SELECT EXISTS(
         SELECT 1 FROM assessments ass
         JOIN candidates c ON c.id = ass.candidate_id
         WHERE c.company_id = $1 AND ass.top_type IS NOT NULL
       ) AS exists`,
      [cid]
    ).then(r => r.rows[0]?.exists || false),

    // MOVE_PIPELINE (proxy: tem assessment_pipeline_history)
    db.query(
      `SELECT EXISTS(
         SELECT 1 FROM assessment_pipeline_history h
         JOIN assessments ass ON ass.id = h.assessment_id
         JOIN candidates c ON c.id = ass.candidate_id
         WHERE c.company_id = $1
       ) AS exists`,
      [cid]
    ).then(r => r.rows[0]?.exists || false),

    // CREATE_CLIMATE
    db.query(
      `SELECT EXISTS(SELECT 1 FROM climate_surveys WHERE company_id = $1) AS exists`,
      [cid]
    ).then(r => r.rows[0]?.exists || false),

    // VIEW_ANALYTICS (proxy: tem hr_scores calculados)
    db.query(
      `SELECT EXISTS(
         SELECT 1 FROM hr_scores h
         JOIN candidates c ON c.id = h.candidate_id
         WHERE c.company_id = $1
       ) AS exists`,
      [cid]
    ).then(r => r.rows[0]?.exists || false),

    // INVITE_MANAGER (2+ users)
    db.query(
      `SELECT COUNT(*)::int AS n FROM users WHERE company_id = $1 AND active = TRUE`,
      [cid]
    ).then(r => (r.rows[0]?.n || 0) >= 2),
  ]);

  const completionMap = {
    [ONBOARDING_TASKS.CREATE_VACANCY.id]: hasVacancy,
    [ONBOARDING_TASKS.SEND_ASSESSMENT.id]: hasAssessment,
    [ONBOARDING_TASKS.VIEW_RESULT.id]: hasResultViewed,
    [ONBOARDING_TASKS.MOVE_PIPELINE.id]: hasPipelineMove,
    [ONBOARDING_TASKS.CREATE_CLIMATE.id]: hasClimate,
    [ONBOARDING_TASKS.VIEW_ANALYTICS.id]: hasAnalyticsAccess,
    [ONBOARDING_TASKS.INVITE_MANAGER.id]: hasMultipleManagers,
  };

  const completed = Object.keys(completionMap).filter(id => completionMap[id]);
  
  const totalWeight = Object.values(ONBOARDING_TASKS).reduce((sum, t) => sum + t.weight, 0);
  const completedWeight = completed.reduce((sum, id) => {
    const task = Object.values(ONBOARDING_TASKS).find(t => t.id === id);
    return sum + (task?.weight || 0);
  }, 0);

  const progress = Math.round((completedWeight / totalWeight) * 100);

  const tasks = Object.values(ONBOARDING_TASKS).map(task => ({
    ...task,
    completed: completionMap[task.id],
  }));

  return { completed, progress, tasks };
}
