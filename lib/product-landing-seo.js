/**
 * Landpage `/` — copy de vendas (CMO) + SEO/JSON-LD/llms.txt.
 * UI = benefícios e conversão. Detalhe técnico de rotas só em llms.txt (crawlers/IA).
 */

import { BRAND_ASSETS } from './brand.js';
import { localeHtmlLang, localeOpenGraph, normalizeLocale, contentLocale, t } from './i18n.js';
import frenchLandingCopy from './i18n/landing/fr-FR.js';
import germanLandingCopy from './i18n/landing/de-DE.js';
import { PUBLIC_PRICING_MAX_EMPLOYEES, publicPricingCurrency, publicPricingTextValues } from './pricing-currency.js';

export const PRODUCT_LANDING_CONTACT_EMAIL = 'contact@3035tech.com';

function serializeJsonLdForScript(obj) {
  return JSON.stringify(obj).replace(/</g, '\\u003c');
}

function appBaseUrl() {
  return String(process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '');
}

export function productLandingAbsoluteUrl(path = '/') {
  const base = appBaseUrl();
  const p = path.startsWith('/') ? path : `/${path}`;
  return base ? `${base}${p === '/' ? '/' : p}` : p;
}

export function productLandingOgImageUrl() {
  const base = appBaseUrl();
  const path = BRAND_ASSETS.s512 || '/brand/logo-512.png';
  return base ? `${base}${path}` : path;
}

/** Inventário técnico só para llms.txt / machines — não vai na UI de venda. */
const TECHNICAL_FOR_LLMS = {
  modules: [
    'Visão geral',
    'Equipe',
    'Compatibilidade',
    'Comparativo',
    'Grupos',
    'Liderança',
    'Vagas',
    'Cargos',
    'Motivadores',
    'Clima',
    'Ouvidoria',
    'Avaliações / 9Box / calibração',
    'Sucessão',
    'Análise demissional',
    'OKRs',
    'LMS (cursos)',
    'Academia / recursos de aprendizado',
    'Benefícios',
    'Mural / feed',
    'DP (ficha, docs, férias)',
    'Remuneração interna',
    'Empresas (admin)',
    'Usuários (admin)',
    'Guia + assistente',
    'Meu perfil',
    'Hub colaborador (/employee)',
    'App do colaborador (iOS / Android, lançamento em outubro de 2026)',
  ],
  urls: [
    { path: '/', use: 'Product sales landing + early access' },
    { path: '/pricing', use: 'Public plans and early-access pricing (GTM)' },
    { path: '/signup', use: 'Self-serve early access sign-up' },
    { path: '/privacy', use: 'Public privacy policy and data-subject contact' },
    { path: '/terms', use: 'Public terms of use' },
    { path: '/login', use: 'Manager sign-in' },
    { path: '/employee', use: 'Collaborator hub (password session)' },
    { path: '/employee/login', use: 'Collaborator sign-in' },
    { path: '/employee/lms', use: 'Collaborator LMS courses' },
    { path: '/employee/dp', use: 'Collaborator HR ops (profile, docs, leave)' },
    { path: '/employee/time-clock', use: 'Collaborator web time clock' },
    { path: '/t/{token}', use: 'Company Enneagram-at-work profile (noindex)' },
    { path: '/v/{token}', use: 'Vacancy Enneagram-at-work profile (noindex)' },
    { path: '/assessment/motivators/{token}', use: 'Motivators assessment' },
    { path: '/jobs', use: 'Public SEO job index' },
    { path: '/jobs/{slug}-{id}', use: 'Indexable public job posting with JobPosting structured data' },
    { path: '/companies/{companySlug}', use: 'Public company careers page (opt-in)' },
    { path: '/r/{token}', use: 'Client shortlist report' },
    { path: '/clima/{token}', use: 'Anonymous climate survey' },
    { path: '/pulso/{token}', use: 'Team pulse' },
    { path: '/ouvidoria/{token}', use: 'Whistleblowing / speak-up channel' },
    { path: '/e/{token}', use: 'Employee light space (token, no password)' },
  ],
};

