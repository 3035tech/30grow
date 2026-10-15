# Backlog de evolução: benchmark Sólides/RHGestor

Análise crítica do Sólides/RHGestor em comparação com o 30Grow, preparada a partir dos prints disponíveis em `/Users/thomasmetz/Documents/Solides` em setembro de 2026.

Foram encontrados 62 arquivos PNG, com aproximadamente 45 telas únicas após desconsiderar duplicações. Os prints cobrem principalmente dashboard do colaborador, People Analytics, cargos e carreira, cadastro de colaboradores, SESMT, férias, LMS, perfis e provas, documentos, recrutamento, admissão, desligamento, aprovações, avaliação, PDI, metas, relatórios e configurações.

Este documento é backlog de produto e referência para desenho futuro. Não é especificação aprovada para implementação integral e não propõe copiar a arquitetura, a navegação ou todos os módulos do concorrente.

## 1. Decisão de produto

O 30Grow não deve buscar paridade ampla com a Sólides. A Sólides é mais completa como sistema administrativo de RH, mas apresenta navegação profunda, muitas telas operacionais, relatórios fragmentados e sobreposição entre cargo, pessoa e lotação.

O posicionamento recomendado para o 30Grow é:

> Plataforma de inteligência e operação de pessoas que acompanha a jornada da vaga ao desenvolvimento, sustentada por uma estrutura organizacional confiável.

Prioridade estratégica:

1. Fortalecer a estrutura organizacional e os dados mestres.
2. Conectar os módulos já existentes.
3. Transformar dados em decisões e tarefas de RH.
4. Evitar criar módulos regulatórios ou administrativos sem demanda comercial validada.

## 2. Resumo comparativo

| Dimensão | Sólides/RHGestor | 30Grow | Decisão |
|---|---|---|---|
| Estrutura organizacional | Grupo, empresa, filial, área, departamento, setor, cargo e superior | Área simples, cargo leve e gestor direto na pessoa | Investir como fundação |
| Engenharia de cargos | Cadastro extenso, requisitos e carreira | Nome, descrição, rubrica T1–T9, faixa e trilha LMS | Evoluir sem copiar excesso de abas |
| Headcount | Lotação, simulação e relatórios | Vagas têm quantidade, sem posição estrutural | Criar posição e planejamento |
| Cadastro de pessoa | Muito amplo e fragmentado | `candidates` como hub único | Manter hub e ampliar por seções |
| Recrutamento | Banco, execução, aprovações, funil, admissão | Funil configurável, templates, scorecard, entrevistas, oferta e hire | Polir, não recriar |
| Assessment | Perfil e provas | T1–T9, Motivadores e compatibilidade | Preservar diferencial |
| Desempenho/PDI | Avaliações, feedback, PDI, 9Box | Ciclos, 90/180/360, PDI, Nine Box, calibração, 1:1 | Conectar a cargo e competências |
| LMS | Cursos, aulas, progresso e certificados | Cursos, vídeo/PDF, matrícula, prazo, quiz, progresso e certificado | Polir e ligar a requisitos |
| DP/documentos | Forte e abrangente | DP leve, documentos, férias, afastamentos, ponto e banco de horas | Evoluir por demanda |
| SESMT | ASO, exames, CIPA, EPI e vacinação | Não existe | Integrar no futuro; não construir agora |
| Analytics | Muitos relatórios separados | Analytics acionável e relatórios agendados | Preferir exploração a catálogo de PDFs |
| IA | Botões distribuídos em várias telas | Assistente contextual, interpretação e sugestões | IA por tarefa, com fonte e ação |

## 3. Lacuna estrutural prioritária

O 30Grow ainda não separa adequadamente:

- empresa e estabelecimento;
- unidade organizacional;
- cargo;
- posição de headcount;
- pessoa;
- vínculo da pessoa com a estrutura;
- linha de reporte;
- centro de custo;
- histórico de movimentação.

Situação atual relevante:

- `areas` é um catálogo global simples de chave e nome;
- `job_roles` guarda nome, descrição, rubrica T1–T9, faixa de mercado e status;
- `candidates.job_role_id` liga diretamente pessoa e cargo;
- `candidates.manager_candidate_id` liga diretamente pessoa e gestor;
- o organograma atual é uma árvore de pessoas, read-only, com cap de 200 registros;
- não há entidade canônica para filial, unidade, posição ou lotação com vigência.

Referências atuais:

- `lib/job-roles.js`
- `lib/people/org-chart.js`
- `migrations/055_job_roles.sql`
- `migrations/084_market_salary_bands.sql`
- `migrations/090_b3005_3006_3010.sql`

Sem resolver essa fundação, filtros de departamento/setor, headcount, organograma, carreira, sucessão e análises históricas tenderiam a duplicar campos e regras.

## 4. Modelo organizacional recomendado

### 4.1 Hierarquia conceitual

```text
Grupo econômico opcional
└── Empresa / pessoa jurídica
    └── Filial / estabelecimento
        └── Unidade organizacional
            ├── Diretoria
            ├── Área
            ├── Departamento
            ├── Setor
            ├── Time
            └── Núcleo
                └── Posição
                    └── Vínculo da pessoa
```

Uma empresa pode não usar todos os níveis. A unidade deve ser hierárquica e tipada, evitando tabelas rígidas separadas para área, departamento e setor.

### 4.2 Distinções obrigatórias

| Conceito | Definição | Exemplo |
|---|---|---|
| Cargo | Modelo de trabalho reutilizável | Analista de RH Pleno |
| Posição | Assento de headcount dentro da estrutura | Posição 002 no RH de Recife |
| Pessoa | Identidade estável no hub `candidates` | Ana Souza |
| Vínculo | Ocupação da posição por uma pessoa em um período | Ana ocupa a posição 002 desde 01/03 |
| Vaga | Processo para preencher uma posição ou necessidade | Processo seletivo para a posição 002 |

Um cargo pode ter várias posições. Uma posição pode existir sem ocupante. O ocupante pode mudar sem apagar a posição.

### 4.3 Entidade de unidade organizacional

Campos propostos:

| Campo | Regra |
|---|---|
| `id` | PK |
| `company_id` | Tenant obrigatório |
| `parent_id` | Unidade superior da mesma empresa |
| `type` | `directorate`, `area`, `department`, `sector`, `team` ou `nucleus` |
| `name` | Nome exibido |
| `code` | Código interno opcional |
| `description` | Texto rico sanitizado opcional |
| `legal_entity_id` | Pessoa jurídica opcional |
| `branch_id` | Estabelecimento opcional |
| `cost_center_id` | Centro de custo principal opcional |
| `manager_position_id` | Posição responsável pela unidade |
| `active` | Soft delete funcional |
| `effective_from` | Início de vigência |
| `effective_to` | Fim de vigência opcional |
| `sort_order` | Ordenação entre irmãos |
| `external_id` | Identificador de integração opcional |
| `created_at`, `updated_at` | Auditoria |

Regras:

- pai e filho sempre da mesma empresa;
- impedir autorreferência e ciclos;
- nome único por pai quando fizer sentido;
- não remover unidade com posições ou vínculos ativos;
- mover unidade deve gerar evento de histórico e auditoria;
- toda listagem e árvore deve ter cap, paginação ou carregamento por ramo.

### 4.4 Empresa jurídica e filial

Não sobrecarregar `companies` para representar todos os níveis. A empresa do 30Grow continua sendo o tenant. Dentro dela podem existir:

#### Pessoa jurídica

- razão social;
- nome fantasia;
- CNPJ mascarado/validado;
- código externo;
- ativa;
- endereço principal;
- vigência.

#### Filial ou estabelecimento

- pessoa jurídica;
- nome;
- código;
- CNPJ próprio quando aplicável;
- cidade/estado;
- endereço;
- timezone;
- ativa;
- vigência.

