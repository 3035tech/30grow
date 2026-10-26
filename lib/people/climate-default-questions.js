import { normalizeLocale } from '../locale-negotiation.js';

/** Starter questions for an editable draft. These are templates, not AI output. */
const PROMPTS = Object.freeze({
  'pt-BR': {
    likert: [
      'Em geral, sinto que posso contribuir com o meu melhor no dia a dia.',
      'Tenho clareza sobre o que se espera do meu trabalho.',
      'Sinto que há espaço para falar sobre dificuldades sem retaliação.',
      'Percebo reconhecimento quando entrego resultados relevantes.',
      'O ritmo e a carga de trabalho tendem a ser sustentáveis para mim.',
    ],
    text: [
      'Se quiser, conte em poucas palavras o que mais ajuda você a trabalhar bem por aqui.',
      'O que tende a dificultar o seu dia a dia no trabalho, se houver algo relevante?',
    ],
  },
  'pt-PT': {
    likert: [
      'Em geral, sinto que consigo dar o meu melhor no dia a dia.',
      'Sei o que se espera do meu trabalho.',
      'Sinto que posso falar sobre dificuldades sem receio de represálias.',
      'Sinto que o meu trabalho é reconhecido quando alcanço resultados relevantes.',
      'O ritmo e a carga de trabalho são sustentáveis para mim.',
    ],
    text: [
      'Se quiser, diga em poucas palavras o que mais o ajuda a trabalhar bem aqui.',
      'O que dificulta o seu dia a dia no trabalho, se houver algo relevante?',
    ],
  },
  en: {
    likert: [
      'Overall, I feel able to do my best work day to day.',
      'I understand what is expected of my work.',
      'I feel safe raising difficulties without fear of retaliation.',
      'My relevant contributions are recognized.',
      'My workload and pace feel sustainable.',
    ],
    text: [
      'If you wish, briefly describe what helps you work well here.',
      'What makes your day-to-day work harder, if anything?',
    ],
  },
  'es-419': {
    likert: [
      'En general, siento que puedo dar lo mejor de mí en el trabajo diario.',
      'Tengo claro qué se espera de mi trabajo.',
      'Siento que puedo hablar de las dificultades sin temor a represalias.',
      'Siento que se reconocen mis aportes cuando logro resultados relevantes.',
      'El ritmo y la carga de trabajo son sostenibles para mí.',
    ],
    text: [
      'Si lo deseas, cuenta brevemente qué te ayuda a trabajar bien aquí.',
      '¿Qué dificulta tu trabajo diario, si hay algo relevante?',
    ],
  },
  'es-ES': {
    likert: [
      'En general, siento que puedo dar lo mejor de mí en el trabajo diario.',
      'Tengo claro qué se espera de mi trabajo.',
      'Siento que puedo hablar de las dificultades sin temor a represalias.',
      'Siento que se reconocen mis aportaciones cuando logro resultados relevantes.',
      'El ritmo y la carga de trabajo son sostenibles para mí.',
    ],
    text: [
      'Si quieres, cuenta brevemente qué te ayuda a trabajar bien aquí.',
      '¿Qué dificulta tu trabajo diario, si hay algo relevante?',
    ],
  },
  'fr-FR': {
    likert: [
      'Dans l’ensemble, je me sens capable de donner le meilleur de moi-même au quotidien.',
      'Je sais ce que l’on attend de mon travail.',
      'Je me sens libre de parler des difficultés sans craindre de représailles.',
      'Mes contributions sont reconnues lorsque j’obtiens des résultats importants.',
      'Mon rythme et ma charge de travail me semblent soutenables.',
    ],
    text: [
      'Si vous le souhaitez, décrivez brièvement ce qui vous aide à bien travailler ici.',
      'Qu’est-ce qui complique votre travail au quotidien, le cas échéant ?',
    ],
  },
  'de-DE': {
    likert: [
      'Insgesamt habe ich das Gefühl, im Arbeitsalltag mein Bestes geben zu können.',
      'Ich weiß, was von meiner Arbeit erwartet wird.',
      'Ich kann Schwierigkeiten ansprechen, ohne Nachteile befürchten zu müssen.',
      'Meine Beiträge werden anerkannt, wenn ich wichtige Ergebnisse erziele.',
      'Mein Arbeitstempo und meine Arbeitsbelastung sind für mich langfristig tragbar.',
    ],
    text: [
      'Wenn Sie möchten, beschreiben Sie kurz, was Ihnen hilft, hier gut zu arbeiten.',
      'Was erschwert Ihren Arbeitsalltag, falls es etwas Relevantes gibt?',
    ],
  },
});

export function defaultClimateQuestions(locale) {
  const prompts = PROMPTS[normalizeLocale(locale)];
  return { likert: [...prompts.likert], text: [...prompts.text] };
}