const COPY = {
  'pt-BR': {
    metaTitle: '30Grow: recrutamento, perfil de trabalho e gestão de pessoas',
    metaDescription:
      'Plataforma de RH para recrutar, desenvolver e acompanhar pessoas. Teste por 30 dias; as 20 primeiras empresas têm 90 dias grátis.',
    metaKeywords: [
      'software RH',
      'recrutamento com perfil',
      'fit de time',
      'ATS com people',
      'Eneagrama no trabalho',
      'Motivadores',
      '1:1 gestão',
      'OKR',
      'LMS corporativo',
      'portal colaborador',
      'app do colaborador',
      'clima organizacional',
      'onboarding',
      'PDI',
      'pesquisa de clima e eNPS',
      'entrevista estruturada',
      'blog de RH',
      '30Grow',
      '3035Tech',
      'early access RH',
    ].join(', '),
    earlyBadge: '30 dias para testar · 90 dias para os primeiros 20',
    ui: {
      mainNavigation: 'Navegação principal',
      navJourney: 'Como funciona',
      navModules: 'Módulos',
      navPricing: 'Preços',
      navEnneagram: 'Eneagrama',
      exploreProduct: 'Explorar funcionalidades',
      heroProof: ['30 dias grátis', 'Sem cartão', 'Mínimo de 5 colaboradores'],
      previewAria: 'Prévia da experiência do produto 30Grow',
      liveWorkspace: 'produto real',
      teamReading: 'Inteligência do time',
      previewTitle: 'Visão de pessoas e recrutamento',
      updated: 'Atualizado',
      typeMap: 'Mapa de estilos de trabalho',
      nextConversation: 'Próxima conversa',
      hypothesis: 'Alinhar autonomia e critérios de decisão.',
      hedging: 'Hipótese para orientar a conversa, nunca um diagnóstico.',
      pipeline: 'Pipeline da vaga',
      candidates: '7 candidatos',
      pipelineStages: ['Entrevista', 'Teste concluído', 'Aprovado'],
      previewCaption: 'Composição ilustrativa baseada nas telas e funcionalidades atuais do 30Grow.',
      humanContextEyebrow: 'A tecnologia apoia a conversa',
      humanContextTitle: 'Decisões melhores começam com uma conversa melhor.',
      humanContextBody: 'O 30Grow organiza sinais, contexto e próximos passos para que RH e liderança cheguem mais preparados às conversas que realmente importam.',
      humanContextAlt: 'Profissionais de RH e liderança conversando em um escritório contemporâneo.',
      coverageLabel: 'Uma plataforma para',
      coverageItems: ['Recrutar', 'Compreender', 'Desenvolver', 'Engajar', 'Operar'],
      enneagramLabel: 'Eneagrama aplicado ao trabalho',
      enneagramTitle: 'Nove estilos. Mais contexto para cada conversa.',
      enneagramBody: 'O T1–T9 ajuda a observar padrões de trabalho, comunicação e decisão. No 30Grow, esse contexto acompanha a pessoa da seleção ao desenvolvimento, sempre com linguagem de hipótese.',
      enneagramPoints: ['Rubrica por vaga e ranking explicável', 'Compatibilidade e composição do time', 'Briefing para entrevistas e 1:1', 'Sem laudo ou diagnóstico clínico'],
      typesAria: 'Nove estilos de trabalho T1 a T9',
      types: [
        { name: 'Critério', signal: 'qualidade e padrão' },
        { name: 'Apoio', signal: 'cooperação e vínculo' },
        { name: 'Resultado', signal: 'ritmo e realização' },
        { name: 'Expressão', signal: 'identidade e significado' },
        { name: 'Análise', signal: 'profundidade e autonomia' },
        { name: 'Segurança', signal: 'preparo e confiança' },
        { name: 'Possibilidades', signal: 'energia e exploração' },
        { name: 'Direção', signal: 'força e decisão' },
        { name: 'Harmonia', signal: 'mediação e estabilidade' },
      ],
      modulesNote: 'A empresa ativa apenas os módulos de que precisa. O menu e as permissões acompanham essa escolha sem apagar os dados existentes.',
    },
    heroTitle: 'Pessoas crescem. Empresas vão mais longe.',
    heroLead:
      'O 30Grow reúne recrutamento, perfil de trabalho e gestão de pessoas para RH, direção e lideranças tomarem decisões com mais contexto.',
    heroBody:
      'A mesma pessoa segue da vaga para o time: pipeline, T1–T9, Motivadores, briefing, 1:1, PDI, desempenho, LMS, clima e operações leves de DP. Sem transformar perfil em diagnóstico.',
    pricingSnapshotTitle: 'Teste grátis por 30 dias',
    pricingSnapshotBody: 'As 20 primeiras empresas têm 90 dias. Depois, a partir de {monthlyPrice}/mês para até {firstTierMax} colaboradores.',
    pricingSnapshotCta: 'Calcular meu plano →',
    heroFoot: 'Já é cliente? Entre como gestão/RH ou colaborador. Ainda não? Teste por 30 dias. Ou veja o que está incluído:',
    navLogin: 'Gestão / RH',
    navEmployee: 'Colaborador',
    navPricing: 'Planos',
    navEarly: 'Testar 30 dias grátis',
    ctaEarly: 'Testar 30 dias grátis →',
    ctaLogin: 'Acesso gestão / RH',
    ctaEmployee: 'Sou colaborador',
    tocLabel: 'Nesta página',
    journeyNav: 'Como o 30Grow conecta a jornada',
    audienceLabel: 'Para quem',
    audienceTitle: 'RH, direção e gestores que contratam e acompanham pessoas',
    audienceItems: [
      'Times que usam ATS (Gupy, Greenhouse e similares) e sentem falta de Eneagrama / teste de perfil ligado à vaga e ao time.',
      'Empresas que compram teste de perfil avulso e recebem PDF. Sem briefing, sem 1:1, sem pós-hire nem hub do colaborador.',
      'Lideranças que querem hipóteses de gestão (“tende a…”) em vez de rótulo ou “diagnóstico”.',
    ],
    journeyLabel: 'Jornada conectada',
    journeyTitle: 'Quatro momentos, um único contexto',
    journeyLead:
      'Cada etapa reaproveita os dados e decisões da anterior. O cadastro central é a pessoa, não um relatório isolado.',
    journeyStages: [
      {
        title: 'Atrair e organizar',
        body: 'Publique vagas, receba candidaturas e conduza o pipeline configurável em kanban.',
        detail: 'Vagas públicas · pipeline · banco de talentos',
      },
      {
        title: 'Avaliar com contexto',
        body: 'Combine T1–T9, Motivadores, rubrica da vaga, ranking explicável e scorecard de entrevista.',
        detail: 'Perfil de trabalho · fit · entrevista',
      },
      {
        title: 'Decidir e integrar',
        body: 'Registre a decisão, prepare a chegada e acompanhe os check-ins D30, D60 e D90.',
        detail: 'Oferta · onboarding · check-ins',
      },
      {
        title: 'Desenvolver e cuidar',
        body: 'Conduza 1:1, PDI, desempenho, OKRs, LMS, clima e rotinas leves de DP.',
        detail: 'Gestão · aprendizado · operação',
      },
    ],
    problemLabel: 'A dor',
    problemTitle: 'Três produtos. Zero continuidade.',
    problems: [
      {
        title: 'ATS organiza o funil',
        body: 'Currículo, estágio, calendário. Ótimo para volume. Fraco para explicar fit com a vaga e com o time que já existe.',
      },
      {
        title: 'Teste vira arquivo',
        body: 'Baterias avulsas geram relatório bonito. Na entrevista e no 1:1, o contexto já se perdeu.',
      },
      {
        title: 'Depois do hire, reinicia',
        body: 'Onboarding, LMS, OKRs, clima e retenção moram em outras ferramentas. A pessoa contratada “nasce de novo” no sistema.',
      },
    ],
    wedgeLabel: 'O gancho',
    wedgeTitle: 'Uma pessoa. Uma história. Do candidato ao colaborador.',
    wedgeBody:
      'No 30Grow a mesma pessoa carrega o Eneagrama (personalidades no trabalho), Motivadores, ranking da vaga, briefing, 1:1, PDI, OKRs, LMS, check-ins, clima e DP leve. Você não “integra PDF”: você decide e acompanha com o mesmo fio.',
    outcomesLabel: 'O que muda no dia a dia',
    outcomesTitle: 'Resultados que o cliente sente',
    outcomes: [
      {
        title: 'Decisão de hire mais rápida e defendável',
        body: 'Rubrica por vaga, ranking de aderência do perfil e briefing com perguntas e faça/evite. Prontos para a banca.',
      },
      {
        title: 'Gestor preparado na conversa',
        body: 'Hipóteses de gestão + registro de 1:1 + prep do colaborador. Menos reunião genérica, mais próximos passos.',
      },
      {
        title: 'Menos “sumiu depois que contratou”',
        body: 'Hub do colaborador, chegada D1–D90, LMS com progresso, OKRs atribuídos e PDI na mesma jornada. Com alertas de retenção acionáveis.',
      },
      {
        title: 'Uma ferramenta a menos na stack',
        body: 'Funil + perfil + gestão leve + LMS/DP leves. Complementa o ATS; não obriga a trocar folha ou HRIS no dia 1.',
      },
    ],
    pillarsLabel: 'O que você leva',
    pillarsTitle: 'O que já existe no produto',
    pillarsLead: 'Capacidades disponíveis hoje, organizadas pelo trabalho real de RH e liderança.',
    pillars: [
      {
        id: 'recrutar',
        title: 'Recrutamento com fit',
        items: [
          'Vagas e pipeline kanban até contratar ou arquivar',
          'Perfil de referência reutilizável: defina os estilos de trabalho esperados e use em novas vagas',
          'Rubrica de perfil por vaga + ranking de aderência explicável',
          'Scorecard de entrevista, notas ricas e pool de talentos',
          'Análise demissional: o que corrigir na seleção com base em motivos de saída reais',
          'Página pública de vagas para atrair candidatos',
          'Relatório shortlist para o cliente (parecer + PDF)',
          'Oferta mínima (salário / status) no funil',
          'Métricas de efetividade: time-to-hire, retenção, fit contratados vs pool',
        ],
      },
      {
        id: 'perfil',
        title: 'Eneagrama e Motivadores que viram ação',
        items: [
          'Teste de perfil inspirado no Eneagrama: personalidades no trabalho (não é diagnóstico clínico)',
          'Motivadores: o que energiza e o que drena no dia a dia',
          'HR Score: índice consolidado de sinais comportamentais (0-100) com predições de turnover e lacunas PDI',
          'Radar de rotatividade: monitoramento multi-sinal de risco de saída com ações sugeridas',
          'Briefing de decisão + PDF one-pager para a entrevista',
          'Compatibilidade e composição do time (sinergia / tensão)',
          'Visão geral com mapa do time e fila do que precisa atenção',
          'Analytics: tendências temporais, comparativos entre áreas, alertas de anomalias',
        ],
      },
      {
        id: 'time',
        title: 'Gestão, desempenho e clima',
        items: [
          'Equipe unificada: candidatos e colaboradores',
          '1:1 com hipóteses e próximos passos',
          'OKRs leves (empresa / time / pessoa) com atividades atribuídas ao colaborador',
          'Avaliação de desempenho: metas, outcomes, 180°/360° opcional e calibração',
          'Matriz 9Box (desempenho × potencial) com linguagem hedged',
          'Feedback contínuo entre pares e mural da empresa com kudos',
          'Plano de sucessão: papéis críticos, sucessores e prontidão',
          'Pesquisa de clima anônima, pulso de grupos e digest semanal',
          'Canal de ouvidoria / denúncias com triagem pelo RH',
        ],
      },
      {
        id: 'jornada',
        title: 'Pós-contratação e aprendizado',
        items: [
          'Hub do colaborador com login (senha): tarefas, jornada, PDI, OKRs e pesquisas',
          'Timeline “Minha chegada”: kit, acessos, calls e check-ins D30/D60/D90',
          'LMS com cursos, player, progresso, quiz e certificado',
          'Academia / catálogo de recursos que o PDI pode apontar',
          'PDI com progresso, ciclo e responsável',
          'Catálogo de benefícios da empresa',
          'Alertas de retenção com plano e revisão',
          'Jornada contínua na ficha da pessoa',
        ],
      },
      {
        id: 'dp',
        title: 'DP leve no mesmo login',
        items: [
          'Ficha do colaborador: endereço, CPF e contato de emergência',
          'Checklist de documentos com upload pelo colaborador',
          'Pedidos de férias / afastamento com saldo e anexos',
          'Ponto web (entrada / saída) no hub do colaborador',
          'Remuneração interna e remuneração variável (proposta / aprovação): sem folha nem holerite',
          'Não substitui eSocial / folha completa: cobre o operacional leve no mesmo tenant',
        ],
      },
    ],
    employeeApp: {
      label: '30Grow no celular',
      eyebrow: 'Aplicativo do colaborador · iOS e Android',
      title: 'O dia de trabalho também cabe no bolso.',
      body:
        'O app do 30Grow leva ao colaborador uma experiência nativa, direta e segura. Não é o painel do RH reduzido: é uma jornada própria para consultar prioridades e agir em poucos toques.',
      status: 'Lançamento em outubro de 2026 · iOS e Android',
      features: [
        'Hoje, notificações e jornada de onboarding',
        'Pesquisas, PDI, OKRs e avaliações recebidas',
        'Feedback e LMS com vídeo, PDF, quiz e certificado',
        'Login seguro com 2FA e troca de empresa',
      ],
      note:
        'O aplicativo chega às lojas em outubro de 2026. Até lá, o portal web do colaborador já está disponível com as mesmas jornadas.',
      mockup: {
        greeting: 'Bom dia, Marina',
        context: 'Seu dia no 30Grow',
        priority: 'Prioridade de hoje',
        task: 'Atualizar progresso do PDI',
        progress: '2 de 4 ações concluídas',
        next: 'Próximos passos',
        items: ['Responder pesquisa de pulso', 'Continuar curso de liderança'],
        nav: ['Hoje', 'Jornada', 'Aprender'],
      },
    },
    hrReports: {
      label: 'Relatórios para gestão de RH',
      title: 'Do dado disperso à pauta da reunião de pessoas.',
      body: 'Relatórios de recrutamento, evolução e retenção ajudam o RH a comparar períodos, investigar causas e escolher a próxima prioridade.',
      groups: [
        { title: 'Contratar melhor', body: 'Time-to-hire, conversão do funil, fit dos contratados e aderência à rubrica.', icon: 'vacancies' },
        { title: 'Acompanhar evolução', body: 'Produtividade, retenção, HR Score e contratações versus desligamentos.', icon: 'chart' },
        { title: 'Antecipar atenção', body: 'Clima, risco de saída, comparativos entre áreas e alertas agregados.', icon: 'climate' },
      ],
      delivery: 'Filtros por período, comparação entre áreas, exportação e envio semanal ou mensal com PDF opcional.',
      guardrail: 'Os indicadores mostram onde investigar. Não tomam decisões automáticas sobre pessoas.',
      preview: {
        label: 'Leitura executiva', title: 'Resumo de pessoas', period: 'Últimos 12 meses',
        metrics: [
          { label: 'Time-to-hire', value: '34 dias', trend: '−8%' },
          { label: 'Retenção 12m', value: '82%', trend: '+5%' },
          { label: 'Fit contratado', value: '7,8/10', trend: '+0,6' },
        ],
        trendTitle: 'Contratações e desligamentos',
        alertTitle: 'Pauta sugerida',
        alert: 'Revisar a etapa com maior tempo de espera',
      },
    },
    compareLabel: 'Posicionamento',
    compareTitle: 'Onde o 30Grow ganha (e onde não compete)',
    compareLead: 'Sem atacar marcas: o cliente escolhe a categoria certa.',
    compareRows: [
      {
        them: 'ATS clássico (ex.: Gupy, Greenhouse)',
        gap: 'Forte em volume, estágio e carreiras.',
        us: '30Grow adiciona Eneagrama + decisão + pós-hire no mesmo fio da pessoa.',
      },
      {
        them: 'Teste avulso / PDF de perfil',
        gap: 'Relatório que não entra no fluxo de RH.',
        us: 'O teste de perfil vira briefing, ranking da vaga e roteiro de 1:1.',
      },
      {
        them: 'Só engajamento / clima',
        gap: 'Mede sentimento depois: sem ligação com o hire.',
        us: 'Clima, pulso, OKRs e LMS entram depois do mesmo perfil que contratou.',
      },
      {
        them: 'HRIS / folha completa',
        gap: 'Admissão fiscal, eSocial, holerite.',
        us: 'Não substitui: LMS e DP leves + hub do colaborador no mesmo produto de perfil.',
      },
    ],
    builderLabel: 'Origem',
    builderTitle: 'Por que a 3035Tech construiu o 30Grow',
    builderParagraphs: [
      'O 30Grow nasceu dentro da 3035Tech: uma empresa de engenharia de software que contrata e monta times o tempo todo. A dor era nossa: decidir no feeling, receber PDF que ninguém reabre, e reiniciar a história da pessoa depois do hire.',
      'Usamos o produto de verdade. Contratamos com ele, treinamos gente via 3035TEACH e gerimos o time no mesmo fluxo. Não é pitch de PowerPoint: é ferramenta que sobreviveu ao RH interno antes de virar oferta.',
      'A 3035Tech fica como fiadora: engenharia séria por trás. O protagonista da página, e do dia a dia, continua sendo o 30Grow.',
    ],
    howLabel: 'Como começa',
    howTitle: 'Três passos até o valor',
    steps: [
      {
        n: '01',
        title: 'Ative o teste',
        body: 'Crie sua conta ou fale com a 3035Tech, receba o acesso de gestão e configure a empresa.',
      },
      {
        n: '02',
        title: 'Rode uma vaga ou o time',
        body: 'Convide pessoas por link (sem conta para candidato). Veja ranking e briefing na mesma semana.',
      },
      {
        n: '03',
        title: 'Feche o ciclo',
        body: 'Contrate com contexto e acompanhe chegada → hub do colaborador → 1:1 / OKRs / LMS. Sem mudar de ferramenta.',
      },
    ],
    trustLabel: 'Confiança',
    trustTitle: 'Sério com linguagem: e transparente no limite',
    trustItems: [
      'Hipóteses de gestão (“tende a”), nunca diagnóstico clínico.',
      'Não substitui entrevista técnica nem avaliação de saúde.',
      'Eneagrama no trabalho: perfil de estilo de trabalho, não laudo clínico.',
      'Candidatos não criam conta: entram pelo link que o RH envia. Colaboradores podem ter login com senha.',
      'Dados de cada empresa ficam isolados.',
      'Onboarding inicial com a 3035Tech e sem fidelidade obrigatória.',
    ],
    faqLabel: 'Dúvidas que travam a compra',
    faqTitle: 'FAQ comercial',
    faqs: [
      {
        q: 'É de graça mesmo?',
        a: 'Sim. Toda empresa começa com 30 dias grátis. As 20 primeiras têm 90 dias; design partners podem negociar até 6 meses. Depois, o plano começa em {monthlyPrice}/mês para até {firstTierMax} colaboradores, com 20% de desconto no anual.',
      },
      {
        q: 'Preciso abandonar meu ATS?',
        a: 'Não. O 30Grow cobre funil e perfil no mesmo produto, mas a proposta de valor é a camada de decisão e pós-hire. Muitos times começam paralelo ao ATS atual.',
      },
      {
        q: 'É mais um teste de personalidade?',
        a: 'Não. É teste de perfil (Eneagrama no trabalho) + Motivadores ligados a vaga, time, entrevista e 1:1. Sem diagnóstico clínico.',
      },
      {
        q: 'O colaborador também usa?',
        a: 'Sim. No portal /employee: chegada, pesquisas, PDI, OKRs, LMS, DP leve e ponto web. O app nativo, com lançamento em outubro de 2026, leva Hoje, notificações, onboarding, pesquisas, PDI, OKRs, avaliações, feedback e LMS a iOS e Android. Há também o link leve /e por token, sem senha.',
      },
      {
        q: 'Quanto tempo até ver valor?',
        a: 'Na primeira vaga ou no primeiro lote do time: ranking, briefing e uma conversa de 1:1 já mostram o diferencial frente ao PDF.',
      },
      {
        q: 'Como peço acesso?',
        a: `Clique em “Testar 30 dias grátis” ou escreva para ${PRODUCT_LANDING_CONTACT_EMAIL} com empresa e papel (RH/gestão).`,
      },
    ],
    earlyLabel: 'Oferta',
    earlyTitle: '90 dias grátis para as 20 primeiras empresas',
    earlyBody:
      'Toda empresa começa com 30 dias grátis. As 20 primeiras recebem 90 dias; design partners podem negociar até 6 meses. Depois, continue a partir de {monthlyPrice}/mês para até {firstTierMax} colaboradores.',
    earlyProof: [
      'Sem cartão · sem fidelidade obrigatória',
      'Onboarding com a 3035Tech',
      'Mínimo de 5 colaboradores',
    ],
    earlyContact: 'Ou escreva para',
    earlyMailSubject: '30Grow: quero early access gratuito',
    earlyMailBody:
      'Olá! Quero o early access gratuito do 30Grow.\n\nEmpresa:\nNome:\nPapel (RH / gestão / direção):\nTamanho aproximado do time:\nPrincipal dor hoje (ATS / teste PDF / pós-hire):\n',
    closeTitle: 'Pronto para vender o “sim” interno?',
    closeBody:
      'Mostre ao time um fluxo que vai do candidato ao hub do colaborador. Sem mais uma planilha. Comece com 30 dias grátis.',
    footerBrand: '30Grow',
    footerCred:
      'Feito pela 3035Tech: engenharia de software há ~19 anos, com clientes no Brasil, Irlanda, EUA e Alemanha.',
    footerPricing: 'Planos e preços',
    footerPrivacy: 'Privacidade',
    footerTerms: 'Termos',
    footerLegal: 'Software de RH com Eneagrama, Motivadores e recrutamento. Hipóteses de gestão, não diagnóstico.',
    skipToContent: 'Ir para o conteúdo',
  },
  en: {
    metaTitle: '30Grow: recruiting, work profiles, and people management',
    metaDescription:
      'HR platform to recruit, develop, and support people. Try for 30 days; the first 20 companies get 90 days free.',
    metaKeywords: [
      'HR software',
      'hiring with Enneagram profile',
      'team fit',
      'ATS plus people',
      'Motivators assessment',
      '1:1 management',
      'OKR',
      'corporate LMS',
      'employee portal',
      'employee mobile app',
      'employee climate',
      'onboarding check-ins',
      'individual development plan',
      'structured interview scorecard',
      'HR blog',
      '30Grow',
      '3035Tech',
      'early access HR',
    ].join(', '),
    earlyBadge: '30 days to try · 90 days for the first 20',
    ui: {
      mainNavigation: 'Main navigation',
      navJourney: 'How it works',
      navModules: 'Modules',
      navPricing: 'Pricing',
      navEnneagram: 'Enneagram',
      exploreProduct: 'Explore capabilities',
      heroProof: ['30 days free', 'No credit card', 'Minimum 5 employees'],
      previewAria: 'Preview of the 30Grow product experience',
      liveWorkspace: 'real product',
      teamReading: 'Team intelligence',
      previewTitle: 'People and recruiting overview',
      updated: 'Updated',
      typeMap: 'Work-style map',
      nextConversation: 'Next conversation',
      hypothesis: 'Align autonomy and decision criteria.',
      hedging: 'A hypothesis to guide conversation, never a diagnosis.',
      pipeline: 'Vacancy pipeline',
      candidates: '7 candidates',
      pipelineStages: ['Interview', 'Test complete', 'Approved'],
      previewCaption: 'Illustrative composition based on current 30Grow screens and capabilities.',
      humanContextEyebrow: 'Technology supports the conversation',
      humanContextTitle: 'Better decisions start with a better conversation.',
      humanContextBody: '30Grow organizes signals, context, and next steps so HR and leaders can arrive better prepared for the conversations that matter.',
      humanContextAlt: 'HR and leadership professionals having a conversation in a contemporary office.',
      coverageLabel: 'One platform to',
      coverageItems: ['Recruit', 'Understand', 'Develop', 'Engage', 'Operate'],
      enneagramLabel: 'Enneagram applied to work',
      enneagramTitle: 'Nine styles. More context for every conversation.',
      enneagramBody: 'T1–T9 helps observe patterns in work, communication, and decision-making. In 30Grow, that context follows the person from selection to development, always framed as a hypothesis.',
      enneagramPoints: ['Per-role rubric and explainable ranking', 'Team compatibility and composition', 'Briefs for interviews and 1:1s', 'No clinical report or diagnosis'],
      typesAria: 'Nine T1 to T9 work styles',
      types: [
        { name: 'Standards', signal: 'quality and rigor' },
        { name: 'Support', signal: 'cooperation and bonds' },
        { name: 'Results', signal: 'pace and achievement' },
        { name: 'Expression', signal: 'identity and meaning' },
        { name: 'Analysis', signal: 'depth and autonomy' },
        { name: 'Security', signal: 'readiness and trust' },
        { name: 'Possibility', signal: 'energy and exploration' },
        { name: 'Direction', signal: 'strength and decision' },
        { name: 'Harmony', signal: 'mediation and stability' },
      ],
      modulesNote: 'Each company activates only the modules it needs. Navigation and permissions follow that choice without deleting existing data.',
    },
    heroTitle: 'People grow. Companies go further.',
    heroLead:
      '30Grow brings recruiting, work profiles, and people management together so HR, leadership, and managers can decide with more context.',
    heroBody:
      'The same person moves from vacancy to team: pipeline, T1–T9, Motivators, briefs, 1:1s, development plans, performance, LMS, climate, and light HR operations. Never a clinical diagnosis.',
    pricingSnapshotTitle: 'Try free for 30 days',
    pricingSnapshotBody: 'The first 20 companies get 90 days. Then from {monthlyPrice}/month for up to {firstTierMax} employees.',
    pricingSnapshotCta: 'Calculate my plan →',
    heroFoot: 'Already a customer? Sign in as manager/HR or collaborator. Not yet? Try it free for 30 days. Or see what is included:',
    navLogin: 'Managers / HR',
    navEmployee: 'Collaborator',
    navPricing: 'Pricing',
    navEarly: 'Try free for 30 days',
    ctaEarly: 'Try free for 30 days →',
    ctaLogin: 'Manager / HR access',
    ctaEmployee: 'I am a collaborator',
    tocLabel: 'On this page',
    journeyNav: 'How 30Grow connects the journey',
    audienceLabel: 'Who it is for',
    audienceTitle: 'HR, leadership, and managers who hire and coach people',
    audienceItems: [
      'Teams on ATS tools (Gupy, Greenhouse, and peers) that lack Enneagram / personality-at-work profile tied to role and team.',
      'Companies that buy standalone profile tests and get a PDF. No brief, no 1:1, no post-hire or collaborator hub.',
      'Leaders who want management hypotheses (“tends to…”) instead of labels or “diagnosis”.',
    ],
    journeyLabel: 'Connected journey',
    journeyTitle: 'Four moments, one shared context',
    journeyLead:
      'Each stage reuses the data and decisions from the one before it. The central record is the person, not an isolated report.',
    journeyStages: [
      {
        title: 'Attract and organize',
        body: 'Publish jobs, receive applications, and run a configurable kanban pipeline.',
        detail: 'Public jobs · pipeline · talent pool',
      },
      {
        title: 'Assess in context',
        body: 'Combine T1–T9, Motivators, role rubric, explainable ranking, and interview scorecards.',
        detail: 'Work profile · fit · interview',
      },
      {
        title: 'Decide and onboard',
        body: 'Record the decision, prepare arrival, and follow Day-30, Day-60, and Day-90 check-ins.',
        detail: 'Offer · onboarding · check-ins',
      },
      {
        title: 'Develop and support',
        body: 'Run 1:1s, development plans, performance, OKRs, LMS, climate, and light HR routines.',
        detail: 'Management · learning · operations',
      },
    ],
    problemLabel: 'The pain',
    problemTitle: 'Three products. Zero continuity.',
    problems: [
      {
        title: 'ATS runs the funnel',
        body: 'Resumes, stages, calendar. Great for volume. Weak at explaining fit to the role and the team already there.',
      },
      {
        title: 'The test becomes a file',
        body: 'Standalone batteries look polished. By the interview and 1:1, context is gone.',
      },
      {
        title: 'After hire, start over',
        body: 'Onboarding, LMS, OKRs, climate, and retention live elsewhere. The hired person is “born again” in another system.',
      },
    ],
    wedgeLabel: 'The hook',
    wedgeTitle: 'One person. One story. From candidate to employee.',
    wedgeBody:
      'In 30Grow the same person carries the Enneagram (personalities at work), Motivators, vacancy ranking, brief, 1:1s, plans, OKRs, LMS, check-ins, climate, and light HR ops. You do not “integrate a PDF”. You decide and follow through on one thread.',
    outcomesLabel: 'What changes',
    outcomesTitle: 'Outcomes customers feel',
    outcomes: [
      {
        title: 'Faster, defensible hire decisions',
        body: 'Per-role rubric, explainable profile fit ranking, and interview brief with do/avoid. Ready for the panel.',
      },
      {
        title: 'Managers ready for the conversation',
        body: 'Management hypotheses + 1:1 log + employee prep. Fewer generic meetings, clearer next steps.',
      },
      {
        title: 'Less “vanished after hire”',
        body: 'Collaborator hub, Day-1–D90 arrival, LMS with progress, assigned OKRs, and development plans. With actionable retention alerts.',
      },
      {
        title: 'One less tool in the stack',
        body: 'Funnel + profile + light people ops + light LMS/HR ops. Complements your ATS; no forced payroll rip-and-replace on day one.',
      },
    ],
    pillarsLabel: 'What you get',
    pillarsTitle: 'What is already in the product',
    pillarsLead: 'Capabilities available today, organized around the actual work of HR and leadership.',
    pillars: [
      {
        id: 'recruit',
        title: 'Hiring with fit',
        items: [
          'Vacancies and kanban pipeline through hire or archive',
          'Reusable work-profile reference: define the expected work styles and reuse them in new vacancies',
          'Per-role profile rubric + explainable fit ranking',
          'Interview scorecard, rich notes, talent pool',
          'Exit analysis: what to fix in hiring based on real departure reasons',
          'Public job pages to attract candidates',
          'Client shortlist report (opinion + PDF)',
          'Minimal offer tracking in the funnel',
          'Effectiveness metrics: time-to-hire, retention, hired fit vs pool',
        ],
      },
      {
        id: 'profile',
        title: 'Enneagram and Motivators that drive action',
        items: [
          'Enneagram-inspired profile test: personalities at work (not a clinical diagnosis)',
          'Motivators: what energizes and drains day to day',
          'HR Score: consolidated behavioral signals (0-100) with turnover predictions and PDI gaps',
          'Turnover radar: multi-signal monitoring of departure risk with suggested actions',
          'Decision brief + one-pager PDF for interviews',
          'Team compatibility and composition (synergy / tension)',
          'Overview with team map and attention queue',
          'Analytics: time trends, area comparisons, anomaly alerts',
        ],
      },
      {
        id: 'team',
        title: 'Management, performance, and climate',
        items: [
          'Unified team: candidates and employees',
          '1:1s with hypotheses and next steps',
          'Light OKRs (company / team / person) with activities assigned to collaborators',
          'Performance reviews: goals, outcomes, optional 180°/360°, and calibration',
          '9Box matrix (performance × potential) with hedged language',
          'Continuous peer feedback plus company feed with kudos',
          'Succession planning: critical roles, successors, and readiness',
          'Anonymous climate surveys, group pulse, and weekly manager digest',
          'Whistleblowing / speak-up channel with HR triage',
        ],
      },
      {
        id: 'journey',
        title: 'Post-hire and learning',
        items: [
          'Collaborator hub with password login: tasks, arrival, plans, OKRs, and surveys',
          '“My arrival” timeline: kit, access sheet, calls, and D30/D60/D90 check-ins',
          'LMS with courses, player, progress, quiz, and certificate',
          'Academy / learning catalog that development plans can reference',
          'Development plans with progress, cycle, and owner',
          'Company benefits catalog',
          'Retention alerts with plan and review',
          'Continuous journey on the person record',
        ],
      },
      {
        id: 'dp',
        title: 'Light HR ops in the same login',
        items: [
          'Collaborator profile: address, tax ID, and emergency contact',
          'Document checklist with collaborator upload',
          'Leave / time-off requests with balance and attachments',
          'Web time clock (clock in / out) in the collaborator hub',
          'Internal compensation and variable pay (propose / approve): not payroll or payslips',
          'Does not replace full payroll / tax filings: light ops in the same tenant',
        ],
      },
    ],
    employeeApp: {
      label: '30Grow on mobile',
      eyebrow: 'Collaborator app · iOS and Android',
      title: 'The workday also fits in your pocket.',
      body:
        'The 30Grow app gives collaborators a native, focused, and secure experience. It is not a shrunken HR dashboard: it is a dedicated journey to check priorities and act in a few taps.',
      status: 'Launching October 2026 · iOS and Android',
      features: [
        'Today, notifications, and onboarding journey',
        'Surveys, development plans, OKRs, and received reviews',
        'Feedback and LMS with video, PDF, quiz, and certificate',
        'Secure sign-in with 2FA and company switching',
      ],
      note:
        'The app reaches the stores in October 2026. Until then, the collaborator web portal is already available with the same journeys.',
      mockup: {
        greeting: 'Good morning, Marina',
        context: 'Your day in 30Grow',
        priority: "Today's priority",
        task: 'Update development-plan progress',
        progress: '2 of 4 actions completed',
        next: 'Next steps',
        items: ['Answer pulse survey', 'Continue leadership course'],
        nav: ['Today', 'Journey', 'Learn'],
      },
    },
    hrReports: {
      label: 'Reports for HR management',
      title: 'From scattered data to the people-meeting agenda.',
      body: 'Recruiting, progress, and retention reports help HR compare periods, investigate causes, and choose the next priority.',
      groups: [
        { title: 'Hire better', body: 'Time-to-hire, funnel conversion, hired-person fit, and rubric adherence.', icon: 'vacancies' },
        { title: 'Track progress', body: 'Productivity, retention, HR Score, and hires versus exits.', icon: 'chart' },
        { title: 'Anticipate attention', body: 'Climate, turnover risk, area comparisons, and aggregate alerts.', icon: 'climate' },
      ],
      delivery: 'Period filters, area comparison, exports, and weekly or monthly delivery with an optional PDF.',
      guardrail: 'Indicators show where to investigate. They do not make automated decisions about people.',
      preview: {
        label: 'Executive read', title: 'People summary', period: 'Last 12 months',
        metrics: [
          { label: 'Time-to-hire', value: '34 days', trend: '−8%' },
          { label: '12m retention', value: '82%', trend: '+5%' },
          { label: 'Hired fit', value: '7.8/10', trend: '+0.6' },
        ],
        trendTitle: 'Hires and exits',
        alertTitle: 'Suggested agenda',
        alert: 'Review the stage with the longest wait',
      },
    },
    compareLabel: 'Positioning',
    compareTitle: 'Where 30Grow wins (and where it does not compete)',
    compareLead: 'No brand bashing: help the buyer pick the right category.',
    compareRows: [
      {
        them: 'Classic ATS (e.g. Gupy, Greenhouse)',
        gap: 'Strong on volume, stages, careers.',
        us: '30Grow adds Enneagram + decision + post-hire on the same person thread.',
      },
      {
        them: 'Standalone test / profile PDF',
        gap: 'A report that never enters the HR workflow.',
        us: 'The profile test becomes brief, vacancy ranking, and 1:1 script.',
      },
      {
        them: 'Engagement / climate only',
        gap: 'Measures feeling later: disconnected from hire.',
        us: 'Climate, pulse, OKRs, and LMS follow the same profile you hired on.',
      },
      {
        them: 'Full HRIS / payroll',
        gap: 'Fiscal admissions, payslips, tax filings.',
        us: 'Does not replace them: light LMS and HR ops plus collaborator hub on the profile product.',
      },
    ],
    builderLabel: 'Origin',
    builderTitle: 'Why 3035Tech built 30Grow',
    builderParagraphs: [
      '30Grow started inside 3035Tech: a software engineering company that hires and builds teams constantly. The pain was ours: gut-feel decisions, PDFs nobody reopens, and restarting the person’s story after hire.',
      'We use the product for real. We hire with it, train people through 3035TEACH, and manage the team in the same flow. Not a slide deck: a tool that survived our own HR before it became an offer.',
      '3035Tech stands behind it as guarantor: serious engineering. The hero of the page, and of the day-to-day, remains 30Grow.',
    ],
    howLabel: 'How it starts',
    howTitle: 'Three steps to value',
    steps: [
      {
        n: '01',
        title: 'Start the trial',
        body: 'Create your account or talk to 3035Tech, get manager access, and set up the company.',
      },
      {
        n: '02',
        title: 'Run a vacancy or the team',
        body: 'Invite people by link (no candidate account). See ranking and brief within a week.',
      },
      {
        n: '03',
        title: 'Close the loop',
        body: 'Hire with context and follow arrival → collaborator hub → 1:1 / OKRs / LMS. Without switching tools.',
      },
    ],
    trustLabel: 'Trust',
    trustTitle: 'Serious language: clear limits',
    trustItems: [
      'Management hypotheses (“tends to”), never a clinical diagnosis.',
      'Does not replace technical interviews or health assessment.',
      'Enneagram at work: work-style profile, not a clinical report.',
      'Candidates do not create accounts: they use the link HR sends. Collaborators can have a password login.',
      'Each company’s data stays isolated.',
      'Initial onboarding with 3035Tech and no mandatory commitment.',
    ],
    faqLabel: 'Buying questions',
    faqTitle: 'Commercial FAQ',
    faqs: [
      {
        q: 'Is it really free?',
        a: 'Yes. Every company starts with 30 days free. The first 20 get 90 days; design partners can negotiate up to 6 months. Then plans start at {monthlyPrice}/month for up to {firstTierMax} employees, with 20% off annual billing.',
      },
      {
        q: 'Do I have to drop my ATS?',
        a: 'No. 30Grow includes funnel and profile, but the core value is decision and post-hire. Many teams start alongside their current ATS.',
      },
      {
        q: 'Is this another personality test?',
        a: 'No. An Enneagram-at-work profile test + Motivators tied to role, team, interview, and 1:1. Not a clinical diagnosis.',
      },
      {
        q: 'Do collaborators use it too?',
        a: 'Yes. The /employee portal covers arrival, surveys, plans, OKRs, LMS, light HR ops, and web time clock. The native app, launching in October 2026, brings Today, notifications, onboarding, surveys, plans, OKRs, reviews, feedback, and LMS to iOS and Android. There is also a light /e token link without a password.',
      },
      {
        q: 'How fast to value?',
        a: 'On the first vacancy or first team batch: ranking, brief, and one 1:1 already beat a PDF.',
      },
      {
        q: 'How do I get access?',
        a: `Click “Try free for 30 days” or email ${PRODUCT_LANDING_CONTACT_EMAIL} with company and role (HR/manager).`,
      },
    ],
    earlyLabel: 'Offer',
    earlyTitle: '90 days free for the first 20 companies',
    earlyBody:
      'Every company starts with 30 days free. The first 20 get 90 days; design partners can negotiate up to 6 months. Then continue from {monthlyPrice}/month for up to {firstTierMax} employees.',
    earlyProof: ['No card · no mandatory commitment', 'Onboarding with 3035Tech', 'Minimum 5 employees'],
    earlyContact: 'Or write to',
    earlyMailSubject: '30Grow: free early access',
    earlyMailBody:
      'Hi! I want free early access to 30Grow.\n\nCompany:\nName:\nRole (HR / manager / leadership):\nApprox. team size:\nMain pain today (ATS / PDF test / post-hire):\n',
    closeTitle: 'Ready to win the internal “yes”?',
    closeBody:
      'Show your team a flow from candidate to collaborator hub. Without another spreadsheet. Start with 30 days free.',
    footerBrand: '30Grow',
    footerCred:
      'Built by 3035Tech: software engineering for ~19 years, with clients in Brazil, Ireland, the US, and Germany.',
    footerPricing: 'Plans and pricing',
    footerPrivacy: 'Privacy',
    footerTerms: 'Terms',
    footerLegal: 'HR software with Enneagram, Motivators, and hiring. Management hypotheses, not diagnosis.',
    skipToContent: 'Skip to content',
  },
};