Grupo econômico só deve ser adicionado quando houver caso real de consolidação. Não deve permitir acesso cruzado automático entre tenants.

### 4.5 Cargo

Campos recomendados por seção:

#### Identificação

- título;
- código interno;
- código de importação;
- CBO;
- família de cargos;
- trilha de carreira;
- senioridade;
- classe ou grade;
- status;
- propósito do cargo;
- descrição.

#### Responsabilidades

- missão;
- responsabilidades principais;
- entregas esperadas;
- autonomia;
- escopo de decisão;
- interfaces internas;
- interfaces externas.

#### Requisitos

- escolaridade mínima e desejável;
- área de formação;
- experiência mínima;
- idiomas e nível;
- conhecimentos técnicos;
- ferramentas;
- cursos e certificações;
- requisitos legais;
- treinamentos obrigatórios.

#### Competências

- competência;
- categoria: comportamental, técnica ou valor;
- proficiência esperada;
- indispensável ou desejável;
- peso;
- evidência esperada;
- explicação;
- vínculo opcional com dimensões T1–T9 e Motivadores.

T1–T9 e Motivadores não substituem competências técnicas. São camadas complementares para interpretação do estilo de trabalho.

#### Remuneração

- grade/faixa;
- mínimo;
- referência;
- máximo;
- moeda;
- periodicidade;
- data-base;
- vigência;
- elegibilidade a variável;
- benefícios típicos.

### 4.6 Posição

Campos propostos:

- código da posição;
- `company_id`;
- cargo;
- unidade organizacional;
- posição gestora;
- centro de custo;
- filial/local;
- modalidade de trabalho;
- tipo de vínculo esperado;
- jornada/escala;
- FTE;
- status: planejada, aberta, ocupada, congelada ou encerrada;
- orçamento aprovado;
- faixa salarial específica opcional;
- criticidade;
- elegibilidade para sucessão;
- início/fim de vigência;
- motivo de abertura;
- aprovador;
- vaga vinculada opcional.

### 4.7 Vínculo organizacional da pessoa

Campos propostos:

- `candidate_id`;
- `position_id`;
- cargo efetivo;
- unidade organizacional;
- gestor funcional;
- gestor matricial opcional;
- centro de custo;
- filial/local;
- regime;
- matrícula;
- data de admissão;
- início/fim do vínculo;
- principal/secundário;
- motivo da movimentação;
- origem da alteração;
- usuário responsável;
- notas restritas de RH.

Vínculos encerrados permanecem para histórico. Não fazer merge de pessoas por nome; a identidade continua no hub `candidates`.

### 4.8 Eventos de movimentação

Tipos iniciais:

- admissão;
- promoção;
- mudança de cargo;
- transferência de unidade;
- mudança de filial;
- mudança de gestor;
- alteração de centro de custo;
- afastamento;
- retorno;
- desligamento;
- correção administrativa.

Campos:

- pessoa/vínculo;
- tipo;
- data efetiva;
- situação anterior e nova em JSON controlado;
- motivo;
- solicitante;
- aprovador;
- status;
- timestamps.

## 5. Telas futuras

### 5.1 Módulo Organização

Navegação interna:

- Estrutura;
- Organograma;
- Posições;
- Headcount;
- Movimentações;
- Configurações.

Cabeçalho:

- seletor de empresa para super admin;
- data de referência;
- busca por pessoa, posição ou unidade;
- ação principal `Adicionar` com opções contextuais.

### 5.2 Estrutura

Layout recomendado:

```text
┌──────────────────────┬───────────────────────────────────────┐
│ Árvore organizacional│ Unidade selecionada                   │
│                      │                                       │
│ Empresa              │ RH Corporativo                        │
│ ├ Diretoria          │ Responsável: Mariana                  │
│ │ ├ RH               │ 18 pessoas · 20 posições · 2 abertas  │
│ │ └ Financeiro       │                                       │
│ └ Operações          │ Subunidades                           │
│                      │ Posições e ocupantes                  │
│                      │ Indicadores e ações                   │
└──────────────────────┴───────────────────────────────────────┘
```

