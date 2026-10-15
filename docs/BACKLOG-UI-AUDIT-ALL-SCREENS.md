# Backlog UI/UX: auditoria de todas as telas do 30Grow

Auditoria transversal de disposição de componentes, hierarquia visual, uso de espaço, densidade, ações, navegação, responsividade, acessibilidade e estados de interface.

Data da análise: setembro de 2026.

Entrega transversal de 15/10/2026: o padrão compartilhado de tabelas agora inclui indicação de rolagem, botões, setas/Home/End e primeira coluna fixa; filtros se agrupam e se reorganizam no celular; avisos não encobrem ações de diálogos. Estado de listas locais foi ligado à URL em Remuneração, DP, Cargos, Avaliações, PDI, Sucessão, Análise demissional, Biblioteca, Cursos, Benefícios, Mural, Motivadores, Clima, Ouvidoria, Organização, Consumo de IA e Banco de talentos. As listagens de Equipe, Vagas, Usuários, Empresas, Leads, Feedback e Auditoria mantêm seus contratos de URL existentes. A ficha retorna ao Banco de talentos preservando contexto e o pipeline oferece movimentação por seleção acessível. Isso padroniza o comportamento transversal; os itens específicos de hierarquia/conteúdo por tela abaixo continuam com seus respectivos estados.

## 1. Escopo e método

Foram auditadas estaticamente:

- todas as abas do dashboard em `app/dashboard/tabs/`;
- shell, menu e navegação do dashboard;
- ficha da pessoa e blocos de People;
- hub e páginas do colaborador em `/employee`;
- portal mínimo `/e/{token}`;
- fluxos públicos de assessment, clima, pulso, feedback, avaliação e ouvidoria;
- páginas de vagas públicas;
- login, cadastro, redefinição e onboarding;
- landpage e preços.

Também foram considerados os prints enviados durante os ciclos de polish, especialmente Visão geral, Equipe, Vagas, Pipeline, Remuneração e PDI/Clima.

### Níveis de evidência

- **Confirmado:** identificado diretamente no JSX, nos componentes compartilhados ou em print.
- **Provável:** inferido por composição, tamanho e arquitetura do componente; requer validação visual autenticada.
- **Visual:** depende de uma nova sessão autenticada para confirmar quebra, ritmo ou prioridade percebida.

O navegador local não estava disponível nesta sessão. Portanto, o documento não afirma como confirmado aquilo que depende exclusivamente de renderização.

## 2. Diagnóstico executivo

O 30Grow possui bons componentes canônicos para listagens, formulários, loading, empty state e progressive disclosure. O principal problema atual não é falta de design system. É a quantidade de responsabilidades acumuladas em algumas telas.

Os arquivos mais densos são sinais objetivos de risco de UX e manutenção:

| Superfície | Tamanho aproximado | Risco principal |
|---|---:|---|
| Vagas | 1.983 linhas | lista, detalhe, criação, pipeline e configuração competindo |
| Equipe | 1.879 linhas | lista e dossiê extenso dentro de drawer |
| LMS admin | 1.457 linhas | catálogo, detalhe, aulas, matrículas e coortes |
| Clima | 1.359 linhas | campanhas, respostas e analytics no mesmo contexto |
| Motivadores | 1.222 linhas | convites, configuração, resultados e analytics |
| Hub do colaborador | 1.175 linhas | muitas jornadas em uma coluna longa |
| Empresas | 1.053 linhas | listagem, configuração e módulos |
| Visão geral | 1.053 linhas | muitos sinais e cards secundários |
| Sucessão | 985 linhas | configuração, cobertura, sucessores e analytics |

Conclusão:

1. Listagens administrativas simples estão próximas do padrão desejado.
2. Telas compostas precisam de arquitetura de informação, não apenas redução de padding.
3. Drawers estão carregando fluxos que já merecem rota ou workspace próprio.
4. O dashboard possui módulos demais visíveis simultaneamente quando todos estão habilitados.
5. O hub do colaborador precisa priorizar tarefas e reduzir rolagem vertical.
6. Os fluxos públicos estreitos são adequados; devem permanecer simples e focados.

## 3. Princípios para o polish global

### 3.1 Uma tarefa primária por viewport

Cada tela precisa responder em poucos segundos:

- onde estou;
- qual decisão preciso tomar;
- qual é a próxima ação;
- o que demanda atenção agora.

### 3.2 Resumo antes do detalhe

Ordem recomendada:

1. cabeçalho e contexto;
2. alerta/estado;
3. ação principal;
4. filtros;
5. resultado/lista;
6. detalhes secundários recolhíveis.

### 3.3 Largura proporcional ao conteúdo

- formulários e leitura: `max-w-3xl` a `max-w-5xl`;
- tabelas: largura disponível, com colunas priorizadas;
- analytics: grid assimétrico quando houver um insight principal;
- não esticar uma lista textual curta por toda a largura;
- não deixar metade da tela vazia quando existe informação complementar acionável.

### 3.4 Ações no ponto de decisão

- ação de página no cabeçalho;
- ação da linha no fim da linha;
- ação do objeto no cabeçalho do detalhe;
- destrutiva em menu secundário quando não for frequente;
- evitar blocos de ícones sem texto fora de tabelas densas.

### 3.5 Progressive disclosure real

Recolher conteúdo secundário, não esconder a tarefa principal. O primeiro bloco aberto deve conter o trabalho mais frequente, não apenas um resumo decorativo.

## 4. Gaps sistêmicos

### B-UIA-001: arquitetura global de navegação

**Evidência:** confirmada em `DashboardClient.jsx`.

**Onda 1 entregue:** menu reorganizado em seis grupos orientados ao trabalho, ações rápidas removidas da sidebar, grupo da tela atual aberto no primeiro acesso, preferência posterior persistida e Guia/Sair fixados no rodapé. O mapa compartilhado também alimenta o breadcrumb. Permanecem neste item a validação visual autenticada e a eventual busca global com recentes/favoritos.

