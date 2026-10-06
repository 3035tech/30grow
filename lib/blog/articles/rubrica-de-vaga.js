import { BLOG_CATEGORY } from '../categories.js';

export default {
  slug: 'rubrica-de-vaga',
  title: 'Rubrica de vaga: como definir critérios e contratar com menos viés',
  description:
    'Passo a passo para montar uma rubrica de vaga com competências, estilos de trabalho e pesos, comparar candidatos de forma explicável e reduzir decisões por afinidade.',
  keywords: ['rubrica de vaga', 'critérios de seleção', 'contratação sem viés', 'perfil da vaga', 'ranking de candidatos', 'recrutamento e seleção'],
  category: BLOG_CATEGORY.RECRUITING,
  publishedAt: '2026-09-25',
  intro:
    'Sem critérios combinados antes das entrevistas, cada avaliador procura uma coisa diferente e a escolha tende a favorecer quem se parece com o entrevistador. Uma rubrica de vaga resolve isso ao transformar "o que buscamos" em critérios explícitos, com pesos e evidências esperadas.',
  sections: [
    {
      heading: 'O que é uma rubrica de vaga',
      paragraphs: [
        'É um documento curto que lista os critérios que importam para o cargo, quanto cada um pesa e o que conta como evidência de cada nível. Ela é escrita antes de abrir a vaga e usada por todos que avaliam.',
        'A rubrica não substitui o julgamento de quem entrevista. Ela dá a esse julgamento uma régua comum.',
      ],
    },
    {
      heading: 'Passo 1: comece pelos resultados do cargo',
      paragraphs: [
        'Antes de listar competências, descreva o que a pessoa precisa entregar nos primeiros seis a doze meses. Resultados concretos ajudam a separar o essencial do desejável.',
        'Pergunte ao gestor: o que faria esta contratação ser considerada um sucesso daqui a um ano? As respostas viram a base dos critérios.',
      ],
    },
    {
      heading: 'Passo 2: escolha poucos critérios e defina pesos',
      paragraphs: [
        'Rubricas com muitos itens viram checklist e perdem força. Prefira de quatro a seis critérios, combinando conhecimento técnico, comportamentos observáveis e estilo de trabalho esperado.',
        'Distribua pesos de acordo com o impacto no resultado. Um critério que, se faltar, inviabiliza a entrega deve pesar mais do que um que pode ser desenvolvido depois.',
      ],
      bullets: [
        'Técnico: o que precisa saber fazer no primeiro dia.',
        'Comportamental: como precisa agir em situações recorrentes do cargo.',
        'Estilo de trabalho: ritmo, autonomia e forma de colaboração que o contexto pede.',
      ],
    },
    {
      heading: 'Passo 3: descreva evidências por nível',
      paragraphs: [
        'Para cada critério, escreva o que seria uma evidência fraca, adequada e forte. Exemplo para "priorização sob pressão": fraca, fala em termos genéricos; adequada, descreve um caso com critérios claros; forte, mostra trade-offs explícitos e o resultado obtido.',
        'Isso reduz notas por impressão e facilita a calibração entre avaliadores.',
      ],
    },
    {
      heading: 'Passo 4: use a rubrica para comparar, não para eliminar no automático',
      paragraphs: [
        'Com notas por critério, o ranking de candidatos fica explicável: dá para dizer por que uma pessoa ficou à frente. Ainda assim, o ranking é apoio à decisão. Diferenças pequenas pedem conversa, não corte automático.',
        'Revise a rubrica ao final de cada processo. Se um critério não diferenciou ninguém ou se mostrou irrelevante depois da contratação, ajuste.',
      ],
    },
    {
      heading: 'Como o 30Grow apoia a rubrica',
      paragraphs: [
        'No 30Grow, cada vaga pode ter uma rubrica de perfil com pesos por estilo de trabalho (T1 a T9) e um perfil de referência reutilizável por cargo. O ranking de aderência mostra a explicação de cada posição, a IA pode sugerir pesos a partir da descrição da vaga e o scorecard de entrevista registra as evidências no mesmo lugar.',
      ],
    },
  ],
  takeaways: [
    'Escreva a rubrica antes da primeira entrevista e compartilhe com todos os avaliadores.',
    'Poucos critérios, com pesos ligados ao resultado do cargo.',
    'Evidências descritas por nível reduzem notas por impressão.',
    'Ranking é apoio à decisão, não corte automático.',
  ],
  faq: [
    {
      q: 'Quantos critérios uma rubrica deve ter?',
      a: 'Entre quatro e seis costuma funcionar bem. Mais do que isso dilui o foco e torna a avaliação demorada.',
    },
    {
      q: 'A rubrica elimina o viés?',
      a: 'Ela reduz, mas não elimina. Critérios explícitos, evidências por nível e calibração entre avaliadores diminuem a influência de afinidade e primeira impressão.',
    },
  ],
};