const SPANISH_LANDING_OVERRIDES = {
  metaTitle: '30Grow: reclutamiento, perfiles de trabajo y gestión de personas',
  metaDescription: 'Plataforma de RR. HH. para reclutar, desarrollar y acompañar personas. Prueba durante 30 días; las primeras 20 empresas reciben 90 días gratis.',
  metaKeywords: 'software de RR. HH., reclutamiento con perfil, compatibilidad de equipos, ATS, Motivadores, gestión 1:1, OKR, LMS corporativo, portal del colaborador, 30Grow',
  earlyBadge: '30 días para probar · 90 días para las primeras 20',
  ui: {
    mainNavigation: 'Navegación principal', navJourney: 'Cómo funciona', navModules: 'Módulos', navPricing: 'Precios', navEnneagram: 'Eneagrama', exploreProduct: 'Explorar funcionalidades',
    heroProof: ['30 días gratis', 'Sin tarjeta', 'Mínimo de 5 colaboradores'], previewAria: 'Vista previa de la experiencia de 30Grow', liveWorkspace: 'producto real', teamReading: 'Inteligencia del equipo', previewTitle: 'Vista de personas y reclutamiento', updated: 'Actualizado', typeMap: 'Mapa de estilos de trabajo', nextConversation: 'Próxima conversación', hypothesis: 'Alinear autonomía y criterios de decisión.', hedging: 'Una hipótesis para orientar la conversación, nunca un diagnóstico.', pipeline: 'Pipeline de la vacante', candidates: '7 candidatos', pipelineStages: ['Entrevista', 'Prueba completada', 'Aprobado'], previewCaption: 'Composición ilustrativa basada en las pantallas y funcionalidades actuales de 30Grow.', humanContextEyebrow: 'La tecnología apoya la conversación', humanContextTitle: 'Las mejores decisiones comienzan con una mejor conversación.', humanContextBody: '30Grow organiza señales, contexto y próximos pasos para que RR. HH. y los líderes lleguen mejor preparados a las conversaciones importantes.', humanContextAlt: 'Profesionales de RR. HH. y liderazgo conversando en una oficina contemporánea.', coverageLabel: 'Una plataforma para', coverageItems: ['Reclutar', 'Comprender', 'Desarrollar', 'Comprometer', 'Operar'], enneagramLabel: 'Eneagrama aplicado al trabajo', enneagramTitle: 'Nueve estilos. Más contexto para cada conversación.', enneagramBody: 'T1–T9 ayuda a observar patrones de trabajo, comunicación y toma de decisiones. En 30Grow, ese contexto acompaña a la persona desde la selección hasta el desarrollo, siempre como hipótesis.', enneagramPoints: ['Rúbrica por puesto y ranking explicable', 'Compatibilidad y composición del equipo', 'Briefs para entrevistas y 1:1', 'Sin informe ni diagnóstico clínico'], typesAria: 'Nueve estilos de trabajo T1 a T9', types: [{ name: 'Criterio', signal: 'calidad y rigor' }, { name: 'Apoyo', signal: 'cooperación y vínculos' }, { name: 'Resultados', signal: 'ritmo y logro' }, { name: 'Expresión', signal: 'identidad y significado' }, { name: 'Análisis', signal: 'profundidad y autonomía' }, { name: 'Seguridad', signal: 'preparación y confianza' }, { name: 'Posibilidades', signal: 'energía y exploración' }, { name: 'Dirección', signal: 'fuerza y decisión' }, { name: 'Armonía', signal: 'mediación y estabilidad' }], modulesNote: 'Cada empresa activa solo los módulos que necesita. La navegación y los permisos siguen esa elección sin eliminar datos existentes.',
  },
  heroTitle: 'Las personas crecen. Las empresas llegan más lejos.', heroLead: '30Grow reúne reclutamiento, perfiles de trabajo y gestión de personas para que RR. HH., líderes y gestores decidan con más contexto.', heroBody: 'La misma persona pasa de la vacante al equipo: pipeline, T1–T9, Motivadores, briefs, 1:1, planes de desarrollo, desempeño, LMS, clima y operaciones ligeras de RR. HH. Nunca un diagnóstico clínico.', pricingSnapshotTitle: 'Prueba gratis durante 30 días', pricingSnapshotBody: 'Las primeras 20 empresas reciben 90 días. Después, desde {monthlyPrice}/mes para hasta {firstTierMax} colaboradores.', pricingSnapshotCta: 'Calcular mi plan →', heroFoot: '¿Ya eres cliente? Entra como gestor/RR. HH. o colaborador. ¿Todavía no? Pruébalo durante 30 días. O mira lo que incluye:', navLogin: 'Gestión / RR. HH.', navEmployee: 'Colaborador', navPricing: 'Precios', navEarly: 'Probar 30 días gratis', ctaEarly: 'Probar 30 días gratis →', ctaLogin: 'Acceso de gestión / RR. HH.', ctaEmployee: 'Soy colaborador', tocLabel: 'En esta página', journeyNav: 'Cómo 30Grow conecta la jornada', audienceLabel: 'Para quién', audienceTitle: 'RR. HH., liderazgo y gestores que contratan y acompañan personas', audienceItems: ['Equipos que usan ATS y necesitan un perfil de trabajo vinculado al puesto y al equipo.', 'Empresas que compran pruebas de perfil independientes y reciben un PDF, sin brief, 1:1 ni hub del colaborador.', 'Líderes que quieren hipótesis de gestión (“tiende a…”) en lugar de etiquetas o “diagnósticos”.'], journeyLabel: 'Jornada conectada', journeyTitle: 'Cuatro momentos, un mismo contexto', journeyLead: 'Cada etapa reutiliza los datos y decisiones de la anterior. El registro central es la persona, no un informe aislado.', journeyStages: [{ title: 'Atraer y organizar', body: 'Publica vacantes, recibe candidaturas y gestiona un pipeline kanban configurable.', detail: 'Vacantes públicas · pipeline · banco de talentos' }, { title: 'Evaluar con contexto', body: 'Combina T1–T9, Motivadores, rúbrica del puesto, ranking explicable y scorecards de entrevista.', detail: 'Perfil de trabajo · compatibilidad · entrevista' }, { title: 'Decidir e integrar', body: 'Registra la decisión, prepara la llegada y acompaña los check-ins D30, D60 y D90.', detail: 'Oferta · onboarding · check-ins' }, { title: 'Desarrollar y cuidar', body: 'Gestiona 1:1, planes de desarrollo, desempeño, OKR, LMS, clima y rutinas ligeras de RR. HH.', detail: 'Gestión · aprendizaje · operación' }], problemLabel: 'El problema', problemTitle: 'Tres productos. Cero continuidad.', problems: [{ title: 'El ATS organiza el embudo', body: 'Currículums, etapas y calendario. Excelente para volumen, débil para explicar la compatibilidad con el puesto y el equipo.' }, { title: 'La prueba se convierte en un archivo', body: 'Las pruebas independientes generan un informe bonito. En la entrevista y el 1:1, el contexto ya se perdió.' }, { title: 'Después de contratar, todo empieza de nuevo', body: 'Onboarding, LMS, OKR, clima y retención viven en otro lugar.' }], wedgeLabel: 'La diferencia', wedgeTitle: 'Una persona. Una historia. De candidato a colaborador.', wedgeBody: 'En 30Grow, la misma persona reúne perfil de trabajo, Motivadores, ranking de la vacante, brief, 1:1, planes, OKR, LMS, check-ins, clima y operaciones ligeras de RR. HH. No integras un PDF: decides y acompañas una sola historia.', outcomesLabel: 'Qué cambia', outcomesTitle: 'Resultados que los clientes perciben', outcomes: [{ title: 'Decisiones de contratación más rápidas y defendibles', body: 'Rúbrica por puesto, ranking explicable y brief de entrevista con recomendaciones prácticas.' }, { title: 'Gestores preparados para la conversación', body: 'Hipótesis de gestión, registro de 1:1 y preparación del colaborador.' }, { title: 'Menos personas que desaparecen después de contratar', body: 'Hub del colaborador, llegada D1–D90, LMS, OKR y planes de desarrollo.' }, { title: 'Una herramienta menos en la operación', body: 'Embudo, perfil, gestión de personas y operaciones ligeras en una misma jornada.' }],
  pillars: [
    { id: 'recruit', title: 'Contratar con compatibilidad', items: ['Vacantes y pipeline kanban hasta la contratación o el archivo', 'Referencia de perfil de trabajo reutilizable: define los estilos esperados y úsalos en nuevas vacantes', 'Rúbrica de perfil por puesto + ranking de compatibilidad explicable', 'Scorecard de entrevista, notas enriquecidas y banco de talentos', 'Análisis de salidas: qué ajustar en la contratación según motivos reales de desvinculación', 'Páginas públicas de vacantes para atraer candidatos', 'Informe de terna para el cliente (opinión + PDF)', 'Seguimiento básico de la oferta en el embudo', 'Métricas de efectividad: tiempo de contratación, retención y compatibilidad contratada frente al banco'] },
    { id: 'profile', title: 'Eneagrama y Motivadores que llevan a la acción', items: ['Prueba de perfil inspirada en el Eneagrama: estilos de trabajo (no es un diagnóstico clínico)', 'Motivadores: lo que da y quita energía en el día a día', 'HR Score: señales de comportamiento consolidadas (0-100) con predicción de rotación y brechas del plan de desarrollo', 'Radar de rotación: seguimiento de varias señales de riesgo de salida con acciones sugeridas', 'Brief de decisión + PDF de una página para entrevistas', 'Compatibilidad y composición del equipo (sinergia / tensión)', 'Visión general con mapa del equipo y cola de atención', 'Analítica: tendencias en el tiempo, comparación por área y alertas de anomalías'] },
    { id: 'team', title: 'Gestión, desempeño y clima', items: ['Equipo unificado: candidatos y colaboradores', '1:1 con hipótesis y próximos pasos', 'OKR ligeros (empresa / equipo / persona) con actividades asignadas a colaboradores', 'Evaluaciones de desempeño: metas, resultados, 180°/360° opcional y calibración', 'Matriz 9Box (desempeño × potencial) con lenguaje prudente', 'Feedback continuo entre pares y muro de la empresa con reconocimientos', 'Plan de sucesión: puestos críticos, sucesores y preparación', 'Encuestas de clima anónimas, pulso de grupo y resumen semanal para gestores', 'Canal de denuncias con triage de RR. HH.'] },
    { id: 'journey', title: 'Poscontratación y aprendizaje', items: ['Hub del colaborador con acceso por contraseña: tareas, llegada, planes, OKR y encuestas', 'Línea de tiempo “Mi llegada”: kit, ficha de accesos, llamadas y check-ins D30/D60/D90', 'LMS con cursos, reproductor, progreso, cuestionario y certificado', 'Academia / catálogo de aprendizaje que los planes de desarrollo pueden referenciar', 'Planes de desarrollo con progreso, ciclo y responsable', 'Catálogo de beneficios de la empresa', 'Alertas de retención con plan y revisión', 'Jornada continua en el registro de la persona'] },
    { id: 'dp', title: 'Operación ligera de RR. HH. en el mismo acceso', items: ['Ficha del colaborador: dirección, identificación fiscal y contacto de emergencia', 'Checklist de documentos con carga por parte del colaborador', 'Solicitudes de ausencias y vacaciones con saldo y adjuntos', 'Registro de jornada web (entrada / salida) en el hub del colaborador', 'Compensación interna y variable (propuesta / aprobación): no es nómina ni recibo de sueldo', 'No reemplaza la nómina completa ni las obligaciones fiscales: operación ligera en la misma cuenta'] },
  ],
  howLabel: 'Cómo empieza',
  howTitle: 'Tres pasos hasta el valor',
  trustLabel: 'Confianza',
  compareLabel: 'Posicionamiento',
  builderLabel: 'Origen',
  faqTitle: 'Preguntas comerciales',
  steps: [
    { n: '01', title: 'Empieza la prueba', body: 'Crea tu cuenta o habla con 3035Tech, recibe el acceso de gestión y configura la empresa.' },
    { n: '02', title: 'Lleva una vacante o el equipo', body: 'Invita personas por enlace (sin cuenta de candidato). Ve el ranking y el brief en una semana.' },
    { n: '03', title: 'Cierra el ciclo', body: 'Contrata con contexto y sigue llegada → hub del colaborador → 1:1 / OKR / LMS. Sin cambiar de herramienta.' },
  ],
  trustTitle: 'Lenguaje serio: límites claros',
  trustItems: ['Hipótesis de gestión (“tiende a”), nunca un diagnóstico clínico.', 'No reemplaza entrevistas técnicas ni evaluaciones de salud.', 'Eneagrama en el trabajo: perfil de estilo de trabajo, no un informe clínico.', 'Los candidatos no crean cuenta: usan el enlace que envía RR. HH. Los colaboradores pueden tener acceso con contraseña.', 'Los datos de cada empresa quedan aislados.', 'Onboarding inicial con 3035Tech y sin compromiso obligatorio.'],
  compareTitle: 'Dónde gana 30Grow (y dónde no compite)',
  compareLead: 'Sin atacar marcas: ayudar a quien compra a elegir la categoría correcta.',
  compareRows: [
    { them: 'ATS clásico (p. ej., Gupy, Greenhouse)', gap: 'Fuerte en volumen, etapas y portal de empleo.', us: '30Grow suma Eneagrama + decisión + poscontratación en la misma historia de la persona.' },
    { them: 'Prueba aislada / PDF de perfil', gap: 'Un informe que nunca entra en el flujo de RR. HH.', us: 'La prueba de perfil se convierte en brief, ranking de la vacante y guion de 1:1.' },
    { them: 'Solo compromiso / clima', gap: 'Mide el sentimiento después, desconectado de la contratación.', us: 'Clima, pulso, OKR y LMS siguen el mismo perfil con el que contrataste.' },
    { them: 'HRIS completo / nómina', gap: 'Altas fiscales, recibos de sueldo y declaraciones.', us: 'No los reemplaza: LMS y operación ligera de RR. HH. más hub del colaborador sobre el producto de perfil.' },
  ],
  builderTitle: 'Por qué 3035Tech creó 30Grow',
  builderParagraphs: [
    '30Grow nació dentro de 3035Tech: una empresa de ingeniería de software que contrata y forma equipos todo el tiempo. El dolor era nuestro: decisiones por intuición, PDF que nadie vuelve a abrir y la historia de la persona que empieza de cero después de contratar.',
    'Usamos el producto de verdad. Contratamos con él, formamos personas con 3035TEACH y gestionamos el equipo en el mismo flujo. No es una presentación: es una herramienta que sobrevivió a nuestro propio RR. HH. antes de convertirse en oferta.',
    '3035Tech la respalda como garante: ingeniería seria. El protagonista de la página, y del día a día, sigue siendo 30Grow.',
  ],
  faqLabel: 'Preguntas de compra',
  faqs: [
    { q: '¿De verdad es gratis?', a: 'Sí. Toda empresa empieza con 30 días gratis. Las primeras 20 reciben 90 días; los socios de diseño pueden negociar hasta 6 meses. Después, los planes empiezan en {monthlyPrice}/mes para hasta {firstTierMax} colaboradores, con 20% de descuento en el pago anual.' },
    { q: '¿Tengo que dejar mi ATS?', a: 'No. 30Grow incluye embudo y perfil, pero el valor central está en la decisión y la poscontratación. Muchos equipos empiezan usándolo junto a su ATS actual.' },
    { q: '¿Es otra prueba de personalidad?', a: 'No. Es una prueba de perfil de Eneagrama aplicado al trabajo + Motivadores, vinculada al puesto, al equipo, a la entrevista y al 1:1. No es un diagnóstico clínico.' },
    { q: '¿Los colaboradores también lo usan?', a: 'Sí. El portal /employee cubre llegada, encuestas, planes, OKR, LMS, operación ligera de RR. HH. y registro de jornada web. La app nativa, que se lanza en octubre de 2026, lleva Hoy, notificaciones, onboarding, encuestas, planes, OKR, evaluaciones, feedback y LMS a iOS y Android. También hay un enlace ligero /e por token, sin contraseña.' },
    { q: '¿En cuánto tiempo veo valor?', a: 'Con la primera vacante o el primer grupo del equipo: ranking, brief y un 1:1 ya superan a un PDF.' },
    { q: '¿Cómo obtengo acceso?', a: 'Haz clic en “Probar 30 días gratis” o escribe a contact@3035tech.com con la empresa y tu rol (RR. HH. / gestor).' },
  ],
  pillarsLabel: 'Qué obtienes', pillarsTitle: 'Lo que ya existe en el producto', pillarsLead: 'Funcionalidades disponibles hoy, organizadas alrededor del trabajo real de RR. HH. y el liderazgo.', employeeApp: { label: '30Grow en el móvil', eyebrow: 'App del colaborador · iOS y Android', title: 'La jornada también cabe en tu bolsillo.', body: 'La app de 30Grow ofrece a los colaboradores una experiencia nativa, enfocada y segura para revisar prioridades y actuar en pocos toques.', status: 'Lanzamiento en octubre de 2026 · iOS y Android', features: ['Hoy, notificaciones y jornada de onboarding', 'Encuestas, planes de desarrollo, OKR y evaluaciones recibidas', 'Feedback y LMS con vídeo, PDF, cuestionario y certificado', 'Acceso seguro con 2FA y cambio de empresa'], note: 'La app llega a las tiendas en octubre de 2026. Mientras tanto, el portal web del colaborador ya está disponible con las mismas jornadas.', mockup: { greeting: 'Buenos días, Marina', context: 'Tu día en 30Grow', priority: 'Prioridad de hoy', task: 'Actualizar el progreso del plan de desarrollo', progress: '2 de 4 acciones completadas', next: 'Próximos pasos', items: ['Responder la encuesta de pulso', 'Continuar el curso de liderazgo'], nav: ['Hoy', 'Jornada', 'Aprender'] } },
  hrReports: { label: 'Informes para la gestión de RR. HH.', title: 'De datos dispersos a la agenda de reuniones de personas.', body: 'Los informes de reclutamiento, progreso y retención ayudan a comparar períodos, investigar causas y elegir la próxima prioridad.', groups: [{ title: 'Contratar mejor', body: 'Tiempo de contratación, conversión del embudo, compatibilidad y adherencia a la rúbrica.', icon: 'vacancies' }, { title: 'Seguir el progreso', body: 'Productividad, retención, HR Score y contrataciones frente a salidas.', icon: 'chart' }, { title: 'Anticipar la atención', body: 'Clima, riesgo de rotación, comparaciones por área y alertas agregadas.', icon: 'climate' }], delivery: 'Filtros por período, comparación por área, exportaciones y envío semanal o mensual con PDF opcional.', guardrail: 'Los indicadores muestran dónde investigar. No toman decisiones automáticas sobre personas.', preview: { label: 'Lectura ejecutiva', title: 'Resumen de personas', period: 'Últimos 12 meses', metrics: [{ label: 'Tiempo de contratación', value: '34 días', trend: '−8%' }, { label: 'Retención 12m', value: '82%', trend: '+5%' }, { label: 'Compatibilidad contratada', value: '7,8/10', trend: '+0,6' }], trendTitle: 'Contrataciones y salidas', alertTitle: 'Agenda sugerida', alert: 'Revisa la etapa con mayor espera' } },
  earlyLabel: 'Oferta', earlyTitle: '90 días gratis para las primeras 20 empresas', earlyBody: 'Todas las empresas comienzan con 30 días gratis. Las primeras 20 reciben 90 días; los socios de diseño pueden negociar hasta 6 meses. Después, desde {monthlyPrice}/mes para hasta {firstTierMax} colaboradores.', earlyProof: ['Sin tarjeta · sin compromiso obligatorio', 'Onboarding con 3035Tech', 'Mínimo de 5 colaboradores'], earlyContact: 'O escríbenos', earlyMailSubject: '30Grow: acceso anticipado gratis', earlyMailBody: 'Hola. Quiero acceso anticipado gratis a 30Grow.\n\nEmpresa:\nNombre:\nRol (RR. HH. / gestor / liderazgo):\nTamaño aproximado del equipo:\nPrincipal problema actual (ATS / prueba PDF / poscontratación):\n', closeTitle: '¿Listo para conseguir el “sí” interno?', closeBody: 'Muestra a tu equipo una jornada desde el candidato hasta el hub del colaborador, sin otra hoja de cálculo. Empieza con 30 días gratis.', footerBrand: '30Grow', footerCred: 'Creado por 3035Tech: ingeniería de software durante unos 19 años, con clientes en Brasil, Irlanda, Estados Unidos y Alemania.', footerPricing: 'Planes y precios', footerPrivacy: 'Privacidad', footerTerms: 'Términos', footerLegal: 'Software de RR. HH. con Eneagrama, Motivadores y reclutamiento. Hipótesis de gestión, no diagnóstico.', skipToContent: 'Saltar al contenido',
};