Com todos os módulos habilitados, o menu contém aproximadamente 30 destinos agrupados em Análise, Recrutamento, Pessoas, Catálogos, LMS, Conta e Ajuda.

Gaps:

- categorias orientadas parcialmente pela implementação, não pela tarefa;
- Remuneração aparece em Análise, enquanto DP aparece em Pessoas;
- Motivadores está em Pessoas, embora também seja instrumento de análise;
- Academy e LMS podem parecer duplicados;
- Catálogos reúne Cargos, Academy, Benefícios e Mural, objetos com finalidades diferentes;
- seções abertas por padrão aumentam a altura total.

Proposta:

- manter no máximo 6 grupos de primeiro nível;
- usar `Início`, `Pessoas`, `Recrutamento`, `Desenvolvimento`, `Cultura e RH`, `Administração`;
- mover configurações de catálogo para dentro do módulo consumidor quando possível;
- manter favoritos/recentes na busca global, não como bloco fixo grande;
- persistir grupos abertos, mas abrir apenas o grupo atual por padrão no primeiro acesso;
- validar menu em 1280×720 e 1440×900.

### B-UIA-002: cabeçalho canônico para todas as abas

**Evidência:** confirmada.

**Onda 3 entregue parcialmente:** `AdminPageHeader` passou a reorganizar contexto e ações verticalmente em telas estreitas e mantém uma única região de ações. As listagens administrativas que já usam o componente recebem o comportamento em conjunto; telas analíticas legadas ainda precisam de migração sem duplicar o título do shell.

Listagens recentes usam `AdminPageHeader`; telas analíticas mais antigas variam entre labels, cards e cabeçalhos internos.

Padronizar:

- título;
- descrição curta opcional;
- contexto/filtros ativos;
- ação principal à direita;
- no máximo uma ação primária;
- ações secundárias em menu ou grupo discreto.

Aplicar em Overview, Equipe, Compatibilidade, Comparativo, Grupos, Liderança, Analytics e Clima sem duplicar o título do shell.

### B-UIA-003: densidade e ritmo vertical

**Evidência:** confirmada em prints e JSX.

**Onda 3 entregue parcialmente:** ações canônicas deixaram de usar monoespaçada como tipografia principal, ganharam estados consistentes de hover/foco e filtros/ordenação ficaram mais discretos. A revisão de cards aninhados continua por módulo nas ondas seguintes.

Há telas com sucessão de cards de mesma aparência e importância. Isso cria sensação de informações “jogadas”, mesmo quando o conteúdo é correto.

Correção:

- distinguir painel primário, seção e item;
- diminuir bordas repetidas em blocos aninhados;
- usar separadores internos em vez de card dentro de card;
- limitar labels de seção em caixa alta/monoespaçada;
- preservar respiro entre grupos de tarefas, não entre todos os campos.

### B-UIA-004: modelo de workspace para telas compostas

**Evidência:** confirmada.

Vagas, Equipe, LMS, Clima e Motivadores alternam entre lista, edição e detalhe dentro do mesmo componente.

Criar padrão compartilhado:

```text
Cabeçalho
Subnavegação local
┌──────────────────────────┬────────────────────────────┐
│ lista/contexto           │ detalhe ou workspace       │
└──────────────────────────┴────────────────────────────┘
```

Em mobile, lista e detalhe viram telas sequenciais. Não comprimir duas colunas.

### B-UIA-005: drawers extensos

**Evidência:** confirmada em Equipe e outros cadastros ricos.

O drawer é adequado para criação/edição curta. Não é adequado para dossiê, jornada, histórico, remuneração e DP completos.

Regras:

- até aproximadamente 8 campos ou uma decisão curta: drawer;
- objeto com subabas, histórico ou tarefas contínuas: rota/workspace;
- preservar deep link;
- drawer pode servir como preview com CTA `Abrir ficha completa`.

### B-UIA-006: tabelas responsivas

**Evidência:** confirmada.

**Onda 3 entregue parcialmente:** `AdminTableShell` centraliza scroll horizontal com contenção e scrollbar previsível; cabeçalhos ordenáveis e paginação ganharam foco visível. Corrigido também o HTML inválido da tabela de afastamentos em DP. Permanecem priorização de colunas por breakpoint e validação visual autenticada.

`AdminTableShell` protege várias tabelas com overflow e largura mínima. Isso evita quebra, mas não resolve prioridade de informação em telas menores.

Evolução:

- coluna principal sticky quando útil;
- ações sticky à direita somente em desktop;
- ocultar metadados secundários em breakpoints menores;
- versão em cards apenas quando a ação por item for mais importante que comparação entre linhas;
- informar scroll horizontal;
- testar teclado e foco dentro do container.

### B-UIA-007: filtros e estado na URL

**Evidência:** parcial.

**Onda 3 entregue parcialmente:** Vaga e ficha da pessoa preservam a seção ativa na URL; fechar o detalhe limpa seu contexto sem descartar os filtros da lista. A migração das listagens que ainda guardam filtros apenas em estado local permanece no backlog.

O shell já utiliza parâmetros para várias abas, mas diversas listagens mantêm filtros e paginação localmente.

Critérios:

- filtros relevantes compartilháveis na URL;
- voltar do detalhe preserva filtros/página;
- botão limpar consistente;
- chips apenas para filtros ativos relevantes;
- não exibir ao mesmo tempo formulário de filtro extenso e chips redundantes.

### B-UIA-008: semântica de status e cor

**Evidência:** confirmada.

**Onda 3 entregue parcialmente:** estágio na lista de Equipe passou de brand para `info`; ações canônicas mantêm brand para interação, e tons semânticos continuam centralizados em `StatusToneChip`. Restam usos específicos por módulo para auditar.

