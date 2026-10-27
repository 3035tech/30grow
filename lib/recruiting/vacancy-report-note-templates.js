import { contentLocale } from '../i18n.js';
/**
 * Templates de parecer /r por tipo de vaga (consultoria).
 */

export const REPORT_TEMPLATE_KINDS = Object.freeze([
  'technical',
  'leadership',
  'operational',
]);

const TEMPLATES_PT = Object.freeze({
  technical: `<p><strong>Quem avançar (perfil técnico):</strong> …</p>
<p><strong>Por quê (aderência rubrica + profundidade):</strong> …</p>
<p><strong>Alertas técnicos / gaps a sondar:</strong> …</p>
<p><strong>Próximo passo:</strong> Entrevista técnica + pair programming / desafio prático com quem está em Avançar.</p>`,
  leadership: `<p><strong>Quem avançar (perfil de liderança):</strong> …</p>
<p><strong>Por quê (fit + composição com o time):</strong> …</p>
<p><strong>Alertas de gestão / influência:</strong> …</p>
<p><strong>Próximo passo:</strong> Conversa de liderança com stakeholders + referências comportamentais.</p>`,
  operational: `<p><strong>Quem avançar (perfil operacional):</strong> …</p>
<p><strong>Por quê (execução, ritmo, clareza de processo):</strong> …</p>
<p><strong>Alertas de carga / consistência:</strong> …</p>
<p><strong>Próximo passo:</strong> Simulação de rotina + alinhamento de expectativas de entrega.</p>`,
});

const TEMPLATES_EN = Object.freeze({
  technical: `<p><strong>Who to advance (technical profile):</strong> …</p>
<p><strong>Why (rubric fit + depth):</strong> …</p>
<p><strong>Technical watch-outs / probes:</strong> …</p>
<p><strong>Next step:</strong> Technical interview + practical exercise with Advance picks.</p>`,
  leadership: `<p><strong>Who to advance (leadership profile):</strong> …</p>
<p><strong>Why (fit + team composition):</strong> …</p>
<p><strong>Leadership / influence watch-outs:</strong> …</p>
<p><strong>Next step:</strong> Leadership conversation with stakeholders + behavioral references.</p>`,
  operational: `<p><strong>Who to advance (operational profile):</strong> …</p>
<p><strong>Why (execution, pace, process clarity):</strong> …</p>
<p><strong>Load / consistency watch-outs:</strong> …</p>
<p><strong>Next step:</strong> Day-in-the-role simulation + delivery expectation alignment.</p>`,
});

/**
 * Heurística leve a partir do título da vaga / cargo.
 * @returns {'technical'|'leadership'|'operational'}
 */
export function inferReportTemplateKind({ title = '', jobRoleName = '' } = {}) {
  const blob = `${title} ${jobRoleName}`.toLowerCase();
  if (/\b(diretor|director|head|gerente|manager|lead|líder|lider|coordenador|supervisor|chief|vp|c-level)\b/.test(blob)) {
    return 'leadership';
  }
  if (/\b(operacional|operador|assistant|assistente|analista júnior|support|atendimento|logística|logistica|produção|producao)\b/.test(blob)) {
    return 'operational';
  }
  if (/\b(dev|developer|engenheiro|engineer|tech|software|dados|data|qa|sre|backend|frontend|full.?stack|arquitet)\b/.test(blob)) {
    return 'technical';
  }
  return 'technical';
}

export function getReportNoteTemplate(locale, kind = 'technical') {
  const safe = REPORT_TEMPLATE_KINDS.includes(kind) ? kind : 'technical';
  const map = contentLocale(locale) === 'en' ? TEMPLATES_EN : TEMPLATES_PT;
  return map[safe] || map.technical;
}