function mergeCopy(base, override) {
  if (!override || typeof override !== 'object' || Array.isArray(override)) return override ?? base;
  const out = { ...base };
  for (const [key, value] of Object.entries(override)) {
    out[key] = value && typeof value === 'object' && !Array.isArray(value)
      ? mergeCopy(base?.[key] || {}, value)
      : value;
  }
  return out;
}

COPY['es-419'] = mergeCopy(COPY.en, SPANISH_LANDING_OVERRIDES);
COPY['fr-FR'] = mergeCopy(COPY.en, frenchLandingCopy);
COPY['de-DE'] = mergeCopy(COPY.en, germanLandingCopy);

/** English landing copy before price interpolation (source for generated translations). */
export const PRODUCT_LANDING_SOURCE_COPY = COPY.en;

/** Locales with their own landing copy; other UI locales reuse the closest one. */
export const LANDING_LOCALES = ['pt-BR', 'en', 'es-419', 'fr-FR', 'de-DE'];

export function getProductLandingCopy(locale) {
  const normalized = normalizeLocale(locale);
  const loc = COPY[normalized] ? normalized : normalized.startsWith('es-') ? 'es-419' : contentLocale(normalized);
  const copy = COPY[loc];
  const { monthlyPrice, firstTierMax } = publicPricingTextValues(normalized);
  const priceText = (text) => text.replaceAll('{monthlyPrice}', monthlyPrice).replaceAll('{firstTierMax}', String(firstTierMax));
  return {
    ...copy,
    ui: { ...copy.ui, navBlog: t(normalized, 'blog.navBlog') },
    blog: {
      label: t(normalized, 'blog.landingLabel'),
      title: t(normalized, 'blog.landingTitle'),
      body: t(normalized, 'blog.landingBody'),
      readArticle: t(normalized, 'blog.readArticle'),
      readMinutes: t(normalized, 'blog.readMinutes', { n: '{n}' }),
      allPosts: t(normalized, 'blog.allPosts'),
      contentLanguageNote: t(normalized, 'blog.contentLanguageNote'),
    },
    pricingSnapshotBody: priceText(copy.pricingSnapshotBody),
    earlyBody: priceText(copy.earlyBody),
    faqs: copy.faqs.map((faq) => ({ ...faq, a: priceText(faq.a) })),
  };
}

