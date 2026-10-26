/**
 * Seed DEMO — empresa "Todos os Dados" (tenant isolado, apresentação completa)
 *
 * Popula o máximo possível do produto (migrations ≤103):
 * Equipe, Comparar, Vagas/pipeline, Motivadores, 1:1, PDI, clima+eNPS, pulso,
 * grupos, benefícios, Academy, LMS (quiz/watch/trilha), performance+side reviews,
 * sucessão, saídas, compensação, jornada onboarding, scorecards, interview slots,
 * DP leve, mural/kudos, ouvidoria, feedback contínuo, OKR ciclos, ponto + banco
 * de horas, prep de entrevista, /r, /t, /v, /e, /employee, notificações.
 *
 * Pré-requisitos:
 *   - migrations através de 103
 *   - areas populadas
 *   - npm run db:seed-motivators  (ae_definitions slug=motivators; opcional)
 *
 * Uso:
 *   CONFIRM_DEMO_PURGE=1 npm run db:seed-demo-todos-os-dados
 *   (alias) npm run db:seed-demo-todos-os-dados:confirm
 *
 * Alternativa SQL (pgAdmin / apresentação): scripts/seed-demo-todos-os-dados.sql
 *
 * Logins (senha DemoTodosDados!2026):
 *   hr@todos-os-dados.demo           → /login (dashboard)
 *   direction@todos-os-dados.demo    → /login
 *   colaborador@todos-os-dados.demo  → /employee
 */

import crypto from 'node:crypto';
import process from 'node:process';
import { createRequire } from 'node:module';
import { getPgBaseConfig } from '../lib/pg-config.js';
import { MOTIVATORS_DIMENSIONS, motivatorDimensionLabel } from '../lib/ae/motivators-dimensions.js';
import { AE_SCORING_ENGINE_VERSION } from '../lib/ae/ae-id.js';
import { computeAreaScore010 } from '../lib/area-fit.js';
import {
  fitTypeAlignment,
  normalizeRecommendation,
  normalizeReportWeights,
  recommendationFromStage,
  rubricWeightedTypes,
} from '../lib/recruiting/vacancy-report-shared.js';
import { isRichTextEmpty, sanitizeRichTextHtml } from '../lib/sanitize-html.js';
import { seedTodosOsDadosModules, MODULE_TOK } from './seed-demo-todos-os-dados-modules.js';

const require = createRequire(import.meta.url);
const { Client } = require('pg');
const bcrypt = require('bcryptjs');

const SLUG = 'todos-os-dados-demo';
const COMPANY_NAME = 'Todos os Dados';
const DOMAIN = 'todos-os-dados.demo';
const HR_EMAIL = `hr@${DOMAIN}`;
const DIR_EMAIL = `direction@${DOMAIN}`;
const COLAB_EMAIL = `colaborador@${DOMAIN}`;
const PASSWORD = process.env.DEMO_TODOS_PASSWORD || 'DemoTodosDados!2026';
const SOURCE = 'demo_todos_os_dados';

/** Tokens fixos — smoke manual / documentação. */
const TOK = {
  company: 'd0d0todosdadose5f60718293a4b5c6d7e8f01',
  vacancyOpen: 'e1e1todosdadose5f60718293a4b5c6d7e8f02',
  vacancyClosed: 'f2f2todosdadose5f60718293a4b5c6d7e8f03',
  report: 'a3a3todosdadose5f60718293a4b5c6d7e8f04a3a3todosdadose5f60718',
  aeInvite: 'b4b4todosdadose5f60718293a4b5c6d7e8f05',
  candInvite: 'c5c5todosdadose5f60718293a4b5c6d7e8f06',
  employeePortal: 'e0e0todosdadose5f60718293a4b5c6d7e8f07',
  climate: 'c1c1todosdadose5f60718293a4b5c6d7e8f08',
  pulse: 'p1p1todosdadose5f60718293a4b5c6d7e8f09',
  sidePeer: 's1s1todosdadose5f60718293a4b5c6d7e8f0a',
  whistle: MODULE_TOK.whistle,
  prepPedro: MODULE_TOK.prepPedro,
};

const ASSIGNABLE_CAPS = [
  'overview.view',
  'team.view',
  'compatibility.view',
  'compare.view',
  'group.view',
  'leadership.view',
  'vacancies.view',
  'motivators.view',
  'climate.view',
  'job_roles.view',
  'performance.view',
  'succession.view',
  'exit_analysis.view',
  'learning.view',
  'benefits.view',
  'compensation.view',
  'whistleblowing.view',
  'dp.view',
  'company_feed.view',
  'help.view',
];

async function deleteIfExists(client, sql, params) {
  try {
    await client.query(sql, params);
  } catch (err) {
    if (err && (err.code === '42P01' || /does not exist/i.test(String(err.message || '')))) return;
    throw err;
  }
}

function token(bytes = 24) {
  return crypto.randomBytes(bytes).toString('hex');
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function makeScoresBiased(topType) {
  const scores = {};
  let max = 0;
  for (let t = 1; t <= 9; t += 1) {
    const base = 10 + Math.floor(Math.random() * 8);
    const boost = t === topType ? 8 + Math.floor(Math.random() * 6) : Math.floor(Math.random() * 5) - 1;
    const v = clamp(base + boost, 6, 30);
    scores[String(t)] = v;
    if (v > max) max = v;
  }
  scores[String(topType)] = Math.max(scores[String(topType)], max + 1);
  return scores;
}

/** Local calendar date as YYYY-MM-DD shifted by dayOffset, then yearsAgo. */
function calendarYmd(dayOffset = 0, yearsAgo = 0) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + dayOffset);
  d.setFullYear(d.getFullYear() - yearsAgo);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function motivatorsPayload(topKeys) {
  const dims = MOTIVATORS_DIMENSIONS.map((d) => d.key);
  const scores = {};
  for (const k of dims) scores[k] = 40;
  let high = 90;
  for (const k of topKeys) {
    scores[k] = high;
    high -= 4;
  }
  const ranking = [...dims].sort((a, b) => (scores[b] || 0) - (scores[a] || 0));
  return { dimensionScores: scores, ranking };
}

function motivatorsTopFromKeys(keys, dimensionScores) {
  return (keys || []).slice(0, 3).map((key) => ({
    key,
    label: motivatorDimensionLabel(key, 'pt-BR'),
    score: Math.round(Number(dimensionScores?.[key]) || 0),
  }));
}

/** Colaboradores internos — um de cada T1–T9. */
const EMPLOYEES = [
  {
    key: 'ana',
    fullName: 'Ana Clara Mendes',
    topType: 1,
    areaKey: 'juridico',
    motivators: ['seguranca', 'proposito', 'desenvolvimento'],
    city: 'São Paulo',
    state: 'SP',
    phone: '+55 11 99100-1001',
    birthInDays: 2,
    ageYears: 34,
    workAnnivInDays: 7,
    tenureYears: 3,
  },
  {
    key: 'bruno',
    fullName: 'Bruno Oliveira',
    topType: 2,
    areaKey: 'rh',
    motivators: ['relacionamentos', 'equilibrio', 'proposito'],
    city: 'São Paulo',
    state: 'SP',
    phone: '+55 11 99100-1002',
    birthInDays: 5,
    ageYears: 29,
    workAnnivInDays: 11,
    tenureYears: 2,
  },
  {
    key: 'carla',
    fullName: 'Carla Souza',
    topType: 3,
    areaKey: 'comercial',
    motivators: ['reconhecimento', 'desafio', 'financeiro'],
    city: 'Campinas',
    state: 'SP',
    phone: '+55 19 99100-1003',
    birthInDays: 9,
    ageYears: 31,
    workAnnivInDays: 0,
    tenureYears: 1,
  },
  {
    key: 'diego',
    fullName: 'Diego Martins',
    topType: 4,
    areaKey: 'produto',
    motivators: ['criatividade', 'autonomia', 'proposito'],
    city: 'Rio de Janeiro',
    state: 'RJ',
    phone: '+55 21 99100-1004',
  },
  {
    key: 'elena',
    fullName: 'Elena Ferreira',
    topType: 5,
    areaKey: 'tecnologia',
    motivators: ['autonomia', 'desafio', 'crescimento'],
    city: 'São Paulo',
    state: 'SP',
    phone: '+55 11 99100-1005',
  },
  {
    key: 'fabio',
    fullName: 'Fábio Nunes',
    topType: 6,
    areaKey: 'operacoes',
    motivators: ['seguranca', 'equilibrio', 'relacionamentos'],
    city: 'Belo Horizonte',
    state: 'MG',
    phone: '+55 31 99100-1006',
  },
  {
    key: 'gabi',
    fullName: 'Gabriela Rocha',
    topType: 7,
    areaKey: 'marketing',
    motivators: ['crescimento', 'flexibilidade', 'desafio'],
    city: 'Curitiba',
    state: 'PR',
    phone: '+55 41 99100-1007',
  },
  {
    key: 'hugo',
    fullName: 'Hugo Almeida',
    topType: 8,
    areaKey: 'operacoes',
    motivators: ['lideranca', 'desafio', 'financeiro'],
    city: 'São Paulo',
    state: 'SP',
    phone: '+55 11 99100-1008',
  },
  {
    key: 'iris',
    fullName: 'Íris Campos',
    topType: 9,
    areaKey: 'cs',
    motivators: ['relacionamentos', 'equilibrio', 'proposito'],
    city: 'Porto Alegre',
    state: 'RS',
    phone: '+55 51 99100-1009',
  },
  {
    key: 'colaborador',
    fullName: 'Lucas Colaborador',
    topType: 5,
    areaKey: 'tecnologia',
    motivators: ['autonomia', 'desenvolvimento', 'proposito'],
    city: 'São Paulo',
    state: 'SP',
    phone: '+55 11 99100-1010',
    birthInDays: 3,
    ageYears: 28,
    workAnnivInDays: 4,
    tenureYears: 1,
    isCollaboratorLogin: true,
  },
  {
    key: 'joana',
    fullName: 'Joana Prestes',
    topType: 2,
    areaKey: 'rh',
    motivators: ['relacionamentos', 'proposito', 'equilibrio'],
    city: 'Florianópolis',
    state: 'SC',
    phone: '+55 48 99100-1011',
  },
];

