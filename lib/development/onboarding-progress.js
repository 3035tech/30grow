/**
 * Onboarding Progress — Track completion de tarefas críticas
 * Melhoria #1 (Sprint Quick Wins)
 */

import { asDb } from '../ae/as-db.js';
import { climateMinResponses } from '../people/climate-response-threshold.js';

/**
 * Tarefas críticas de onboarding (order matters)
 */
export const ONBOARDING_TASKS = {
  CREATE_VACANCY: {
    id: 'create_vacancy',
    moduleId: 'recruiting',
    title: 'Criar primeira vaga',
    description: 'Configure uma vaga com rubrica T1-T9',
    weight: 20,
  },
  SEND_ASSESSMENT: {
    id: 'send_assessment',
    moduleId: 'recruiting',
    title: 'Enviar assessment',
    description: 'Convide um candidato para fazer o teste T1-T9',
    weight: 20,
  },
  VIEW_RESULT: {
    id: 'view_result',
    moduleId: 'recruiting',
    title: 'Obter o primeiro resultado do assessment',
    description: 'Acompanhe um candidato até concluir o teste.',
    weight: 15,
  },
  MOVE_PIPELINE: {
    id: 'move_pipeline',
    moduleId: 'recruiting',
    title: 'Mover no pipeline',
    description: 'Arraste um card no kanban ou mude estágio',
    weight: 15,
  },
  CREATE_CLIMATE: {
    id: 'create_climate',
    moduleId: 'climate',
    title: 'Criar pesquisa de clima',
    description: 'Lance uma pesquisa para o time',
    weight: 10,
  },
  CLIMATE_RESULTS: { id: 'climate_results', moduleId: 'climate', title: 'Liberar os primeiros resultados de clima', description: 'Convide o time até alcançar o mínimo de respostas anônimas.', weight: 10 },
  VIEW_ANALYTICS: {
    id: 'view_analytics',
    moduleId: 'analysis',
    title: 'Gerar os primeiros dados de análise',
    description: 'Os indicadores ficam disponíveis quando os resultados da equipe são calculados.',
    weight: 10,
  },
  INVITE_MANAGER: {
    id: 'invite_manager',
    moduleId: 'core',
    title: 'Convidar gestor',
    description: 'Adicione outro usuário ao painel',
    weight: 10,
  },
  FIRST_EMPLOYEE: { id: 'first_employee', moduleId: 'core', title: 'Adicionar a primeira pessoa à equipe', description: 'Ative o cadastro da primeira pessoa colaboradora.', weight: 10 },
  SETUP_JOB_ROLE: { id: 'setup_job_role', moduleId: 'job_roles', title: 'Cadastrar um cargo', description: 'Crie o primeiro cargo ou papel da empresa.', weight: 5 },
  SETUP_LMS_COURSE: { id: 'setup_lms_course', moduleId: 'learning', title: 'Criar curso com conteúdo', description: 'Cadastre um curso e inclua pelo menos uma aula.', weight: 5 },
  COMPLETE_LMS_COURSE: { id: 'complete_lms_course', moduleId: 'learning', title: 'Concluir o primeiro curso', description: 'Acompanhe uma matrícula até a conclusão.', weight: 10 },
  SETUP_BENEFITS: { id: 'setup_benefits', moduleId: 'benefits', title: 'Cadastrar benefícios', description: 'Monte o catálogo inicial de benefícios da empresa.', weight: 5 },
  SETUP_PERFORMANCE: { id: 'setup_performance', moduleId: 'performance', title: 'Criar ciclo de avaliação', description: 'Configure o primeiro ciclo de avaliação.', weight: 5 },
  START_PERFORMANCE_CYCLE: { id: 'start_performance_cycle', moduleId: 'performance', title: 'Abrir o primeiro ciclo de avaliação', description: 'Ative o ciclo para começar as avaliações.', weight: 10 },
  SETUP_SUCCESSION: { id: 'setup_succession', moduleId: 'succession', title: 'Criar plano de sucessão', description: 'Mapeie um cargo crítico e sua pessoa sucessora.', weight: 5 },
  SETUP_COMPANY_FEED: { id: 'setup_company_feed', moduleId: 'company_feed', title: 'Publicar comunicado', description: 'Publique o primeiro conteúdo no mural da equipe.', weight: 5 },
  SETUP_WHISTLEBLOWING: { id: 'setup_whistleblowing', moduleId: 'whistleblowing', title: 'Criar canal de ouvidoria', description: 'Ative um canal para receber relatos da equipe.', weight: 5 },
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
    moduleSetup,
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
    db.query(
      `SELECT
         EXISTS(SELECT 1 FROM job_roles WHERE company_id=$1 AND active=TRUE) AS "jobRole",
         EXISTS(SELECT 1 FROM lms_courses c JOIN lms_lessons l
           ON l.course_id=c.id AND l.company_id=c.company_id AND l.active=TRUE
           WHERE c.company_id=$1 AND c.active=TRUE) AS "lmsCourseWithLesson",
         EXISTS(SELECT 1 FROM company_benefits WHERE company_id=$1 AND active=TRUE) AS benefits,
         EXISTS(SELECT 1 FROM performance_cycles WHERE company_id=$1) AS "performanceCycle",
         EXISTS(SELECT 1 FROM succession_plans WHERE company_id=$1) AS "successionPlan",
         EXISTS(SELECT 1 FROM company_posts WHERE company_id=$1 AND deleted=FALSE) AS "companyFeedPost",
         EXISTS(SELECT 1 FROM whistleblowing_channels WHERE company_id=$1 AND active=TRUE AND deleted=FALSE) AS "whistleblowingChannel",
         EXISTS(SELECT 1 FROM candidates WHERE company_id=$1 AND employment_status='employee') AS "firstEmployee",
         EXISTS(SELECT 1 FROM climate_surveys s JOIN climate_survey_responses r
           ON r.survey_id=s.id AND r.company_id=s.company_id
           WHERE s.company_id=$1 AND s.deleted=FALSE
           GROUP BY s.id HAVING COUNT(*) >= $2) AS "climateResultsAvailable",
         EXISTS(SELECT 1 FROM performance_cycles
           WHERE company_id=$1 AND status IN ('active','closed')) AS "performanceCycleStarted",
         EXISTS(SELECT 1 FROM lms_enrollments e JOIN candidates c
           ON c.id=e.candidate_id AND c.company_id=e.company_id
           WHERE e.company_id=$1 AND c.employment_status='employee' AND e.completed_at IS NOT NULL) AS "lmsCourseCompleted"`,
      [cid, climateMinResponses()]
    ).then(r => r.rows[0] || {}),
  ]);

  const completionMap = {
    [ONBOARDING_TASKS.CREATE_VACANCY.id]: hasVacancy,
    [ONBOARDING_TASKS.SEND_ASSESSMENT.id]: hasAssessment,
    [ONBOARDING_TASKS.VIEW_RESULT.id]: hasResultViewed,
    [ONBOARDING_TASKS.MOVE_PIPELINE.id]: hasPipelineMove,
    [ONBOARDING_TASKS.CREATE_CLIMATE.id]: hasClimate,
    [ONBOARDING_TASKS.VIEW_ANALYTICS.id]: hasAnalyticsAccess,
    [ONBOARDING_TASKS.INVITE_MANAGER.id]: hasMultipleManagers,
    [ONBOARDING_TASKS.SETUP_JOB_ROLE.id]: Boolean(moduleSetup.jobRole),
    [ONBOARDING_TASKS.SETUP_LMS_COURSE.id]: Boolean(moduleSetup.lmsCourseWithLesson),
    [ONBOARDING_TASKS.SETUP_BENEFITS.id]: Boolean(moduleSetup.benefits),
    [ONBOARDING_TASKS.SETUP_PERFORMANCE.id]: Boolean(moduleSetup.performanceCycle),
    [ONBOARDING_TASKS.SETUP_SUCCESSION.id]: Boolean(moduleSetup.successionPlan),
    [ONBOARDING_TASKS.SETUP_COMPANY_FEED.id]: Boolean(moduleSetup.companyFeedPost),
    [ONBOARDING_TASKS.SETUP_WHISTLEBLOWING.id]: Boolean(moduleSetup.whistleblowingChannel),
    [ONBOARDING_TASKS.FIRST_EMPLOYEE.id]: Boolean(moduleSetup.firstEmployee),
    [ONBOARDING_TASKS.CLIMATE_RESULTS.id]: Boolean(moduleSetup.climateResultsAvailable),
    [ONBOARDING_TASKS.START_PERFORMANCE_CYCLE.id]: Boolean(moduleSetup.performanceCycleStarted),
    [ONBOARDING_TASKS.COMPLETE_LMS_COURSE.id]: Boolean(moduleSetup.lmsCourseCompleted),
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
