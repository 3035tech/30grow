/**
 * Help assistant — product Q&A only (Guia / navigation).
 * Prefer FAQ (0 LLM tokens) then lexical retrieval + cheap chat.
 */

import { messageNode, normalizeLocale, t, t as i18nT, contentLocale } from './i18n.js';
import { isOpenAiConfigured, openAiChatCompletion } from './openai-chat.js';
import { AI_BLOCK_CODE, AI_FEATURE, aiUsageContext } from './ai-usage.js';
import { HELP_GUIDE_SECTIONS, HELP_SECTION_STEP_COUNTS, TAB_BY_HELP_SECTION } from './help-sections.js';
import {
  buildContextualTipsAnswer,
  helpMetaForTab,
  helpScreenPurpose,
  helpSuggestionLabels,
  helpTabLabel,
  isContextualHelpIntent,
} from './help-screen-context.js';

/** @deprecated use HELP_GUIDE_SECTIONS */
const HELP_SECTIONS = HELP_GUIDE_SECTIONS;

const TAB_BY_SECTION = TAB_BY_HELP_SECTION;

/** FAQ: zero-token answers when the query matches strongly. */
const FAQ = [
  {
    id: 'reports',
    patterns: [
      /relat[oó]rios?\s+(de\s+)?(rh|pessoas|gest[aã]o)/i,
      /onde\s+(vejo|ver)\s+(os\s+)?indicadores/i,
      /m[eé]tricas?\s+(de\s+)?(contrata[cç][aã]o|reten[cç][aã]o)/i,
      /comparar\s+[aá]reas/i,
      /hr\s+reports?/i,
      /people\s+reports?/i,
      /hiring\s+(metrics|reports?)/i,
      /compare\s+(teams|areas)/i,
    ],
    section: 'reports',
    answerKey: 'panel.helpAssist.faqReports',
  },
  {
    id: 'setup-path',
    patterns: [
      /sou\s+novo/i,
      /acab(ei|ou)\s+de\s+(chegar|entrar)/i,
      /como\s+(comecar|configurar)\s+(o\s+)?(sistema|painel|30\s*team)/i,
      /o\s+que\s+(cadastrar|configurar|fazer)\s+antes/i,
      /pr[eé]\s*-?\s*requisito/i,
      /depend[eê]ncia/i,
      /passo\s+a\s+passo\s+(de\s+)?(tudo|config)/i,
      /pegar\s+(na|pela)\s+m[aã]o/i,
      /roteiro\s+de\s+configura/i,
      /ordem\s+(de\s+)?(cadastro|configura)/i,
      /i\s+am\s+new/i,
      /just\s+(got\s+here|arrived)/i,
      /how\s+(do\s+i\s+)?(start|set\s*up|configure)\s+(the\s+)?(system|panel|30\s*team)/i,
      /what\s+(to\s+)?(set\s*up|register|configure)\s+before/i,
      /prerequisit/i,
      /dependenc(y|ies)/i,
      /setup\s+(path|walkthrough|guide)/i,
      /hand[\s-]?hold/i,
    ],
    section: 'setupPath',
    answerKey: 'panel.helpAssist.faqSetupPath',
  },
  {
    id: 'screens-map',
    patterns: [
      /para\s+que\s+serve\s+(cada\s+)?(tela|aba)/i,
      /mapa\s+(das?\s+)?(telas|abas)/i,
      /o\s+que\s+[eé]\s+cada\s+(tela|aba)/i,
      /what\s+(is|are)\s+each\s+(screen|tab)/i,
      /screen\s+map|map\s+of\s+(screens|tabs)/i,
      /explain\s+(all\s+)?(the\s+)?(screens|tabs)/i,
    ],
    section: 'screens',
    answerKey: 'panel.helpAssist.faqScreens',
  },
  {
    id: 'system-tips',
    patterns: [
      /dicas?\s+do\s+sistema/i,
      /sugest(o|õ)es?\s+(do\s+)?sistema/i,
      /system\s+tips?/i,
      /system\s+suggestions?/i,
      /quick\s+tips/i,
      /dicas?\s+rapidas?/i,
    ],
    section: 'tips',
    answerKey: null, // resolved in matchHelpFaq via contextual builder
    contextual: 'system',
  },
  {
    id: 'product-feedback',
    patterns: [
      /sugerir\s+(melhoria|funcionalidade|ideia)/i,
      /enviar\s+(sugest|feedback|ideia)/i,
      /como\s+(pe[cç]o|envio|mando)\s+(melhoria|feature|ideia)/i,
      /suggest\s+(improvement|feature|idea)/i,
      /send\s+(feedback|suggestion|idea)/i,
      /feature\s+request/i,
      /product\s+feedback/i,
      /(falar|contato|contatar)\s+(com\s+)?(o\s+)?suporte/i,
      /prazo\s+de\s+resposta|abrir\s+chamado|reportar\s+(um\s+)?(bug|problema|erro)/i,
      /(contact|reach)\s+support|support\s+(channel|ticket)|response\s+time|report\s+a\s+(bug|problem)/i,
    ],
    section: 'productFeedback',
    answerKey: 'panel.helpAssist.faqProductFeedback',
  },
  {
    id: 'company-feed',
    patterns: [
      /mural/i,
      /\bkudos\b/i,
      /reconheciment/i,
      /company\s+feed/i,
      /peer\s+recognition/i,
      /aviso(s)?\s+(da\s+)?empresa/i,
    ],
    section: 'companyFeed',
    answerKey: 'panel.helpAssist.faqCompanyFeed',
  },
  {
    id: 'interview-prep',
    patterns: [
      /prep\s+(de\s+)?entrevista/i,
      /interview\s+prep/i,
      /prepara(r|ção|cao)\s+(para\s+)?(a\s+)?entrevista/i,
      /\/prep\b/i,
      /candidato\s+se\s+prepar/i,
      /candidate\s+prepar/i,
    ],
    section: 'interviewPrep',
    answerKey: 'panel.helpAssist.faqInterviewPrep',
  },
  {
    id: 'leave-balance',
    patterns: [
      /\bsaldo\s+(de\s+)?f[eé]rias\b/i,
      /vacation\s+balance/i,
      /leave\s+balance/i,
      /direito\s+(anual|de\s+f[eé]rias)/i,
      /entitlement\s+(days|vacation)/i,
    ],
    section: 'dpLight',
    answerKey: 'panel.helpAssist.faqLeaveBalance',
  },
  {
    id: 'hour-bank',
    patterns: [
      /banco\s+de\s+horas/i,
      /hour\s*bank/i,
      /horas?\s+extras?/i,
      /compensat(ory|ion)\s+time/i,
      /comp\s*time/i,
    ],
    section: 'hourBank',
    answerKey: 'panel.helpAssist.faqHourBank',
  },
  {
    id: 'rehire',
    patterns: [
      /reativar/i,
      /recontrat/i,
      /ex-?colaborador/i,
      /voltou\s+(para|pra)\s+(a\s+)?empresa/i,
      /rehire/i,
      /reactivat/i,
      /former\s+employee/i,
    ],
    section: 'b1000Exit',
    answerKey: 'panel.helpAssist.faqRehire',
  },
  {
    id: 'time-clock',
    patterns: [
      /\bponto\b/i,
      /bater\s+(o\s+)?ponto/i,
      /time\s*clock/i,
      /clock\s*in/i,
      /clock\s*out/i,
      /espelho\s+do\s+dia/i,
      /day\s+mirror/i,
      /espelho\s+de\s+ponto/i,
      /fechamento\s+(de\s+|do\s+)?ponto/i,
      /timesheet/i,
      /justificar\s+(o\s+)?dia/i,
      /(pj|cooperad[oa]|contractor)\b.*\bponto\b|\bponto\b.*\b(pj|cooperad[oa])\b/i,
      /sem\s+(controle\s+de\s+)?ponto/i,
      /(localiza[cç][aã]o|geoloc|mapa|gps).*(ponto|batida)|(ponto|batida).*(localiza[cç][aã]o|geoloc|mapa|gps)/i,
      /punch.*(location|map)|(location|map).*punch/i,
      /(pedido|pedir|solicita[cç][aã]o).*(ajuste|abono)|(ajuste|abono).*(ponto|aprova)/i,
      /(adjustment|excuse).*(request|approv)|(request|approv).*(adjustment|excuse)/i,
      /feriados?|jornada\s+(do|de|por)\s+colaborador|escala\s+(pr[oó]pria|individual)/i,
      /holidays?|(work|employee)\s+schedule/i,
    ],
    section: 'timeClock',
    answerKey: 'panel.helpAssist.faqTimeClock',
  },
  {
    id: 'dp-light',
    patterns: [
      /\bdp\b/i,
      /f[eé]rias/i,
      /afastamento/i,
      /documentos?\s+(do\s+)?(dp|rh|admiss)/i,
      /checklist\s+document/i,
  /\bsaldo\s+(de\s+)?f[eé]rias\b/i,
  /vacation\s+balance/i,
  /leave\s+balance/i,
  /leave\s+request/i,
  /vacation\s+request/i,
  /hr\s+ops/i,
    ],
    section: 'dpLight',
    answerKey: 'panel.helpAssist.faqDpLight',
  },
  {
    id: 'ai-limit',
    patterns: [
      /limite\s+(de\s+)?(uso\s+(de\s+)?)?(ia|intelig[eê]ncia\s+artificial)\b/i,
      /\bia\s+(n[aã]o\s+(funciona|responde)|indispon[ií]vel|parou|bloquead[ao]|pausad[ao])/i,
      /\bai\s+(usage\s+)?limit/i,
      /\bai\s+(is\s+)?(unavailable|not\s+working|blocked|paused)/i,
    ],
    section: 'access',
    answerKey: 'panel.helpAssist.faqAiLimit',
  },
  {
    id: 'talent-bank',
    patterns: [
      /banco\s+de\s+talentos/i,
      /talent\s*bank/i,
      /reaproveitar\s+candidat/i,
      /reuse\s+(a\s+)?candidat/i,
    ],
    section: 'talentBank',
  },
  {
    id: 'create-vacancy',
    patterns: [/criar\s+(uma\s+)?vaga/i, /nova\s+vaga/i, /new\s+vacanc/i, /create\s+(a\s+)?vacanc/i],
    section: 'vacancies',
    answerKey: 'panel.helpAssist.faqCreateVacancy',
  },
  {
    id: 'first-week',
    patterns: [
      /primeira\s+semana/i,
      /first\s+week/i,
      /7\s+dias/i,
      /risco.*fit.*pdi/i,
      /risk.*fit.*idp/i,
      /como\s+ativar/i,
      /get\s+started\s+week/i,
    ],
    section: 'firstWeek',
    answerKey: 'panel.helpAssist.faqFirstWeek',
  },
  {
    id: 'hire',
    patterns: [/contrat/i, /\bhire\b/i, /marcar\s+contrat/i, /pronto\s+para\s+contrat/i],
    section: 'pipeline',
    answerKey: 'panel.helpAssist.faqHire',
  },
  {
    id: 'motivators',
    patterns: [/motivador/i, /motivator/i],
    section: 'motivators',
    answerKey: 'panel.helpAssist.faqMotivators',
  },
  {
    id: 'climate',
    // Product climate — not weather ("clima amanhã").
    patterns: [
      /pesquisa\s+de\s+clima/i,
      /climate\s+survey/i,
      /aba\s+clima/i,
      /\/clima\b/i,
      /\bclima\b(?!\s+(amanh[aã]|hoje|tempo|chuv|sol))/i,
    ],
    section: 'climate',
    answerKey: 'panel.helpAssist.faqClimate',
  },
  {
    id: 'enneagram',
    patterns: [/eneagrama/i, /enneagram/i, /\bt[1-9]\b/i, /enviar\s+teste/i],
    section: 'enneagram',
    answerKey: 'panel.helpAssist.faqEnneagram',
  },
  {
    id: 'public-page',
    patterns: [/p[aá]gina\s+p[uú]blica/i, /\/j\b/i, /\/jobs\b/i, /seo/i, /public\s+page/i],
    section: 'publicVacancy',
    answerKey: 'panel.helpAssist.faqPublicPage',
  },
  {
    id: 'guide',
    patterns: [/guia/i, /\bhelp\b/i, /ajuda/i, /onde\s+(fico|est[aá]|acho)/i],
    section: 'welcome',
    answerKey: 'panel.helpAssist.faqGuide',
  },
  {
    id: 'why-missing',
    patterns: [
      /por\s+que\s+(n[aã]o\s+)?(aparece|vejo|acho)/i,
      /why\s+(is\s+it\s+)?missing/i,
      /why\s+(can'?t|dont|don'?t)\s+i\s+see/i,
      /n[aã]o\s+(aparece|acho)\s+(na\s+)?(equipe|lista)/i,
    ],
    section: 'team',
    answerKey: 'panel.helpAssist.faqWhyMissing',
  },
  {
    id: 'employee-journey',
    patterns: [
      /minha\s+chegada/i,
      /jornada\s+de\s+chegada/i,
      /checklist\s+d1/i,
      /kit\s+de\s+boas[\s-]?vindas/i,
      /folha\s+de\s+acessos/i,
      /d30|d60|d90/i,
      /check[\s-]?in\s+p[oó]s/i,
      /arrival\s+journey/i,
      /my\s+arrival/i,
      /day[\s-]?1\s+checklist/i,
    ],
    section: 'b700Onboarding',
    answerKey: 'panel.helpAssist.faqEmployeeJourney',
  },
  {
    id: 'colaborador',
    patterns: [
      /\/employee/i,
      /\/e\b/i,
      /espaco\s+do\s+colaborador/i,
      /login\s+do\s+colaborador/i,
      /convidar\s+acesso/i,
      /collaborator\s+(login|space)/i,
      /employee\s+portal/i,
      /app(?:licativo)?\s+(?:do\s+)?colaborador/i,
      /collaborator\s+(?:mobile\s+)?app/i,
      /employee\s+(?:mobile\s+)?app/i,
      /link\s+do\s+colaborador/i,
    ],
    section: 'employeeHome',
    answerKey: 'panel.helpAssist.faqColaborador',
  },
  {
    id: '2fa',
    patterns: [
      /\b2fa\b/i,
      /dois\s+fatores/i,
      /autenticador/i,
      /google\s+authenticator/i,
      /totp/i,
      /two[\s-]?factor/i,
    ],
    section: 'access',
    answerKey: 'panel.helpAssist.faq2fa',
  },
  {
    id: 'audit',
    patterns: [/auditoria/i, /audit\s+log/i, /log\s+de\s+auditoria/i],
    section: 'access',
    answerKey: 'panel.helpAssist.faqAudit',
  },
  {
    id: 'compensation',
    patterns: [
      /lista\s+(de\s+)?salario/i,
      /salarios?\s+unificad/i,
      /unified\s+(salary|compensation)/i,
      /compensation\s+list/i,
      /tab=compensation/i,
      /remuneracao(\s+interna)?/i,
      /internal\s+compensation/i,
      /\bcompensation\s+tab\b/i,
      /historico\s+(de\s+)?salario/i,
      /salario\s+vigente/i,
      /aumento\s+salarial/i,
      /\breajuste\b/i,
      /novo\s+salario/i,
      /(registrar|cadastrar|adicionar|lancar)\s+(o\s+)?salario/i,
      /(salario|remuneracao|reajuste|aumento).{0,48}(equipe|colaborador|funcionario|contratado)/i,
      /(equipe|colaborador|funcionario|contratado).{0,48}(salario|remuneracao|reajuste|aumento)/i,
      /onde\s+.*(salario|remuneracao|reajuste).{0,40}(equipe|colaborador|funcionario|contratado|painel)?/i,
      /salary\s+(raise|increase|history|current|record)/i,
      /(add|register|log)\s+(a\s+)?salary/i,
      /(salary|compensation|raise).{0,48}(team|employee|hired)/i,
      /(team|employee|hired).{0,48}(salary|compensation|raise)/i,
      /where\s+.*(salary|compensation).{0,40}(team|employee)?/i,
    ],
    section: 'compensation',
    answerKey: 'panel.helpAssist.faqCompensation',
  },
  {
    id: 'lms',
    patterns: [/\blms\b/i, /curso\s+lms/i, /meus\s+cursos/i, /matricul/i],
    section: 'lmsBasic',
    answerKey: 'panel.helpAssist.faqLms',
  },
  {
    id: 'okr',
    patterns: [
      /\bokr\b/i,
      /okrs\b/i,
      /objetivos?\s+e\s+resultados/i,
      /objectives?\s+and\s+key\s+results/i,
      /ciclo\s+okr/i,
      /okr\s+cycle/i,
      /meus\s+okrs/i,
      /my\s+okrs/i,
    ],
    section: 'b3000Pack',
    answerKey: 'panel.helpAssist.faqOkr',
  },
  {
    id: 'whistleblowing',
    patterns: [
      /ouvidoria/i,
      /whistleblow/i,
      /canal\s+de\s+den[uú]ncia/i,
      /speak[\s-]?up/i,
      /\/ouvidoria/i,
    ],
    section: 'b3005Pack',
    answerKey: 'panel.helpAssist.faqWhistleblowing',
  },
  {
    id: 'variable-pay',
    patterns: [
      /remunera[cç][aã]o\s+vari[aá]vel/i,
      /variable\s+pay/i,
      /\bb[oô]nus\b/i,
      /\bbonus\b/i,
      /\bplr\b/i,
      /aprovar\s+b[oô]nus/i,
    ],
    section: 'b3000Pack',
    answerKey: 'panel.helpAssist.faqVariablePay',
  },
  {
    id: 'dashboard-cohort',
    patterns: [
      /escolher\s+(uma\s+)?empresa/i,
      /selecion(e|ar)\s+(uma\s+)?empresa/i,
      /company\s+(filter|chip|selector|required)/i,
      /vis[aã]o\s+geral.*(empresa|vazia|pedir)/i,
      /overview.*(company|empty|pick)/i,
      /comparar.*(empresa|chip)/i,
      /compare.*(company|chip)/i,
      /needsCompanyScope/i,
      /filtro\s+de\s+empresa/i,
      /escala\s+do\s+painel/i,
      /panel\s+scale/i,
    ],
    section: 'dashboardCohort',
    answerKey: 'panel.helpAssist.faqDashboardCohort',
  },
  {
    id: 'hr-score',
    patterns: [
      /hr\s*score/i,
      /score\s+hr/i,
      /n[uú]cleo\s+hr/i,
      /7\s+sinais/i,
      /seven\s+signals/i,
    ],
    section: 'b1000HrScore',
    answerKey: 'panel.helpAssist.faqHrScore',
  },
  {
    id: 'turnover-radar',
    patterns: [
      /radar\s+de\s+rotatividade/i,
      /turnover\s+radar/i,
      /risco\s+de\s+(sa[ií]da|turnover|rotatividade)/i,
      /turnover\s+risk/i,
      /varredura\s+limitada/i,
      /limited\s+scan/i,
    ],
    section: 'b1000TurnoverRadar',
    answerKey: 'panel.helpAssist.faqTurnoverRadar',
  },
  {
    id: 'job-roles',
    patterns: [
      /job\s*roles?/i,
      /\bcargos?\b/i,
      /rubrica\s+do\s+cargo/i,
      /role\s+rubric/i,
    ],
    section: 'b1000JobRoles',
    answerKey: 'panel.helpAssist.faqJobRoles',
  },
];