/** Candidatos da vaga aberta — cobrem todos os estágios do pipeline. */
const APPLICANTS = [
  {
    key: 'pedro',
    fullName: 'Pedro Henrique Santos',
    topType: 5,
    areaKey: 'tecnologia',
    pipeline: 'screening',
    vacancyStage: 'screening',
    motivators: ['autonomia', 'desafio', 'crescimento'],
    salary: '18500.00',
    availability: '30_days',
    source: 'linkedin',
    city: 'São Paulo',
    state: 'SP',
    phone: '+55 11 99200-2001',
    linkedin: 'https://linkedin.com/in/pedro-henrique-todosdados',
    scores: { 1: 15, 2: 11, 3: 13, 4: 12, 5: 27, 6: 18, 7: 10, 8: 14, 9: 9 },
    why: 'Forte aderência analítica à rubrica da vaga; stack e cases alinhados à plataforma.',
    watchOut: 'Pode demorar demais em análise antes de entregar.',
    interviewProbe: 'Como equilibra profundidade técnica com prazo de sprint?',
    recommendation: 'advance',
    interviewNotes: `<p><strong>Entrevista 1 (screening) — 13/08.</strong></p>
<ul>
<li>Stack: Node, React, Postgres; falou com clareza de índices e N+1.</li>
<li>Case: migração de conciliação com idempotência; perguntou trade-offs.</li>
<li>Fit cultural: perfil analítico (T5); gosta de aprofundar antes de commit.</li>
</ul>
<p><strong>Pontos positivos:</strong> raciocínio estruturado, curiosidade técnica, pretensão alinhada (R$ 18,5k).</p>
<p><strong>Atenção:</strong> pode alongar análise — explorar ritmo de sprint com o time do cliente.</p>
<p><strong>Próximo passo:</strong> avançar para entrevista técnica com o cliente.</p>`,
  },
  {
    key: 'marina',
    fullName: 'Marina Duarte',
    topType: 3,
    areaKey: 'tecnologia',
    pipeline: 'interview',
    vacancyStage: 'interview',
    motivators: ['reconhecimento', 'crescimento', 'desafio'],
    salary: '17000.00',
    availability: '15_days',
    source: 'referral',
    city: 'Curitiba',
    state: 'PR',
    phone: '+55 41 99200-2002',
    scores: { 1: 12, 2: 14, 3: 26, 4: 11, 5: 13, 6: 10, 7: 16, 8: 15, 9: 9 },
    why: 'Execução rápida; bom para ritmo de entrega — validar processo.',
    watchOut: 'Pode priorizar velocidade sobre processo.',
    interviewProbe: 'Conte um caso em que revisou uma decisão sob pressão.',
    recommendation: 'discuss',
    interviewNotes: `<p><strong>Entrevista 1 — 15/08 (agendada / em andamento).</strong></p>
<ul>
<li>Indicação interna; disponibilidade em até 15 dias.</li>
<li>Perfil executor (T3): foco em entrega e meta.</li>
<li>Experiência em produto digital; menos profundidade em SQL avançado.</li>
</ul>
<p><strong>Pontos positivos:</strong> comunicação objetiva, energia de entrega, pretensão R$ 17k ok.</p>
<p><strong>Atenção:</strong> validar se prioriza velocidade sobre processo/documentação.</p>
<p><strong>Próximo passo:</strong> concluir entrevista e decidir se entra na shortlist “conversar”.</p>`,
  },
  {
    key: 'gustavo',
    fullName: 'Gustavo Pires',
    topType: 6,
    areaKey: 'tecnologia',
    pipeline: 'rejected',
    vacancyStage: 'rejected',
    rejectionReason: 'skill_gap',
    motivators: ['seguranca', 'equilibrio', 'relacionamentos'],
    salary: '16000.00',
    availability: 'immediate',
    source: 'job_board',
    city: 'São Paulo',
    state: 'SP',
    phone: '+55 11 99200-2003',
    scores: { 1: 14, 2: 12, 3: 11, 4: 10, 5: 15, 6: 25, 7: 9, 8: 13, 9: 12 },
    recommendation: 'exclude',
    interviewNotes: `<p><strong>Entrevista 1 — 08/08.</strong></p>
<ul>
<li>Portal de vagas; disponibilidade imediata.</li>
<li>Perfil T6 — cauteloso; boa postura, porém gaps em settlement e filas.</li>
<li>Exercício técnico: dificuldade em modelar idempotência e retry.</li>
</ul>
<p><strong>Decisão:</strong> reprovado por <em>skill_gap</em> (fit técnico insuficiente para a vaga).</p>
<p><strong>Feedback interno:</strong> candidato educado; possível banco para vagas mais operacionais no futuro.</p>`,
  },
  {
    key: 'lara',
    fullName: 'Lara Mendonça',
    topType: 1,
    areaKey: 'tecnologia',
    pipeline: 'approved',
    vacancyStage: 'approved',
    motivators: ['proposito', 'desenvolvimento', 'seguranca'],
    salary: '19000.00',
    availability: '30_days',
    source: 'agency',
    city: 'Florianópolis',
    state: 'SC',
    phone: '+55 48 99200-2004',
    scores: { 1: 28, 2: 12, 3: 14, 4: 11, 5: 16, 6: 18, 7: 9, 8: 13, 9: 10 },
    why: 'Processo + qualidade; boa para compliance e previsibilidade da plataforma.',
    watchOut: 'Pode travar se o time for muito “atalho”.',
    interviewProbe: 'Como documenta decisões técnicas?',
    recommendation: 'advance',
    interviewNotes: `<p><strong>Entrevista 1 + 2 — triagem e aprovação interna.</strong></p>
<ul>
<li>Agência; pretensão R$ 19k; disponibilidade 30 dias.</li>
<li>Perfil T1 — qualidade e processo; excelente para compliance de plataforma.</li>
<li>Case: revisão de PR e checklist de release; documentação clara.</li>
</ul>
<p><strong>Pontos positivos:</strong> disciplina, alinhamento à rubrica (T1), maturidade de entrega.</p>
<p><strong>Atenção:</strong> pode travar com times muito “atalho” — explorar no cliente.</p>
<p><strong>Status:</strong> aprovada internamente; pronta para shortlist do relatório ao cliente.</p>`,
  },
  {
    key: 'otavio',
    fullName: 'Otávio Ribeiro',
    topType: 7,
    areaKey: 'tecnologia',
    pipeline: 'test_completed',
    vacancyStage: 'test_completed',
    motivators: ['flexibilidade', 'criatividade', 'crescimento'],
    salary: '15500.00',
    availability: '60_days',
    source: 'linkedin',
    city: 'Recife',
    state: 'PE',
    phone: '+55 81 99200-2005',
    scores: { 1: 11, 2: 13, 3: 15, 4: 12, 5: 14, 6: 10, 7: 27, 8: 16, 9: 9 },
    recommendation: 'bank',
    interviewNotes: `<p><strong>Pós-teste (test_completed) — 16/08.</strong></p>
<ul>
<li>LinkedIn; Recife; disponibilidade 60 dias (mais longo).</li>
<li>Perfil T7 — exploração e ritmo; teste ok, entrevista ainda não marcada.</li>
<li>Motivadores: flexibilidade / criatividade / crescimento.</li>
</ul>
<p><strong>Leitura:</strong> banco por ora — timing de disponibilidade e menor aderência à rubrica (T5/T1/T6).</p>
<p><strong>Próximo passo:</strong> manter em banco; reavaliar se a shortlist principal não fechar.</p>`,
  },
  {
    key: 'nina',
    fullName: 'Nina Barbosa',
    topType: 2,
    areaKey: 'tecnologia',
    pipeline: 'new',
    vacancyStage: 'new',
    salary: '14000.00',
    availability: 'immediate',
    source: 'other',
    city: 'Brasília',
    state: 'DF',
    phone: '+55 61 99200-2006',
    scores: { 1: 14, 2: 26, 3: 15, 4: 12, 5: 11, 6: 16, 7: 13, 8: 10, 9: 17 },
    pendingAeInvite: true,
    interviewNotes: `<p><strong>Pré-cadastro / screening inicial — 19/08.</strong></p>
<ul>
<li>Contato frio (fonte: outro); disponibilidade imediata.</li>
<li>Perfil T2 — colaborativo; ainda sem Motivadores respondidos.</li>
<li>Convite de Eneagrama: <strong>enviado</strong>; aguardando abertura do link.</li>
</ul>
<p><strong>Notas da call rápida (15 min):</strong> interesse genuíno na vaga; experiência mid em front; backend mais raso.</p>
<p><strong>Próximo passo:</strong> aguardar conclusão do teste + enviar Motivadores; só então marcar entrevista estruturada.</p>`,
  },
  {
    key: 'ricardo',
    fullName: 'Ricardo Alves',
    topType: 8,
    areaKey: 'tecnologia',
    pipeline: 'archived',
    vacancyStage: 'archived',
    motivators: ['lideranca', 'desafio', 'autonomia'],
    salary: '21000.00',
    availability: 'other',
    source: 'referral',
    city: 'São Paulo',
    state: 'SP',
    phone: '+55 11 99200-2007',
    scores: { 1: 13, 2: 10, 3: 14, 4: 11, 5: 15, 6: 12, 7: 16, 8: 28, 9: 9 },
    recommendation: 'exclude',
    interviewNotes: `<p><strong>Processo encerrado (arquivado) — 01/08.</strong></p>
<ul>
<li>Indicação; pretensão acima do teto da vaga (R$ 21k).</li>
<li>Perfil T8 — liderança forte; excesso de seniority para a abertura atual.</li>
</ul>
<p><strong>Motivo do arquivo:</strong> desalinhamento de escopo/senioridade e expectativa salarial.</p>
<p><strong>Nota:</strong> não reabrir nesta vaga; eventual fit em papel de tech lead futuro.</p>`,
  },
];

