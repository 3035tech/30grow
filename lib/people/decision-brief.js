/**
 * Briefing acionável para RH: empacota Eneagrama + Motivadores + compat
 * (síntese, entrevista, time, alertas) — sem novo instrumento de score.
 */

import { getCompat } from '../data.js';
import { getTypeData } from '../i18n-data.js';
import { buildProfileSynthesis } from '../assessment/profile-synthesis.js';
import { contentLocale } from '../i18n.js';

function loc(locale) {
  return contentLocale(locale);
}

function copy(locale, pt, en) {
  return contentLocale(locale) === 'en' ? en : pt;
}

/** Perguntas de entrevista (contratação) — distintas do roteiro de 1:1. */
const INTERVIEW_BY_TYPE = {
  1: {
    'pt-BR': 'Conte um caso em que você insistiu em um padrão de qualidade mesmo sob prazo curto. O que negociou?',
    en: 'Tell me about a time you insisted on a quality bar under a tight deadline. What did you negotiate?',
  },
  2: {
    'pt-BR': 'Quando alguém do time pediu ajuda e isso competiu com a sua entrega, como você decidiu?',
    en: 'When someone on the team needed help and it competed with your own delivery, how did you decide?',
  },
  3: {
    'pt-BR': 'Descreva uma meta que você puxou com força. Como equilibrava resultado e alinhamento com o time?',
    en: 'Describe a goal you pushed hard on. How did you balance results with team alignment?',
  },
  4: {
    'pt-BR': 'Conte uma situação em que o jeito padrão de fazer não cabia. Como propôs outra abordagem?',
    en: 'Tell me about a situation where the standard way did not fit. How did you propose another approach?',
  },
  5: {
    'pt-BR': 'Como você decide quando já sabe o suficiente para agir versus quando ainda precisa investigar?',
    en: 'How do you decide when you know enough to act versus when you still need to investigate?',
  },
  6: {
    'pt-BR': 'Descreva um risco que você antecipou no trabalho. Como comunicou e o que mudou no plano?',
    en: 'Describe a risk you anticipated at work. How did you communicate it and what changed in the plan?',
  },
  7: {
    'pt-BR': 'Quando muitas ideias competiam na mesma semana, como você escolheu o que fechar primeiro?',
    en: 'When many ideas competed in the same week, how did you choose what to finish first?',
  },
  8: {
    'pt-BR': 'Conte um momento em que você precisou puxar uma decisão difícil. Como lidou com discordância?',
    en: 'Tell me about a time you had to drive a hard decision. How did you handle disagreement?',
  },
  9: {
    'pt-BR': 'Quando havia tensão no time e você preferia evitar atrito, o que fez para o assunto avançar?',
    en: 'When there was team tension and you preferred to avoid friction, what did you do so the topic still moved forward?',
  },
};

const INTERVIEW_BY_MOTIVATOR = {
  reconhecimento: {
    'pt-BR': 'O que, para você, conta como reconhecimento justo de uma entrega. E o que soa vazio?',
    en: 'What counts as fair recognition of a delivery for you. And what feels empty?',
  },
  financeiro: {
    'pt-BR': 'Como você avalia se o esforço de um ciclo está alinhado ao que a empresa oferece?',
    en: 'How do you judge whether a cycle’s effort lines up with what the company offers?',
  },
  crescimento: {
    'pt-BR': 'Para onde você gostaria que este papel avançasse em 12–18 meses?',
    en: 'Where would you like this role to move in 12–18 months?',
  },
  desenvolvimento: {
    'pt-BR': 'O que você quer estar sabendo fazer daqui a seis meses que ainda não domina?',
    en: 'What do you want to be able to do in six months that you do not yet master?',
  },
  autonomia: {
    'pt-BR': 'Em que tipo de tarefa você rende mais quando escolhe o método. E onde prefere guia claro?',
    en: 'On which kind of work do you perform better when you choose the method. And where do you prefer clear guidance?',
  },
  flexibilidade: {
    'pt-BR': 'Que arranjo de horário ou local mais ajuda a sua entrega sem prejudicar o time?',
    en: 'What schedule or location arrangement most helps your delivery without hurting the team?',
  },
  proposito: {
    'pt-BR': 'Em quais trabalhos fica claro para você para quem ou para que aquilo serve?',
    en: 'In which kinds of work is it clear to you who or what it serves?',
  },
  relacionamentos: {
    'pt-BR': 'Com que tipo de colega você rende melhor: e o que facilita isso no dia a dia?',
    en: 'What kind of colleague do you work best with. And what makes that easier day to day?',
  },
  seguranca: {
    'pt-BR': 'O que na rotina de uma empresa te deixa mais seguro para entregar bem?',
    en: 'What in a company’s routine makes you feel secure enough to deliver well?',
  },
  lideranca: {
    'pt-BR': 'Onde você gostaria de puxar rumo ou apoiar outras pessoas neste papel?',
    en: 'Where would you like to set direction or support others in this role?',
  },
  desafio: {
    'pt-BR': 'Qual problema difícil você gostaria de pegar nos primeiros meses. E por quê?',
    en: 'Which hard problem would you like to take on in the first months. And why?',
  },
  criatividade: {
    'pt-BR': 'Conte um caso em que você testou um jeito novo de trabalhar. O que validou o resultado?',
    en: 'Tell me about a time you tried a new way of working. What validated the outcome?',
  },
  equilibrio: {
    'pt-BR': 'O que na semana de trabalho mais protege (ou invade) o tempo fora do expediente para você?',
    en: 'What in the work week most protects (or invades) time outside work for you?',
  },
};