/**
 * Hard refuse — product-forbidden or clearly non-product domains.
 * Runs before FAQ so "diagnóstico" never hits enneagram FAQ by accident.
 * Accent-folded match (amanhã → amanha) so `\b` works on ASCII.
 */
const HARD_OUT_OF_SCOPE =
  /\b(folha(\s+de\s+pagamento)?|holerite|ponto\s+eletronico|salario\s+liquido|imposto\s+de\s+renda|clinico|diagnostico|psicolog|psiquiat|terapia|transtorno|medicament|disc\b|mbti|linkedin|curriculo|\bcv\b|lgpd\s+exclu|receita\s+de|bolo\s+de|cozinhar|futebol|bitcoin|criptomoeda|eleicao|partido\s+politico|previsao\s+do\s+tempo|weather\b|clima\s+(amanha|hoje|tempo)|piada\b|namoro|romance)\b/i;

/** Soft off-topic — refuse only when the question lacks product hints. */
const SOFT_OUT_OF_SCOPE =
  /\b(javascript|typescript|python|react\s+hook|sql\s+injection|docker\s+compose|kubernetes|algoritmo|matematica|fisica|receita|ingrediente|filme|serie|novela|esporte|politica|governo|guerra|religiao|horoscopo|signo)\b/i;

/** In-scope vocabulary (panel / assessments / people modules). */
const PRODUCT_HINT =
  /\b(30grow|painel|dashboard|guia|ajuda|vaga|vacanc|candidato|candidate|eneagrama|enneagram|\bt[1-9]\b|motivador|motivator|pipeline|kanban|equipe|team\b|pdi|clima|climate|nr[\s-]?1|psicossocia|psychosocial|pgr\b|sesmt|pulso|pulse|compat|grupo|group|rubrica|rubric|contratar|hire|hired|\/t\b|\/v\b|\/e\b|\/r\b|\/jobs|\/clima|\/pulso|\/employee|\/prep|\/ouvidoria|colaborador|collaborator|assessment|recrut|triagem|screen|1:1|one[\s-]?on[\s-]?one|retencao|retention|onboarding|beneficio|academy|sucessao|succession|turnover|hr\s*score|desempenho|performance|cargo|job\s*role|overview|analytics|ranking|fit\b|nucleo|nucleus|lms|curso|meet|chegada|arrival|2fa|totp|autenticador|auditoria|audit|remuneracao|compensation|salario|salary|aumento|reajuste|dossier|d30|d60|d90|comparar|compare|seletor\s+de\s+empresa|company\s+filter|varredura|scan\s+cap|tela|aba|dica|sugest|tip\b|para\s+que\s+serve|mural|kudos|reconheciment|company\s+feed|interview\s+prep|prep\s+de\s+entrevista|saldo\s+(de\s+)?ferias|vacation\s+balance|leave\s+balance|\bokr\b|objetivos?\s+e\s+resultados|ouvidoria|whistleblow|denuncia|organograma|org\s*chart|bonus|b[oô]nus|variavel|variable\s+pay|ponto|time\s*clock|ferias|dp\s+leve|hr\s+ops|configurar|cadastrar\s+antes|passo\s+a\s+passo|prerequisit|dependenc|setup\s+path|sou\s+novo|i\s+am\s+new)\b/i;