Revisar usos de `brand` como status em chips. Brand deve indicar seleção/ação, não estado de domínio.

Usar:

- neutro para informação;
- info para andamento;
- success para concluído/aprovado;
- warning para atenção;
- danger para falha, vencimento ou destrutivo;
- cores de pipeline somente no funil.

### B-UIA-009: ações apenas por ícone

**Evidência:** parcial.

**Onda 3 entregue parcialmente:** botões canônicos de linha possuem alvo mínimo, foco visível, `aria-label`, `title` e tooltip imediato. Na Equipe, ações raras/destrutivas foram movidas para menu textual `Mais ações`; o alvo principal agora é um botão semântico acessível por teclado.

Os componentes canônicos possuem tooltip, mas blocos específicos ainda usam botões customizados.

Auditar:

- `title` e `aria-label`;
- ícone consistente;
- alvo de 40px;
- texto visível para ações incomuns;
- menu `Mais ações` para reduzir grupos de 4+ ícones.

### B-UIA-010: validação visual automatizada

**Onda 12:** o smoke Playwright passou a cobrir as superfícies públicas em 375×812, 768×1024, 1280×720 e 1440×900, verificando renderização e overflow horizontal. Os contratos estruturais de navegação local, SEO e chrome canônico também estão cobertos em teste unitário; estados autenticados com dados continuam no smoke DTOV existente.

Criar matriz Playwright visual para:

- 375×812;
- 768×1024;
- 1280×720;
- 1440×900;
- 1920×1080.

Cenários mínimos:

- sidebar aberta/fechada;
- vazio, loading, erro e com dados;
- texto pt-BR e en;
- tabela larga;
- drawer/formulário;
- dark mode onde suportado.

## 5. Dashboard: auditoria por tela

### B-UIA-101: Visão geral

**Estado:** melhorada, mas ainda com risco de excesso abaixo da dobra.

**Validado na Onda 9:** Atenção permanece como tarefa primária, contextos secundários usam progressive disclosure e os blocos de dados utilizam `ContentEnter`, métricas semânticas e gráficos leves. Não foi criado um segundo dashboard de BI.

Pontos positivos:

- fila de atenção ganhou prioridade e contexto;
- grid assimétrico aproveita melhor a largura;
- inteligência operacional está recolhível;
- recrutamento possui progressive disclosure.

Gaps:

- muitos domínios continuam na mesma página;
- cards secundários podem voltar a competir se todos estiverem abertos;
- onboarding checklist, atenção, aniversários, inteligência comportamental, operações e recrutamento formam uma página longa;
- ausência de personalização por papel pode mostrar informação pouco relevante.

Recomendação:

- manter `Atenção` como bloco principal;
- manter no máximo um contexto lateral;
- recolher módulos secundários por padrão depois do primeiro uso;
- permitir visão `RH`, `Direção` e `Recrutamento`, sem dashboard livre tipo Metabase;
- medir cliques e scroll antes de adicionar novos cards.

### B-UIA-102: Equipe

**Prioridade:** P0.

**Onda 3 entregue parcialmente:** cards foram enxugados no viewport operacional, pipeline deixou de usar brand como status, ações administrativas raras migraram para `Mais ações` e as seções da ficha passaram a persistir na URL com fechamento que limpa o contexto. Permanecem a extração da ficha completa para workspace/rota própria e a revisão visual autenticada dos blocos internos.

Gaps confirmados:

- cards de pessoa carregam muitos chips e ações;
- o clique abre drawer de até 920px com quatro abas principais;
- a aba Pessoas contém resumo recolhível e outra subnavegação;
- dossiê, 1:1, jornada, remuneração, benefícios e DP coexistem no mesmo drawer;
- histórico e assessments aumentam a profundidade vertical;
- ação destrutiva de exclusão aparece diretamente no card da pessoa.

Proposta:

- lista compacta com nome, cargo/vínculo, 2 sinais prioritários e estado;
- filtros no topo, seleção em lote apenas quando acionada;
- preview lateral curto;
- rota `/dashboard/people/{id}` ou estado equivalente deep-linkável para ficha completa;
- cabeçalho da ficha com identidade, vínculo, gestor, alertas e ações;
- seções: Resumo, Jornada, Desenvolvimento, Estilo, Histórico, Remuneração, DP;
- mover exclusão para menu secundário com contexto de impacto;
- reservar chips para estados acionáveis, não todos os atributos.

### B-UIA-103: Remuneração

**Estado:** base consistente.

Gaps:

- listagem separada da ficha pode parecer outro cadastro;
- faixa de mercado e salário vigente precisam de comparação visual mais clara;
- falta estrutura/cargo confiável para filtros mais úteis;
- histórico em modal/drawer pode crescer.

Proposta:

- manter roster como visão gerencial;
- usar barra de posição na faixa somente quando min/max válidos;
- destacar sem cargo vinculado com CTA direto, como já iniciado;
- abrir ficha completa da pessoa para edição/histórico extenso;
- não usar vermelho para salário apenas fora da faixa sem explicar contexto.

### B-UIA-104: Compatibilidade

Gaps prováveis:

- múltiplos cards e visualizações de pares podem competir;
- cards em `auto-fit` ocupam toda a largura mesmo com pouco conteúdo;
- leitura pode ficar repetitiva em equipes grandes.

Proposta:

- filtros e explicação da métrica no topo;
- matriz/resumo como visual principal;
- lista de tensões/sinergias como resultado acionável;
- detalhe do par sob demanda;
- limitar largura de textos interpretativos.

### B-UIA-105: Comparativo T1–T9

Gaps confirmados:

- seletor de pessoas em grid rolável antes do resultado;
- tabela horizontal de comparação;
- seleção e análise dividem atenção.

Proposta:

- seletor compacto com busca e chips;
- resultado ocupa o primeiro plano após selecionar 2+ pessoas;
- fixar nomes/legenda na rolagem horizontal;
- oferecer remoção rápida e estado `Comparar` claro;
- mobile: uma dimensão por linha, sem tabela comprimida.

### B-UIA-106: Grupos

**Prioridade:** P1.

Gaps:

- muitos cards e blocos analíticos no mesmo fluxo;
- criação, seleção, análise comportamental e pulso convivem;
- pouca distinção entre grupo salvo e análise temporária;
- risco de grande rolagem.

Proposta:

- coluna/lista de grupos à esquerda;
- workspace do grupo à direita;
- abas locais: Composição, Dinâmica, Pulso, Ações;
- criação atrás de ação;
- comparar antes/depois somente quando houver série temporal.

### B-UIA-107: Liderança

Gaps:

- cards interpretativos, tabelas e blocos de recomendações podem disputar hierarquia;
- ausência de jornada clara entre diagnóstico e ação.

Proposta:

- resumo do líder/time;
- 3 riscos/oportunidades prioritários;
- ações sugeridas;
- evidências e detalhes recolhíveis;
- vínculo direto a 1:1, PDI ou grupo.

### B-UIA-108: Analytics

**Prioridade:** P1.

**Validado na Onda 9:** Métricas, Tendências e Comparação já são views exclusivas com transição canônica e filtros contextuais. Alertas continuam na Visão geral e exportação permanece ação secundária, evitando duplicar superfícies.

Gaps:

- três colunas iguais podem dar o mesmo peso a métricas de importância diferente;
- alertas, tendências, comparativos e exportação precisam de navegação local;
- risco de cards genéricos sem pergunta de negócio.

Proposta:

- subnav: Efetividade, Tendências, Comparativos, Alertas, Relatórios;
- uma pergunta principal por view;
- gráficos ocupam 2/3 quando são a evidência central;
- insight/ação ocupa 1/3;
- filtros globais persistentes;
- definições e amostra visíveis.

## 6. Recrutamento

### B-UIA-201: Vagas, lista

**Prioridade:** P0.

**Onda 2 entregue parcialmente:** cabeçalho duplicado removido, introdução e ações consolidadas no `AdminPageHeader`, mantendo uma única ação primária. Permanecem a redução do conjunto de ações por card e a revisão visual da ordenação.

Gaps observados nos prints e confirmados no componente:

- lista, criação, detalhe e configurações coexistem;
- cards já foram reduzidos, mas ações ainda podem ficar numerosas;
- ordenação por chips ocupa uma faixa própria;
- cada vaga precisa mostrar apenas informação para decidir o próximo clique.

Proposta de card:

- linha 1: título, status e quantidade de candidatos;
- linha 2: local/modalidade, prazo e posições;
- lado direito: ação principal `Abrir` e menu secundário;
- link público/copiar como ação contextual;
- editar, clonar, fechar e arquivar dentro de menu;
- indicadores de atraso e pipeline somente quando acionáveis.

### B-UIA-202: Vaga, detalhe

**Prioridade:** P0.

**Onda 2 entregue:** detalhe reorganizado em `Pipeline`, `Candidatos`, `Informações`, `Divulgação` e `Configurações`, com seção persistida na URL. Links, indicação e relatório foram reunidos em Divulgação; ações secundárias do cabeçalho passaram para `Mais ações`.

Gaps:

- informações e ações ficaram historicamente concentradas à esquerda;
- configuração de funil e pipeline aparecem na mesma longa superfície;
- ações de link, WhatsApp, editar, clonar, fechar e arquivar competem;
- cabeçalho não funciona como resumo operacional completo.

Proposta:

```text
Título + status + empresa
Resumo: posições | prazo | remuneração | modalidade | candidatos
Ação primária: adicionar candidato ou publicar
Ações secundárias: menu
Subnav: Pipeline | Candidatos | Informações | Divulgação | Configurações
```

O pipeline deve ocupar a largura total. Informações e configurações ficam fora da viewport operacional principal.

### B-UIA-203: Pipeline da vaga

**Onda 2 entregue parcialmente:** Kanban passou a ser o primeiro conteúdo de Pipeline; analytics ficou recolhível e configuração de etapas foi movida para Configurações. Permanecem validação visual do scroll, cabeçalho sticky e navegação avançada por teclado entre colunas.

Gaps:

- muitas colunas exigem scroll horizontal;
- configurar etapas acima do kanban empurra a tarefa principal para baixo;
- cards podem truncar e-mails e motivos importantes;
- barra horizontal pouco evidente em telas grandes.

Proposta:

- configuração em modal/drawer ou modo próprio;
- kanban primeiro;
- coluna com largura estável e cabeçalho sticky;
- CTA `Adicionar etapa` como última coluna;
- templates e cópia de funil em menu de configuração;
- detalhes do candidato no drawer, não todos no card;
- indicar scroll lateral e permitir navegação por teclado.

### B-UIA-204: Banco de talentos

**Estado:** tabela canônica, risco moderado.

Gaps:

- filtros de vaga, etapa e tipo podem formar linha longa;
- currículo, histórico, assessments e ações não cabem bem como colunas;
- contexto `candidato` versus `colaborador` precisa ser explícito.

Proposta:

- busca principal e 2 filtros frequentes;
- demais filtros em painel;
- coluna principal com identidade e resumo;
- ação `Abrir dossiê`;
- preservar filtros ao voltar;
- evitar mapa geográfico sem caso comercial validado.

## 7. Pessoas, desenvolvimento e cultura

### B-UIA-301: Avaliações de desempenho

**Validado na Onda 7:** a tela já separa Metas e Avaliação formal, mantém criação no cabeçalho e usa loading canônico. O workspace interno do ciclo permanece como evolução incremental.

Gaps:

- ciclos e metas podem parecer cadastros separados;
- tabela é adequada para gestão, mas não mostra progresso geral imediatamente;
- criação/edição de ciclo precisa distinguir configuração de execução.

