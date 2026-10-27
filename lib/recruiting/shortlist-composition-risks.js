/**
 * Riscos de composição na shortlist /r — reusa matriz T1–T9.
 */

import { getCompat } from '../data.js';
import { buildNucleusCompositionAdvice } from '../people/decision-brief.js';
import { contentLocale } from '../i18n.js';

function pairKey(a, b) {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

/**
 * Tensões pairwise dentro da shortlist selecionada.
 * @param {{ locale?: string, people: Array<{ candidateId: number, name?: string, topType: number }> }} input
 */
export function buildShortlistPairTensions(input = {}) {
  const locale = contentLocale(input.locale);
  const people = (Array.isArray(input.people) ? input.people : []).filter(
    (p) => Number.isInteger(Number(p.topType)) && Number(p.topType) >= 1 && Number(p.topType) <= 9
  );
  const seen = new Set();
  const tensions = [];
  for (let i = 0; i < people.length; i += 1) {
    for (let j = i + 1; j < people.length; j += 1) {
      const a = people[i];
      const b = people[j];
      const key = pairKey(a.candidateId, b.candidateId);
      if (seen.has(key)) continue;
      seen.add(key);
      const compat = getCompat(Number(a.topType), Number(b.topType), locale);
      if (compat?.level !== 'tension') continue;
      tensions.push({
        candidateA: { id: a.candidateId, name: a.name || '', topType: Number(a.topType) },
        candidateB: { id: b.candidateId, name: b.name || '', topType: Number(b.topType) },
        title: compat.title,
        desc: compat.desc || '',
      });
    }
  }
  return tensions.slice(0, 8);
}

/**
 * Shortlist vs núcleo interno + tensões internas.
 */
export function buildShortlistCompositionRisks({
  locale = 'pt-BR',
  shortlist = [],
  nucleus = [],
} = {}) {
  const pairTensions = buildShortlistPairTensions({ locale, people: shortlist });
  const nucleusAdvice = buildNucleusCompositionAdvice({
    locale,
    nucleus,
    candidates: shortlist.map((p) => ({
      id: p.candidateId,
      name: p.name,
      topType: p.topType,
    })),
    limitCompleters: 3,
    limitRisks: 5,
  });

  return {
    pairTensions,
    nucleusRisks: nucleusAdvice.risks || [],
    nucleusCompleters: nucleusAdvice.completers || [],
    empty: pairTensions.length === 0 && (nucleusAdvice.risks || []).length === 0,
  };
}