/** Minimal copy for `PublicSiteHeader` on public pages other than the landing. */
export function getPublicHeaderCopy(locale) {
  const copy = getProductLandingCopy(locale);
  const { mainNavigation, navJourney, navModules, navPricing, navBlog } = copy.ui;
  return {
    ui: { mainNavigation, navJourney, navModules, navPricing, navBlog },
    employeeApp: { label: copy.employeeApp.label },
    navLogin: copy.navLogin,
    navEarly: copy.navEarly,
    ctaEarly: copy.ctaEarly,
  };
}

export function buildProductLandingJsonLd(locale = 'pt-BR') {
  const copy = getProductLandingCopy(locale);
  const url = productLandingAbsoluteUrl('/');
  const logo = productLandingOgImageUrl();
  const inLanguage = localeHtmlLang(locale);

  const organization = {
    '@type': 'Organization',
    '@id': `${url}#organization`,
    name: '3035Tech',
    url: 'https://3035tech.com',
    email: PRODUCT_LANDING_CONTACT_EMAIL,
    logo: { '@type': 'ImageObject', url: logo },
  };

  const software = {
    '@type': 'SoftwareApplication',
    '@id': `${url}#software`,
    name: '30Grow',
    alternateName: ['30grow', '30 Grow'],
    applicationCategory: 'BusinessApplication',
    applicationSubCategory: 'HumanResourcesApplication',
    operatingSystem: 'Web, iOS, Android',
    inLanguage: LANDING_LOCALES,
    description: copy.metaDescription,
    url,
    image: logo,
    publisher: { '@id': `${url}#organization` },
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: publicPricingCurrency(locale),
      description: copy.earlyTitle,
      availability: 'https://schema.org/InStock',
      url,
    },
    featureList: [
      ...copy.pillars.flatMap((p) => p.items),
      ...copy.hrReports.groups.map((group) => `${group.title}: ${group.body}`),
      ...copy.employeeApp.features,
    ],
    audience: {
      '@type': 'Audience',
      audienceType: 'HR managers and company leadership',
    },
  };

  const website = {
    '@type': 'WebSite',
    '@id': `${url}#website`,
    name: '30Grow',
    url,
    inLanguage: LANDING_LOCALES,
    publisher: { '@id': `${url}#organization` },
  };

  const webPage = {
    '@type': 'WebPage',
    '@id': `${url}#webpage`,
    url,
    name: copy.metaTitle,
    description: copy.metaDescription,
    inLanguage,
    isPartOf: { '@id': `${url}#website` },
    about: { '@id': `${url}#software` },
    primaryImageOfPage: { '@type': 'ImageObject', url: logo },
    speakable: {
      '@type': 'SpeakableSpecification',
      cssSelector: ['#produto-hero', '#gancho', '#oferta', '#faq'],
    },
  };

  const faqPage = {
    '@type': 'FAQPage',
    '@id': `${url}#faq`,
    mainEntity: copy.faqs.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };

  return serializeJsonLdForScript({
    '@context': 'https://schema.org',
    '@graph': [organization, website, software, webPage, faqPage],
  });
}

