/**
 * Hipóteses de gestão + roteiro de 1:1 a partir de Eneagrama e Motivadores.
 * Mesma pessoa = mesmo candidates.id (company_id + email).
 * Linguagem hedged (“tende a”) — não é diagnóstico.
 */

import { getTypeData } from '../i18n-data.js';
import { buildEnneagramCross, rankEnneagramScores } from '../assessment/enneagram-cross.js';
import { buildHrInsights } from '../ae/hr-insights.js';
import { MOTIVATORS_DIMENSIONS } from '../ae/motivators-dimensions.js';
import { retentionWatchMinScore } from './retention-watch.js';
import { contentLocale } from '../i18n.js';

const PROMPT_BY_DIM = {
  reconhecimento: {
    'pt-BR': 'O que mais te faz sentir que o trabalho está sendo visto. E o que falta hoje?',
    en: 'What most makes you feel your work is noticed. And what is missing today?',
  },
  financeiro: {
    'pt-BR': 'Como você avalia se o esforço deste ciclo está alinhado ao que recebe?',
    en: 'How do you judge whether this cycle’s effort lines up with what you receive?',
  },
  crescimento: {
    'pt-BR': 'Para onde você gostaria que este papel avançasse nos próximos 12 meses?',
    en: 'Where would you like this role to move in the next 12 months?',
  },
  desenvolvimento: {
    'pt-BR': 'O que você gostaria de aprender no próprio trabalho neste trimestre?',
    en: 'What would you like to learn on the job this quarter?',
  },
  autonomia: {
    'pt-BR': 'Em quais entregas você sente que falta margem para decidir o “como”?',
    en: 'On which deliverables do you feel you lack room to decide the “how”?',
  },
  flexibilidade: {
    'pt-BR': 'O que na rotina (horário/lugar) mais ajuda ou atrapalha sua semana?',
    en: 'What in the routine (schedule/place) most helps or hurts your week?',
  },
  proposito: {
    'pt-BR': 'Em quais atividades fica claro para quem ou para que o trabalho serve?',
    en: 'In which activities is it clear who or what the work is for?',
  },
  relacionamentos: {
    'pt-BR': 'Com quem no time você rende melhor: e o que facilita isso?',
    en: 'Who on the team do you work best with: and what makes that easier?',
  },
  seguranca: {
    'pt-BR': 'O que deixaria a rotina mais previsível sem tirar o ritmo?',
    en: 'What would make the routine more predictable without killing pace?',
  },
  lideranca: {
    'pt-BR': 'Onde você gostaria de puxar rumo ou apoiar outras pessoas?',
    en: 'Where would you like to set direction or support others?',
  },
  desafio: {
    'pt-BR': 'Qual problema difícil você gostaria de pegar a seguir?',
    en: 'Which hard problem would you like to take on next?',
  },
  criatividade: {
    'pt-BR': 'Onde ainda dá para testar um jeito que o processo ainda não prevê?',
    en: 'Where can you still try an approach the process does not yet cover?',
  },
  equilibrio: {
    'pt-BR': 'O que na semana mais protege (ou invade) o tempo fora do trabalho?',
    en: 'What in the week most protects (or invades) time outside work?',
  },
};

const ACTIONS_EN = {
  autonomia: {
    do: 'Delegate projects and give room on the how, with clear outcomes.',
    avoid: 'Avoid micromanaging and excessive task-level control.',
  },
  reconhecimento: {
    do: 'Recognize wins publicly and often, with specifics.',
    avoid: 'Avoid silence after strong deliveries.',
  },
  desenvolvimento: {
    do: 'Offer training, mentoring, and a concrete development path.',
    avoid: 'Avoid long stretches with no learning on the job.',
  },
  desafio: {
    do: 'Assign hard problems with visible impact.',
    avoid: 'Avoid endless routine with no new challenge.',
  },
  crescimento: {
    do: 'Discuss career next steps on a regular cadence.',
    avoid: 'Avoid blocking progress without clear criteria.',
  },
  relacionamentos: {
    do: 'Protect teamwork and real connection between people.',
    avoid: 'Avoid isolation or unresolved conflict.',
  },
  flexibilidade: {
    do: 'Offer schedule/location flexibility when work allows.',
    avoid: 'Avoid rigid rules without operational need.',
  },
  proposito: {
    do: 'Connect deliveries to impact and mission.',
    avoid: 'Avoid work that feels like reporting for its own sake.',
  },
  seguranca: {
    do: 'Communicate changes early and keep the routine predictable.',
    avoid: 'Avoid sudden shifts without context.',
  },
  financeiro: {
    do: 'Review pay and benefits against the market periodically.',
    avoid: 'Avoid opaque pay gaps.',
  },
  lideranca: {
    do: 'Offer chances to lead initiatives or mentor others.',
    avoid: 'Avoid shutting people out of decisions without reason.',
  },
  criatividade: {
    do: 'Leave room to propose ideas and try new approaches.',
    avoid: 'Avoid rigid process with zero experiment space.',
  },
  equilibrio: {
    do: 'Respect off-hours and support work–life balance.',
    avoid: 'Avoid chronic overload and after-hours as the default.',
  },
};