function isSetupPathIntent(query) {
  const q = foldHelpText(query);
  return (
    /\b(sou\s+novo|acab(ei|ou)\s+de\s+(chegar|entrar)|como\s+(comecar|configurar)|o\s+que\s+(cadastrar|configurar|fazer)\s+antes|prerequisit|dependenc|passo\s+a\s+passo|pegar\s+(na|pela)\s+mao|roteiro\s+de\s+configura|ordem\s+(de\s+)?(cadastro|configura)|i\s+am\s+new|just\s+(got\s+here|arrived)|how\s+(do\s+i\s+)?(start|set\s*up|configure)|what\s+(to\s+)?(set\s*up|register|configure)\s+before|setup\s+(path|walkthrough)|hand[\s-]?hold)\b/i.test(
      q
    ) ||
    /\b(antes\s+de\s+(okr|pdi|vaga|lms|clima|avaliac|contratar|cargo))\b/i.test(q) ||
    /\b(before\s+(okr|idp|pdi|vacanc|lms|climate|review|hire|job\s*role))\b/i.test(q)
  );
}

function foldHelpText(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function offTopicRefuse(locale, { again = false } = {}) {
  const loc = normalizeLocale(locale);
  return {
    answer: t(loc, again ? 'panel.helpAssist.offTopicAgain' : 'panel.helpAssist.offTopic'),
    tab: 'help',
    section: null,
    source: 'guard',
    citations: [],
  };
}

function historyHasPriorOffTopicRefuse(history, locale) {
  const loc = normalizeLocale(locale);
  const markers = [
    t(loc, 'panel.helpAssist.offTopic'),
    t(loc, 'panel.helpAssist.offTopicAgain'),
    t(loc, 'panel.helpAssist.outOfScope'),
  ];
  return (Array.isArray(history) ? history : []).some(
    (m) => m && m.role === 'assistant' && markers.some((mk) => String(m.content || '').includes(mk.slice(0, 40)))
  );
}

/**
 * True when the question is outside 30Grow product help.
 * Product "clima" (survey) stays in scope; weather / recipes / clinical / payroll do not.
 */
export function isHelpOutOfScope(query) {
  const q = foldHelpText(query).trim();
  if (!q) return false;
  if (HARD_OUT_OF_SCOPE.test(q)) return true;
  if (SOFT_OUT_OF_SCOPE.test(q) && !PRODUCT_HINT.test(q)) return true;
  return false;
}

/** LLM drift: answer wandered into forbidden / off-topic territory. */
export function helpAnswerLooksOffTopic(answer) {
  const a = foldHelpText(answer).trim();
  if (!a) return false;
  if (HARD_OUT_OF_SCOPE.test(a)) return true;
  if (SOFT_OUT_OF_SCOPE.test(a) && !PRODUCT_HINT.test(a)) return true;
  return false;
}

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3);
}