Proposta:

- cards-resumo: rascunho, em andamento, pendências e concluídas;
- lista de ciclos abaixo;
- detalhe do ciclo em workspace com Pessoas, Competências, Progresso e Resultados;
- ações de configuração separadas da avaliação individual.

### B-UIA-302: OKRs

**Validado na Onda 7:** ciclo selecionável, progresso agregado antes das áreas, criação por ação e check-in curto no contexto do item já atendem o fluxo principal. A hierarquia permanece responsiva em blocos, sem tabela multinível.

`OkrAdminTab` delega a outro componente. Auditoria visual específica ainda é necessária.

Critérios:

- separar ciclo, objetivo e atividade;
- evitar formulário aberto antes da lista;
- mostrar progresso agregado antes dos itens;
- edição inline somente para check-in curto;
- peso 0–10 com explicação;
- mobile sem tabela de muitos níveis.

### B-UIA-303: Sucessão

**Prioridade:** P1.

**Validado na Onda 7:** resumo de cobertura precede a lista, cargos críticos são a entidade principal, criação fica no cabeçalho e sucessores são geridos no contexto do cargo.

Gaps:

- quase mil linhas indicam múltiplos fluxos na mesma tela;
- cards, cobertura e tabela podem repetir a mesma informação;
- cargo crítico e sucessor precisam de relação visual clara;
- cadastro de sucessor e análise de cobertura competem.

Proposta:

- resumo de cobertura no topo;
- lista de posições/cargos críticos;
- detalhe abre sucessores e gaps;
- criação atrás de ação;
- filtros por impacto/prontidão;
- quando B-ORG existir, migrar foco de cargo abstrato para posição crítica.

### B-UIA-304: Análise demissional

**Estado:** estrutura de listagem madura.

Gaps:

- insights e gráficos podem ficar distantes da lista de saídas;
- formulário de registro exige muitos campos e contexto;
- filtros por tipo/motivo sem período reduzem valor analítico.

Proposta:

- resumo e tendências em faixa superior compacta;
- lista como corpo principal;
- período sempre visível;
- detalhe da saída em drawer curto;
- entrevista/nota rica em ficha completa;
- CTA para ação sistêmica, não apenas gráfico.

### B-UIA-305: DP

**Prioridade:** P1.

**Entregue na Onda 6:** subnav `Pendências`, `Férias e afastamentos`, `Documentos`, `Ponto e banco de horas` e `Admissão`. Cada domínio monta apenas sua superfície; os indicadores do cabeçalho continuam atalhos para a pendência correspondente.

**Polish:** o cabeçalho voltou a ter somente ações da área ativa. Pendências virou uma fila visual com três entradas acionáveis; documentos não são mais repetidos abaixo do resumo.

Gaps:

- inbox de licenças, fila de documentos e calendário estão na mesma tela;
- collapsibles reduzem altura, mas não definem a tarefa principal;
- chips de contagem e CTA de licença competem;
- documentos e ausência são domínios diferentes.

Proposta:

- subnav `Pendências`, `Férias e afastamentos`, `Documentos`, `Calendário`, `Banco de horas`;
- pendências como entrada padrão;
- cada subview com lista e ação própria;
- indicadores servem de links/filtros;
- calendário como visual secundário, não bloco abaixo de tabela longa.

### B-UIA-306: Motivadores

**Prioridade:** P0/P1.

**Entregue:** subnav por Analytics, Convites, Resultados e Configuração; configuração restrita a admin; CTA de convite aparece somente em Convites; troca persistida em `motivatorsView`.

Gaps:

- configuração, convites, resultados e analytics em um componente muito extenso;
- variação entre tabelas e cards;
- admin e gestor compartilham contexto com capacidades diferentes;
- múltiplos grids analíticos podem diluir a leitura.

Proposta:

- subnav: Convites, Resultados, Analytics, Configuração;
- configuração apenas para admin;
- uma lista canônica de convites;
- resultado individual abre dossiê;
- analytics com pergunta principal e amostra;
- botão criar convite somente no cabeçalho da subview apropriada.

### B-UIA-307: Clima

**Prioridade:** P0/P1.

**Entrega parcial (Onda 5):** lista continua como entrada e o detalhe separa Resultados, Distribuição e Questionário. Convites e disparos aparecem no contexto de Distribuição; edição de perguntas, no Questionário; médias e textos, em Resultados.

**Polish:** ações passaram a acompanhar a seção ativa e a seção de campanha agora persiste em `climateSection`, preservando contexto em atualização e histórico do navegador.

Gaps:

- campanhas, criação, distribuição, respostas e leitura analítica no mesmo componente;
- sidebar interna + conteúdo pode deixar áreas vazias dependendo da seleção;
- métricas precisam de mínimo de amostra e hierarquia;
- ações de campanha e leitura de resultados competem.

Proposta:

- lista de pesquisas como entrada;
- detalhe da campanha com subnav: Visão geral, Perguntas, Distribuição, Resultados;
- campanha aberta destaca respostas e prazo;
- campanha encerrada destaca análise;
- gráficos ocupam largura proporcional;
- texto aberto separado e protegido;
- esconder médias quando N insuficiente.

### B-UIA-308: Ouvidoria

Gaps:

- configuração de canal, analytics e inbox convivem;
- privacidade exige sinalização mais forte do que em módulos comuns;
- detalhes do relato não devem aparecer em cards analíticos.

Proposta:

- entrada sempre pela inbox;
- badges de prazo/status;
- configuração em subview restrita;
- analytics apenas agregado;
- painel de caso com histórico, responsáveis e resposta;
- aviso permanente de confidencialidade e auditoria.

## 8. Catálogos e comunicação

### B-UIA-401: Cargos

**Estado:** listagem consistente; formulário ainda pode crescer.

Gaps:

- descrição, faixa, rubrica e trilha LMS já tornam o drawer denso;
- expansão prevista pelo backlog organizacional tornará o drawer insuficiente;
- rubrica não deve dominar o cadastro do cargo.

Proposta:

- manter listagem canônica;
- preview na linha;
- página/workspace de cargo para futuras seções;
- drawer somente para criação mínima;
- trilha, competências e histórico em seções próprias.

### B-UIA-402: Academy/recursos de aprendizagem

Gaps:

- tabela é funcional, mas conteúdo de aprendizagem é naturalmente visual;
- URL, tema, duração e tipo competem como colunas;
- diferença entre Academy e LMS pode não estar clara.

Proposta:

- explicar `Academy = catálogo de recursos para PDI`;
- cards compactos ou tabela híbrida com título/tema como coluna principal;
- filtros por tipo e tema;
- preview sem sair da lista;
- CTA para converter/vincular ao LMS somente se fizer sentido.

### B-UIA-403: Benefícios

Gaps:

- catálogo e atribuição individual estão em superfícies diferentes;
- categorias livres podem gerar inconsistência visual;
- tabela simples não comunica valor ao colaborador.

Proposta:

- admin: tabela canônica;
- colaborador: cards por categoria;
- atribuição na ficha da pessoa;
- estado `oferecido`, `elegível`, `atribuído` claramente distinto;
- não criar adesão/folha implicitamente.

### B-UIA-404: Mural e reconhecimento

Gaps:

- admin usa tabelas para posts e kudos;
- conteúdo editorial precisa de preview;
- kudos recolhido abaixo dos posts pode ficar invisível.

Proposta:

- subnav `Publicações` e `Reconhecimentos`;
- preview do post no drawer;
- status/agendamento no topo;
- moderação de kudos como inbox, não tabela escondida;
- colaborador mantém feed cronológico.

### B-UIA-405: LMS admin

**Prioridade:** P0.

**Entrega parcial (Onda 4):** detalhe do curso organizado em `Conteúdo`, `Matrículas` e `Acompanhamento`, com estado persistido na URL e retorno ao catálogo. O cadastro único de aula mantém descrição e escolha entre vídeo/link ou PDF. Turmas, avaliação, certificado, preview e drag-and-drop continuam como evolução incremental.

Gaps:

- catálogo e detalhe já alternam dentro do mesmo componente;
- detalhe contém aulas, matrículas, coortes, quiz/certificado e configurações;
- vários collapsibles não substituem arquitetura local;
- formulários e tabelas no mesmo viewport aumentam carga.

Proposta:

- lista de cursos como tela inicial;
- curso em rota/workspace;
- cabeçalho com título, status, progresso e ações;
- subnav: Conteúdo, Pessoas, Turmas, Avaliação, Certificado, Configurações;
- aula em drawer/modal curto;
- reordenação de aulas no contexto Conteúdo;
- matrículas sempre paginadas;
- preview como colaborador.

## 9. Administração da plataforma

### B-UIA-501: Usuários

**Estado:** padrão canônico adequado.

Gaps:

- capabilities/módulos podem tornar edição extensa;
- diferença entre papel, módulo da empresa e override do usuário precisa ser explicada;
- super admin e tenant admin exigem contextos distintos.

Proposta:

- lista permanece;
- edição em seções: Identidade, Papel, Módulos, Segurança;
- mostrar origem da permissão: papel, empresa ou override;
- confirmação clara ao remover acesso;
- não listar módulos indisponíveis para a empresa como simples checkbox desabilitado sem explicação.

### B-UIA-502: Empresas

**Prioridade:** P1.

Gaps:

- listagem, dados, branding e módulos podem coexistir em drawer longo;
- super admin precisa comparar empresas, mas configuração é um objeto rico;
- ações administrativas sensíveis podem ficar próximas de edição comum.

Proposta:

- lista canônica;
- rota de detalhe da empresa;
- subnav: Geral, Marca, Módulos, Usuários, Integrações, Auditoria;
- ações destrutivas em área separada;
- resumo de uso/módulos sem carregar dados de todas as abas.

### B-UIA-503: Leads

**Estado:** tabela simples adequada.

Gaps:

- status e próxima ação precisam ser mais visíveis;
- dados do signup e atividade podem ocupar colunas demais.

Proposta:

- coluna principal com empresa/contato;
- status, origem, data e próxima ação;
- detalhe sob demanda;
- filtros na URL.

### B-UIA-504: Feedback de produto

Gaps:

- inbox precisa priorizar triagem, não exibir tudo igualmente;
- texto longo em tabela prejudica comparação;
- status e responsável precisam dominar.

Proposta:

- preview truncado;
- detalhe lateral;
- filtros por tipo/status;
- ação rápida de classificar;
- link para contexto/origem quando seguro.

### B-UIA-505: Auditoria

Gaps:

- JSON em `pre` com scroll é útil tecnicamente, mas pouco legível;
- tabela larga exige hierarquia;
- filtros de ator, ação, entidade e período são essenciais.

Proposta:

- linha principal: ação, objeto, ator e data;
- detalhe expandido com diff antes/depois;
- JSON bruto como opção secundária;
- busca/filtros persistentes;
- exportação controlada.

### B-UIA-506: Ajuda

Gaps:

- guia pode crescer junto com módulos;
- navegação linear não escala;
- assistente flutuante e página de ajuda podem duplicar conteúdo.

Proposta:

- busca no topo;
- categorias por tarefa;
- artigos curtos com deep link para o módulo;
- mesma fonte para guia e assistente;
- contextualizar artigo conforme aba de origem.

### B-UIA-507: Perfil e módulos

**Entregue na Onda 8:** Perfil separado em Conta, Módulos e Segurança. A aba Módulos só aparece quando a API autoriza a gestão do tenant; remoções continuam exigindo confirmação e o super admin mantém controle pelas telas administrativas.

