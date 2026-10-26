import { closeDeltaForLead, rankEnneagramScores } from './enneagram-cross.js';
import { getEnneagramBlend } from './enneagram-blend.js';
import { getTypeData } from '../i18n-data.js';
import { t as i18nT, contentLocale } from '../i18n.js';

function copy(locale, pt, en) {
  return contentLocale(locale) === 'en' ? en : pt;
}

function joinLabels(items, locale) {
  const labels = items.map((item) => item.label || item.key).filter(Boolean);
  if (labels.length < 2) return labels[0] || '';
  const conjunction = i18nT(locale, 'ui.profileSynthesis.and');
  return `${labels.slice(0, -1).join(', ')}${conjunction}${labels.at(-1)}`;
}

function normalizeMotivators(motivatorsTop) {
  if (!Array.isArray(motivatorsTop)) return [];
  return motivatorsTop
    .filter((item) => item && (item.label || item.key))
    .map((item) => ({
      key: String(item.key || ''),
      label: String(item.label || item.key),
      score: Number.isFinite(Number(item.score)) ? Number(item.score) : null,
    }))
    .slice(0, 3);
}

/**
 * Lightweight work-profile synthesis. It combines existing results without
 * introducing another assessment or treating either source as a diagnosis.
 * B-RH2-09: `conversationActions` = 2–4 usable 1:1 prompts with sources.
 */
