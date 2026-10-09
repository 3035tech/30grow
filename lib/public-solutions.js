import { normalizeLocale } from './locale-negotiation.js';
import { getProductLandingCopy, buildProductLandingMetadata, productLandingAbsoluteUrl } from './product-landing-seo.js';
import { publicMarketingPath, publicLanguageAlternates } from './public-marketing-paths.js';
import { publicSiteBaseUrl } from './public-site-url.js';

const COPY = {
  pt: {
    label: 'Soluções de RH', features: 'O que você pode fazer', journey: 'Como usar no dia a dia', related: 'Conheça outras soluções',
    titles: ['Software de recrutamento e seleção (ATS)', 'Eneagrama no trabalho e Motivadores', 'Gestão de desempenho e pesquisa de clima', 'Onboarding de colaboradores e LMS corporativo', 'Departamento Pessoal e rotinas de RH', 'Organograma e gestão de pessoas'],
    bodies: [
      'Organize vagas, candidaturas e etapas de seleção em um só lugar. O 30Grow conecta o pipeline de recrutamento aos perfis de trabalho e à rubrica da vaga, para que RH e gestores discutam a contratação com critérios claros. Depois da contratação, o histórico da pessoa acompanha sua entrada na equipe.',
      'Use os perfis T1–T9 e Motivadores para preparar entrevistas, conversas de liderança e planos de desenvolvimento. O perfil ajuda a formular hipóteses de gestão e perguntas melhores; a decisão continua com as pessoas. As avaliações não são diagnósticos clínicos e devem ser interpretadas com contexto.',
      'Acompanhe desempenho, planos de desenvolvimento individual, objetivos e conversas 1:1. Pesquisas de clima e pulsos ajudam a ouvir a equipe, enquanto os registros de acompanhamento dão contexto às próximas ações. O 30Grow conecta essas rotinas ao histórico do colaborador, para dar continuidade ao desenvolvimento.',
      'Dê continuidade à contratação com check-ins de onboarding, cursos e trilhas de aprendizagem. O LMS conecta cursos, cargos e desenvolvimento, enquanto o hub do colaborador reúne as atividades da pessoa. RH e liderança podem acompanhar a chegada e identificar o que precisa de atenção ao longo da jornada.',
      'Mantenha informações cadastrais, documentos e rotinas leves de Departamento Pessoal junto ao histórico da pessoa. O 30Grow aproxima a operação de RH do recrutamento e do desenvolvimento, reduzindo a necessidade de consultar registros separados. Confira as funcionalidades disponíveis; a plataforma não substitui uma folha de pagamento completa.',
      'Organize unidades, áreas e relações de liderança para entender a estrutura da empresa. Cargos, responsabilidades e informações da equipe ajudam RH e gestores a conectar a organização aos processos de contratação e desenvolvimento. O organograma dá uma visão comum da estrutura que acompanha a operação.',
    ],
  },
  en: {
    label: 'HR solutions', features: 'What you can do', journey: 'How to use it at work', related: 'Explore other solutions',
    titles: ['Recruiting and applicant tracking software (ATS)', 'Enneagram at work and Motivators', 'Performance management and employee engagement surveys', 'Employee onboarding and corporate LMS', 'HR operations and employee records', 'Organization charts and people management'],
    bodies: [
      'Organize jobs, applications, and hiring stages in one place. 30Grow connects your recruiting pipeline to work profiles and job rubrics so HR and managers can discuss hiring with clear criteria. When someone joins the company, their history continues into the team.',
      'Use T1–T9 profiles and Motivators to prepare interviews, leadership conversations, and development plans. Profiles support management hypotheses and better questions; people remain responsible for decisions. Assessments are not clinical diagnoses and require context.',
      'Follow performance, individual development plans, objectives, and one-to-one conversations. Engagement surveys and group pulses help you listen to your team, while follow-up records provide context for action. 30Grow connects these routines to each employee’s history to support ongoing development.',
      'Continue the hiring journey with onboarding check-ins, courses, and learning paths. The LMS connects courses, roles, and development, while the employee hub brings personal activities together. HR and managers can follow the arrival and identify what needs attention along the way.',
      'Keep employee records, documents, and lightweight HR routines alongside each person’s history. 30Grow connects HR operations to recruiting and development, reducing the need to consult separate records. Review the available features; this is not a replacement for a complete payroll system.',
      'Organize units, departments, and reporting relationships to understand your company structure. Roles, responsibilities, and team information connect organization to hiring and development processes. The organization chart provides a shared view of the structure behind everyday operations.',
    ],
  },
  es: {
    label: 'Soluciones de RR. HH.', features: 'Qué puedes hacer', journey: 'Cómo usarlo en el trabajo', related: 'Conoce otras soluciones',
    titles: ['Software de reclutamiento y selección (ATS)', 'Eneagrama en el trabajo y Motivadores', 'Gestión del desempeño y encuestas de clima', 'Onboarding de colaboradores y LMS corporativo', 'Operaciones de RR. HH. y registros de colaboradores', 'Organigrama y gestión de personas'],
    bodies: [
      'Organiza vacantes, candidaturas y etapas de selección en un mismo lugar. 30Grow conecta el pipeline con los perfiles de trabajo y la rúbrica del puesto para que RR. HH. y gestores conversen con criterios claros. Después de contratar, el historial de la persona continúa en el equipo.',
      'Usa perfiles T1–T9 y Motivadores para preparar entrevistas, conversaciones de liderazgo y planes de desarrollo. Los perfiles ayudan a formular hipótesis de gestión y mejores preguntas; las decisiones siguen en manos de las personas. Las evaluaciones no son diagnósticos clínicos y requieren contexto.',
      'Acompaña el desempeño, los planes individuales de desarrollo, los objetivos y las conversaciones 1:1. Las encuestas de clima y los pulsos permiten escuchar al equipo, mientras los registros dan contexto a las próximas acciones. Estas rutinas se conectan con el historial del colaborador.',
      'Da continuidad a la contratación con check-ins de onboarding, cursos y rutas de aprendizaje. El LMS conecta cursos, puestos y desarrollo; el portal del colaborador reúne sus actividades. RR. HH. y líderes pueden acompañar la llegada e identificar lo que necesita atención.',
      'Mantén datos de registro, documentos y rutinas ligeras de RR. HH. junto al historial de cada persona. 30Grow acerca la operación al reclutamiento y al desarrollo, reduciendo las consultas a registros separados. Revisa las funciones disponibles; no sustituye un sistema completo de nómina.',
      'Organiza unidades, áreas y relaciones de liderazgo para entender la estructura de la empresa. Los puestos, responsabilidades y datos del equipo conectan la organización con la contratación y el desarrollo. El organigrama ofrece una visión compartida de la estructura de trabajo.',
    ],
  },
  fr: {
    label: 'Solutions RH', features: 'Ce que vous pouvez faire', journey: 'Utilisation au quotidien', related: 'Découvrez les autres solutions',
    titles: ['Logiciel de recrutement et de suivi des candidatures (ATS)', 'Ennéagramme au travail et Motivateurs', 'Gestion de la performance et enquêtes de climat', 'Intégration des collaborateurs et LMS', 'Opérations RH et dossiers des collaborateurs', 'Organigramme et gestion des personnes'],
    bodies: [
      'Organisez les offres, candidatures et étapes de recrutement au même endroit. 30Grow relie le pipeline aux profils de travail et à la grille du poste pour des échanges fondés sur des critères clairs. Après l’embauche, l’historique de la personne accompagne son arrivée dans l’équipe.',
      'Utilisez les profils T1–T9 et les Motivateurs pour préparer les entretiens, les échanges de management et les plans de développement. Les profils aident à formuler des hypothèses et de meilleures questions ; les décisions restent humaines. Les évaluations ne sont pas des diagnostics cliniques et nécessitent du contexte.',
      'Suivez la performance, les plans de développement individuels, les objectifs et les échanges individuels. Les enquêtes de climat et les sondages réguliers permettent d’écouter l’équipe. Les comptes rendus apportent du contexte aux prochaines actions et s’inscrivent dans l’historique du collaborateur.',
      'Prolongez le recrutement avec des points de suivi d’intégration, des cours et des parcours de formation. Le LMS relie cours, postes et développement, tandis que le portail du collaborateur regroupe ses activités. RH et managers peuvent suivre l’arrivée et les besoins d’accompagnement.',
      'Conservez les données administratives, documents et routines RH légères avec l’historique de chaque personne. 30Grow rapproche les opérations du recrutement et du développement pour limiter la consultation de dossiers séparés. Vérifiez les fonctions disponibles ; il ne remplace pas un système complet de paie.',
      'Organisez les unités, services et relations hiérarchiques pour comprendre la structure de l’entreprise. Postes, responsabilités et informations de l’équipe relient l’organisation au recrutement et au développement. L’organigramme donne une vision commune de cette structure.',
    ],
  },
  de: {
    label: 'HR-Lösungen', features: 'Ihre Möglichkeiten', journey: 'So nutzen Sie es im Alltag', related: 'Weitere Lösungen entdecken',
    titles: ['Recruiting-Software und Bewerbermanagement (ATS)', 'Enneagramm am Arbeitsplatz und Motivatoren', 'Performance-Management und Mitarbeiterbefragungen', 'Mitarbeiter-Onboarding und Unternehmens-LMS', 'HR-Prozesse und Mitarbeiterdaten', 'Organigramm und Personalmanagement'],
    bodies: [
      'Organisieren Sie Stellen, Bewerbungen und Auswahlphasen an einem Ort. 30Grow verbindet die Recruiting-Pipeline mit Arbeitsprofilen und Bewertungskriterien für die Stelle. So sprechen HR und Führungskräfte auf einer gemeinsamen Grundlage. Nach der Einstellung wird die Historie im Team fortgeführt.',
      'Nutzen Sie T1–T9-Profile und Motivatoren für Interviews, Führungsgespräche und Entwicklungspläne. Die Profile helfen bei Managementhypothesen und besseren Fragen; Entscheidungen bleiben bei den Menschen. Die Bewertungen sind keine klinischen Diagnosen und benötigen Kontext.',
      'Begleiten Sie Performance, individuelle Entwicklungspläne, Ziele und Einzelgespräche. Mitarbeiterbefragungen und regelmäßige Stimmungsabfragen helfen, das Team zu verstehen. Gesprächsaufzeichnungen geben den nächsten Schritten Kontext und werden mit der Historie der Person verbunden.',
      'Führen Sie die Einstellung mit Onboarding-Check-ins, Kursen und Lernpfaden fort. Das LMS verbindet Kurse, Rollen und Entwicklung; im Mitarbeiterportal stehen die persönlichen Aktivitäten zusammen. HR und Führungskräfte können die Ankunft und den Unterstützungsbedarf begleiten.',
      'Halten Sie Stammdaten, Dokumente und schlanke HR-Routinen gemeinsam mit der Historie jeder Person fest. 30Grow verbindet die Abläufe mit Recruiting und Entwicklung und reduziert getrennte Informationsquellen. Prüfen Sie die verfügbaren Funktionen; eine vollständige Lohnabrechnung wird nicht ersetzt.',
      'Organisieren Sie Einheiten, Abteilungen und Führungsbeziehungen, um die Unternehmensstruktur zu verstehen. Rollen, Verantwortlichkeiten und Teaminformationen verbinden die Organisation mit Einstellung und Entwicklung. Das Organigramm schafft eine gemeinsame Sicht auf die Struktur.',
    ],
  },
};

export function solutionCopy(locale) {
  return COPY[normalizeLocale(locale).slice(0, 2)] || COPY.en;
}

export function getPublicSolutions(locale) {
  const landing = getProductLandingCopy(locale);
  const copy = solutionCopy(locale);
  return landing.pillars.map((pillar, index) => ({
    index, title: copy.titles[index], body: copy.bodies[index],
    path: publicMarketingPath(locale, 'solution', index),
    items: pillar.items,
  }));
}

export function buildSolutionMetadata(locale, index) {
  const solution = getPublicSolutions(locale)[index];
  const metadata = buildProductLandingMetadata(locale);
  const title = `${solution.title} | 30Grow`;
  const description = solution.body.split('. ')[0] + '.';
  const url = productLandingAbsoluteUrl(solution.path);
  return {
    ...metadata, title: { absolute: title }, description,
    keywords: [solution.title, '30Grow'],
    alternates: { canonical: url, languages: publicLanguageAlternates('solution', index, publicSiteBaseUrl()) },
    openGraph: { ...metadata.openGraph, url, title, description },
    twitter: { ...metadata.twitter, title, description },
  };
}