export function buildProductLlmsTxt() {
  const pt = getProductLandingCopy('pt-BR');
  const en = getProductLandingCopy('en');
  const es = getProductLandingCopy('es-419');
  const base = appBaseUrl() || 'https://team.3035service.com';
  const lines = [
    '# 30Grow',
    `> ${pt.metaDescription}`,
    '',
    `Canonical: ${base}/`,
    `Publisher: 3035Tech`,
    `Contact: ${PRODUCT_LANDING_CONTACT_EMAIL}`,
    `Offer: 30-day trial; 90 days free for the first 20 companies. Fixed monthly price per band of active employees, from ${publicPricingTextValues('pt-BR').monthlyPrice} (Brazil, pt-BR) or ${publicPricingTextValues('en').monthlyPrice} (other locales) for up to ${publicPricingTextValues('en').firstTierMax} employees; above ${PUBLIC_PRICING_MAX_EMPLOYEES} employees by quote.`,
    `Languages: pt-BR, en, es-419`,
    '',
    '## Sales positioning',
    '- Category: recruiting + work-profile assessment + people management + light HR operations (not payroll or a clinical assessment).',
    '- Competitors / alternatives: classic ATS (Gupy, Greenhouse…), standalone profile PDFs, climate-only tools, full HRIS/payroll.',
    '- Wedge: one person record from candidate to employee (funnel → brief → 1:1 → hub / LMS / OKRs / D1–D90 / light HR ops / climate).',
    '',
    '## Summary (pt-BR)',
    pt.heroLead,
    pt.heroBody,
    '',
    '## Summary (en)',
    en.heroLead,
    en.heroBody,
    '',
    '## Summary (es-419)',
    es.heroLead,
    es.heroBody,
    '',
    '## Capabilities (buyer language)',
  ];
  for (const pillar of pt.pillars) {
    lines.push(`### ${pillar.title}`);
    for (const item of pillar.items) lines.push(`- ${item}`);
    lines.push('');
  }
  lines.push('### App do colaborador');
  lines.push(pt.employeeApp.body);
  for (const item of pt.employeeApp.features) lines.push(`- ${item}`);
  lines.push(`- Status: ${pt.employeeApp.status}`);
  lines.push('');
  lines.push('### Relatórios para gestão de RH');
  lines.push(pt.hrReports.body);
  for (const group of pt.hrReports.groups) lines.push(`- ${group.title}: ${group.body}`);
  lines.push(`- Entrega: ${pt.hrReports.delivery}`);
  lines.push(`- Limite: ${pt.hrReports.guardrail}`);
  lines.push('');
  lines.push('## Dashboard modules (product)');
  for (const m of TECHNICAL_FOR_LLMS.modules) lines.push(`- ${m}`);
  lines.push('', '## Public routes (engineering; not shown on sales UI)');
  for (const u of TECHNICAL_FOR_LLMS.urls) lines.push(`- ${u.path}: ${u.use}`);
  lines.push('', '## FAQ (pt-BR)');
  for (const f of pt.faqs) {
    lines.push(`### ${f.q}`);
    lines.push(f.a);
    lines.push('');
  }
  lines.push('## FAQ (en)');
  for (const f of en.faqs) {
    lines.push(`### ${f.q}`);
    lines.push(f.a);
    lines.push('');
  }
  lines.push('## Links');
  lines.push(`- Sales landing: ${base}/`);
  lines.push(`- Pricing / plans: ${base}/pricing`);
  lines.push(`- Early access signup: ${base}/signup`);
  lines.push(`- Privacy policy: ${base}/privacy`);
  lines.push(`- Terms of use: ${base}/terms`);
  lines.push(`- Manager login: ${base}/login`);
  lines.push(`- Collaborator login: ${base}/employee/login`);
  lines.push(`- Public jobs: ${base}/jobs`);
  lines.push(`- Blog (pt-BR): ${base}/blog`);
  lines.push('');
  return `${lines.join('\n')}\n`;
}