const GENERIC_INTERVIEW = {
  'pt-BR': 'O que te faria dizer sim a esta vaga: e o que te faria hesitar?',
  en: 'What would make you say yes to this role: and what would make you hesitate?',
};

/**
 * @param {{
 *   locale?: string,
 *   topType?: number|null,
 *   motivatorKeys?: string[],
 * }} input
 */
export function buildInterviewQuestions(input = {}) {
  const locale = loc(input.locale);
  const out = [];
  const type = Number(input.topType);
  if (Number.isInteger(type) && type >= 1 && type <= 9) {
    const row = INTERVIEW_BY_TYPE[type];
    if (row) out.push({ id: `iv-t${type}`, source: 'enneagram', text: row[locale] || row['pt-BR'] });
  }
  const preferred = Array.isArray(input.preferredTypes) ? input.preferredTypes : [];
  for (const raw of preferred.slice(0, 3)) {
    const pt = Number(raw);
    if (!Number.isInteger(pt) || pt < 1 || pt > 9 || pt === type) continue;
    const row = INTERVIEW_BY_TYPE[pt];
    if (row) {
      out.push({
        id: `iv-rubric-t${pt}`,
        source: 'rubric',
        text: row[locale] || row['pt-BR'],
      });
    }
  }
  for (const key of (input.motivatorKeys || []).slice(0, 3)) {
    const row = INTERVIEW_BY_MOTIVATOR[key];
    if (row) {
      out.push({
        id: `iv-m-${key}`,
        source: 'motivators',
        text: row[locale] || row['pt-BR'],
      });
    }
  }
  out.push({
    id: 'iv-generic',
    source: 'general',
    text: GENERIC_INTERVIEW[locale] || GENERIC_INTERVIEW['pt-BR'],
  });
  const seen = new Set();
  return out.filter((q) => {
    if (seen.has(q.text)) return false;
    seen.add(q.text);
    return true;
  }).slice(0, 8);
}

/**
 * @param {{
 *   locale?: string,
 *   topType?: number|null,
 *   personName?: string|null,
 *   colleagues?: Array<{ id: string|number, name: string, topType: number }>,
 * }} input
 */