Gaps a validar visualmente:

- seleção de módulos, idioma, segurança e perfil podem competir;
- regras de super admin versus gestor precisam aparecer em linguagem simples.

Proposta:

- Perfil;
- Segurança;
- Preferências;
- Módulos da empresa;
- resumo do impacto no menu antes de salvar;
- mudanças de módulo auditadas.

## 10. Experiência do colaborador

### B-UIA-601: hub `/employee`

**Prioridade:** P0/P1.

**Validado na Onda 10:** sidebar já está agrupada por Hoje, Desenvolvimento e Conta; LMS, DP e Ponto possuem rotas dedicadas; o hub possui bloco inicial de tarefas urgentes e badges. Permanecem limites de três itens por seção e validação visual mobile como evolução.

Gaps confirmados:

- conteúdo limitado a `max-w-4xl` e organizado majoritariamente em uma coluna;
- chegada, PDI, OKR, LMS, feedback, acordos, mural, benefícios e tarefas geram rolagem longa;
- muitos `CollapsibleBlock` reduzem visualmente, mas não priorizam trabalho;
- o colaborador precisa procurar o que fazer.

Proposta:

- bloco inicial `Para você fazer` com prazos;
- faixa de atalhos: Ponto, Cursos, PDI, Perfil;
- duas colunas em desktop: tarefas principais + empresa/comunicação;
- seções históricas em páginas próprias;
- mostrar apenas 3 itens por seção e CTA `Ver todos`;
- personalizar por pendência, não pela disponibilidade de todos os módulos.

### B-UIA-602: LMS do colaborador

**Estado:** arquitetura de curso relativamente boa.

Gaps:

- player + sidebar fixa de 280px precisa validação em tablet;
- lista de aulas com até 70vh pode competir com quiz e descrição;
- controles de vídeo, progresso e próxima aula precisam de ordem consistente;
- catálogo e curso usam o mesmo componente.

Proposta:

- catálogo separado do curso;
- em desktop: conteúdo + trilha lateral;
- em mobile: trilha em drawer/bottom sheet;
- título e progresso sticky no contexto do curso;
- próxima ação após aula claramente indicada;
- descrição e anexos abaixo do player.

### B-UIA-603: perfil do colaborador

**Estado:** largura e progressive disclosure adequados.

Gaps:

- perfil, senha, 2FA e privacidade na mesma página podem parecer configuração técnica;
- formulário usa linhas flexíveis para cidade/estado, validar mobile;
- feedback de salvamento precisa ser localizado por seção.

Proposta:

- Dados pessoais;
- Acesso e segurança;
- Privacidade;
- cada seção salva independentemente;
- exibir campos não editáveis com motivo/origem.

### B-UIA-604: ponto e DP do colaborador

Auditoria visual específica ainda necessária porque os clients delegam para blocos compartilhados.

Critérios:

- ação `Registrar ponto` sempre primária;
- saldo e último registro visíveis antes do histórico;
- erros de localização/rede acionáveis;
- DP separado em Documentos, Férias/Afastamentos e Banco de horas;
- mobile como caso principal.

### B-UIA-605: portal mínimo `/e/{token}`

Gaps:

- PDI, acordos, cursos, preparação e combinados aparecem sequencialmente;
- ausência de navegação local pode gerar rolagem;
- é uma superfície legada em relação ao `/employee`.

Proposta:

- manter simples e sem novo escopo;
- resumo inicial com âncoras;
- priorizar pendências;
- CTA de convite/login quando o colaborador tiver conta;
- evitar replicar todas as features do hub autenticado.

## 11. Fluxos públicos

**Validado na Onda 11:** os fluxos por token permanecem focados e sem chrome do dashboard. Landpage, índice/detalhe de vagas e empresa pública mantêm metadata, canonical, regras de indexação, JSON-LD, sitemap, robots e `llms.txt`; a matriz responsiva da Onda 12 cobre home, vagas e login.

### B-UIA-701: assessment T1–T9

**Estado:** foco e largura adequados.

Gaps:

- textos introdutórios e consentimento precisam revisão contínua de legibilidade;
- opções devem permanecer confortáveis em telas estreitas;
- progresso precisa representar etapas reais;
- prevenção de perda de resposta deve ser clara.

Não adicionar navegação lateral, cards extras ou conteúdo promocional durante o teste.

### B-UIA-702: Motivadores público

**Estado:** foco adequado.

Gaps:

- grupos de opções e escala precisam de distinção visual;
- validar teclado, leitor de tela e telas menores;
- resultado não deve expor pesos internos.

### B-UIA-703: clima e pulso

Gaps:

- telas públicas precisam reforçar anonimato ou identificação antes da resposta;
- escala e texto aberto precisam explicar obrigatoriedade;
- sucesso deve orientar fechamento seguro.

Proposta:

- cabeçalho com empresa/pesquisa;
- aviso de privacidade curto;
- uma pergunta por bloco;
- progresso quando houver múltiplas perguntas;
- sem elementos do dashboard.

### B-UIA-704: feedback, avaliação lateral e avaliação formal

Gaps:

- três superfícies de avaliação podem divergir visualmente;
- escalas, comentários e envio precisam do mesmo padrão;
- falta de contexto sobre quem verá a resposta gera insegurança.

Proposta:

- shell público compartilhado;
- introdução padronizada;
- destinatário/finalidade claros;
- mesma escala e semântica quando o domínio for o mesmo;
- confirmação antes de envio irreversível;
- tela de sucesso consistente.

### B-UIA-705: ouvidoria pública

Gaps:

- anonimato e acompanhamento exigem confiança especial;
- categoria e relato não devem parecer formulário genérico;
- anexos e protocolo futuro precisam cuidado.

Proposta:

- explicar anonimato antes do formulário;
- indicar o que não deve ser enviado;
- protocolo de acompanhamento quando suportado;
- não carregar analytics ou branding excessivo;
- acessibilidade e privacidade como P0.