/** Dimensões que, altas, pedem checagem de retenção no 1:1. */
const RETENTION_DIMS = new Set(['financeiro', 'equilibrio', 'reconhecimento', 'seguranca']);

function loc(locale) {
  return contentLocale(locale);
}

function copy(locale, pt, en) {
  return contentLocale(locale) === 'en' ? en : pt;
}

function dimLabel(key, locale) {
  const d = MOTIVATORS_DIMENSIONS.find((x) => x.key === key);
  if (!d) return key;
  if (contentLocale(locale) === 'en') {
    const enLabels = {
      reconhecimento: 'Recognition',
      financeiro: 'Financial',
      crescimento: 'Growth',
      desenvolvimento: 'Development',
      autonomia: 'Autonomy',
      flexibilidade: 'Flexibility',
      proposito: 'Purpose',
      relacionamentos: 'Relationships',
      seguranca: 'Security',
      lideranca: 'Leadership',
      desafio: 'Challenge',
      criatividade: 'Creativity',
      equilibrio: 'Balance & personal life',
    };
    return enLabels[key] || d.label;
  }
  return d.label;
}

function normalizeRanking(ranking, dimensionScores) {
  if (Array.isArray(ranking) && ranking.length) {
    return ranking.map((item) => (typeof item === 'string' ? item : item?.key)).filter(Boolean);
  }
  return Object.entries(dimensionScores || {})
    .sort((a, b) => (Number(b[1]) || 0) - (Number(a[1]) || 0))
    .map(([k]) => k);
}

/**
 * @param {{
 *   locale?: string,
 *   scores?: Record<string, number>|null,
 *   topType?: number|null,
 *   motivators?: { dimensionScores?: object, ranking?: any, profileSummary?: string|null }|null,
 * }} input
 */