export function buildTeamCompositionHints(input = {}) {
  const locale = loc(input.locale);
  const topType = Number(input.topType);
  const typeData = Number.isInteger(topType) && topType >= 1 && topType <= 9
    ? getTypeData(locale)[topType]
    : null;

  const roleHint = typeData?.team
    ? {
        kind: 'role',
        text: copy(
          locale,
          `No time, ${typeData.name} tende a: ${typeData.team}`,
          `On a team, ${typeData.name} tends to: ${typeData.team}`
        ),
      }
    : null;

  const colleagues = Array.isArray(input.colleagues) ? input.colleagues : [];
  const scored = [];
  if (Number.isInteger(topType) && topType >= 1 && topType <= 9) {
    for (const c of colleagues) {
      const other = Number(c.topType);
      if (!Number.isInteger(other) || other < 1 || other > 9) continue;
      if (String(c.id) === String(input.selfId)) continue;
      const compat = getCompat(topType, other, locale);
      if (!compat?.level || compat.level === 'neutral') continue;
      scored.push({
        id: c.id,
        name: c.name,
        topType: other,
        level: compat.level,
        title: compat.title,
        desc: compat.desc,
      });
    }
  }

  const synergies = scored
    .filter((r) => r.level === 'synergy')
    .slice(0, 3)
    .map((r) => ({
      kind: 'synergy',
      colleagueId: r.id,
      colleagueName: r.name,
      colleagueType: r.topType,
      text: copy(
        locale,
        `Com ${r.name} (T${r.topType}): há indícios de sinergia. ${r.title}. ${r.desc || ''}`.trim(),
        `With ${r.name} (T${r.topType}): there are signs of synergy. ${r.title}. ${r.desc || ''}`.trim()
      ),
    }));

  const tensions = scored
    .filter((r) => r.level === 'tension')
    .slice(0, 3)
    .map((r) => ({
      kind: 'tension',
      colleagueId: r.id,
      colleagueName: r.name,
      colleagueType: r.topType,
      text: copy(
        locale,
        `Com ${r.name} (T${r.topType}): há indícios de tensão. ${r.title}. Vale alinhar expectativas cedo. ${r.desc || ''}`.trim(),
        `With ${r.name} (T${r.topType}): there are signs of tension. ${r.title}. Align expectations early. ${r.desc || ''}`.trim()
      ),
    }));

  return {
    roleHint,
    synergies,
    tensions,
    empty: !roleHint && synergies.length === 0 && tensions.length === 0,
  };
}

/**
 * Dado um núcleo (2+ pessoas com tipo), sugere quem completa o time e quem tende a gerar tensão.
 * Reusa getCompat — sem novo instrumento.
 *
 * @param {{
 *   locale?: string,
 *   nucleus?: Array<{ id: string|number, name?: string, topType: number }>,
 *   candidates?: Array<{ id: string|number, name?: string, topType: number }>,
 *   limitCompleters?: number,
 *   limitRisks?: number,
 * }} input
 */
export function buildNucleusCompositionAdvice(input = {}) {
  const locale = loc(input.locale);
  const nucleus = (Array.isArray(input.nucleus) ? input.nucleus : [])
    .map((n) => ({
      id: n.id,
      name: n.name || '',
      topType: Number(n.topType),
    }))
    .filter((n) => Number.isInteger(n.topType) && n.topType >= 1 && n.topType <= 9);

  if (nucleus.length < 2) {
    return { completers: [], risks: [], empty: true, nucleusSize: nucleus.length };
  }

  const nucleusIds = new Set(nucleus.map((n) => String(n.id)));
  const scored = [];

  for (const raw of Array.isArray(input.candidates) ? input.candidates : []) {
    const topType = Number(raw.topType);
    if (!Number.isInteger(topType) || topType < 1 || topType > 9) continue;
    if (nucleusIds.has(String(raw.id))) continue;

    let synergy = 0;
    let tension = 0;
    const highlights = [];
    for (const n of nucleus) {
      const compat = getCompat(n.topType, topType, locale);
      if (compat?.level === 'synergy') {
        synergy += 1;
        if (highlights.length < 2) {
          highlights.push({
            withId: n.id,
            withName: n.name,
            level: 'synergy',
            title: compat.title,
          });
        }
      } else if (compat?.level === 'tension') {
        tension += 1;
        if (highlights.length < 2) {
          highlights.push({
            withId: n.id,
            withName: n.name,
            level: 'tension',
            title: compat.title,
          });
        }
      }
    }

    const net = synergy - tension * 1.5;
    scored.push({
      id: raw.id,
      name: raw.name || '',
      topType,
      synergy,
      tension,
      net,
      highlights,
      summary: copy(
        locale,
        `Com o núcleo: ${synergy} sinergia(s), ${tension} tensão(ões).`,
        `With the nucleus: ${synergy} synerg${synergy === 1 ? 'y' : 'ies'}, ${tension} tension${tension === 1 ? '' : 's'}.`
      ),
    });
  }

  const completers = [...scored]
    .filter((s) => s.synergy > 0 && s.net > 0)
    .sort((a, b) => b.net - a.net || b.synergy - a.synergy || a.tension - b.tension)
    .slice(0, Math.max(1, Number(input.limitCompleters) || 5));

  const risks = [...scored]
    .filter((s) => s.tension > 0)
    .sort((a, b) => b.tension - a.tension || a.net - b.net)
    .slice(0, Math.max(1, Number(input.limitRisks) || 3));

  return {
    completers,
    risks,
    empty: completers.length === 0 && risks.length === 0,
    nucleusSize: nucleus.length,
  };
}

