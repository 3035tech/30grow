import { contentLocale } from '../i18n.js';
/** Intra-person T1–T9 blends (primary + second-highest). Not pair-of-people compatibility. */

function L(pt, en) {
  return { 'pt-BR': pt, en };
}

export const ENNEAGRAM_BLENDS = {
  '1-2': {
    level: 'synergy',
    title: L('Padrão com cuidado', 'Standards with care'),
    reading: L(
      'Há indícios de busca por fazer certo sem perder o olhar para as pessoas. Pode funcionar melhor quando a excelência vem acompanhada de apoio ao time, e não só de correção.',
      'There are signs of wanting to get things right without losing sight of people. Tends to work better when excellence comes with support, not only correction.'
    ),
    team: L(
      'Pode contribuir com qualidade e, ao mesmo tempo, com atenção a quem executa o processo.',
      'May contribute quality while staying attentive to the people running the process.'
    ),
  },
  '1-3': {
    level: 'neutral',
    title: L('Processo e resultado', 'Process and outcome'),
    reading: L(
      'Pode oscilar entre fazer do jeito certo e entregar rápido. Há potencial para alta performance quando prazo e critério estão explícitos; o desgaste tende a aparecer quando só um dos dois é cobrado.',
      'May swing between doing it the right way and delivering fast. High performance is more likely when both deadline and quality criteria are explicit.'
    ),
    team: L(
      'Tende a puxar o time para entregar com padrão visível. Desde que o “como” não trave o “quando”.',
      'Tends to pull the team toward visible standards. As long as the “how” does not freeze the “when”.'
    ),
  },
  '1-4': {
    level: 'tension',
    title: L('Crítica e autenticidade', 'Critique and authenticity'),
    reading: L(
      'Pode coexistir um padrão interno alto com sensibilidade a julgamento. Feedback tende a funcionar melhor quando é específico e sobre o trabalho, não sobre a pessoa.',
      'A high inner standard may coexist with sensitivity to judgment. Feedback tends to work better when it is specific and about the work, not the person.'
    ),
    team: L(
      'Pode elevar qualidade e, ao mesmo tempo, trazer um olhar mais original. Se houver espaço para o padrão sem exposição pública da falha.',
      'May raise quality while adding an original lens. If standards exist without publicly exposing mistakes.'
    ),
  },
  '1-5': {
    level: 'synergy',
    title: L('Rigor analítico', 'Analytical rigor'),
    reading: L(
      'Há indícios de combinação entre critério e profundidade. Pode funcionar especialmente bem em revisão, dados e processos; o risco é demorar para soltar a entrega por querer mais uma verificação.',
      'There are signs of combining criteria with depth. Often strong in review, data, and process; the risk is delaying release to run one more check.'
    ),
    team: L(
      'Tende a contribuir com análises confiáveis e padrões que o grupo consegue repetir.',
      'Tends to contribute reliable analysis and standards the group can repeat.'
    ),
  },
  '1-6': {
    level: 'synergy',
    title: L('Integridade e prevenção', 'Integrity and prevention'),
    reading: L(
      'Pode unir senso de dever com antecipação de risco. Há potencial para ser âncora de confiabilidade; pode gerar ansiedade quando regras mudam sem contexto.',
      'May combine a sense of duty with risk anticipation. Can become an anchor of reliability; may feel anxious when rules change without context.'
    ),
    team: L(
      'Tende a fortalecer compliance, continuidade e o “não deixar passar” o que importa.',
      'Tends to strengthen compliance, continuity, and catching what must not slip through.'
    ),
  },
  '1-7': {
    level: 'tension',
    title: L('Rigor e movimento', 'Rigor and movement'),
    reading: L(
      'Há indícios de um padrão que busca fazer certo e, ao mesmo tempo, escapar da rigidez. Pode oscilar entre cobrança alta e vontade de variar quando a rotina aperta. Funciona melhor quando há espaço para melhorar processos com criatividade, sem abrir mão de um critério mínimo.',
      'There are signs of wanting to get it right and, at the same time, escape rigidity. May swing between high standards and a need for variety when routine tightens. Works better when processes can improve creatively without dropping a minimum bar.'
    ),
    team: L(
      'Pode trazer qualidade e, ao mesmo tempo, ideias para destravar o que ficou engessado. Se o grupo não ler a variação como falta de compromisso.',
      'May bring quality and ideas to unstick what became rigid. If the group does not read variation as lack of commitment.'
    ),
  },
  '1-8': {
    level: 'tension',
    title: L('Padrão e assertividade', 'Standards and assertiveness'),
    reading: L(
      'Pode haver duas vozes internas de “é assim que deve ser”. Há potencial de liderança em crise e em correção de rumo; o risco é endurecer o tom ou entrar em disputa de controle.',
      'Two inner voices of “this is how it should be” may coexist. Potential for crisis leadership and course-correction; the risk is a harder tone or a control struggle.'
    ),
    team: L(
      'Tende a definir direção com clareza. Funciona melhor quando o padrão é negociado, não imposto só na pressão.',
      'Tends to set direction clearly. Works better when the standard is negotiated, not only imposed under pressure.'
    ),
  },
  '1-9': {
    level: 'synergy',
    title: L('Ação com clima', 'Action with climate'),
    reading: L(
      'Pode equilibrar execução de padrão com desejo de harmonia. Há potencial para liderar sem quebrar o grupo; o risco é suavizar demais um critério importante para evitar atrito.',
      'May balance executing a standard with a wish for harmony. Can lead without breaking the group; the risk is softening an important criterion to avoid friction.'
    ),
    team: L(
      'Tende a sustentar qualidade e, ao mesmo tempo, mediar o ritmo do time.',
      'Tends to hold quality while mediating the team’s pace.'
    ),
  },
  '2-3': {
    level: 'neutral',
    title: L('Cuidado e entrega', 'Care and delivery'),
    reading: L(
      'Pode querer ser útil e, ao mesmo tempo, ser visto pelo resultado. Funciona bem em papéis de atendimento com meta; o desgaste tende a aparecer quando só a performance é reconhecida e o cuidado some.',
      'May want to be useful and, at the same time, seen for results. Fits service roles with targets; strain tends to appear when only performance is recognized and care disappears.'
    ),
    team: L(
      'Pode colar o time e puxar entrega: se houver reconhecimento tanto da relação quanto do número.',
      'May glue the team and pull delivery: if both relationship and numbers are recognized.'
    ),
  },
  '2-4': {
    level: 'synergy',
    title: L('Cuidado com profundidade', 'Care with depth'),
    reading: L(
      'Há indícios de forte orientação a pessoas, com necessidade de ser visto de forma genuína. Pode contribuir muito em RH e relação; o risco é absorver o clima do grupo como se fosse pessoal.',
      'Signs of a strong people orientation, with a need to be seen genuinely. Can contribute a lot in HR and relationship work; the risk is absorbing the group’s mood as personal.'
    ),
    team: L(
      'Tende a criar vínculo e leitura fina do que o time sente. Útil em suporte, cultura e clientes.',
      'Tends to create bond and a fine reading of what the team feels. Useful in support, culture, and customers.'
    ),
  },
  '2-5': {
    level: 'tension',
    title: L('Proximidade e espaço', 'Closeness and space'),
    reading: L(
      'Pode haver um puxa-e-solta interno entre cuidar e precisar de distância. Funciona melhor quando a autonomia é combinada e o cuidado não é lido como invasão.',
      'An inner pull between caring and needing distance may appear. Works better when autonomy is agreed and care is not read as intrusion.'
    ),
    team: L(
      'Pode oferecer ajuda pontual e análise: se o grupo respeitar momentos de foco sem interpretar como frieza.',
      'May offer timely help and analysis: if the group respects focus time without reading it as coldness.'
    ),
  },
  '2-6': {
    level: 'synergy',
    title: L('Cuidado leal', 'Loyal care'),
    reading: L(
      'Há potencial de ser alguém em quem o time se apoia. Pode antecipar problemas e necessidades; o risco é sobrecarga por dizer sim demais ou por hipervigilância relacional.',
      'Potential to be someone the team leans on. May anticipate problems and needs; the risk is overload from saying yes too often or from relational hypervigilance.'
    ),
    team: L(
      'Tende a fortalecer confiança, continuidade e o cuidado de quem está na operação.',
      'Tends to strengthen trust, continuity, and care for people in the operation.'
    ),
  },
  '2-7': {
    level: 'neutral',
    title: L('Calor e energia', 'Warmth and energy'),
    reading: L(
      'Pode unir disposição para as pessoas com busca de leveza. Há potencial em ambientes de cliente e produto; pode evitar conversas pesadas que o grupo precisa ter.',
      'May combine a people orientation with a search for lightness. Fits customer and product settings; may avoid heavy conversations the group still needs.'
    ),
    team: L(
      'Tende a animar o clima e facilitar conexão: com o risco de passar rápido demais por conflitos.',
      'Tends to lift the mood and ease connection: with a risk of moving too quickly past conflict.'
    ),
  },
  '2-8': {
    level: 'tension',
    title: L('Cuidar e confrontar', 'Care and confrontation'),
    reading: L(
      'Pode haver um contraste interno entre suavidade e assertividade. Há potencial para proteger o time e também para tensionar quando algo é injusto; o tom pode oscilar.',
      'An inner contrast between softness and assertiveness may appear. Potential to protect the team and also to push back when something is unfair; tone may swing.'
    ),
    team: L(
      'Pode ser quem defende pessoas e, ao mesmo tempo, quem põe o assunto difícil na mesa.',
      'May be the one who defends people and, at the same time, puts the hard topic on the table.'
    ),
  },
  '2-9': {
    level: 'synergy',
    title: L('Acolhimento e harmonia', 'Welcome and harmony'),
    reading: L(
      'Há indícios de forte orientação a clima e cooperação. Pode ser o “óleo” do grupo; o risco é evitar o conflito necessário e diluir a própria necessidade.',
      'Signs of a strong orientation to climate and cooperation. May be the group’s “oil”; the risk is avoiding needed conflict and diluting one’s own needs.'
    ),
    team: L(
      'Tende a suavizar atritos e manter o time junto. Desde que alguém ainda nomeie o que precisa ser decidido.',
      'Tends to soften friction and keep the team together. As long as someone still names what must be decided.'
    ),
  },
  '3-4': {
    level: 'tension',
    title: L('Imagem e autenticidade', 'Image and authenticity'),
    reading: L(
      'Pode coexistir a adaptação ao contexto com a necessidade de ser genuíno. Há potencial criativo e de entrega; o desgaste tende a aparecer quando a meta pede um papel que não “combina” com a pessoa.',
      'Adapting to context may coexist with a need to be genuine. Creative delivery is possible; strain tends to appear when the goal asks for a role that does not “fit”.'
    ),
    team: L(
      'Pode unir resultado com um olhar mais original. Se houver espaço para não performar o tempo todo.',
      'May combine results with a more original lens. If there is room not to perform all the time.'
    ),
  },
  '3-5': {
    level: 'neutral',
    title: L('Velocidade e profundidade', 'Speed and depth'),
    reading: L(
      'Pode haver tensão de ritmo: entregar agora versus entender melhor. Funciona melhor em ciclos curtos com um momento explícito de análise.',
      'A pace tension may appear: deliver now versus understand better. Works better in short cycles with an explicit analysis slot.'
    ),
    team: L(
      'Tende a puxar o time para o resultado sem abrir mão de uma base analítica mínima.',
      'Tends to pull the team toward outcomes without dropping a minimum analytical base.'
    ),
  },
  '3-6': {
    level: 'tension',
    title: L('Confiança e verificação', 'Confidence and checking'),
    reading: L(
      'Pode projetar segurança e, ao mesmo tempo, questionar o terreno. Há potencial para execução com gestão de risco; o risco é parecer inconsistente (otimista num dia, cético no outro).',
      'May project confidence and, at the same time, question the ground. Potential for execution with risk management; the risk is looking inconsistent (optimistic one day, skeptical the next).'
    ),
    team: L(
      'Pode acelerar entregas e, ao mesmo tempo, pedir evidência. Útil se o grupo não ler a dúvida como falta de fé no plano.',
      'May speed delivery and still ask for evidence. Useful if the group does not read doubt as lack of faith in the plan.'
    ),
  },
  '3-7': {
    level: 'synergy',
    title: L('Resultado com energia', 'Results with energy'),
    reading: L(
      'Há indícios de perfil rápido, otimista e orientado a conquista. Pode puxar o time em projetos com prazo; o risco é superficialidade ou abandono do que ficou “chato”.',
      'Signs of a fast, optimistic, achievement-oriented profile. May pull the team on deadline projects; the risk is skimming depth or dropping what became “boring”.'
    ),
    team: L(
      'Tende a gerar ritmo, ideias e entrega visível em ambientes ágeis.',
      'Tends to generate pace, ideas, and visible delivery in agile settings.'
    ),
  },
  '3-8': {
    level: 'neutral',
    title: L('Ambição e força', 'Ambition and force'),
    reading: L(
      'Pode haver alta assertividade e foco em resultado. Há potencial de liderança de frente; o risco é competir por espaço ou atropelar o processo do grupo.',
      'High assertiveness and outcome focus may appear. Front-line leadership potential; the risk is competing for space or running over the group’s process.'
    ),
    team: L(
      'Tende a destravar decisão e meta: melhor quando a força vem com clareza de papéis.',
      'Tends to unlock decisions and goals: better when force comes with clear roles.'
    ),
  },
  '3-9': {
    level: 'tension',
    title: L('Urgência e ritmo natural', 'Urgency and natural pace'),
    reading: L(
      'Pode haver um puxa interno entre acelerar e preservar o clima. Funciona melhor com prazos combinados, não só com pressão implícita.',
      'An inner pull between speeding up and protecting the climate may appear. Works better with agreed deadlines, not only implied pressure.'
    ),
    team: L(
      'Pode equilibrar entrega e harmonia: ou frustrar o grupo se o ritmo não for explícito.',
      'May balance delivery and harmony: or frustrate the group if pace stays implicit.'
    ),
  },
  '4-5': {
    level: 'synergy',
    title: L('Profundidade criativa', 'Creative depth'),
    reading: L(
      'Há indícios de originalidade com base analítica. Pode brilhar em desenho de solução; o risco é isolar-se demais ou demorar para expor o trabalho.',
      'Signs of originality with an analytical base. May shine in solution design; the risk is isolating too much or delaying showing the work.'
    ),
    team: L(
      'Tende a trazer perspectivas que o grupo não veria só pelo processo padrão.',
      'Tends to bring perspectives the group would not see through the standard process alone.'
    ),
  },
  '4-6': {
    level: 'neutral',
    title: L('Intensidade e cautela', 'Intensity and caution'),
    reading: L(
      'Pode mergulhar no que importa e, ao mesmo tempo, checar risco. Há potencial em papéis que pedem critério e significado; mudanças bruscas tendem a pesar.',
      'May dive into what matters and, at the same time, check risk. Fits roles that need both judgment and meaning; sudden change tends to weigh more.'
    ),
    team: L(
      'Pode contribuir com leitura fina e prevenção. Se houver previsibilidade mínima no entorno.',
      'May contribute a fine reading and prevention. If the environment has a minimum of predictability.'
    ),
  },
  '4-7': {
    level: 'tension',
    title: L('Profundidade e leveza', 'Depth and lightness'),
    reading: L(
      'Há indícios de um contraste interno entre ir fundo e buscar estímulo. Pode gerar criatividade alta; também pode parecer inconsistente (intenso num tema, disperso no outro). Funciona melhor quando há um fio de propósito ligando as variações.',
      'An inner contrast between going deep and seeking stimulation may appear. Can generate high creativity; may also look inconsistent (intense on one theme, scattered on another). Works better when a thread of purpose links the variations.'
    ),
    team: L(
      'Pode trazer ideias e significado: se o grupo não exigir só leveza nem só densidade o tempo todo.',
      'May bring ideas and meaning: if the group does not demand only lightness or only density all the time.'
    ),
  },
  '4-8': {
    level: 'neutral',
    title: L('Autenticidade e força', 'Authenticity and force'),
    reading: L(
      'Pode haver intensidade nas duas direções: sentir e agir. Há potencial de posicionamento claro; o risco é o conflito ficar pessoal rápido demais.',
      'Intensity may show in both feeling and acting. Potential for a clear stance; the risk is conflict turning personal too quickly.'
    ),
    team: L(
      'Tende a defender o que considera verdadeiro e a empurrar decisão. Melhor com acordos de tom.',
      'Tends to defend what it sees as true and to push decisions. Better with tone agreements.'
    ),
  },
  '4-9': {
    level: 'synergy',
    title: L('Significado e paz', 'Meaning and peace'),
    reading: L(
      'Há indícios de busca por trabalho com sentido em um clima menos agressivo. Pode contribuir em cultura e criação; o risco é adiar confronto e decisão.',
      'Signs of seeking meaningful work in a less aggressive climate. May contribute in culture and creation; the risk is postponing confrontation and decisions.'
    ),
    team: L(
      'Tende a cuidar do clima e da qualidade da experiência. Útil em times que já têm quem acelere a pauta.',
      'Tends to care for climate and experience quality. Useful in teams that already have someone accelerating the agenda.'
    ),
  },
  '5-6': {
    level: 'synergy',
    title: L('Análise e prevenção', 'Analysis and prevention'),
    reading: L(
      'Há potencial forte em planejamento e risco. Pode ser o “cérebro” silencioso do time; o risco é travar ação por querer mais uma garantia.',
      'Strong potential in planning and risk. May be the team’s quiet “brain”; the risk is freezing action to get one more guarantee.'
    ),
    team: L(
      'Tende a antecipar falhas e estruturar o que o grupo ainda está improvisando.',
      'Tends to anticipate failures and structure what the group is still improvising.'
    ),
  },
  '5-7': {
    level: 'tension',
    title: L('Foco e expansão', 'Focus and expansion'),
    reading: L(
      'Pode haver um puxa entre conservar energia/profundidade e explorar o novo. Funciona melhor com blocos claros: mergulho e depois variação. Não os dois ao mesmo tempo sem combinado.',
      'A pull between conserving energy/depth and exploring the new may appear. Works better with clear blocks: deep work, then variation. Not both at once without agreement.'
    ),
    team: L(
      'Pode alternar especialidade e ideação; o grupo ganha se souber em qual modo a pessoa está.',
      'May alternate specialist mode and ideation; the group gains if it knows which mode the person is in.'
    ),
  },
  '5-8': {
    level: 'neutral',
    title: L('Conhecimento e decisão', 'Knowledge and decision'),
    reading: L(
      'Pode unir análise com assertividade. Há potencial em arquitetura e decisões difíceis; o risco é o tom direto sem o contexto que a análise precisaria.',
      'May combine analysis with assertiveness. Potential in architecture and hard decisions; the risk is a direct tone without the context the analysis would need.'
    ),
    team: L(
      'Tende a fundamentar a decisão e depois empurrá-la. Útil em crises técnicas e políticas internas.',
      'Tends to ground the decision and then push it. Useful in technical crises and internal politics.'
    ),
  },
  '5-9': {
    level: 'synergy',
    title: L('Quietude produtiva', 'Productive quiet'),
    reading: L(
      'Há indícios de preferência por foco, autonomia e pouco ruído. Pode entregar profundidade alta; o risco é sumir do radar do grupo ou adiar o alinhamento.',
      'Signs of preferring focus, autonomy, and low noise. May deliver high depth; the risk is disappearing from the group’s radar or delaying alignment.'
    ),
    team: L(
      'Tende a contribuir melhor com escopo claro e menos reunião performática.',
      'Tends to contribute better with a clear scope and fewer performative meetings.'
    ),
  },
  '6-7': {
    level: 'neutral',
    title: L('Segurança e novidade', 'Safety and novelty'),
    reading: L(
      'Pode querer previsibilidade e, ao mesmo tempo, estímulo. Há potencial para inovar com rede de segurança; mudanças sem roteiro tendem a gerar ida e volta.',
      'May want predictability and, at the same time, stimulation. Potential to innovate with a safety net; change without a script tends to produce back-and-forth.'
    ),
    team: L(
      'Pode ser quem testa o novo sem largar o plano B. Se o grupo não ridicularizar a cautela.',
      'May be the one who tests the new without dropping plan B. If the group does not mock the caution.'
    ),
  },
  '6-8': {
    level: 'tension',
    title: L('Lealdade e autoridade', 'Loyalty and authority'),
    reading: L(
      'Pode haver alerta a controle e, ao mesmo tempo, presença forte. Funciona melhor com transparência de critérios; microgerenciamento tende a piorar a reação.',
      'Alertness to control may coexist with a strong presence. Works better with transparent criteria; micromanagement tends to worsen the reaction.'
    ),
    team: L(
      'Pode proteger o grupo e questionar rumo: valioso se a liderança não ler pergunta como ataque.',
      'May protect the group and question direction. Valuable if leadership does not read questions as attack.'
    ),
  },
  '6-9': {
    level: 'synergy',
    title: L('Estabilidade compartilhada', 'Shared stability'),
    reading: L(
      'Há indícios de busca por ambiente previsível e pouco conflito. Pode ser base confiável; o risco é acomodar demais ou espalhar preocupação sem decidir.',
      'Signs of seeking a predictable, low-conflict environment. May be a reliable base; the risk is accommodating too much or spreading worry without deciding.'
    ),
    team: L(
      'Tende a sustentar continuidade, lealdade e clima. Alguém no time ainda precisa puxar a decisão difícil.',
      'Tends to hold continuity, loyalty, and climate. Someone on the team still needs to pull the hard decision.'
    ),
  },
  '7-8': {
    level: 'neutral',
    title: L('Expansão e impacto', 'Expansion and impact'),
    reading: L(
      'Pode haver muita presença, energia e vontade de avançar. Há potencial em iniciativa e crise; o risco é ocupar espaço demais ou subestimar limites do grupo.',
      'A lot of presence, energy, and drive to move may appear. Potential in initiative and crisis; the risk is taking too much space or underestimating the group’s limits.'
    ),
    team: L(
      'Tende a destravar movimento. Funciona melhor com combinados de turno da fala e de decisão.',
      'Tends to unlock movement. Works better with agreements on speaking turns and decision rights.'
    ),
  },
  '7-9': {
    level: 'synergy',
    title: L('Leveza e calma', 'Lightness and calm'),
    reading: L(
      'Há indícios de evitar tensão e buscar um ambiente agradável. Pode manter moral alto; o risco é adiar o desconforto que faria o projeto andar.',
      'Signs of avoiding tension and seeking a pleasant environment. May keep morale high; the risk is postponing the discomfort that would move the project.'
    ),
    team: L(
      'Tende a suavizar o clima e gerar ideias: melhor se houver um combinado explícito de quando confrontar.',
      'Tends to soften the climate and generate ideas. Better with an explicit agreement on when to confront.'
    ),
  },
  '8-9': {
    level: 'neutral',
    title: L('Força e mediação', 'Force and mediation'),
    reading: L(
      'Pode haver um contraste interno entre ir direto e suavizar. Há potencial para decidir e depois acolher; o risco é o grupo não saber qual modo esperar.',
      'An inner contrast between going direct and softening may appear. Potential to decide and then welcome; the risk is the group not knowing which mode to expect.'
    ),
    team: L(
      'Pode tanto cortar rumo quanto apaziguar: o time ganha se a pessoa sinalizar quando está em cada polo.',
      'May both cut a path and pacify: the team gains if the person signals which pole they are in.'
    ),
  },
};

export function blendKey(a, b) {
  const x = Number(a);
  const y = Number(b);
  if (!Number.isFinite(x) || !Number.isFinite(y) || x === y) return null;
  return x < y ? `${x}-${y}` : `${y}-${x}`;
}

export function getEnneagramBlend(a, b, locale) {
  const key = blendKey(a, b);
  if (!key) return null;
  const row = ENNEAGRAM_BLENDS[key];
  if (!row) return null;
  const loc = contentLocale(locale);
  return {
    key,
    level: row.level,
    title: row.title[loc] || row.title['pt-BR'],
    reading: row.reading[loc] || row.reading['pt-BR'],
    team: row.team[loc] || row.team['pt-BR'],
  };
}