### B-UIA-706: preparação de entrevista

Gaps:

- texto longo pode exigir hierarquia melhor;
- ações e próximos passos precisam ser explícitos;
- evitar linguagem determinista de perfil.

## 12. Vagas públicas, marketing e acesso

### B-UIA-801: lista pública de vagas

Gaps a validar:

- consistência entre `/jobs`, remoto, cidade e empresa;
- filtros e paginação;
- card precisa equilibrar SEO e escaneabilidade;
- empty state por filtro/localidade.

Critérios:

- título, empresa, local/modalidade, faixa quando pública e data;
- CTA claro;
- navegação e canonical corretos;
- nenhuma informação interna de pipeline.

### B-UIA-802: detalhe público da vaga

Gaps:

- descrição rica pode ficar extensa;
- CTA de candidatura/assessment precisa permanecer visível;
- metadados devem ser escaneáveis;
- mobile e impressão/compartilhamento.

Proposta:

- coluna principal de conteúdo;
- resumo lateral/sticky apenas em desktop;
- CTA após resumo e no final;
- headings semânticos;
- benefícios/requisitos somente se houver dado real.

### B-UIA-803: landpage

**Estado:** estrutura responsiva e SEO já trabalhados.

Gaps:

- muitas seções consecutivas podem alongar excessivamente a narrativa;
- múltiplos cards de duas/três colunas repetem ritmo;
- três CTAs no cabeçalho podem competir;
- uso de gradiente em CTAs precisa permanecer exceção de marca, não padrão interno.

Proposta:

- medir conversão e scroll;
- reduzir seções que repetem mensagem;
- demonstração real do fluxo candidato→pessoa→ação;
- CTA primário único no header;
- manter inventário funcional fiel ao produto.

### B-UIA-804: preços

Gaps a validar:

- quantidade de planos versus modelo modular;
- diferenciação entre plano e módulo;
- CTA e FAQ;
- responsividade dos cards.

### B-UIA-805: login do gestor

**Estado:** largura e foco adequados.

Gaps:

- componente longo sugere múltiplos estados no mesmo arquivo;
- login, recuperação, 2FA e mensagens podem alterar muito a altura;
- links secundários podem competir.

Proposta:

- uma tarefa por estado;
- mensagens de erro junto ao campo/contexto;
- CTA principal único;
- lembrar empresa/usuário somente quando seguro;
- consistência com login do colaborador.

### B-UIA-806: login e entrada do colaborador

Gaps:

- login, magic link, set-password e entrada por token possuem experiências separadas;
- linguagem precisa distinguir gestor de colaborador;
- transições entre convite e login precisam evitar loop.

Proposta:

- shell visual compartilhado;
- título explícito `Acesso do colaborador`;
- explicar qual e-mail usar;
- estados de convite expirado e conta existente com próximo passo.

### B-UIA-807: signup/onboarding

Gaps:

- formulário central é adequado, mas seleção de módulos pode ficar extensa;
- onboarding precisa mostrar progresso e permitir retorno;
- escolha de módulo deve explicar impacto no menu e poder ser alterada depois.

Proposta:

- etapas curtas: conta, empresa, módulos, concluir;
- recomendação inicial sem marcar tudo automaticamente;
- preview dos módulos;
- confirmação de que podem ser alterados no perfil;
- não misturar configuração avançada.

## 13. Sequência recomendada

### Onda 1: estrutura e telas críticas

1. B-UIA-001 navegação.
2. B-UIA-004 workspace composto.
3. B-UIA-005 drawers extensos.
4. B-UIA-102 Equipe.
5. B-UIA-201/202/203 Vagas e pipeline.
6. B-UIA-405 LMS admin.

### Onda 2: módulos densos

1. B-UIA-306 Motivadores.
2. B-UIA-307 Clima.
3. B-UIA-303 Sucessão.
4. B-UIA-305 DP.
5. B-UIA-601 hub do colaborador.
6. B-UIA-502 Empresas.

### Onda 3: consistência transversal

1. B-UIA-002 cabeçalhos.
2. B-UIA-003 ritmo e cards.
3. B-UIA-006 tabelas responsivas.
4. B-UIA-007 filtros/URL.
5. B-UIA-008 status/cores.
6. B-UIA-009 ações por ícone.

### Onda 4: superfícies públicas e validação

1. B-UIA-701 a 706.
2. B-UIA-801 a 807.
3. B-UIA-010 matriz visual automatizada.

## 14. Critérios de aceite por tela

Antes de fechar qualquer item:

- ação principal reconhecível em até poucos segundos;
- nenhum formulário de criação permanente antes da lista;
- conteúdo usa a largura de acordo com sua natureza;
- sem metade vazia sem intenção;
- sem grupo de 4+ ações competindo;
- loading, erro, vazio, sucesso e permissão cobertos;
- transição canônica reutilizada;
- pt-BR e en revisados;
- teclado e foco visíveis;
- 375px, 768px, 1280px e 1440px validados;
- filtros e retorno do detalhe preservam contexto;
- nenhuma nova query carrega dados de abas não abertas;
- screenshots antes/depois anexados à validação do item.

## 15. Limites do audit

Este backlog identifica gaps e direção. Antes de implementar cada onda:

1. abrir a aplicação com seed representativa;
2. capturar desktop/tablet/mobile;
3. validar com papel `admin`, `direction`, `hr` e colaborador;
4. confirmar frequência da tarefa com usuário de RH;
5. escolher a menor mudança que resolve a hierarquia;
6. evitar refatorar todos os módulos ao mesmo tempo.

O objetivo não é uniformizar todas as telas até perder a identidade do domínio. É tornar a navegação previsível, dar hierarquia às decisões e usar melhor o espaço sem aumentar a quantidade de componentes visíveis.