async function main() {
  if (process.env.CONFIRM_DEMO_PURGE !== '1') {
    console.error(
      'ABORTADO: defina CONFIRM_DEMO_PURGE=1 para apagar/recriar apenas o tenant slug=%s',
      SLUG
    );
    process.exit(1);
  }

  const client = new Client(getPgBaseConfig());
  await client.connect();

  try {
    await client.query('BEGIN');

    const existing = await client.query(
      `SELECT id FROM companies WHERE LOWER(slug) = $1 ORDER BY id`,
      [SLUG]
    );

    for (const row of existing.rows) {
      const companyId = row.id;
      const badUsers = await client.query(
        `SELECT COUNT(*)::int AS n FROM users
         WHERE company_id = $1 AND email NOT ILIKE '%.demo' AND deleted = FALSE`,
        [companyId]
      );
      if (badUsers.rows[0].n > 0) {
        throw new Error(`ABORTADO: company_id=${companyId} parece tenant real (usuários sem *.demo).`);
      }

      await deleteIfExists(client, `DELETE FROM lms_lesson_quiz_attempts WHERE company_id = $1`, [companyId]);
      await deleteIfExists(client, `DELETE FROM lms_lesson_watch_progress WHERE company_id = $1`, [companyId]);
      await deleteIfExists(client, `DELETE FROM lms_lesson_quiz_questions WHERE company_id = $1`, [companyId]);
      await deleteIfExists(client, `DELETE FROM lms_job_role_courses WHERE company_id = $1`, [companyId]);
      await deleteIfExists(
        client,
        `DELETE FROM development_plan_lms_links l
           USING development_plan_items i
          WHERE l.plan_item_id = i.id AND i.company_id = $1`,
        [companyId]
      );
      await deleteIfExists(client, `DELETE FROM lms_lesson_completions WHERE company_id = $1`, [companyId]);
      await deleteIfExists(client, `DELETE FROM lms_enrollments WHERE company_id = $1`, [companyId]);
      await deleteIfExists(client, `DELETE FROM lms_lessons WHERE company_id = $1`, [companyId]);
      await deleteIfExists(client, `DELETE FROM lms_cohorts WHERE company_id = $1`, [companyId]);
      await deleteIfExists(client, `DELETE FROM lms_courses WHERE company_id = $1`, [companyId]);
      await deleteIfExists(client, `DELETE FROM employee_compensation_events WHERE company_id = $1`, [companyId]);
      await deleteIfExists(client, `DELETE FROM employee_hour_bank_entries WHERE company_id = $1`, [companyId]);
      await deleteIfExists(client, `DELETE FROM employee_dp_documents WHERE company_id = $1`, [companyId]);
      await deleteIfExists(client, `DELETE FROM employee_leave_requests WHERE company_id = $1`, [companyId]);
      await deleteIfExists(client, `DELETE FROM employee_leave_balances WHERE company_id = $1`, [companyId]);
      await deleteIfExists(client, `DELETE FROM candidate_dp_profiles WHERE company_id = $1`, [companyId]);
      await deleteIfExists(client, `DELETE FROM company_kudos WHERE company_id = $1`, [companyId]);
      await deleteIfExists(client, `DELETE FROM company_posts WHERE company_id = $1`, [companyId]);
      await deleteIfExists(client, `DELETE FROM feedback_requests WHERE company_id = $1`, [companyId]);
      await deleteIfExists(client, `DELETE FROM whistleblowing_reports WHERE company_id = $1`, [companyId]);
      await deleteIfExists(client, `DELETE FROM whistleblowing_channels WHERE company_id = $1`, [companyId]);
      await deleteIfExists(client, `DELETE FROM interview_prep_links WHERE company_id = $1`, [companyId]);
      await deleteIfExists(client, `DELETE FROM company_pre_onboarding_templates WHERE company_id = $1`, [companyId]);
      await deleteIfExists(client, `DELETE FROM okr_activity_checkins WHERE company_id = $1`, [companyId]);
      await deleteIfExists(client, `DELETE FROM okr_activity_assignees WHERE company_id = $1`, [companyId]);
      await deleteIfExists(client, `DELETE FROM okr_activities WHERE company_id = $1`, [companyId]);
      await deleteIfExists(client, `DELETE FROM okr_areas WHERE company_id = $1`, [companyId]);
      await deleteIfExists(client, `DELETE FROM okr_cycles WHERE company_id = $1`, [companyId]);
      await deleteIfExists(client, `DELETE FROM product_feedback WHERE company_id = $1`, [companyId]);
      await deleteIfExists(client, `DELETE FROM candidate_notifications WHERE company_id = $1`, [companyId]);
      await deleteIfExists(client, `DELETE FROM employee_login_tokens WHERE company_id = $1`, [companyId]);
      await deleteIfExists(client, `DELETE FROM performance_side_reviews WHERE company_id = $1`, [companyId]);
      await deleteIfExists(client, `DELETE FROM interview_slots WHERE company_id = $1`, [companyId]);
      await deleteIfExists(client, `DELETE FROM job_funnel_events WHERE company_id = $1`, [companyId]);
      await deleteIfExists(client, `DELETE FROM referral_codes WHERE company_id = $1`, [companyId]);
      await deleteIfExists(client, `DELETE FROM company_analytics_report_prefs WHERE company_id = $1`, [companyId]);
      await deleteIfExists(client, `DELETE FROM vacancy_report_shares WHERE company_id = $1`, [companyId]);
      await client.query(`DELETE FROM manager_notifications WHERE company_id = $1`, [companyId]);
      await deleteIfExists(client, `DELETE FROM hr_scores WHERE company_id = $1`, [companyId]);
      await deleteIfExists(
        client,
        `DELETE FROM development_plan_resource_links l
           USING development_plan_items i
          WHERE l.plan_item_id = i.id AND i.company_id = $1`,
        [companyId]
      );
      await deleteIfExists(client, `DELETE FROM development_plan_items WHERE company_id = $1`, [companyId]);
      await deleteIfExists(client, `DELETE FROM development_plans WHERE company_id = $1`, [companyId]);
      await client.query(`DELETE FROM one_on_ones WHERE company_id = $1`, [companyId]);
      await deleteIfExists(client, `DELETE FROM retention_followups WHERE company_id = $1`, [companyId]);
      await deleteIfExists(client, `DELETE FROM employee_onboarding_checkins WHERE company_id = $1`, [companyId]);
      await deleteIfExists(client, `DELETE FROM employee_pre_onboarding_items WHERE company_id = $1`, [companyId]);
      await deleteIfExists(client, `DELETE FROM employee_portal_tokens WHERE company_id = $1`, [companyId]);
      await deleteIfExists(client, `DELETE FROM interview_scorecards WHERE company_id = $1`, [companyId]);
      await deleteIfExists(
        client,
        `DELETE FROM climate_survey_responses r USING climate_surveys s
          WHERE r.survey_id = s.id AND s.company_id = $1`,
        [companyId]
      );
      await deleteIfExists(
        client,
        `DELETE FROM climate_survey_invites i USING climate_surveys s
          WHERE i.survey_id = s.id AND s.company_id = $1`,
        [companyId]
      );
      await deleteIfExists(
        client,
        `DELETE FROM climate_survey_questions q USING climate_surveys s
          WHERE q.survey_id = s.id AND s.company_id = $1`,
        [companyId]
      );
      await deleteIfExists(client, `DELETE FROM climate_surveys WHERE company_id = $1`, [companyId]);
      await deleteIfExists(
        client,
        `DELETE FROM team_pulse_responses r USING team_pulses p
          WHERE r.pulse_id = p.id AND p.company_id = $1`,
        [companyId]
      );
      await deleteIfExists(
        client,
        `DELETE FROM team_pulse_invites i USING team_pulses p
          WHERE i.pulse_id = p.id AND p.company_id = $1`,
        [companyId]
      );
      await deleteIfExists(
        client,
        `DELETE FROM team_pulse_questions q USING team_pulses p
          WHERE q.pulse_id = p.id AND p.company_id = $1`,
        [companyId]
      );
      await deleteIfExists(client, `DELETE FROM team_pulses WHERE company_id = $1`, [companyId]);
      await deleteIfExists(client, `DELETE FROM okr_key_results WHERE company_id = $1`, [companyId]);
      await deleteIfExists(client, `DELETE FROM okr_objectives WHERE company_id = $1`, [companyId]);
      await deleteIfExists(client, `DELETE FROM employee_time_punches WHERE company_id = $1`, [companyId]);
      await deleteIfExists(client, `DELETE FROM company_time_schedules WHERE company_id = $1`, [companyId]);
      await deleteIfExists(client, `DELETE FROM team_groups WHERE company_id = $1`, [companyId]);
      await deleteIfExists(client, `DELETE FROM succession_plans WHERE company_id = $1`, [companyId]);
      await deleteIfExists(client, `DELETE FROM critical_roles WHERE company_id = $1`, [companyId]);
      await deleteIfExists(
        client,
        `DELETE FROM performance_reviews r USING performance_cycles c
          WHERE r.cycle_id = c.id AND c.company_id = $1`,
        [companyId]
      );
      await deleteIfExists(
        client,
        `DELETE FROM performance_goals g USING performance_cycles c
          WHERE g.cycle_id = c.id AND c.company_id = $1`,
        [companyId]
      );
      await deleteIfExists(client, `DELETE FROM performance_cycles WHERE company_id = $1`, [companyId]);
      await deleteIfExists(client, `DELETE FROM exit_records WHERE company_id = $1`, [companyId]);
      await deleteIfExists(client, `DELETE FROM learning_resources WHERE company_id = $1`, [companyId]);
      await deleteIfExists(client, `DELETE FROM company_benefits WHERE company_id = $1`, [companyId]);
      await deleteIfExists(client, `DELETE FROM benefit_categories WHERE company_id = $1`, [companyId]);
      await deleteIfExists(client, `DELETE FROM job_roles WHERE company_id = $1`, [companyId]);
      await client.query(`DELETE FROM ae_attempts WHERE company_id = $1`, [companyId]);
      await client.query(`DELETE FROM ae_invites WHERE company_id = $1`, [companyId]);
      await client.query(
        `DELETE FROM vacancy_candidate_pipeline_history h
         USING vacancy_candidates vc
         WHERE h.vacancy_candidate_id = vc.id AND vc.company_id = $1`,
        [companyId]
      );
      await client.query(`DELETE FROM vacancy_candidates WHERE company_id = $1`, [companyId]);
      await client.query(
        `DELETE FROM assessment_pipeline_history h
         USING assessments a
         WHERE h.assessment_id = a.id AND a.company_id = $1`,
        [companyId]
      );
      await client.query(`DELETE FROM assessments WHERE company_id = $1`, [companyId]);
      await client.query(
        `DELETE FROM vacancy_rubrics r USING vacancies v
         WHERE r.vacancy_id = v.id AND v.company_id = $1`,
        [companyId]
      );
      await client.query(
        `DELETE FROM vacancy_links l USING vacancies v
         WHERE l.vacancy_id = v.id AND v.company_id = $1`,
        [companyId]
      );
      await client.query(`DELETE FROM candidate_invites WHERE company_id = $1`, [companyId]);
      await client.query(`DELETE FROM vacancies WHERE company_id = $1`, [companyId]);
      await client.query(`DELETE FROM candidates WHERE company_id = $1`, [companyId]);
      await client.query(`DELETE FROM company_links WHERE company_id = $1`, [companyId]);
      await client.query(
        `DELETE FROM user_capability_overrides o USING users u
         WHERE o.user_id = u.id AND u.company_id = $1`,
        [companyId]
      );
      await client.query(`DELETE FROM users WHERE company_id = $1`, [companyId]);
      await client.query(`DELETE FROM companies WHERE id = $1`, [companyId]);
    }

    // Orphan demo logins (soft-deleted company / email left behind)
    await client.query(
      `DELETE FROM user_capability_overrides o
         USING users u
        WHERE o.user_id = u.id
          AND LOWER(u.email) IN (LOWER($1), LOWER($2))`,
      [HR_EMAIL, DIR_EMAIL]
    );
    await client.query(
      `DELETE FROM users WHERE LOWER(email) IN (LOWER($1), LOWER($2))`,
      [HR_EMAIL, DIR_EMAIL]
    );

    // Fixed demo tokens left behind (soft-deleted company / partial seed)
    const tokenLike = '%todosdados%';
    await client.query(`DELETE FROM company_links WHERE token LIKE $1`, [tokenLike]);
    await client.query(`DELETE FROM vacancy_links WHERE token LIKE $1`, [tokenLike]);
    await client.query(`DELETE FROM candidate_invites WHERE token LIKE $1`, [tokenLike]);
    await client.query(`DELETE FROM ae_invites WHERE token LIKE $1`, [tokenLike]);
    await deleteIfExists(client, `DELETE FROM vacancy_report_shares WHERE token LIKE $1`, [tokenLike]);
    await deleteIfExists(client, `DELETE FROM employee_portal_tokens WHERE token LIKE $1`, [tokenLike]);
    await deleteIfExists(client, `DELETE FROM climate_survey_invites WHERE token LIKE $1`, [tokenLike]);
    await deleteIfExists(client, `DELETE FROM team_pulse_invites WHERE token LIKE $1`, [tokenLike]);
    await deleteIfExists(client, `DELETE FROM performance_side_reviews WHERE token LIKE $1`, [tokenLike]);
    await deleteIfExists(client, `DELETE FROM whistleblowing_channels WHERE token LIKE $1`, [tokenLike]);
    await deleteIfExists(client, `DELETE FROM interview_prep_links WHERE token LIKE $1`, [tokenLike]);
    await deleteIfExists(client, `DELETE FROM feedback_requests WHERE token LIKE $1`, [tokenLike]);

    const co = await client.query(
      `INSERT INTO companies (
         name, slug, active, deleted, anniversary_date,
         website, about_html, public_profile_enabled, logo_url
       ) VALUES ($1, $2, TRUE, FALSE, $3::date, $4, $5, TRUE, NULL)
       RETURNING id`,
      [
        COMPANY_NAME,
        SLUG,
        calendarYmd(5, 12),
        'https://www.todososdados.demo',
        '<p><strong>Todos os Dados</strong> é a empresa demo do 30Grow para apresentações.</p><p>Recrutamento T1–T9, Motivadores, People e LMS.</p>',
      ]
    );
    const companyId = co.rows[0].id;

    const pwdHash = await bcrypt.hash(PASSWORD, 10);

    const hr = await client.query(
      `INSERT INTO users (company_id, email, password_hash, role, locale, display_name, active, deleted)
       VALUES ($1, $2, $3, 'hr', 'pt-BR', 'RH Todos os Dados', TRUE, FALSE)
       RETURNING id`,
      [companyId, HR_EMAIL, pwdHash]
    );
    const hrUserId = hr.rows[0].id;

    const dir = await client.query(
      `INSERT INTO users (company_id, email, password_hash, role, locale, display_name, active, deleted)
       VALUES ($1, $2, $3, 'direction', 'pt-BR', 'Direção Todos os Dados', TRUE, FALSE)
       RETURNING id`,
      [companyId, DIR_EMAIL, pwdHash]
    );
    const dirUserId = dir.rows[0].id;

    // Full assignable module caps (overrides ⇒ capabilitiesCustomized=true)
    for (const uid of [hrUserId, dirUserId]) {
      for (const cap of ASSIGNABLE_CAPS) {
    await client.query(
          `INSERT INTO user_capability_overrides (user_id, capability, granted) VALUES ($1, $2, TRUE)`,
          [uid, cap]
        );
      }
    }

    await client.query(
      `INSERT INTO company_links (company_id, token, active, expires_at, require_candidate_email)
       VALUES ($1, $2, TRUE, NOW() + INTERVAL '365 days', TRUE)`,
      [companyId, TOK.company]
    );

    const areasRes = await client.query(`SELECT id, key, label FROM areas ORDER BY id`);
    const areaByKey = Object.fromEntries(areasRes.rows.map((a) => [a.key, a]));
    const fallbackArea = areasRes.rows[0];

    const defRes = await client.query(
      `SELECT id FROM ae_definitions WHERE LOWER(slug) = 'motivators' AND active = TRUE LIMIT 1`
    );
    const motivatorsDefId = defRes.rows[0]?.id || null;

    // Vaga aberta (recrutamento — mostra pretensão no /r)
    let jobRoleId = null;
    try {
      const roleIns = await client.query(
        `INSERT INTO job_roles (
           company_id, name, description, rubric, active,
           market_salary_min, market_salary_max
         )
         VALUES ($1, $2, $3, $4::jsonb, TRUE, $5, $6) RETURNING id`,
        [
          companyId,
          'Engenheiro(a) de Plataforma',
          'Cargo demo vinculado à vaga fullstack.',
          JSON.stringify({ 5: 3, 1: 2, 6: 2, 3: 1 }),
          '11000.00',
          '16000.00',
        ]
      );
      jobRoleId = roleIns.rows[0].id;
    } catch (_) {
      /* job_roles optional on older DBs */
    }

    const vacOpen = await client.query(
      `INSERT INTO vacancies (
         company_id, title, slug, status, positions_count, target_date, deleted,
         description, salary_min, salary_max, client_report_show_salary,
         employment_type, workplace_modality, workplace_city, workplace_state,
         public_page_enabled, job_role_id
       ) VALUES (
         $1, $2, $3, 'open', 2, (CURRENT_DATE + 21), FALSE,
         $4, $5, $6, TRUE,
         'clt', 'hybrid', 'São Paulo', 'SP',
         TRUE, $7
       ) RETURNING id`,
      [
        companyId,
        'Engenheiro(a) Fullstack: Plataforma',
        'engenheiro-fullstack-plataforma',
        '<p><strong>Missão:</strong> evoluir o produto 30Grow (Next.js + Postgres).</p><ul><li>React / Node</li><li>SQL e performance</li><li>Cultura de entrega com qualidade</li></ul>',
        '14000.00',
        '22000.00',
        jobRoleId,
      ]
    );
    const vacancyOpenId = vacOpen.rows[0].id;

    await client.query(
      `INSERT INTO vacancy_links (vacancy_id, token, active, expires_at, require_candidate_email)
       VALUES ($1, $2, TRUE, NOW() + INTERVAL '180 days', TRUE)`,
      [vacancyOpenId, TOK.vacancyOpen]
    );

    await client.query(
      `INSERT INTO vacancy_rubrics (vacancy_id, desired_type_weights, notes)
       VALUES ($1, $2::jsonb, $3)
       ON CONFLICT (vacancy_id) DO UPDATE SET
         desired_type_weights = EXCLUDED.desired_type_weights,
         notes = EXCLUDED.notes,
         updated_at = NOW()`,
      [
        vacancyOpenId,
        JSON.stringify({ 5: 3, 1: 2, 6: 2, 3: 1 }),
        '<p>Priorizar <strong>T5/T1/T6</strong> (análise + processo). T3 como executor complementar.</p>',
      ]
    );

    // Vaga fechada (outsourcing — pretensão oculta) + prazo passado (notificação)
    const vacClosed = await client.query(
      `INSERT INTO vacancies (
         company_id, title, slug, status, positions_count, target_date, deleted,
         description, salary_min, salary_max, client_report_show_salary,
         employment_type, workplace_modality, public_page_enabled
       ) VALUES (
         $1, $2, $3, 'closed', 1, (CURRENT_DATE - 3), FALSE,
         $4, $5, $6, FALSE,
         'clt', 'remote', FALSE
       ) RETURNING id`,
      [
        companyId,
        'Analista de Dados (encerrada)',
        'analista-dados-encerrada',
        '<p>Vaga encerrada: útil para validar status closed e notificação.</p>',
        '8000.00',
        '12000.00',
      ]
    );
    const vacancyClosedId = vacClosed.rows[0].id;

    await client.query(
      `INSERT INTO vacancy_links (vacancy_id, token, active, expires_at)
       VALUES ($1, $2, FALSE, NOW() - INTERVAL '1 day')`,
      [vacancyClosedId, TOK.vacancyClosed]
    );

    const created = [];

    async function insertPerson(p, { employee }) {
      const area = areaByKey[p.areaKey] || fallbackArea;
      const scores = p.scores || makeScoresBiased(p.topType);
      const email = p.isCollaboratorLogin
        ? COLAB_EMAIL
        : `${p.key.replace(/[^a-z]/g, '')}@${DOMAIN}`;
      const hrNotes = employee
        ? `<p><strong>Colaborador demo T${p.topType}.</strong> Dados completos para Equipe / Comparar / 1:1.</p>`
        : p.interviewNotes ||
          `<p><strong>Candidato — ${p.vacancyStage || p.pipeline}.</strong> Pipeline de validação.</p>`;

      const cand = await client.query(
        `INSERT INTO candidates (
           company_id, full_name, email, phone, linkedin_url, city, state,
           salary_expectation, availability, source, consent_at,
           employment_status, hired_at, start_date, birth_date, hr_notes
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10, NOW() - INTERVAL '20 days',
           $11, $12::timestamptz, $13::date, $14::date, $15
         ) RETURNING id`,
        [
          companyId,
          p.fullName,
          email,
          p.phone || null,
          p.linkedin || `https://linkedin.com/in/${p.key}-todosdados`,
          p.city || null,
          p.state || null,
          p.salary || null,
          p.availability || (employee ? 'immediate' : null),
          p.source || (employee ? 'referral' : 'linkedin'),
          employee ? 'employee' : 'candidate',
          employee ? new Date(Date.now() - 100 * 86400000).toISOString() : null,
          employee ? p.startDate || calendarYmd(p.workAnnivInDays ?? 40, p.tenureYears ?? 2) : null,
          employee ? p.birthDate || calendarYmd(p.birthInDays ?? 20, p.ageYears ?? 32) : null,
          hrNotes,
        ]
      );
      const candidateId = cand.rows[0].id;
      const employeeStartDate = employee
        ? p.startDate || calendarYmd(p.workAnnivInDays ?? 40, p.tenureYears ?? 2)
        : null;

      const assVacancyId = employee ? null : vacancyOpenId;
      const ass = await client.query(
        `INSERT INTO assessments (
           candidate_id, company_id, area_id, top_type, scores, source,
           vacancy_id, pipeline_stage, rejection_reason, hired_at, start_date,
           fill_duration_ms, copy_event_count, created_at
         ) VALUES (
           $1,$2,$3,$4,$5::jsonb,$6,
           $7,$8,$9,
           $10::timestamptz, $11::date,
           $12, $13, NOW() - ($14 || ' days')::interval
         ) RETURNING id`,
        [
          candidateId,
          companyId,
          area.id,
          p.topType,
          JSON.stringify(scores),
          SOURCE,
          assVacancyId,
          employee ? 'hired' : p.pipeline || 'test_completed',
          p.rejectionReason || null,
          employee ? new Date(Date.now() - 100 * 86400000).toISOString() : null,
          employeeStartDate,
          150000 + Math.floor(Math.random() * 100000),
          employee ? 0 : Math.floor(Math.random() * 3),
          String(employee ? 60 + Math.floor(Math.random() * 30) : 3 + Math.floor(Math.random() * 12)),
        ]
      );
      const assessmentId = ass.rows[0].id;

      if (employee) {
        await client.query(
          `INSERT INTO assessment_pipeline_history
             (assessment_id, from_stage, to_stage, changed_by_user_id, changed_at)
           VALUES
             ($1, 'new', 'interview', $2, NOW() - INTERVAL '110 days'),
             ($1, 'interview', 'test_completed', $2, NOW() - INTERVAL '105 days'),
             ($1, 'test_completed', 'screening', $2, NOW() - INTERVAL '102 days'),
             ($1, 'screening', 'approved', $2, NOW() - INTERVAL '101 days'),
             ($1, 'approved', 'hired', $2, NOW() - INTERVAL '100 days')`,
          [assessmentId, hrUserId]
        );
      }

      let vacancyCandidateId = null;
      if (!employee) {
        const vc = await client.query(
          `INSERT INTO vacancy_candidates (
             vacancy_id, candidate_id, company_id, interview_notes, pipeline_stage,
             rejection_reason, created_by_user_id
           ) VALUES ($1,$2,$3,$4,$5,$6,$7)
           RETURNING id`,
          [
            vacancyOpenId,
            candidateId,
            companyId,
            p.interviewNotes ||
              `<p>Notas de entrevista — estágio <strong>${p.vacancyStage}</strong>.</p>`,
            p.vacancyStage || p.pipeline || 'interview',
            p.rejectionReason || null,
            hrUserId,
          ]
        );
        vacancyCandidateId = vc.rows[0].id;
      }

      let attemptId = null;
      let motivatorsTop = [];
      let dimensionScores = null;
      if (p.motivators && motivatorsDefId) {
        const payload = motivatorsPayload(p.motivators);
        dimensionScores = payload.dimensionScores;
        motivatorsTop = motivatorsTopFromKeys(p.motivators, dimensionScores);
        const ae = await client.query(
          `INSERT INTO ae_attempts (
             definition_id, company_id, candidate_id, area_id, status,
             started_at, completed_at, dimension_scores, ranking, profile_summary,
             manager_recommendations, algorithm_version
           ) VALUES (
             $1,$2,$3,$4,'completed',
             NOW() - INTERVAL '10 days', NOW() - INTERVAL '10 days',
             $5::jsonb, $6::jsonb, $7, $8, $9
           ) RETURNING id`,
          [
            motivatorsDefId,
            companyId,
            candidateId,
            area.id,
            JSON.stringify(payload.dimensionScores),
            JSON.stringify(payload.ranking),
            `Demo Todos os Dados: tende a buscar ${p.motivators.slice(0, 2).join(' e ')}.`,
            JSON.stringify({
              do: [`Alinhar expectativas em torno de ${p.motivators[0]}`],
              avoid: ['Rotular a pessoa só pelo tipo predominante'],
            }),
            AE_SCORING_ENGINE_VERSION,
          ]
        );
        attemptId = ae.rows[0].id;
      }

      if (employee) {
        await client.query(
          `INSERT INTO one_on_ones (
             company_id, candidate_id, meeting_date, notes, next_steps, created_by_user_id
           ) VALUES (
             $1,$2, CURRENT_DATE - $3::int, $4, $5, $6
           )`,
          [
            companyId,
            candidateId,
            String(2 + (p.topType % 5)),
            `<p>1:1 com ${p.fullName} (T${p.topType}).</p><ul><li>Prioridades do trimestre</li><li>Colaboração no time</li></ul>`,
            `<p>Revisitar em 2 semanas; validar hipóteses de gestão.</p>`,
            hrUserId,
          ]
        );
      }

      return {
        ...p,
        email,
        candidateId,
        assessmentId,
        attemptId,
        vacancyCandidateId,
        scores,
        motivatorsTop,
        areaLabel: area.label,
        areaId: area.id,
      };
    }

    for (const p of EMPLOYEES) {
      created.push(await insertPerson(p, { employee: true }));
    }
    for (const p of APPLICANTS) {
      created.push(await insertPerson(p, { employee: false }));
    }

    // Convite eneagrama (sent) — nina
    const nina = created.find((c) => c.key === 'nina');
    if (nina) {
      await client.query(
        `INSERT INTO candidate_invites (
           vacancy_id, company_id, candidate_name, candidate_email, token, status,
           sent_at, candidate_id, created_by_user_id
         ) VALUES (
           $1,$2,$3,$4,$5,'sent', NOW() - INTERVAL '2 days', $6, $7
         )`,
        [vacancyOpenId, companyId, nina.fullName, nina.email, TOK.candInvite, nina.candidateId, hrUserId]
      );
    }

    // Convite Motivadores aberto (pending)
    if (motivatorsDefId && nina) {
      await client.query(
        `INSERT INTO ae_invites (
           definition_id, company_id, candidate_id, candidate_name, candidate_email,
           token, status, expires_at, created_by_user_id
         ) VALUES (
           $1,$2,$3,$4,$5,$6,'sent', NOW() + INTERVAL '30 days', $7
         )`,
        [
          motivatorsDefId,
          companyId,
          nina.candidateId,
          nina.fullName,
          nina.email,
          TOK.aeInvite,
          hrUserId,
        ]
      );
    }

    // Relatório /r rico (shortlist: Pedro + Lara advance, Marina discuss)
    const RUBRIC_WEIGHTS = normalizeReportWeights({ 5: 3, 1: 2, 6: 2, 3: 1 });
    const reportKeys = ['pedro', 'lara', 'marina'];
    const executiveNoteRaw = `<p><strong>Quem avançar:</strong> Pedro Henrique Santos (T5) e Lara Mendonça (T1) — aderência à rubrica (análise + processo) e maturidade de entrega.</p>
<p><strong>Por quê (fit / contexto da vaga):</strong> A vaga Engenheiro(a) Fullstack — Plataforma prioriza T5/T1/T6. Pedro lidera em perfil investigativo; Lara complementa qualidade. Marina Duarte (T3) em conversar: boa execução, validar ritmo vs processo.</p>
<p><strong>Alertas / pontos a explorar na entrevista:</strong> Pedro — profundidade sem travar o sprint. Lara — colaboração com times mais “atalho”. Marina — decisão sob pressão e documentação.</p>
<p><strong>Próximo passo sugerido:</strong> Agendar entrevistas técnicas com o time do cliente para Pedro e Lara; segunda passagem com Marina se houver capacidade. Gustavo fora (gap técnico); Otávio em banco interno.</p>`;
    const vacancyDesc =
      '<p><strong>Missão:</strong> evoluir o produto 30Grow (Next.js + Postgres) com qualidade e previsibilidade.</p><ul><li>React / Node em produto multi-tenant</li><li>SQL, índices e performance em listagens</li><li>Cultura de entrega com revisão e documentação</li></ul>';
    const note = sanitizeRichTextHtml(executiveNoteRaw, 8000);
    const description = sanitizeRichTextHtml(vacancyDesc, 12000);
    const weightedTypes = rubricWeightedTypes(RUBRIC_WEIGHTS);

    const snapshot = {
      generatedAt: new Date().toISOString(),
      vacancy: {
        id: Number(vacancyOpenId),
        title: 'Engenheiro(a) Fullstack: Plataforma',
        companyName: COMPANY_NAME,
        positionsCount: 2,
        status: 'open',
        description: description && !isRichTextEmpty(description) ? description : null,
      },
      privacy: { showSalaryExpectation: true },
      rubricSummary: {
        hasRubric: weightedTypes.length > 0,
        weightedTypes,
        notes: 'Priorizar T5/T1/T6 (análise + processo). T3 como executor complementar.',
      },
      executiveNote: note && !isRichTextEmpty(note) ? note : null,
      candidates: reportKeys
        .map((key) => created.find((c) => c.key === key))
        .filter(Boolean)
        .map((p) => {
          const fit = computeAreaScore010(p.scores, RUBRIC_WEIGHTS);
          const align = fitTypeAlignment(p.scores, RUBRIC_WEIGHTS);
          const baseRec = p.recommendation || recommendationFromStage(p.vacancyStage || p.pipeline);
          return {
            name: p.fullName,
            topType: p.topType,
            scores: p.scores,
            pipelineStage: p.vacancyStage || p.pipeline,
            recommendation: normalizeRecommendation(p.recommendation, baseRec),
            why: p.why || null,
            watchOut: p.watchOut || null,
            interviewProbe: p.interviewProbe || null,
            consultantNote: null,
            city: p.city || null,
            state: p.state || null,
            salaryExpectation: p.salary || null,
            availability: p.availability || null,
            areaLabel: p.areaLabel || 'Tecnologia',
            vacancyFitScore010: fit.score010,
            vacancyFitLabel: fit.label,
            fitAlignedTypes: align.alignedTypes,
            fitGapTypes: align.gapTypes,
            motivatorsTop: p.motivatorsTop || [],
          };
        }),
    };

    await client.query(
      `INSERT INTO vacancy_report_shares (
         vacancy_id, company_id, token, title, executive_note, snapshot,
         active, expires_at, created_by_user_id
       ) VALUES (
         $1,$2,$3,$4,$5,$6::jsonb, TRUE, NOW() + INTERVAL '30 days', $7
       )`,
      [
        vacancyOpenId,
        companyId,
        TOK.report,
        'Shortlist: Fullstack Plataforma',
        snapshot.executiveNote,
        JSON.stringify(snapshot),
        hrUserId,
      ]
    );

    // Notificações do gestor: inseridas no fim (após LMS / interview IDs).
    const pedro = created.find((c) => c.key === 'pedro');
    const elena = created.find((c) => c.key === 'elena');

    await client.query(
      `INSERT INTO audit_log (actor_user_id, action, target_type, target_id, metadata)
       VALUES ($1, 'demo_seed_todos_os_dados', 'company', $2, $3::jsonb)`,
      [hrUserId, String(companyId), JSON.stringify({ slug: SLUG, people: created.length })]
    ).catch(() => {});

    const employees = created.filter((p) => EMPLOYEES.some((e) => e.key === p.key));
    const colaborador = created.find((p) => p.key === 'colaborador');
    const marina = created.find((c) => c.key === 'marina');

    // Collaborator password + prep + portal /e
    if (colaborador) {
      await client.query(
        `UPDATE candidates
            SET password_hash = $1,
                preferred_locale = 'pt-BR',
                one_on_one_prep_at = NOW() - INTERVAL '2 days',
                one_on_one_prep_note = $2
          WHERE id = $3 AND company_id = $4`,
        [
          pwdHash,
          'Prep 1:1: quero alinhar prioridades do trimestre e PDI.',
          colaborador.candidateId,
          companyId,
        ]
      ).catch(() => {});
      await deleteIfExists(
        client,
        `INSERT INTO employee_portal_tokens (
           company_id, candidate_id, token, expires_at, created_by_user_id,
           prepared_at, note_to_manager, last_seen_at
         ) VALUES ($1,$2,$3, NOW() + INTERVAL '180 days', $4,
           NOW() - INTERVAL '2 days', 'Prep via portal: prioridades e PDI.',
           NOW() - INTERVAL '6 hours')`,
        [companyId, colaborador.candidateId, TOK.employeePortal, hrUserId]
      );
    }

    // Benefits + Academy
    let resourceId = null;
    try {
      await client.query(
        `INSERT INTO benefit_categories (company_id, name, active, created_by_user_id) VALUES
           ($1,'Alimentação',TRUE,$2),($1,'Saúde',TRUE,$2),
           ($1,'Qualidade de Vida',TRUE,$2),($1,'Financeiro',TRUE,$2)`,
        [companyId, hrUserId]
      );
      await client.query(
        `INSERT INTO company_benefits (
           company_id, name, description, category, category_id, benefit_type, active, created_by_user_id
         )
         SELECT $1, v.name, v.description, c.name, c.id, v.benefit_type, TRUE, $2
         FROM (VALUES
           ('VR / VA', '<p>Auxílio alimentação demo.</p>', 'Alimentação', 'meal_voucher'),
           ('Plano de saúde', '<p>Cobertura médico-hospitalar demo.</p>', 'Saúde', 'health'),
           ('Gympass', '<p>Academias e bem-estar (demo).</p>', 'Qualidade de Vida', 'gym'),
           ('Previdência', '<p>Contribuição parcial (demo).</p>', 'Financeiro', 'retirement')
         ) AS v(name, description, cat_name, benefit_type)
         JOIN benefit_categories c
           ON c.company_id = $1 AND LOWER(btrim(c.name)) = LOWER(btrim(v.cat_name))`,
        [companyId, hrUserId]
      );
      const resIns = await client.query(
        `INSERT INTO learning_resources (
           company_id, title, description, url, theme, resource_type, duration_hours, active, created_by_user_id
         ) VALUES
           ($1,'Feedback eficaz','<p>Como dar e receber feedback.</p>','https://example.com/feedback',
            'Liderança, Comunicação','article',2,TRUE,$2),
           ($1,'SQL para gestores','<p>Consultas básicas.</p>','https://example.com/sql',
            'Técnico, Dados','course',4,TRUE,$2),
           ($1,'Onboarding do time','<p>Checklist das primeiras semanas.</p>','https://example.com/onboarding',
            'Onboarding, Cultura, Liderança','workshop',3,TRUE,$2)
         RETURNING id`,
        [companyId, hrUserId]
      );
      resourceId = resIns.rows[0]?.id || null;
    } catch (_) {
      /* optional catalogs */
    }

    // Performance + succession + exits
    let cycleId = null;
    let critId = null;
    try {
      const cy = await client.query(
        `INSERT INTO performance_cycles (
           company_id, title, description, status, period_start, period_end, created_by_user_id,
           allow_self_review, allow_peer_review
         ) VALUES ($1,$2,$3,'active', CURRENT_DATE - 60, CURRENT_DATE + 30, $4, TRUE, TRUE)
         RETURNING id`,
        [companyId, 'Ciclo Todos os Dados 2026-H1', 'Ciclo demo com self/peer.', hrUserId]
      );
      cycleId = cy.rows[0].id;
      const cr = await client.query(
        `INSERT INTO critical_roles (
           company_id, title, description, area_key, impact_level, active, created_by_user_id
         ) VALUES ($1,'Tech Lead Plataforma','Papel crítico demo.','engineering','critical',TRUE,$2)
         RETURNING id`,
        [companyId, hrUserId]
      );
      critId = cr.rows[0].id;
    } catch (_) {
      /* optional */
    }

    // Alumni exits
    try {
      for (const alum of [
        {
          name: 'Ex Colaborador Demo',
          email: `alumni01@${DOMAIN}`,
          top: 6,
          type: 'voluntary',
          reason: 'career_growth',
          days: 40,
          tenure: 400,
        },
        {
          name: 'Marina Alves Ex',
          email: `alumni02@${DOMAIN}`,
          top: 3,
          type: 'involuntary',
          reason: 'performance',
          days: 90,
          tenure: 500,
        },
      ]) {
        const ac = await client.query(
          `INSERT INTO candidates (
             company_id, full_name, email, phone, city, state, availability, source, consent_at,
             employment_status, hired_at, start_date, hr_notes
           ) VALUES ($1,$2,$3,$4,'São Paulo','SP','immediate','referral', NOW() - ($5||' days')::interval,
             'alumni', NOW() - ($5||' days')::interval, CURRENT_DATE - $5::int, $6)
           RETURNING id`,
          [
            companyId,
            alum.name,
            alum.email,
            '+55 11 90000-0099',
            String(alum.tenure),
            `<p>Alumni demo (${alum.type}).</p>`,
          ]
        );
        const alumId = ac.rows[0].id;
        const areaId = (fallbackArea && fallbackArea.id) || employees[0]?.areaId;
        await client.query(
          `INSERT INTO assessments (
             candidate_id, company_id, area_id, top_type, scores, source, pipeline_stage,
             hired_at, start_date, fill_duration_ms
           ) VALUES ($1,$2,$3,$4,$5::jsonb,$6,'hired',
             NOW() - ($7||' days')::interval, CURRENT_DATE - $7::int, 180000)`,
          [
            alumId,
            companyId,
            areaId,
            alum.top,
            JSON.stringify({ 1: 12, 2: 11, 3: 14, 4: 10, 5: 15, 6: 28, 7: 9, 8: 13, 9: 11 }),
            SOURCE,
            String(alum.tenure),
          ]
        );
        await client.query(
          `INSERT INTO exit_records (
             candidate_id, company_id, exit_date, exit_type, exit_reason, notes, created_by_user_id
           ) VALUES ($1,$2, CURRENT_DATE - $3::int, $4, $5, $6, $7)`,
          [
            alumId,
            companyId,
            String(alum.days),
            alum.type,
            alum.reason,
            `<p>Saída <strong>${alum.type}</strong> (demo).</p>`,
            hrUserId,
          ]
        );
      }
    } catch (_) {
      /* optional */
    }

    // People package for every employee (PDI, chegada, reviews, HR score)
    let lastPlanItemId = null;
    let lastPlanId = null;
    const peopleTargets = employees;
    for (let i = 0; i < peopleTargets.length; i += 1) {
      const emp = peopleTargets[i];
      const start = emp.startDate || calendarYmd(-(90 + i * 11), 0);
      try {
        const plan = await client.query(
          `INSERT INTO development_plans (
             company_id, candidate_id, title, objective, status,
             period_start, period_end, created_by_user_id
           ) VALUES ($1,$2,$3,$4,'active', CURRENT_DATE - 45, CURRENT_DATE + 90, $5)
           RETURNING id`,
          [
            companyId,
            emp.candidateId,
            `PDI Demo: ${emp.fullName.split(' ')[0]}`,
            'Plano ativo para apresentação.',
            hrUserId,
          ]
        );
        lastPlanId = plan.rows[0].id;
        const item = await client.query(
          `INSERT INTO development_plan_items (
             plan_id, company_id, title, notes, status, source, sort_order, due_date, owner_label
           ) VALUES ($1,$2,$3,'Item demo.',$4,'manual',0, CURRENT_DATE + 21, 'Gestor')
           RETURNING id`,
          [
            lastPlanId,
            companyId,
            'Consolidar rituais de feedback',
            i < 3 ? 'done' : i < 5 ? 'doing' : 'todo',
          ]
        );
        lastPlanItemId = item.rows[0].id;
        if (resourceId) {
          await client.query(
            `INSERT INTO development_plan_resource_links (plan_item_id, resource_id)
             VALUES ($1,$2) ON CONFLICT DO NOTHING`,
            [lastPlanItemId, resourceId]
          ).catch(() => {});
        }
        await client.query(
          `INSERT INTO employee_pre_onboarding_items (
             company_id, candidate_id, item_key, due_date, status, completed_at, completed_by_user_id,
             meet_url, employee_ack_at
           ) VALUES
             ($1,$2,'welcome_kit', $3::date - 3, 'done', NOW() - INTERVAL '10 days', $4, NULL, NOW() - INTERVAL '9 days'),
             ($1,$2,'access_sheet', $3::date - 2, 'done', NOW() - INTERVAL '9 days', $4, NULL, $5),
             ($1,$2,'rh_onboarding_call', $3::date - 1, 'done', NOW() - INTERVAL '8 days', $4, $6, NOW() - INTERVAL '8 days'),
             ($1,$2,'manager_onboarding', $3::date, 'done', NOW() - INTERVAL '7 days', $4, $7, $5)`,
          [
            companyId,
            emp.candidateId,
            start,
            hrUserId,
            emp.key === 'colaborador' ? new Date().toISOString() : null,
            `https://meet.google.com/demo-rh-${i}`,
            `https://meet.google.com/demo-mgr-${i}`,
          ]
        );
        await client.query(
          `INSERT INTO employee_onboarding_checkins (
             company_id, candidate_id, milestone_days, due_date, status, outcome, notes,
             completed_at, completed_by_user_id, meet_url, employee_ack_at
           ) VALUES
             ($1,$2,30, $3::date + 30, 'done', 'pass', '<p>D30 ok.</p>', NOW() - INTERVAL '50 days', $4,
              'https://meet.google.com/demo-d30', NOW() - INTERVAL '50 days'),
             ($1,$2,60, $3::date + 60, 'done', 'extend', '<p>D60: reforçar autonomia.</p>',
              NOW() - INTERVAL '20 days', $4, NULL, NULL),
             ($1,$2,90, $3::date + 90, 'pending', '', '', NULL, NULL, NULL, NULL)`,
          [companyId, emp.candidateId, start, hrUserId]
        );
        if ([1, 4].includes(i) || emp.key === 'colaborador') {
          await client.query(
            `INSERT INTO retention_followups (
               company_id, candidate_id, plan_id, signal_keys, explanation,
               suggested_question, review_due, created_by_user_id
             ) VALUES ($1,$2,$3,$4,$5,$6, CURRENT_DATE + 10, $7)`,
            [
              companyId,
              emp.candidateId,
              lastPlanId,
              ['climate_low', 'pdi_delayed'],
              'Sinais leves de retenção (demo).',
              'O que mais ajudaria você neste trimestre?',
              hrUserId,
            ]
          );
        }
        await client.query(
          `INSERT INTO hr_scores (company_id, candidate_id, score, signals, turnover_risk, calculated_at)
           VALUES ($1,$2,$3,$4::jsonb,$5, NOW())
           ON CONFLICT (candidate_id) DO NOTHING`,
          [
            companyId,
            emp.candidateId,
            55 + ((i * 7) % 40),
            JSON.stringify({ note: 'demo_todos_os_dados' }),
            i % 3 === 0 ? 'medium' : 'low',
          ]
        ).catch(() => {});
        if (cycleId) {
          const goal = await client.query(
            `INSERT INTO performance_goals (
               cycle_id, company_id, candidate_id, title, description, weight, sort_order
             ) VALUES ($1,$2,$3,'Entregar iniciativas do trimestre','Meta demo.',100,0)
             RETURNING id`,
            [cycleId, companyId, emp.candidateId]
          );
          const goalId = goal.rows[0].id;
          await client.query(
            `INSERT INTO performance_reviews (
               cycle_id, company_id, candidate_id, reviewer_user_id, outcomes,
               overall_notes, status, submitted_at,
               overall_score, nine_box_cell, calibrated_at, calibrated_by_user_id, calibration_notes
             ) VALUES ($1,$2,$3,$4,$5::jsonb,$6,'submitted', NOW() - ($7||' days')::interval,
               $8, $9, NOW() - ($7||' days')::interval, $4, $10)`,
            [
              cycleId,
              companyId,
              emp.candidateId,
              hrUserId,
              JSON.stringify({ [goalId]: { outcome: i < 3 ? 'exceeded' : 'met', notes: 'Review demo.' } }),
              '<p>Review demo: há indícios de progresso.</p>',
              String(i + 1),
              i < 3 ? 78 + i * 4 : 62 + i,
              i < 3 ? 7 : 5,
              i < 3 ? 'Calibração demo: tendência positiva.' : 'Calibração demo: acompanhar.',
            ]
          );
        }
        if (critId && i < 3) {
          await client.query(
            `INSERT INTO succession_plans (
               critical_role_id, company_id, successor_candidate_id, readiness,
               notes, target_date, created_by_user_id
             ) VALUES ($1,$2,$3,$4,$5, CURRENT_DATE + $6::int, $7)`,
            [
              critId,
              companyId,
              emp.candidateId,
              ['developing', 'ready', 'now'][i],
              'Sucessor demo.',
              String(90 * (i + 1)),
              hrUserId,
            ]
          );
        }
      } catch (_) {
        /* people package best-effort */
      }
    }

    if (cycleId && colaborador) {
      await deleteIfExists(
        client,
        `INSERT INTO performance_side_reviews (
           cycle_id, company_id, candidate_id, role, reviewer_label, token,
           outcomes, overall_notes, status, submitted_at, expires_at
         ) VALUES
           ($1,$2,$3,'self','Autoavaliação','selftodosdadose5f60718293a4b5c6d7e8f0b',
            '{"overall":"met"}'::jsonb, '<p>Self-review demo.</p>', 'submitted',
            NOW() - INTERVAL '3 days', NOW() + INTERVAL '30 days'),
           ($1,$2,$3,'peer','Elena Ferreira',$4,
            '{}'::jsonb, '', 'pending', NULL, NOW() + INTERVAL '30 days')`,
        [cycleId, companyId, colaborador.candidateId, TOK.sidePeer]
      );
    }

    // Climate + eNPS
    try {
      const survey = await client.query(
        `INSERT INTO climate_surveys (
           company_id, title, description, status, opens_at, closes_at, created_by_user_id
         ) VALUES ($1,$2,$3,'open', NOW() - INTERVAL '7 days', NOW() + INTERVAL '30 days', $4)
         RETURNING id`,
        [companyId, 'Clima Todos os Dados 2026', 'Pesquisa aberta (demo).', hrUserId]
      );
      const surveyId = survey.rows[0].id;
      const qL = await client.query(
        `INSERT INTO climate_survey_questions (survey_id, company_id, prompt, question_kind, sort_order)
         VALUES ($1,$2,'Como você avalia o clima da equipe?','likert',0) RETURNING id`,
        [surveyId, companyId]
      );
      const qT = await client.query(
        `INSERT INTO climate_survey_questions (survey_id, company_id, prompt, question_kind, sort_order)
         VALUES ($1,$2,'O que mais ajudaria no dia a dia?','text',1) RETURNING id`,
        [surveyId, companyId]
      );
      const qE = await client.query(
        `INSERT INTO climate_survey_questions (survey_id, company_id, prompt, question_kind, sort_order)
         VALUES ($1,$2,$3,'enps',2) RETURNING id`,
        [
          surveyId,
          companyId,
          'Em uma escala de 0 a 10, quanto você recomendaria a Todos os Dados como lugar para trabalhar?',
        ]
      );
      if (colaborador) {
        await client.query(
          `INSERT INTO climate_survey_invites (survey_id, company_id, token, expires_at, candidate_id)
           VALUES ($1,$2,$3, NOW() + INTERVAL '60 days', $4)`,
          [surveyId, companyId, TOK.climate, colaborador.candidateId]
        );
      }
      for (let i = 1; i <= 4; i += 1) {
        const inv = await client.query(
          `INSERT INTO climate_survey_invites (survey_id, company_id, token, expires_at, used_at)
           VALUES ($1,$2,$3, NOW() + INTERVAL '60 days', NOW() - ($4||' days')::interval)
           RETURNING id`,
          [surveyId, companyId, `clim${String(i).padStart(2, '0')}todosdadose5f60718293a4b5c6`, String(i)]
        );
        await client.query(
          `INSERT INTO climate_survey_responses (survey_id, company_id, invite_id, answers, submitted_at)
           VALUES ($1,$2,$3,$4::jsonb, NOW() - ($5||' days')::interval)`,
          [
            surveyId,
            companyId,
            inv.rows[0].id,
            JSON.stringify({
              [qL.rows[0].id]: 2 + (i % 4),
              [qT.rows[0].id]: `Resposta anônima demo #${i}`,
              [qE.rows[0].id]: 6 + (i % 5),
            }),
            String(i),
          ]
        );
      }
    } catch (_) {
      /* climate optional */
    }

    // Team group + pulse
    try {
      const memberAss = employees.slice(0, 6).map((e) => e.assessmentId).filter(Boolean);
      if (memberAss.length >= 2) {
        const grp = await client.query(
          `INSERT INTO team_groups (
             company_id, name, base_assessment_id, member_assessment_ids, created_by_user_id
           ) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
          [companyId, 'Núcleo Plataforma', memberAss[0], memberAss.slice(1), hrUserId]
        );
        const teamGroupId = grp.rows[0].id;
        try {
          const obj = await client.query(
            `INSERT INTO okr_objectives (
               company_id, level, title, description, period_start, period_end, created_by_user_id
             ) VALUES ($1,'company','Crescer a plataforma 2026','OKR empresa demo.', CURRENT_DATE - 30, CURRENT_DATE + 150, $2)
             RETURNING id`,
            [companyId, hrUserId]
          );
          const companyObjId = obj.rows[0].id;
          await client.query(
            `INSERT INTO okr_key_results (
               company_id, objective_id, title, unit, current_value, target_value, sort_order
             ) VALUES
               ($1,$2,'NPS interno','pts',42,60,0),
               ($1,$2,'Features shipped','un',8,12,1)`,
            [companyId, companyObjId]
          );
          const teamObj = await client.query(
            `INSERT INTO okr_objectives (
               company_id, parent_id, level, title, description, team_group_id,
               period_start, period_end, created_by_user_id
             ) VALUES ($1,$2,'team','Entregar núcleo plataforma','OKR time demo.',$3,
               CURRENT_DATE - 30, CURRENT_DATE + 150, $4)
             RETURNING id`,
            [companyId, companyObjId, teamGroupId, hrUserId]
          );
          await client.query(
            `INSERT INTO okr_key_results (
               company_id, objective_id, title, unit, current_value, target_value, sort_order
             ) VALUES ($1,$2,'PRs merged','un',24,40,0)`,
            [companyId, teamObj.rows[0].id]
          );
          if (colaborador) {
            const personObj = await client.query(
              `INSERT INTO okr_objectives (
                 company_id, parent_id, level, title, description, candidate_id,
                 period_start, period_end, created_by_user_id
               ) VALUES ($1,$2,'person','Contribuir no núcleo','OKR pessoa demo.',$3,
                 CURRENT_DATE - 30, CURRENT_DATE + 150, $4)
               RETURNING id`,
              [companyId, teamObj.rows[0].id, colaborador.candidateId, hrUserId]
            );
            await client.query(
              `INSERT INTO okr_key_results (
                 company_id, objective_id, title, unit, current_value, target_value, sort_order
               ) VALUES ($1,$2,'Stories done','un',6,10,0)`,
              [companyId, personObj.rows[0].id]
            );
          }
        } catch (_) {
          /* OKR optional if migration missing */
        }
        const pulse = await client.query(
          `INSERT INTO team_pulses (
             company_id, team_group_id, title, status, opens_at, closes_at, created_by_user_id
           ) VALUES ($1,$2,$3,'open', NOW() - INTERVAL '3 days', NOW() + INTERVAL '14 days', $4)
           RETURNING id`,
          [companyId, teamGroupId, 'Pulso: Núcleo Plataforma', hrUserId]
        );
        const pq = await client.query(
          `INSERT INTO team_pulse_questions (pulse_id, company_id, prompt_key, prompt, sort_order)
           VALUES ($1,$2,'energy','Como está sua energia no time nesta semana?',0)
           RETURNING id`,
          [pulse.rows[0].id, companyId]
        );
        if (colaborador) {
          await client.query(
            `INSERT INTO team_pulse_invites (pulse_id, company_id, token, expires_at, candidate_id)
             VALUES ($1,$2,$3, NOW() + INTERVAL '30 days', $4)`,
            [pulse.rows[0].id, companyId, TOK.pulse, colaborador.candidateId]
          );
        }
        for (let i = 1; i <= 3; i += 1) {
          const inv = await client.query(
            `INSERT INTO team_pulse_invites (pulse_id, company_id, token, expires_at, used_at)
             VALUES ($1,$2,$3, NOW() + INTERVAL '30 days', NOW() - ($4||' hours')::interval)
             RETURNING id`,
            [pulse.rows[0].id, companyId, `puls${String(i).padStart(2, '0')}todosdadose5f60718293a4b5c6d`, String(i)]
          );
          await client.query(
            `INSERT INTO team_pulse_responses (pulse_id, company_id, invite_id, answers, submitted_at)
             VALUES ($1,$2,$3,$4::jsonb, NOW() - ($5||' hours')::interval)`,
            [
              pulse.rows[0].id,
              companyId,
              inv.rows[0].id,
              JSON.stringify({ [pq.rows[0].id]: 2 + (i % 4) }),
              String(i),
            ]
          );
        }
      }
    } catch (_) {
      /* groups/pulse optional */
    }

    // LMS expanded
    let courseId = null;
    try {
      const courseIns = await client.query(
        `INSERT INTO lms_courses (company_id, title, description, completion_pct, created_by_user_id)
         VALUES ($1, $2, $3, 100, $4) RETURNING id`,
        [companyId, 'Onboarding cultural (demo)', 'Curso LMS demo: aulas por link.', hrUserId]
      );
      courseId = courseIns.rows[0].id;
      const lessons = await client.query(
        `INSERT INTO lms_lessons (company_id, course_id, title, content_url, content_kind, sort_order)
         VALUES
           ($1, $2, 'Bem-vindo à empresa', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'youtube', 0),
           ($1, $2, 'Como usamos o 30Grow', '/demo/lms-guide.pdf', 'pdf', 1)
         RETURNING id`,
        [companyId, courseId]
      );
      let cohortId = null;
      try {
        const coh = await client.query(
          `INSERT INTO lms_cohorts (company_id, course_id, name, due_date, mandatory, created_by_user_id)
           VALUES ($1,$2,'Turma Onboarding Ago/2026', CURRENT_DATE + 21, TRUE, $3) RETURNING id`,
          [companyId, courseId, hrUserId]
        );
        cohortId = coh.rows[0].id;
      } catch (_) {
        /* cohorts optional */
      }
      const enrollTargets = employees.filter(Boolean);
      for (const emp of enrollTargets) {
        const enr = await client.query(
          `INSERT INTO lms_enrollments (
             company_id, course_id, candidate_id, enrolled_by_user_id, cohort_id, due_date, mandatory
           ) VALUES ($1,$2,$3,$4,$5, CURRENT_DATE + 21, TRUE)
           ON CONFLICT (course_id, candidate_id) DO NOTHING
           RETURNING id`,
          [companyId, courseId, emp.candidateId, hrUserId, cohortId]
        );
        if (enr.rows[0]?.id && emp.key === 'colaborador' && lessons.rows[0]?.id) {
          await client.query(
            `INSERT INTO lms_lesson_completions (company_id, enrollment_id, lesson_id)
             VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
            [companyId, enr.rows[0].id, lessons.rows[0].id]
          ).catch(() => {});
        }
      }
      if (lastPlanItemId && courseId) {
        await client.query(
          `INSERT INTO development_plan_lms_links (plan_item_id, course_id)
           VALUES ($1,$2) ON CONFLICT DO NOTHING`,
          [lastPlanItemId, courseId]
        ).catch(() => {});
      }
    } catch (_) {
      /* LMS optional */
    }

    // Compensation
    if (colaborador) {
      await deleteIfExists(
        client,
        `INSERT INTO employee_compensation_events (
           company_id, candidate_id, event_type, amount, effective_date, notes, created_by_user_id, approval_status
         ) VALUES
           ($1,$2,'hire','12000.00', CURRENT_DATE - 200, '<p>Contratação CLT (demo).</p>', $3, 'approved'),
           ($1,$2,'raise','13200.00', CURRENT_DATE - 40, '<p>Ajuste 10%.</p>', $3, 'approved'),
           ($1,$4,'hire','14000.00', CURRENT_DATE - 300, '<p>Contratação Ana.</p>', $3, 'approved'),
           ($1,$5,'bonus','3000.00', CURRENT_DATE - 20, '<p>Bônus Q2.</p>', $3, 'approved'),
           ($1,$2,'bonus','1500.00', CURRENT_DATE + 15, '<p>Bônus proposto (demo RV).</p>', $3, 'proposed')`,
        [
          companyId,
          colaborador.candidateId,
          hrUserId,
          employees[0]?.candidateId || colaborador.candidateId,
          employees.find((e) => e.key === 'elena')?.candidateId || colaborador.candidateId,
        ]
      );
      if (jobRoleId) {
        const linkIds = [
          colaborador.candidateId,
          employees[0]?.candidateId,
          employees.find((e) => e.key === 'elena')?.candidateId,
        ].filter(Boolean);
        await deleteIfExists(
          client,
          `UPDATE candidates SET job_role_id = $1
           WHERE company_id = $2 AND id = ANY($3::bigint[])`,
          [jobRoleId, companyId, linkIds]
        );
      }
    }

    // Time clock MVP (schedule + today punches)
    if (colaborador) {
      await deleteIfExists(
        client,
        `INSERT INTO company_time_schedules (
           company_id, workday_start, workday_end, break_minutes, timezone, late_grace_minutes, updated_by_user_id
         ) VALUES ($1, '09:00', '18:00', 60, 'America/Sao_Paulo', 10, $2)
         ON CONFLICT (company_id) DO UPDATE SET
           workday_start = EXCLUDED.workday_start,
           workday_end = EXCLUDED.workday_end,
           updated_at = NOW()`,
        [companyId, hrUserId]
      );
      const punchTargets = employees.filter(Boolean);
      for (const emp of punchTargets) {
        await deleteIfExists(
          client,
          `INSERT INTO employee_time_punches (
             company_id, candidate_id, punched_at, punch_kind, source, flag, review_status, notes
           ) VALUES
             ($1,$2, (CURRENT_DATE + TIME '09:12') AT TIME ZONE 'America/Sao_Paulo', 'in', 'web', 'late', 'none', 'Demo entrada'),
             ($1,$2, (CURRENT_DATE + TIME '12:05') AT TIME ZONE 'America/Sao_Paulo', 'out', 'web', NULL, 'ok', 'Demo almoço'),
             ($1,$2, (CURRENT_DATE + TIME '13:05') AT TIME ZONE 'America/Sao_Paulo', 'in', 'web', NULL, 'none', ''),
             ($1,$2, (CURRENT_DATE + TIME '18:02') AT TIME ZONE 'America/Sao_Paulo', 'out', 'web', NULL, 'none', '')`,
          [companyId, emp.candidateId]
        );
      }
    }

    // Interview scorecards + slots
    for (const cand of [pedro, marina].filter(Boolean)) {
      await deleteIfExists(
        client,
        `INSERT INTO interview_scorecards (company_id, vacancy_id, candidate_id, items, created_by_user_id)
         VALUES ($1,$2,$3,$4::jsonb,$5)
         ON CONFLICT (vacancy_id, candidate_id) DO NOTHING`,
        [
          companyId,
          vacancyOpenId,
          cand.candidateId,
          JSON.stringify([
            { prompt: 'Profundidade técnica', score: cand.key === 'pedro' ? 4 : 3 },
            { prompt: 'Comunicação', score: 4 },
          ]),
          hrUserId,
        ]
      );
      await deleteIfExists(
        client,
        `INSERT INTO interview_slots (
           company_id, vacancy_id, candidate_id, starts_at, ends_at, meet_url, status, notes, created_by_user_id
         ) VALUES (
           $1,$2,$3, NOW() + ($4||' days')::interval, NOW() + ($4||' days')::interval + INTERVAL '1 hour',
           $5, 'scheduled', $6, $7
         )`,
        [
          companyId,
          vacancyOpenId,
          cand.candidateId,
          cand.key === 'pedro' ? '3' : '5',
          `https://meet.google.com/demo-${cand.key}`,
          `Entrevista ${cand.fullName}`,
          hrUserId,
        ]
      );
    }

    // Manager + collaborator notifications — one row per catalog type (NOTIF / EMPLOYEE_NOTIF)
    const bruno = created.find((c) => c.key === 'bruno');
    const ana = created.find((c) => c.key === 'ana');
    const iris = created.find((c) => c.key === 'iris');
    const duePast = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
    const dueFuture = new Date(Date.now() + 21 * 86400000).toISOString().slice(0, 10);
    const interviewAt = new Date(Date.now() + 3 * 86400000).toISOString();
    const courseTitle = 'Onboarding cultural (demo)';
    const vacTitleOpen = 'Engenheiro(a) Fullstack: Plataforma';
    const vacTitleClosed = 'Analista de Dados (encerrada)';

    const managerNotifs = [];
    if (pedro) {
      managerNotifs.push({
        type: 'enneagram_completed',
        recipient: hrUserId,
        payload: {
          candidateId: pedro.candidateId,
          assessmentId: pedro.assessmentId,
          candidateName: pedro.fullName,
          topType: pedro.topType,
          vacancyId: vacancyOpenId,
        },
        entityType: 'candidate',
        entityId: pedro.candidateId,
        dedupe: `enneagram:${pedro.candidateId}`,
        hoursAgo: 48,
      });
      managerNotifs.push({
          type: 'motivators_completed',
          recipient: hrUserId,
          payload: {
            candidateId: pedro.candidateId,
          attemptId: pedro.attemptId || undefined,
            candidateName: pedro.fullName,
          },
          entityType: 'candidate',
          entityId: pedro.candidateId,
        dedupe: `motivators:${pedro.candidateId}`,
        hoursAgo: 40,
      });
      managerNotifs.push({
        type: 'interview_scheduled',
        recipient: hrUserId,
        payload: {
          candidateId: pedro.candidateId,
          candidateName: pedro.fullName,
          vacancyId: vacancyOpenId,
          vacancyTitle: vacTitleOpen,
          startsAt: interviewAt,
          targetDate: interviewAt.slice(0, 10),
        },
        entityType: 'vacancy',
        entityId: vacancyOpenId,
        dedupe: `interview:${pedro.candidateId}`,
        hoursAgo: 4,
      });
    }
    if (bruno) {
      managerNotifs.push({
        type: 'retention_watch',
        recipient: hrUserId,
        payload: {
          candidateId: bruno.candidateId,
          candidateName: bruno.fullName,
          signalLabels: 'clima · 1:1 atrasado',
          dims: 'clima · 1:1 atrasado',
        },
        entityType: 'candidate',
        entityId: bruno.candidateId,
        dedupe: `retention:${bruno.candidateId}`,
        hoursAgo: 36,
      });
    }
    if (elena) {
      managerNotifs.push({
        type: 'turnover_risk_change',
        recipient: hrUserId,
        payload: {
          candidateId: elena.candidateId,
          candidateName: elena.fullName,
          from: 'low',
          to: 'medium',
        },
        entityType: 'candidate',
        entityId: elena.candidateId,
        dedupe: `turnover:${elena.candidateId}`,
        hoursAgo: 30,
      });
      managerNotifs.push({
        type: 'enneagram_completed',
        recipient: dirUserId,
        payload: {
          candidateId: elena.candidateId,
          assessmentId: elena.assessmentId,
          candidateName: elena.fullName,
          topType: elena.topType,
        },
        entityType: 'candidate',
        entityId: elena.candidateId,
        dedupe: `enneagram:dir:${elena.candidateId}`,
        hoursAgo: 28,
      });
    }
    if (colaborador) {
      managerNotifs.push({
        type: 'hire_onboarding_kit',
        recipient: hrUserId,
        payload: {
          candidateId: colaborador.candidateId,
          candidateName: colaborador.fullName,
          vacancyTitle: vacTitleOpen,
          benefitsSnippet: 'VR · plano de saúde · home office 2x',
        },
        entityType: 'candidate',
        entityId: colaborador.candidateId,
        dedupe: `hire_kit:${colaborador.candidateId}`,
        hoursAgo: 24,
      });
      managerNotifs.push({
        type: 'lms_overdue',
        recipient: hrUserId,
        payload: {
          candidateId: colaborador.candidateId,
          candidateName: colaborador.fullName,
          courseId,
          courseTitle,
          dueDate: duePast,
        },
        entityType: 'lms_course',
        entityId: courseId,
        dedupe: `lms_overdue_mgr:${colaborador.candidateId}`,
        hoursAgo: 8,
      });
    }
    managerNotifs.push({
      type: 'manager_weekly_digest',
      recipient: hrUserId,
      payload: {
        attentionTotal: 3,
        attentionSummary: '2 retenção · 1 1:1 atrasado',
        retentionCount: 2,
        staleCount: 1,
        retentionNames: [bruno?.fullName, elena?.fullName].filter(Boolean).join(' · ') || '—',
        staleNames: iris?.fullName || 'Íris Campos',
      },
      dedupe: 'weekly_digest:demo',
      hoursAgo: 20,
    });
    managerNotifs.push({
      type: 'manager_weekly_digest',
      recipient: dirUserId,
      payload: {
        attentionTotal: 3,
        attentionSummary: '2 retenção · 1 1:1 atrasado',
        retentionCount: 2,
        staleCount: 1,
        retentionNames: [bruno?.fullName, elena?.fullName].filter(Boolean).join(' · ') || '—',
        staleNames: iris?.fullName || 'Íris Campos',
      },
      dedupe: 'weekly_digest:demo:dir',
      hoursAgo: 19,
    });
    managerNotifs.push({
      type: 'vacancy_deadline_approaching',
      recipient: hrUserId,
      payload: {
        vacancyId: vacancyOpenId,
        vacancyTitle: vacTitleOpen,
        targetDate: dueFuture,
      },
      entityType: 'vacancy',
      entityId: vacancyOpenId,
      dedupe: `vacancy_deadline:${vacancyOpenId}:open`,
      hoursAgo: 16,
    });
    managerNotifs.push({
      type: 'vacancy_deadline_approaching',
      recipient: dirUserId,
      payload: {
        vacancyId: vacancyOpenId,
        vacancyTitle: vacTitleOpen,
        targetDate: dueFuture,
      },
      entityType: 'vacancy',
      entityId: vacancyOpenId,
      dedupe: `vacancy_deadline:${vacancyOpenId}:open`,
      hoursAgo: 15,
    });
    managerNotifs.push({
      type: 'vacancy_closed',
      recipient: hrUserId,
      payload: {
        vacancyId: vacancyClosedId,
        vacancyTitle: vacTitleClosed,
      },
      entityType: 'vacancy',
      entityId: vacancyClosedId,
      dedupe: `vacancy_closed:${vacancyClosedId}`,
      hoursAgo: 12,
    });
    if (courseId) {
      managerNotifs.push({
        type: 'lms_enrolled',
        recipient: hrUserId,
        payload: { courseId, courseTitle, enrolled: employees.length || 8 },
        entityType: 'lms_course',
        entityId: courseId,
        dedupe: `lms_enroll_mgr:${courseId}`,
        hoursAgo: 10,
      });
      if (ana) {
        managerNotifs.push({
          type: 'lms_completed',
          recipient: hrUserId,
      payload: {
            candidateId: ana.candidateId,
            candidateName: ana.fullName,
            courseId,
            courseTitle,
          },
          entityType: 'lms_course',
          entityId: courseId,
          dedupe: `lms_done_mgr:${ana.candidateId}`,
          hoursAgo: 6,
        });
      }
    }

    for (const n of managerNotifs) {
      await client.query(
        `INSERT INTO manager_notifications (
           company_id, recipient_user_id, type, payload,
           entity_type, entity_id, dedupe_key, read_at, created_at
         ) VALUES (
           $1,$2,$3,$4::jsonb,$5,$6,$7,
           $8::timestamptz,
           NOW() - ($9 || ' hours')::interval
         )`,
        [
          companyId,
          n.recipient,
          n.type,
          JSON.stringify(n.payload),
          n.entityType || null,
          n.entityId || null,
          n.dedupe || null,
          n.read ? new Date().toISOString() : null,
          String(n.hoursAgo || 1),
        ]
      );
    }

    if (colaborador) {
      const appUrl = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '');
      const candNotifs = [
        {
          type: 'access_invited',
          payload: {},
          entityType: null,
          entityId: null,
          dedupe: 'access_invited:demo',
          hoursAgo: 120,
        },
        {
          type: 'lms_enrolled',
          payload: { courseTitle, courseId },
          entityType: 'lms_course',
          entityId: courseId,
          dedupe: `lms_enroll:${courseId || 0}`,
          hoursAgo: 48,
        },
        {
          type: 'lms_overdue',
          payload: { courseTitle, courseId, dueDate: duePast },
          entityType: 'lms_course',
          entityId: courseId,
          dedupe: `lms_overdue:${courseId || 0}`,
          hoursAgo: 24,
        },
        {
          type: 'motivators_invite',
          payload: { assessmentUrl: `${appUrl}/assessment/motivators/${TOK.aeInvite}` },
          entityType: 'ae_invite',
          entityId: null,
          dedupe: 'motivators_invite:demo',
          hoursAgo: 18,
        },
        {
          type: 'pdi_updated',
          payload: { planTitle: 'PDI Demo: Lucas', itemTitle: 'Sessão 1:1 com gestor' },
          entityType: 'development_plan',
          entityId: lastPlanId,
          dedupe: `pdi_upd:${lastPlanId || 0}`,
          hoursAgo: 12,
        },
        {
          type: 'generic',
          payload: { message: 'Lembrete demo: revise Minha chegada e confirme o kit D1.' },
          entityType: null,
          entityId: null,
          dedupe: 'generic:demo-arrival',
          hoursAgo: 6,
        },
        {
          type: 'pdi_updated',
          payload: { planTitle: 'PDI Demo: Lucas', itemTitle: 'Prática: feedback no 1:1' },
          entityType: 'development_plan',
          entityId: lastPlanId,
          dedupe: `pdi_upd2:${lastPlanId || 0}`,
          hoursAgo: 4,
        },
        {
          type: 'generic',
          payload: { message: 'Há um novo documento no Espaço do colaborador. Confira quando puder.' },
          entityType: null,
          entityId: null,
          dedupe: 'generic:demo-doc',
          hoursAgo: 2,
        },
        {
          type: 'lms_enrolled',
          payload: { courseTitle: 'Segurança da informação (demo)', courseId },
          entityType: 'lms_course',
          entityId: courseId,
          dedupe: `lms_enroll2:${courseId || 0}`,
          hoursAgo: 1,
        },
        {
          type: 'motivators_invite',
          payload: { assessmentUrl: `${appUrl}/assessment/motivators/${TOK.aeInvite}` },
          entityType: 'ae_invite',
          entityId: null,
          dedupe: 'motivators_invite:demo:remind',
          hoursAgo: 1,
        },
      ];
      for (const n of candNotifs) {
        await deleteIfExists(
          client,
          `INSERT INTO candidate_notifications (
             company_id, recipient_candidate_id, type, payload,
             entity_type, entity_id, dedupe_key, created_at
           ) VALUES (
             $1,$2,$3,$4::jsonb,$5,$6,$7,
             NOW() - ($8 || ' hours')::interval
           )`,
          [
            companyId,
            colaborador.candidateId,
            n.type,
            JSON.stringify(n.payload),
            n.entityType,
            n.entityId,
            n.dedupe,
            String(n.hoursAgo),
          ]
        );
      }
    }

    // Referral + funnel + analytics prefs
    await deleteIfExists(
      client,
      `INSERT INTO referral_codes (company_id, vacancy_id, code, owner_user_id, active, label) VALUES
         ($1,$2,'TOD-FS-2026',$3,TRUE,'Indicação fullstack'),
         ($1,NULL,'TOD-EMPRESA',$3,TRUE,'Empresa geral')`,
      [companyId, vacancyOpenId, hrUserId]
    );
    if (pedro) {
      await deleteIfExists(
        client,
        `INSERT INTO job_funnel_events (
           company_id, vacancy_id, candidate_id, event_type, session_id, source, medium, campaign, referral_code
         ) VALUES
           ($1,$2,NULL,'job_view','sess-demo-1','linkedin','social','fullstack-q3',NULL),
           ($1,$2,NULL,'apply_start','sess-demo-1','linkedin','social','fullstack-q3',NULL),
           ($1,$2,$3,'apply_complete','sess-demo-1','linkedin','social','fullstack-q3','TOD-FS-2026'),
           ($1,$2,$3,'screening','sess-demo-1','linkedin','social','fullstack-q3','TOD-FS-2026')`,
        [companyId, vacancyOpenId, pedro.candidateId]
      );
    }
    await deleteIfExists(
      client,
      `INSERT INTO company_analytics_report_prefs (company_id, frequency, recipient_user_ids, attach_pdf, updated_by)
       VALUES ($1,'weekly',$2,FALSE,$3)
       ON CONFLICT (company_id) DO UPDATE SET frequency = EXCLUDED.frequency, updated_at = NOW()`,
      [companyId, [hrUserId, dirUserId], hrUserId]
    );

    const modulesOut = await seedTodosOsDadosModules(client, {
      companyId,
      hrUserId,
      dirUserId,
    });

    await client.query('COMMIT');

    const appUrl = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '');
    console.log('\n══════════════════════════════════════════════════');
    console.log('  DEMO Todos os Dados pronta (apresentação ≤103)');
    console.log('══════════════════════════════════════════════════');
    console.log(`  Empresa:        ${COMPANY_NAME}  slug=${SLUG}  id=${companyId}`);
    console.log(`  Login HR:       ${HR_EMAIL}`);
    console.log(`  Login Dir:      ${DIR_EMAIL}`);
    console.log(`  Login Colab:    ${COLAB_EMAIL}  → /employee`);
    console.log(`  Senha (todos):  ${PASSWORD}`);
    console.log(`  Pessoas:        ${created.length}`);
    console.log(`  Motivadores:    ${motivatorsDefId ? 'ok' : 'PULAR — npm run db:seed-motivators'}`);
    {
      const hrTypes = [
        ...new Set(managerNotifs.filter((n) => n.recipient === hrUserId).map((n) => n.type)),
      ];
      console.log(
        `  Notifs HR:      ${managerNotifs.filter((n) => n.recipient === hrUserId).length} · ${hrTypes.length} tipos (${hrTypes.join(', ')})`
      );
      if (colaborador) {
        console.log('  Notifs colab:   ~10 no inbox /employee (tipos EMPLOYEE_NOTIF)');
      }
    }
    console.log('');
    console.log('  Links:');
    console.log(`    Painel:        ${appUrl}/login`);
    console.log(`    Colaborador:   ${appUrl}/employee`);
    console.log(`    Empresa /t:    ${appUrl}/t/${TOK.company}`);
    console.log(`    Vaga /v:       ${appUrl}/v/${TOK.vacancyOpen}`);
    console.log(`    Relatório /r:  ${appUrl}/r/${TOK.report}`);
    console.log(`    Portal /e:     ${appUrl}/e/${TOK.employeePortal}`);
    console.log(`    Clima:         ${appUrl}/clima/${TOK.climate}`);
    console.log(`    Pulso:         ${appUrl}/pulso/${TOK.pulse}`);
    if (modulesOut?.whistleToken) {
      console.log(`    Ouvidoria:     ${appUrl}/ouvidoria/${modulesOut.whistleToken}`);
    }
    if (modulesOut?.prepToken) {
      console.log(`    Prep /prep:    ${appUrl}/prep/${modulesOut.prepToken}`);
    }
    if (motivatorsDefId) {
      console.log(`    Motivadores:   ${appUrl}/assessment/motivators/${TOK.aeInvite}`);
    }
    console.log('');
    console.log('  Validar: Overview, Equipe, Comparar, Vagas, Motivadores, 1:1, PDI,');
    console.log('  Clima+eNPS, Pulso, LMS, Performance, Sucessão, Saídas, DP, Mural,');
    console.log('  Ouvidoria, OKRs, ponto/banco de horas, /r, /e, /employee.');
    console.log('══════════════════════════════════════════════════\n');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