/**
 * @param {string} locale
 * @returns {Array<{ id: string, section: string, title: string, body: string, tab: string|null }>}
 */
export function buildHelpChunks(locale) {
  const loc = normalizeLocale(locale);
  const pack = messageNode(loc, 'panel.help');
  const chunks = [];
  for (const section of HELP_GUIDE_SECTIONS) {
    const title = pack[`${section}Title`];
    const body = pack[`${section}Body`];
    if (!title && !body) continue;
    const steps = [];
    const stepCap = HELP_SECTION_STEP_COUNTS[section] ?? 20;
    for (let i = 1; i <= stepCap; i += 1) {
      const step = pack[`${section}Step${i}`];
      if (!step) break;
      steps.push(String(step));
    }
    chunks.push({
      id: section,
      section,
      title: String(title || section),
      body: [body, ...steps].filter(Boolean).join('\n'),
      tab: TAB_BY_SECTION[section] || 'help',
    });
  }
  return chunks;
}

/**
 * @param {string} query
 * @param {ReturnType<typeof buildHelpChunks>} chunks
 * @param {number} [limit]
 */
export function retrieveHelpChunks(query, chunks, limit = 4) {
  const qTokens = tokenize(query);
  if (!qTokens.length) return [];
  const scored = chunks.map((c) => {
    const hay = tokenize(`${c.title} ${c.body}`);
    let score = 0;
    for (const tok of qTokens) {
      if (hay.includes(tok)) score += 2;
      else if (hay.some((h) => h.includes(tok) || tok.includes(h))) score += 1;
    }
    if (qTokens.some((t) => c.id.includes(t) || c.section.includes(t))) score += 3;
    return { ...c, score };
  });
  return scored
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function matchHelpFaq(query, locale, opts = {}) {
  // Accent-fold so "salário" / "remuneração" match ASCII patterns.
  const q = foldHelpText(query).trim();
  if (!q) return null;
  const activeTab = opts.activeTab ? String(opts.activeTab).trim() : '';

  // Current-screen tips / “what is this tab for?” when the client sends activeTab.
  if (activeTab && isContextualHelpIntent(q)) {
    const wantsSystemOnly =
      /dicas?\s+do\s+sistema|sugest(o|õ)es?\s+(do\s+)?sistema|system\s+tips?|system\s+suggestions?|quick\s+tips|dicas?\s+rapidas?/i.test(
        q
      ) && !/esta|essa|nesta|nessa|aqui|this\s+(screen|tab)/i.test(q);
    const wantsScreen =
      /para\s+que\s+serve|esta\s+tela|essa\s+tela|nesta\s+aba|o\s+que\s+fazer|what\s+(is|does)|tips?\s+for\s+this|what\s+(should|can)\s+i\s+do/i.test(
        q
      );
    if (wantsSystemOnly) {
      return {
        id: 'system-tips',
        section: 'tips',
        tab: 'help',
        answer: buildContextualTipsAnswer(locale, { tab: activeTab, mode: 'system' }),
        source: 'faq',
      };
    }
    if (wantsScreen || /dica|tip|sugest/i.test(q)) {
      const mode = wantsScreen && !/sistema|system/i.test(q) ? 'screen' : 'both';
      return {
        id: 'screen-context',
        section: 'screens',
        tab: activeTab,
        answer: buildContextualTipsAnswer(locale, { tab: activeTab, mode }),
        source: 'faq',
      };
    }
    if (/mapa\s+(das?\s+)?(telas|abas)|cada\s+tela|each\s+(screen|tab)/i.test(q)) {
      return {
        id: 'screens-map',
        section: 'screens',
        tab: 'help',
        answer: t(locale, 'panel.helpAssist.faqScreens'),
        source: 'faq',
      };
    }
  }

  for (const item of FAQ) {
    if (item.patterns.some((re) => re.test(q))) {
      // Vacancy salary / public job pay ≠ internal Team compensation.
      if (
        item.id === 'compensation' &&
        /(vaga|vacanc|pretensao|\/jobs|pagina\s+publica|public\s+job)/i.test(q) &&
        !/(equipe|colaborador|funcionario|contratado|remuneracao|team|employee|hired)/i.test(q)
      ) {
        continue;
      }
      if (item.contextual === 'system') {
        return {
          id: item.id,
          section: item.section,
          tab: TAB_BY_SECTION[item.section] || 'help',
          answer: buildContextualTipsAnswer(locale, { tab: activeTab || null, mode: 'system' }),
          source: 'faq',
        };
      }
      return {
        id: item.id,
        section: item.section,
        tab: TAB_BY_SECTION[item.section] || 'help',
        answer: t(locale, item.answerKey),
        source: 'faq',
      };
    }
  }
  return null;
}

/**
 * @param {{ question: string, locale?: string, history?: Array<{ role: string, content: string }>, activeTab?: string|null, activeSection?: string|null }} opts
 */
export async function answerHelpQuestion({
  question,
  locale = 'pt-BR',
  history = [],
  activeTab = null,
  activeSection = null,
  usage = null,
} = {}) {
  const loc = normalizeLocale(locale);
  const q = String(question || '').trim().slice(0, 500);
  if (!q) {
    const err = new Error('EMPTY');
    err.code = 'HELP_ASSIST_EMPTY';
    throw err;
  }

  if (isHelpOutOfScope(q)) {
    return offTopicRefuse(loc, { again: historyHasPriorOffTopicRefuse(history, loc) });
  }

  const tabId = activeTab ? String(activeTab).trim().slice(0, 64) : '';
  const sectionId = activeSection ? String(activeSection).trim().slice(0, 64) : '';

  const faq = matchHelpFaq(q, loc, { activeTab: tabId });
  if (faq) {
    return {
      answer: faq.answer,
      tab: faq.tab,
      section: faq.section,
      source: 'faq',
      citations: [{ id: faq.section, title: t(loc, `panel.help.${faq.section}Title`) }],
      suggestions: helpSuggestionLabels(loc, tabId || faq.tab),
      activeTab: tabId || null,
    };
  }

  const chunks = buildHelpChunks(loc);
  let top = retrieveHelpChunks(q, chunks, 4);

  // Bias retrieval toward setup prerequisites when the user is new / asking what to register first.
  if (isSetupPathIntent(q)) {
    const setupChunk = chunks.find((c) => c.section === 'setupPath');
    if (setupChunk) {
      const byId = new Map([['setupPath', { ...setupChunk, score: 99 }]]);
      for (const c of top) {
        if (!byId.has(c.section)) byId.set(c.section, c);
      }
      top = [...byId.values()].sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 4);
    }
  }

  // Bias retrieval toward the open screen's Guia sections.
  const meta = helpMetaForTab(tabId);
  if (meta?.guideSections?.length && !isSetupPathIntent(q)) {
    const prefer = new Set(['screens', 'setupPath', ...meta.guideSections]);
    const boosted = chunks
      .filter((c) => prefer.has(c.section))
      .map((c) => ({ ...c, score: (top.find((x) => x.section === c.section)?.score || 0) + 4 }));
    const byId = new Map();
    for (const c of [...boosted, ...top]) {
      if (!byId.has(c.section) || (c.score || 0) > (byId.get(c.section).score || 0)) {
        byId.set(c.section, c);
      }
    }
    top = [...byId.values()].sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 4);
  }

  if (!top.length) {
    return {
      answer: t(loc, 'panel.helpAssist.noMatch'),
      tab: 'help',
      section: null,
      source: 'none',
      citations: [],
      suggestions: helpSuggestionLabels(loc, tabId),
      activeTab: tabId || null,
    };
  }

  const citations = top.map((c) => ({ id: c.section, title: c.title, tab: c.tab }));
  const primaryTab = top[0].tab || 'help';
  const purpose = helpScreenPurpose(loc, tabId);
  const tabLabel = helpTabLabel(loc, tabId);
  const screenCtx =
    purpose && tabLabel
      ? contentLocale(loc) === 'en'
        ? `OPEN SCREEN: ${tabLabel}${sectionId ? ` (section: ${sectionId})` : ''}. Purpose: ${purpose}`
        : `TELA ABERTA: ${tabLabel}${sectionId ? ` (seção: ${sectionId})` : ''}. Função: ${purpose}`
      : '';

  const retrieveAnswer = () => {
    const lines = top.slice(0, 2).map((c) => `**${c.title}**\n${c.body.split('\n').slice(0, 3).join('\n')}`);
    const prefix = screenCtx ? `${screenCtx}\n\n` : '';
    return {
      answer: `${prefix}${t(loc, 'panel.helpAssist.fallbackIntro')}\n\n${lines.join('\n\n')}`,
      tab: primaryTab,
      section: top[0].section,
      source: 'retrieve',
      citations,
      suggestions: helpSuggestionLabels(loc, tabId || primaryTab),
      activeTab: tabId || null,
    };
  };

  if (!isOpenAiConfigured()) return retrieveAnswer();

  const context = top
    .map((c, i) => `[${i + 1}] ${c.title}\n${c.body.slice(0, 900)}`)
    .join('\n\n');
  const hist = (Array.isArray(history) ? history : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && m.content)
    .slice(-4)
    .map((m) => ({ role: m.role, content: String(m.content).slice(0, 400) }));

  const system =
    i18nT(loc, 'ui.helpAssistant.youAreThe30growProduct');

  const userMsg = `${i18nT(loc, 'ui.helpAssistant.question')}: ${q}\n\n${screenCtx ? `${screenCtx}\n\n` : ''}CONTEXT:\n${context}`;

  let answer;
  try {
    answer = await openAiChatCompletion({
      messages: [{ role: 'system', content: system }, ...hist, { role: 'user', content: userMsg }],
      temperature: 0.2,
      maxTokens: 360,
      usage: aiUsageContext(usage, AI_FEATURE.HELP_ASSISTANT),
      feature: AI_FEATURE.HELP_ASSISTANT,
      // Prompt = Guia + question + open screen (no company data): shared across tenants.
      cache: { companyId: null },
    });
  } catch (e) {
    if (e?.code === AI_BLOCK_CODE.COMPANY_LIMIT || e?.code === AI_BLOCK_CODE.DISABLED) {
      return retrieveAnswer();
    }
    const err = new Error(e?.message || 'AI failed');
    err.code = 'HELP_ASSIST_AI_FAILED';
    throw err;
  }

  answer = String(answer || '').trim();
  if (!answer || answer.startsWith('<p>') || answer.startsWith('{')) {
    answer = t(loc, 'panel.helpAssist.mockAnswer', { section: top[0].title });
  }

  if (helpAnswerLooksOffTopic(answer)) {
    return offTopicRefuse(loc);
  }

  return {
    answer: answer.slice(0, 1400),
    tab: primaryTab,
    section: top[0].section,
    source: 'llm',
    citations,
    suggestions: helpSuggestionLabels(loc, tabId || primaryTab),
    activeTab: tabId || null,
  };
}

export { HELP_GUIDE_SECTIONS as HELP_SECTIONS, TAB_BY_HELP_SECTION as TAB_BY_SECTION, FAQ };
export { HELP_GUIDE_SECTIONS, TAB_BY_HELP_SECTION } from './help-sections.js';
export {
  helpSuggestionLabels,
  helpScreenPurpose,
  buildContextualTipsAnswer,
  HELP_BY_DASHBOARD_TAB,
} from './help-screen-context.js';