Drag-and-drop pode ordenar unidades. Mover uma unidade de pai é ação sensível: mostrar impacto, pedir confirmação e auditar.

### 5.3 Organograma

Modos:

- pessoas;
- posições;
- unidades;
- apenas liderança;
- posições abertas;
- visão em uma data histórica.

Filtros:

- empresa jurídica/filial;
- unidade;
- cargo;
- gestor;
- status da posição;
- regime;
- local;
- centro de custo.

Interações:

- abrir ficha da pessoa;
- abrir posição;
- mostrar linha hierárquica;
- recolher/expandir ramos;
- exportar somente a visão filtrada;
- carregar por ramo, sem enviar a empresa inteira ao cliente.

### 5.4 Headcount

Indicadores:

- headcount aprovado;
- realizado;
- posições abertas;
- posições congeladas;
- ocupação percentual;
- admissões;
- saídas;
- movimentações;
- custo mensal estimado;
- variação contra orçamento.

Visualizações:

- resumo por unidade;
- tendência temporal;
- posições aprovadas versus ocupadas;
- vagas por tempo em aberto;
- divergências que exigem ação.

### 5.5 Ficha da pessoa

Adicionar seção `Vínculo e organização` com:

- cargo e posição;
- caminho organizacional;
- gestor funcional e matricial;
- filial/local;
- centro de custo;
- regime e jornada;
- datas;
- histórico de movimentações;
- atalhos para organograma, remuneração e posição.

### 5.6 Engenharia de cargos

Não copiar as mais de 12 abas observadas na Sólides. Usar página/drawer com seções recolhíveis:

1. Identificação e propósito.
2. Responsabilidades.
3. Requisitos.
4. Competências.
5. Perfil de trabalho T1–T9 e Motivadores.
6. Remuneração.
7. Trilha LMS.
8. Posições e pessoas vinculadas.
9. Histórico de revisões.

## 6. Itens de backlog

**Corte entregue em 15/10/2026 (migration 159):** unidades tipadas sobre o cadastro existente; posições por unidade/cargo com código, FTE, vigência, aprovação e ciclo de vida; ocupação primária e transferências com histórico; indicadores de aprovadas/ocupadas/disponíveis/congeladas e pessoas sem posição; vínculo a vaga e contratação transacional nos dois pipelines; liberação no desligamento. Interface em Organização → Estrutura e organograma / Posições e headcount. A preservação do legado e a validação estão em `docs/VALIDACAO-HEADCOUNT.md`.

| Item | Entregue neste corte | Evolução ainda aberta |
|---|---|---|
| B-ORG-001 | Hierarquia existente, tipo fixo, proteção de unidades com posições e auditoria | Código/descrição, vigência da unidade, ordenação e dimensões jurídicas |
| B-ORG-005 | Posição própria, código único, cargo/unidade, FTE, vigência, aprovação, congelamento e encerramento | Orçamento, centro de custo, filial/local, posição gestora e criticidade |
| B-ORG-006 | Uma ocupação primária atual, histórico, motivo, autor, transferência, cargo/unidade sincronizados e saída | Vínculos secundários, gestor matricial e demais dimensões funcionais |
| B-ORG-007 | Subvisões de estrutura/organograma e headcount no módulo existente | Workspace amplo de movimentações e configurações avançadas |
| B-ORG-009 | Headcount e FTE aprovados versus ocupados, disponíveis, congelados e não alocados, por unidade/cargo | Orçamento e visões históricas por data/período |
| B-ORG-010 | Vincular posições a vaga do mesmo cargo; contratação atômica, idempotência e capacidade | Criar a vaga diretamente de uma posição e seleção explícita de assento em processos com múltiplas posições |

Os textos abaixo preservam a visão de evolução completa; considerar a coluna de pendências para não reabrir o núcleo já entregue. O organograma por posição (B-ORG-008), competências e demais itens continuam abertos.