/**
 * Compat of one person vs a nucleus (B-403). Nucleus size ≥1 is enough.
 * @returns {{
 *   empty: boolean,
 *   nucleusSize: number,
 *   synergy: number,
 *   tension: number,
 *   net: number,
 *   summary: string,
 *   highlights: Array<{ withId: *, withName: string, level: string, title: string }>,
 * }}
 */
export function scorePersonAgainstNucleus(input = {}) {
  const locale = loc(input.locale);
  const topType = Number(input.person?.topType);
  const personId = input.person?.id != null ? String(input.person.id) : null;
  const nucleus = (Array.isArray(input.nucleus) ? input.nucleus : [])
    .map((n) => ({
      id: n.id,
      name: n.name || '',
      topType: Number(n.topType),
    }))
    .filter((n) => {
      if (!Number.isInteger(n.topType) || n.topType < 1 || n.topType > 9) return false;
      if (personId && String(n.id) === personId) return false;
      return true;
    });

  if (!Number.isInteger(topType) || topType < 1 || topType > 9 || nucleus.length < 1) {
    return {
      empty: true,
      nucleusSize: nucleus.length,
      synergy: 0,
      tension: 0,
      net: 0,
      summary: '',
      highlights: [],
    };
  }

  let synergy = 0;
  let tension = 0;
  const highlights = [];
  for (const n of nucleus) {
    const compat = getCompat(n.topType, topType, locale);
    if (compat?.level === 'synergy') {
      synergy += 1;
      if (highlights.length < 2) {
        highlights.push({
          withId: n.id,
          withName: n.name,
          level: 'synergy',
          title: compat.title,
        });
      }
    } else if (compat?.level === 'tension') {
      tension += 1;
      if (highlights.length < 2) {
        highlights.push({
          withId: n.id,
          withName: n.name,
          level: 'tension',
          title: compat.title,
        });
      }
    }
  }

  const net = synergy - tension * 1.5;
  return {
    empty: synergy === 0 && tension === 0,
    nucleusSize: nucleus.length,
    synergy,
    tension,
    net,
    highlights,
    summary: copy(
      locale,
      `Vs time interno: ${synergy} sinergia(s), ${tension} tensão(ões).`,
      `Vs internal team: ${synergy} synerg${synergy === 1 ? 'y' : 'ies'}, ${tension} tension${tension === 1 ? '' : 's'}.`
    ),
  };
}

/**
 * Briefing acionável a partir de síntese + Motivadores + colegas.
 * @param {{
 *   locale?: string,
 *   scores?: object|null,
 *   topType?: number|null,
 *   management?: object|null,
 *   colleagues?: Array<{ id: string|number, name: string, topType: number }>,
 *   selfId?: string|number|null,
 * }} input
 */
export function buildDecisionBrief(input = {}) {
  const locale = loc(input.locale);
  const management = input.management || null;
  const motivatorsTop = management?.motivators?.top || [];
  const synthesis = buildProfileSynthesis({
    locale,
    topType: input.topType ?? management?.enneagram?.topType,
    scores: input.scores,
    motivatorsTop,
  });

  const interviewQuestions = buildInterviewQuestions({
    locale,
    topType: input.topType ?? management?.enneagram?.topType,
    motivatorKeys: motivatorsTop.map((m) => m.key).filter(Boolean),
  });

  const team = buildTeamCompositionHints({
    locale,
    topType: input.topType ?? management?.enneagram?.topType,
    colleagues: input.colleagues,
    selfId: input.selfId,
  });

  const actionsDo = (management?.motivators?.do || []).slice(0, 3).map((a) => ({
    dimension: a.dimension || a.dimensionKey,
    text: a.text,
  }));
  const actionsAvoid = (management?.motivators?.avoid || []).slice(0, 2).map((a) => ({
    dimension: a.dimension || a.dimensionKey,
    text: a.text,
  }));

  const hypotheses = (management?.hypotheses || []).slice(0, 4);
  const alerts = (management?.retentionSignals || []).slice(0, 4);
  const oneOnOnePrompts = (management?.oneOnOnePrompts || []).slice(0, 4);

  const hasAny =
    synthesis.completeness !== 'empty'
    || interviewQuestions.length > 0
    || !team.empty
    || actionsDo.length > 0
    || hypotheses.length > 0
    || alerts.length > 0;

  return {
    completeness: synthesis.completeness,
    hasAny,
    synthesis,
    actionsDo,
    actionsAvoid,
    hypotheses,
    interviewQuestions,
    oneOnOnePrompts,
    team,
    alerts,
  };
}