export function buildManagementHypotheses(input = {}) {
  const locale = loc(input.locale);
  const scores = input.scores || null;
  const hasEnneagram = scores && Object.keys(scores).length > 0;
  const motivators = input.motivators || null;
  const dimensionScores = motivators?.dimensionScores || null;
  const hasMotivators = dimensionScores && Object.keys(dimensionScores).length > 0;

  const hypotheses = [];
  const prompts = [];
  const retentionSignals = [];

  let enneagramBrief = null;
  if (hasEnneagram) {
    const cross = buildEnneagramCross(scores, locale);
    const typeMap = getTypeData(locale);
    const lead = cross?.primary || rankEnneagramScores(scores)[0];
    const typeMeta = lead ? typeMap[lead.type] : null;
    enneagramBrief = {
      topType: lead?.type ?? input.topType ?? null,
      leadScore: lead?.score ?? null,
      cluster: (cross?.cluster || []).map((c) => ({ type: c.type, score: c.score })),
      title: typeMeta?.name || (lead ? `T${lead.type}` : null),
      teamHint: typeMeta?.team || null,
    };

    if (typeMeta?.team) {
      hypotheses.push({
        id: 'enn-team',
        source: 'enneagram',
        title: copy(locale, 'Como tende a contribuir no time', 'How they tend to contribute on the team'),
        body: typeMeta.team,
      });
    }
    if (typeMeta?.challenge) {
      hypotheses.push({
        id: 'enn-watch',
        source: 'enneagram',
        title: copy(locale, 'Ponto de atenção no estilo de trabalho', 'Watchpoint in work style'),
        body: copy(
          locale,
          `Em pressão, ${typeMeta.name} tende a: ${typeMeta.challenge}`,
          `Under pressure, ${typeMeta.name} tends to: ${typeMeta.challenge}`
        ),
      });
    }
    if (cross?.pairs?.length) {
      const p = cross.pairs[0];
      hypotheses.push({
        id: 'enn-blend',
        source: 'enneagram',
        title: copy(
          locale,
          `Leitura combinada T${p.a.type} × T${p.b.type}`,
          `Combined reading T${p.a.type} × T${p.b.type}`
        ),
        body: p.blend?.reading || p.blend?.team || '',
      });
    }

    prompts.push(
      copy(
        locale,
        'O que na semana te deixa mais engajado: e o que mais drena energia?',
        'What in the week most engages you: and what most drains energy?'
      )
    );
  }

  let motivatorsBrief = null;
  if (hasMotivators) {
    const ranking = normalizeRanking(motivators.ranking, dimensionScores);
    const dims = MOTIVATORS_DIMENSIONS.map((d) => ({
      key: d.key,
      label: dimLabel(d.key, locale),
      color: d.color,
    }));
    const insights = buildHrInsights({ ranking, dimensionScores, dimensions: dims });
    motivatorsBrief = {
      top: insights.topMotivators.map((d) => ({
        key: d.key,
        label: dimLabel(d.key, locale),
        score: d.score,
        color: d.color,
      })),
      /** Full 13-dim series for radar (Equipe). */
      dimensions: dims.map((d) => ({
        key: d.key,
        label: d.label,
        color: d.color,
        score: Number(dimensionScores?.[d.key]) || 0,
      })),
      dimensionScores: { ...dimensionScores },
      summaryNote: insights.summaryNote,
      profileSummary: motivators.profileSummary || null,
      do: insights.suggestedActions.do.slice(0, 4),
      avoid: insights.suggestedActions.avoid.slice(0, 4),
    };

    for (const action of insights.suggestedActions.do.slice(0, 3)) {
      const enAction = ACTIONS_EN[action.dimensionKey];
      const actionText = contentLocale(locale) === 'en' && enAction ? enAction.do : action.text;
      hypotheses.push({
        id: `mot-do-${action.dimensionKey}`,
        source: 'motivators',
        title: copy(locale, `Hipótese: ${action.dimension}`, `Hypothesis: ${dimLabel(action.dimensionKey, locale)}`),
        body: copy(
          locale,
          `Tende a responder bem quando: ${actionText}`,
          `Tends to respond well when: ${actionText}`
        ),
      });
    }
    for (const action of insights.suggestedActions.avoid.slice(0, 2)) {
      const enAction = ACTIONS_EN[action.dimensionKey];
      const actionText = contentLocale(locale) === 'en' && enAction ? enAction.avoid : action.text;
      hypotheses.push({
        id: `mot-avoid-${action.dimensionKey}`,
        source: 'motivators',
        title: copy(locale, `Evitar: ${action.dimension}`, `Avoid: ${dimLabel(action.dimensionKey, locale)}`),
        body: actionText,
      });
    }

    for (const dim of insights.topMotivators.slice(0, 3)) {
      const p = PROMPT_BY_DIM[dim.key];
      if (p) prompts.push(p[locale] || p['pt-BR']);
      if (RETENTION_DIMS.has(dim.key) && dim.score >= retentionWatchMinScore()) {
        const prompt = PROMPT_BY_DIM[dim.key];
        retentionSignals.push({
          key: dim.key,
          label: dimLabel(dim.key, locale),
          level: 'watch',
          score: dim.score,
          minScore: retentionWatchMinScore(),
          suggestedQuestion: prompt ? prompt[locale] || prompt['pt-BR'] : null,
          text: copy(
            locale,
            `${dimLabel(dim.key, locale)} aparece alto no perfil (${Math.round(dim.score)}, limiar ${retentionWatchMinScore()}). Vale checar no 1:1 se as condições atuais sustentam isso.`,
            `${dimLabel(dim.key, locale)} ranks high (${Math.round(dim.score)}, threshold ${retentionWatchMinScore()}). Check in the 1:1 whether current conditions still support it.`
          ),
        });
      }
    }
  }

  if (hasEnneagram && hasMotivators && motivatorsBrief?.top?.[0]) {
    const topMot = motivatorsBrief.top[0];
    const typeName = enneagramBrief?.title || `T${enneagramBrief?.topType}`;
    hypotheses.push({
      id: 'cross-lead',
      source: 'cross',
      title: copy(locale, 'Cruzamento estilo × motivadores', 'Style × motivators cross-read'),
      body: copy(
        locale,
        `Com estilo ${typeName} e destaque em ${topMot.label}, a gestão tende a funcionar melhor quando o “como trabalha” e o que energiza a pessoa andam juntos. Use o roteiro abaixo no 1:1 para validar, não para rotular.`,
        `With a ${typeName} style and a lead in ${topMot.label}, management tends to work better when how they work and what energizes them stay aligned. Use the prompts below in the 1:1 to validate, not to label.`
      ),
    });
  }

  const uniquePrompts = [...new Set(prompts)].slice(0, 5);

  return {
    completeness: {
      enneagram: Boolean(hasEnneagram),
      motivators: Boolean(hasMotivators),
    },
    enneagram: enneagramBrief,
    motivators: motivatorsBrief,
    hypotheses: hypotheses.filter((h) => h.body).slice(0, 8),
    oneOnOnePrompts: uniquePrompts,
    retentionSignals: retentionSignals.slice(0, 4),
  };
}