### B-ORG-001: modelo canônico de unidades organizacionais

Criar unidades hierárquicas, tipadas, com vigência, tenant, validação de ciclos, soft delete e auditoria.

Critérios mínimos:

- nenhuma leitura cross-tenant;
- árvore carregada por ramo ou com cap explícito;
- índices por `company_id`, `parent_id`, `active` e vigência;
- impedir exclusão com dependências ativas;
- API fina via `withAdminApi` e lógica em `lib/`.

### B-ORG-002: empresas jurídicas, filiais, locais e centros de custo

Criar dimensões organizacionais reutilizáveis sem transformar cada uma em novo módulo de navegação.

Dependência: B-ORG-001.

### B-ORG-003: ampliar engenharia de cargos

Adicionar CBO, família, carreira, senioridade, grade, responsabilidades, requisitos e histórico de revisão ao cargo existente.

Preservar:

- rubrica T1–T9;
- faixa salarial;
- vínculo com vagas;
- trilha LMS;
- soft delete por `active`.

### B-ORG-004: catálogo e escala de competências

Criar competências reutilizáveis e requisitos por cargo.

Entidades esperadas:

- competência;
- categoria;
- escala de proficiência;
- requisito do cargo;
- evidência/avaliação da pessoa.

Evitar gravar nomes e níveis livres repetidos em cada cargo.

### B-ORG-005: posições de headcount

Criar posição como entidade separada de cargo e pessoa, com status, FTE, unidade, gestor, orçamento, vigência e criticidade.

Dependências: B-ORG-001 e B-ORG-003.

### B-ORG-006: vínculos e histórico funcional

Criar ocupações/vínculos com vigência e eventos de movimentação. Migrar dados atuais sem remover imediatamente `job_role_id` e `manager_candidate_id`.

Dependência: B-ORG-005.

### B-ORG-007: módulo Organização

Criar estrutura, organograma, posições, headcount, movimentações e configurações como subvisões de uma única tarefa de gestão.

Não criar seis itens principais novos no menu lateral.

### B-ORG-008: organograma por pessoa, posição e unidade

Substituir gradualmente a árvore baseada somente em `manager_candidate_id`.

Critérios:

- posições vagas visíveis;
- visão por data;
- filtros compartilhados;
- carregamento progressivo;
- sem drag-and-drop de pessoa sem fluxo de movimentação e auditoria.

### B-ORG-009: headcount aprovado versus realizado

Adicionar planejamento, ocupação, vagas, congelamentos e variação por unidade/posição.

Não confundir `vacancies.positions_count` com headcount estrutural aprovado.

### B-ORG-010: vaga vinculada a posição

Permitir abrir processo seletivo a partir de uma ou mais posições. O hire deve preencher posição e criar vínculo de maneira transacional e idempotente.

### B-ORG-011: sucessão por posição crítica

Migrar gradualmente o conceito de papel crítico para posição/cargo crítico, preservando os planos existentes.

### B-ORG-012: matriz cargo versus pessoa

Exibir esperado, observado, gap, evidência e ação de desenvolvimento.

Integrações:

- avaliação formal;
- PDI;
- LMS/Academy;
- sucessão;
- remuneração.

Não calcular aderência técnica a partir do T1–T9.

### B-ORG-013: filtros organizacionais compartilhados

Criar filtros canônicos para filial, unidade, cargo, gestor, regime, local e período, reutilizados em Pessoas, Analytics, Remuneração, Desempenho e DP.

Dependência: modelo organizacional estabilizado. Não criar filtros sobre campos de texto duplicados.

### B-ORG-014: caixa unificada de aprovações

Consolidar solicitações de vaga/posição, férias, movimentação, alteração salarial e desligamento.

Campos mínimos:

- tipo;
- solicitante;
- pessoa/unidade;
- etapa;
- responsável;
- prazo;
- prioridade;
- status;
- histórico de decisão.