export function buildProfileSynthesis({
  locale = 'pt-BR',
  topType,
  scores,
  motivatorsTop,
} = {}) {
  const loc = contentLocale(locale);
  const motivators = normalizeMotivators(motivatorsTop);
  const ranked = scores && typeof scores === 'object' ? rankEnneagramScores(scores) : [];
  const scoredLead = ranked[0]?.score > 0 ? ranked[0] : null;
  const fallbackType = Number(topType);
  const primaryType = scoredLead?.type
    || (Number.isInteger(fallbackType) && fallbackType >= 1 && fallbackType <= 9 ? fallbackType : null);
  const hasEnneagram = primaryType != null;
  const hasMotivators = motivators.length > 0;
  const completeness = hasEnneagram && hasMotivators
    ? 'full'
    : hasEnneagram
      ? 'enneagram_only'
      : hasMotivators
        ? 'motivators_only'
        : 'empty';

  if (completeness === 'empty') {
    return {
      completeness,
      headline: '',
      convergences: [],
      tensions: [],
      howToLead: [],
      pdiIdeas: [],
      conversationActions: [],
    };
  }

  const typeData = hasEnneagram ? getTypeData(loc)[primaryType] : null;
  const secondary = scoredLead && ranked[1]?.score > 0
    && scoredLead.score - ranked[1].score <= closeDeltaForLead(scoredLead.score)
    ? ranked[1]
    : null;
  const blend = secondary ? getEnneagramBlend(primaryType, secondary.type, loc) : null;
  const motiveNames = joinLabels(motivators, loc);
  const leadName = typeData?.short || typeData?.name || `T${primaryType}`;
  const strengths = (typeData?.strengths || []).slice(0, 3);

  const convergences = [];
  const tensions = [];
  const howToLead = [];
  const pdiIdeas = [];
  const conversationActions = [];

  if (hasEnneagram) {
    convergences.push(copy(
      loc,
      `Há indícios de contribuição por meio de ${joinLabels(strengths.map((label) => ({ label })), loc)}.`,
      `There are signs of contribution through ${joinLabels(strengths.map((label) => ({ label })), loc)}.`
    ));
    if (blend) {
      convergences.push(copy(
        loc,
        `Há indícios de uma combinação próxima de ${blend.title.toLowerCase()}.`,
        `There are signs of a blend close to ${blend.title.toLowerCase()}.`
      ));
    }
    tensions.push(copy(
      loc,
      `Sob pressão, pode ser útil observar o equilíbrio ligado a: ${typeData?.challenge || leadName}.`,
      `Under pressure, it may help to watch the balance related to: ${typeData?.challenge || leadName}.`
    ));
    howToLead.push(copy(
      loc,
      `Tende a responder melhor a expectativas claras e espaço para aplicar ${strengths.slice(0, 2).join(' e ')}.`,
      `They tend to respond better to clear expectations and room to apply ${strengths.slice(0, 2).join(' and ')}.`
    ));
    pdiIdeas.push(copy(
      loc,
      'Pode ser útil escolher uma situação real por semana para testar uma abordagem diferente e revisar o aprendizado.',
      'It may help to choose one real situation each week, test a different approach, and review the learning.'
    ));
    conversationActions.push({
      source: 'enneagram',
      sourceLabel: copy(loc, 'Eneagrama', 'Enneagram'),
      text: copy(
        loc,
        `Pergunte: em qual situação recente o estilo ${leadName} ajudou (ou atrapalhou) a entrega?`,
        `Ask: in a recent situation, when did the ${leadName} style help (or hinder) delivery?`
      ),
    });
    conversationActions.push({
      source: 'enneagram',
      sourceLabel: copy(loc, 'Eneagrama', 'Enneagram'),
      text: copy(
        loc,
        `Combine um próximo passo concreto alinhado a ${strengths[0] || leadName} e um prazo curto.`,
        `Agree on one concrete next step aligned with ${strengths[0] || leadName} and a short deadline.`
      ),
    });
  }

  if (hasMotivators) {
    convergences.push(copy(
      loc,
      `Há indícios de maior energia quando o trabalho favorece ${motiveNames}.`,
      `There are signs of greater energy when work supports ${motiveNames}.`
    ));
    howToLead.push(copy(
      loc,
      `Pode responder melhor quando prioridades e combinados consideram ${motivators[0].label}.`,
      `They may respond better when priorities and agreements account for ${motivators[0].label}.`
    ));
    pdiIdeas.push(copy(
      loc,
      `Pode ser útil experimentar uma ação pequena que amplie ${motivators[0].label} no trabalho atual.`,
      `It may help to try one small action that increases ${motivators[0].label} in current work.`
    ));
    conversationActions.push({
      source: 'motivators',
      sourceLabel: copy(loc, 'Motivadores', 'Motivators'),
      text: copy(
        loc,
        `Valide: o que no trabalho atual mais aproxima (ou afasta) ${motivators[0].label}?`,
        `Validate: what in current work most supports (or blocks) ${motivators[0].label}?`
      ),
    });
    if (motivators.length > 1) {
      tensions.push(copy(
        loc,
        `A combinação entre ${motivators[0].label} e ${motivators[1].label} pode pedir escolhas explícitas quando ambas não couberem na mesma decisão.`,
        `The combination of ${motivators[0].label} and ${motivators[1].label} may require explicit choices when both do not fit the same decision.`
      ));
      pdiIdeas.push(copy(
        loc,
        'Pode ser útil registrar quais tarefas aumentam ou reduzem energia e validar o padrão em conversas de 1:1.',
        'It may help to note which tasks raise or reduce energy and validate the pattern in 1:1 conversations.'
      ));
      conversationActions.push({
        source: 'motivators',
        sourceLabel: copy(loc, 'Motivadores', 'Motivators'),
        text: copy(
          loc,
          `Quando ${motivators[0].label} e ${motivators[1].label} competem, o que deve prevalecer nesta semana?`,
          `When ${motivators[0].label} and ${motivators[1].label} compete, what should win this week?`
        ),
      });
    }
  }

  if (hasEnneagram && hasMotivators) {
    howToLead.push(copy(
      loc,
      `Há indícios de que combinar feedback sobre o estilo ${leadName} com oportunidades ligadas a ${motivators[0].label} tende a tornar os acordos mais concretos.`,
      `There are signs that combining feedback on the ${leadName} style with opportunities linked to ${motivators[0].label} tends to make agreements more concrete.`
    ));
    pdiIdeas.push(copy(
      loc,
      'Pode ser útil definir um experimento de desenvolvimento curto e revisar evidências, sem transformar a leitura em rótulo.',
      'It may help to define a short development experiment and review evidence without turning the reading into a label.'
    ));
  }

  const headline = hasEnneagram
    ? copy(
        loc,
        `Há indícios de um estilo de trabalho próximo de ${leadName}${hasMotivators ? `, com energia associada a ${motiveNames}` : ''}.`,
        `There are signs of a work style close to ${leadName}${hasMotivators ? `, with energy linked to ${motiveNames}` : ''}.`
      )
    : copy(
        loc,
        `Há indícios de energia de trabalho associada a ${motiveNames}.`,
        `There are signs of work energy linked to ${motiveNames}.`
      );

  return {
    completeness,
    headline,
    convergences: convergences.slice(0, 3),
    tensions: tensions.slice(0, 2),
    howToLead: howToLead.slice(0, 3),
    pdiIdeas: pdiIdeas.slice(0, 4),
    conversationActions: conversationActions.slice(0, 4),
  };
}
