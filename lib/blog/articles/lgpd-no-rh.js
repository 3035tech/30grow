import { BLOG_CATEGORY } from '../categories.js';

export default {
  slug: 'lgpd-no-rh',
  title: 'LGPD no RH: cuidados com dados de candidatos e colaboradores',
  description:
    'Boas práticas de LGPD para o RH: finalidade, base legal, minimização, acesso restrito, retenção e direitos do titular em recrutamento, perfis e gestão de pessoas.',
  keywords: ['LGPD no RH', 'proteção de dados RH', 'dados de candidatos', 'privacidade colaboradores', 'retenção de dados', 'Lei 13.709'],
  category: BLOG_CATEGORY.COMPLIANCE,
  publishedAt: '2026-09-01',
  intro:
    'O RH lida com alguns dos dados mais sensíveis da empresa: documentos, saúde, remuneração, avaliações e perfis comportamentais. A Lei Geral de Proteção de Dados (Lei 13.709/2018) exige que esse tratamento tenha finalidade, base legal e cuidado. Este artigo reúne boas práticas gerais e não substitui a orientação do jurídico ou do encarregado de dados da sua empresa.',
  sections: [
    {
      heading: 'Finalidade e base legal para cada dado',
      paragraphs: [
        'Todo dado coletado precisa de um propósito claro e de uma base legal que o justifique, como execução de contrato, cumprimento de obrigação legal, legítimo interesse ou consentimento, conforme o caso.',
        'No recrutamento, por exemplo, os dados do candidato servem para avaliar a candidatura. Reutilizá-los para outra finalidade exige avaliação própria.',
      ],
    },
    {
      heading: 'Colete só o necessário',
      paragraphs: [
        'O princípio da minimização pede que se colete apenas o indispensável para a finalidade. Formulários de candidatura costumam pedir mais do que o necessário: documentos e dados pessoais detalhados raramente são precisos antes da contratação.',
        'Revise formulários e testes periodicamente e remova campos que ninguém usa.',
      ],
    },
    {
      heading: 'Atenção especial a dados sensíveis e perfis',
      paragraphs: [
        'Dados de saúde, por exemplo, são considerados sensíveis pela LGPD e exigem cuidado redobrado. Perfis comportamentais, avaliações e anotações de entrevista também merecem acesso restrito e linguagem cuidadosa, porque influenciam decisões sobre a pessoa.',
        'Evite conclusões definitivas em registros. Linguagem de hipótese ("tende a", "há indícios de") é mais justa e reduz o risco de decisões mal fundamentadas.',
      ],
    },
    {
      heading: 'Acesso restrito por papel',
      paragraphs: [
        'Nem todo gestor precisa ver tudo. Remuneração, documentos e resultados de perfil devem ser acessíveis apenas a quem precisa deles para a sua função.',
        'Registre quem acessou e alterou informações sensíveis. Trilhas de auditoria ajudam a responder incidentes e solicitações.',
      ],
    },
    {
      heading: 'Retenção e descarte',
      paragraphs: [
        'Defina por quanto tempo cada tipo de dado será mantido. Candidatos não contratados, por exemplo, não devem ficar indefinidamente na base sem uma finalidade clara, como um banco de talentos informado ao titular.',
        'Ao final do prazo, descarte ou anonimize de forma segura, inclusive em backups e exportações.',
      ],
    },
    {
      heading: 'Direitos do titular',
      paragraphs: [
        'Candidatos e colaboradores podem pedir acesso, correção, informações sobre o compartilhamento e, em certas situações, a eliminação dos seus dados. Tenha um processo simples para receber e responder essas solicitações dentro dos prazos.',
      ],
    },
    {
      heading: 'Como o 30Grow apoia a privacidade',
      paragraphs: [
        'O 30Grow isola os dados por empresa, controla o acesso a módulos por papel (por exemplo, remuneração e DP), registra auditoria das ações sensíveis, usa links por token para candidatos sem criar contas e aplica rotinas de retenção. Os relatórios de perfil usam linguagem de hipótese e deixam claro que não são diagnóstico.',
      ],
    },
  ],
  takeaways: [
    'Cada dado precisa de finalidade e base legal claras.',
    'Colete só o necessário e revise formulários periodicamente.',
    'Restrinja o acesso por papel e mantenha trilha de auditoria.',
    'Defina prazos de retenção e um processo para os direitos do titular.',
  ],
  faq: [
    {
      q: 'Posso manter currículos de candidatos não aprovados?',
      a: 'Pode, desde que haja finalidade definida, como um banco de talentos, transparência com o candidato e prazo de retenção. Avalie a base legal com o jurídico da empresa.',
    },
    {
      q: 'Resultados de testes de perfil são dados pessoais?',
      a: 'Sim. Eles se referem a uma pessoa identificada e influenciam decisões sobre ela, por isso devem ter acesso restrito e finalidade clara.',
    },
  ],
};