Começar com workflows específicos. Não construir BPM genérico na primeira versão.

### B-ORG-015: analytics organizacional

Adicionar tendências e breakdowns por unidade e posição com definições transparentes.

Métricas iniciais:

- headcount;
- admissões/saídas;
- turnover;
- tempo médio na posição;
- mobilidade interna;
- span of control;
- ocupação de headcount;
- custo estimado;
- gaps de sucessão e competências.

### B-ORG-016: visões salvas e exportação

Substituir o padrão de centenas de relatórios fixos por filtros, colunas configuráveis, visão salva, CSV/PDF e agendamento.

### B-ORG-017: importação organizacional

Importar estrutura, cargos, posições e vínculos por arquivo validado.

Requisitos:

- prévia antes de aplicar;
- identificação de erros por linha;
- idempotência por `external_id`;
- transação em lotes limitados;
- relatório de mudanças;
- rollback operacional quando possível.

### B-ORG-018: permissões por escopo organizacional

Avaliar escopo por unidade somente depois da estrutura estar consolidada. Capabilities continuam decidindo o módulo; escopo organizacional decide quais dados daquele módulo o gestor pode acessar.

Não inferir acesso apenas porque a pessoa é gestora da unidade.

## 7. Evoluções de módulos existentes

### Recrutamento

- vincular vaga a posição;
- requisição e aprovação de posição/vaga;
- filtros organizacionais;
- preencher vínculo ao contratar;
- manter funil configurável e templates atuais;
- não recriar banco de talentos ou kanban.

### Avaliação e PDI

- vincular competência avaliada ao requisito do cargo;
- transformar gaps confirmados em sugestão de PDI;
- preservar decisão humana antes de criar plano;
- recomendar curso/trilha por competência;
- mostrar evolução histórica, não somente porcentagem atual.

### LMS

- trilha por cargo já existe e deve ser preservada;
- adicionar requisitos obrigatórios por cargo/posição;
- certificados e validade quando houver treinamento regulatório;
- evitar marketplace de cursos sem estratégia de conteúdo.

### Remuneração

- faixa por cargo/grade;
- orçamento por posição;
- histórico salarial continua na pessoa;
- análise por unidade e carreira;
- não calcular folha.

### Sucessão

- posição crítica;
- ocupante atual;
- sucessores;
- prontidão;
- gap de competência;
- risco de vacância;
- cobertura por unidade.

### DP e documentos

- documentos exigidos por vínculo/cargo;
- validade e pendências;
- férias e afastamentos alimentam analytics;
- holerite somente por integração/upload;
- não criar folha própria neste epic.

## 8. Funcionalidades observadas que não devem ser copiadas diretamente

### SESMT completo

ASO, CIPA, EPI, vacinação e exames complementares formam outro domínio regulatório. Opção futura: integração ou controle leve de documento/validade. Não construir prontuário ocupacional sem estratégia, especialistas e requisitos legais.

### Folha de pagamento

Aceitar arquivos e integrações é diferente de calcular folha. Cálculo de folha fica fora.

### Catálogo de relatórios fixos

Evitar uma página com dezenas ou centenas de links para relatórios quase iguais. Preferir analytics explorável e visões salvas.

### Pulso emocional diário identificável

O 30Grow já possui clima, eNPS, pulso e ouvidoria. Qualquer pulso frequente precisa de anonimato, coorte mínima, frequência controlada e propósito explícito.

### Formulários e BPM genéricos

Implementar primeiro workflows específicos do domínio. Um motor genérico de formulário/regra/aprovação só deve existir quando três ou mais fluxos estáveis comprovarem a mesma abstração.

### IA como botão decorativo

Cada uso de IA deve declarar:

- tarefa;
- dados utilizados;
- resultado editável;
- incerteza;
- ação seguinte;
- auditoria quando alterar dado relevante.

## 9. Princípios de UI/UX extraídos do benchmark

Preservar os aspectos úteis:

- caminho organizacional visível;
- filtros coerentes com o trabalho de RH;
- ações em lote;
- histórico entre recrutamento e colaborador;
- etapas, responsáveis, prazos e aprovações;
- comparação entre requisito e realidade.

Não repetir os problemas observados:

- menu lateral com muitos níveis;
- hover menus sobre o conteúdo;
- formulários com dezenas de abas;
- tabelas largas sem hierarquia visual;
- ações identificadas somente por ícone/cor;
- filtros duplicados tela a tela;
- mistura entre cargo, lotação e pessoa;
- IA espalhada sem tarefa clara.

Direção de navegação sugerida:

- Visão geral;
- Pessoas;
- Recrutamento;
- Desenvolvimento;
- Organização;
- Operações de RH;
- Cultura;
- Configurações.

Capabilities continuam controlando módulos. A navegação não precisa expor cada capability como um item independente.

## 10. DBA, performance e segurança

Requisitos desde a primeira migration:

- todas as entidades com `company_id` ou join inequívoco ao tenant;
- SQL parametrizado;
- índices alinhados aos filtros e joins;
- vigência indexada para consultas históricas;
- sem `SELECT *` em árvores/listagens;
- árvore carregada sob demanda, com cap;
- movimentações em transações curtas;
- sem N+1 ao contar ocupantes/posições por unidade;
- batch para importação e movimentações em lote;
- auditoria em mudança de gestor, posição, unidade, remuneração ou status;
- permissões separando capability do módulo e escopo organizacional;
- dados sensíveis de remuneração, documentos e saúde com capability dedicada;
- exportações paginadas/stream e registradas quando contiverem dados pessoais.

Índices iniciais a avaliar:

- unidades: `(company_id, parent_id, active, sort_order)`;
- posições: `(company_id, org_unit_id, status)`;
- posições por cargo: `(company_id, job_role_id, status)`;
- vínculos atuais: `(company_id, candidate_id)` com condição de vínculo ativo;
- ocupação: `(company_id, position_id)` com condição de vínculo ativo;
- movimentos: `(company_id, effective_at DESC, id DESC)`;
- external IDs únicos por tenant quando informados.

## 11. Migração proposta

1. Criar unidades, posições e vínculos como estruturas opcionais.
2. Importar cargo e gestor atuais para o novo modelo.
3. Manter `candidates.job_role_id` e `manager_candidate_id` como projeções de compatibilidade.
4. Atualizar primeiro Organização e ficha da pessoa.
5. Atualizar vagas/hire, sucessão e remuneração.
6. Atualizar analytics e filtros compartilhados.
7. Medir cobertura de dados antigos.
8. Desativar dependências legadas somente após provas de preservação.

Não realizar big-bang. Cada fase precisa de migration idempotente, SQL para pgAdmin, backfill limitado, rollback documentado e DTOV.

## 12. Ordem recomendada

### Fase A: fundação

`B-ORG-001` → `002` → `003` → `004` → `005` → `006`

### Fase B: experiência central

`B-ORG-007` → `008` → `009` → `010`

### Fase C: carreira e desenvolvimento

`B-ORG-011` → `012` → `013`

### Fase D: operação e inteligência

`B-ORG-014` → `015` → `016` → `017` → `018`

## 13. Critério de encerramento do epic

O benchmark estará convertido em capacidade de produto quando:

- cargo, posição, pessoa e vínculo estiverem separados;
- o organograma puder mostrar unidades, posições vagas e ocupantes;
- uma vaga puder nascer de uma posição e o hire preencher o vínculo;
- movimentações preservarem histórico;
- avaliação/PDI/LMS puderem usar requisitos de cargo;
- headcount aprovado versus realizado for confiável;
- filtros organizacionais forem compartilhados;
- permissões e queries permanecerem tenant-safe;
- navegação continuar mais simples que a referência analisada.

O objetivo não é declarar paridade com a Sólides. É incorporar as capacidades que fortalecem a proposta do 30Grow sem herdar a complexidade do concorrente.