export function buildProductLandingMetadata(locale = 'pt-BR') {
  const copy = getProductLandingCopy(locale);
  const url = productLandingAbsoluteUrl('/');
  const ogImage = productLandingOgImageUrl();
  const base = appBaseUrl();

  return {
    metadataBase: base ? new URL(base) : undefined,
    title: { absolute: copy.metaTitle },
    description: copy.metaDescription,
    keywords: copy.metaKeywords,
    authors: [{ name: '3035Tech' }],
    creator: '3035Tech',
    publisher: '3035Tech',
    category: 'business',
    alternates: {
      canonical: url,
      languages: { ...Object.fromEntries(LANDING_LOCALES.map((loc) => [loc, url])), 'x-default': url },
      types: { 'text/plain': productLandingAbsoluteUrl('/llms.txt') },
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        'max-snippet': -1,
        'max-image-preview': 'large',
        'max-video-preview': -1,
      },
    },
    openGraph: {
      type: 'website',
      url,
      title: copy.metaTitle,
      description: copy.metaDescription,
      siteName: '30Grow',
      locale: localeOpenGraph(locale),
      alternateLocale: LANDING_LOCALES.map(localeOpenGraph).filter((tag) => tag !== localeOpenGraph(locale)),
      images: [{ url: ogImage, width: 512, height: 512, alt: '30Grow' }],
    },
    twitter: {
      card: 'summary_large_image',
      title: copy.metaTitle,
      description: copy.metaDescription,
      images: [ogImage],
    },
  };
}
