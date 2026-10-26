# Parte 2 RH — decisões (pontos cruzados + fronteiras)

Documento de produto para desbloquear `B-RH2-*` (ver `docs/BACKLOG-RH-TESTES.md`).  
Não substitui o Guia do painel; Guia e FAQ devem espelhar o que for uso de gestor.

## Pontos cruzados (fechados)

### 1. Ciclo de vida

| Estágio | `employment_status` | Onde vive | O que RH/gestor faz |
|---------|---------------------|-----------|---------------------|
| Candidato | `candidate` | Funil da vaga / Equipe (roster recruiting ou all) | Triagem, testes sob convite, oferta, hire |
| Colaborador ativo | `employee` | Equipe (roster `internal`), `/employee` | 1:1, PDI, OKR, DP, check-ins D30/60/90 (gestor conclui) |
| Desligado | `alumni` | Análise demissional + roster `all` | Histórico; não aparece como equipe ativa |
| Contratação fora do funil | `employee` direto | Equipe → “Incluir colaborador” | Sem vaga/teste obrigatório; convite de acesso opcional |

### 2. Perfis (quem faz o quê)

| Ação | Colaborador | Gestor / Direção / RH |
|------|-------------|------------------------|
| Ver datas D30/60/90, reunir, ack | sim | sim |
| **Concluir** checkpoint D30/60/90 | **não** | sim (`completed_by_user_id`) |
| Reabrir checkpoint | não | sim (volta a `pending`) |
| Preparar 1:1 (nota) | sim | vê no painel |
| Disparar Eneagrama/Motivadores | não | sim, após inscrição / seleção |
| Soft apply público | visitante | vê no funil `new` |

### 3. Arquitetura de módulos (B-RH2-04)

| Módulo | Pergunta que responde | Não é |
|--------|----------------------|-------|
| **PDI** | O que esta pessoa desenvolve neste ciclo? | Meta de área / OKR |
| **OKR** | Quais objetivos da área/empresa e atividades atribuídas? | Plano individual de desenvolvimento |
| **1:1** | O que combinamos e acompanhamos na conversa? | Avaliação formal 360° |
| **Feedback contínuo** | Histórico de reforço/ajuste entre reuniões | Substituição do 1:1 |
| **Jornada / check-ins** | Marcos pós-hire (D30/60/90) e onboarding | PDI completo |
| **Avaliação de desempenho** | Ciclo formal com papéis (futuro B-RH2-15) | 1:1 ad hoc |

Vínculos: outcome “develop/concern” no check-in pode semear item de PDI; 1:1 pode apontar item de PDI; OKR não grava em PDI automaticamente.

### 4. Interface

- Lista antes de formulário; progressive disclosure (`CollapsibleBlock`).
- Menos texto técnico; CTAs com verbo + objeto (“Enviar Eneagrama”, “Incluir colaborador”).
- Bastidor/IA só sob ação explícita; saída hedged (“tende a”).

### 5. IA

- Apoio à conversa (perguntas, 2–4 bullets acionáveis ligados a dados).
- Não diagnosticar intenção de saída nem “conclusão” sobre a pessoa.
- Rastreabilidade: cada bullet deve citar fonte (T-type, Motivadores, 1:1, check-in).

### 6. Auditoria

Já via `audit()` em ações sensíveis; Part 2 exige responsável + data em: inclusão de colaborador, disparo de teste, conclusão/reabertura de check-in, convite de acesso.

## Escopo entregue

| ID | Entrega |
|----|---------|
| B-RH2-04 | Este mapa (doc + Guia) |
| B-RH2-05 | Reabrir check-in; mostrar quem concluiu; copy: colaborador só ack |
| B-RH2-06 | Incluir colaborador sem vaga + convite de acesso opcional |
| B-RH2-10 | Prep 1:1: `preparedAt` atualiza a cada envio; estados claros |
| B-RH2-11 | Soft apply já existe; disparo em lote no detalhe da vaga; convite e-mail = Eneagrama explícito |
| B-RH2-01 | Home colaborador: 1ª visita abre só pendências (`tasks`); demais seções recolhidas |
| B-RH2-02 | Overview: “Vagas em aberto” + “Estágios do funil”; copy de atenção/sinais |
| B-RH2-03 | HR Score / radar: linguagem hedged; título “Sinais de retenção”; badges com title auxiliar |
| B-RH2-07 | “DP” → “Informações cadastrais”; Motivadores no radar da aba **Estilo** |
| B-RH2-08 | Dossiê: propósito do HR Score; clima explícito como sinal anônimo da empresa |
| B-RH2-09 | `conversationActions` em `buildProfileSynthesis` (2–4 bullets + fonte) no brief / Estilo |
| B-RH2-13 | Relatório cliente / aderência / indicação: mantidos; polish de copy já alinhado ao Guia (sem redesign estrutural nesta onda) |
| B-RH2-16 | Clima: status `archived`; perguntas editáveis só em `draft`; arquivar + “Nova versão” (rascunho com mesmas perguntas + `source_survey_id`); filtro Ativas/Arquivadas/Todas; `inviteStats` anônimo |
| B-RH2-14 | Benefícios por colaborador: `employee_benefit_assignments` (catálogo → pessoa, valor texto, início/fim, histórico); UI em Equipe → Remuneração |
| B-RH2-17 | Mapa salarial: menos texto; Bônus/PLR permanece módulo separado (Remuneração), fora do mapa |
| B-RH2-18 | Jornada: hint curto D1→D90→PDI |
| B-RH2-15 | Avaliação formal por competências (90/180/360 + self opcional; Likert; envio ao liderado) |
| B-RH2-19 | Abas Analysis nomeadas por pergunta: Encaixe em pares / Comparativo T1–T9 / Grupos / Liderança (sem merge destrutivo) |
| B-RH2-20 | Motivadores: copy situacional no banco v4; templates gestor hedged pt-BR+en; sync desativa (sem DELETE); validação de jargão no respondente. Pesos numéricos mantidos (revisão fina = dono do instrumento) |

## Diferido (próximas ondas / dono)

_(vazio: B-RH2-12 aceite fechado abaixo.)_

## B-RH2-12 — Pipeline configurável (entregue)

**Implementação:** `migrations/110_company_pipeline_stages.sql`, `lib/company/company-pipeline-stages.js` (lazy seed + CRUD + reorder + delete com guard), APIs `app/api/admin/pipeline-stages/*` (VACANCIES_MANAGE), editor DnD em `app/dashboard/vacancies/PipelineStagesEditor.jsx` acima do Kanban, canonicalização nos reports (overview-metrics, hire, manager-weekly-digest, vacancy-report, assessment-filters) via `LEFT JOIN company_pipeline_stages` + `COALESCE(canonical_key, pipeline_stage)`. Hire/reject/archive continuam ações especiais disparadas pelo `canonical_key` — custom pode reutilizar qualquer canonical (ex.: dois "Contratado" mapeados p/ canonical=hired).


Pedido RH: etapa tipo “Encaminhado / Análise da gestão” **e** colunas Kanban configuráveis.

### Decisões (respostas do produto)

| # | Tema | Decisão |
|---|------|---------|
| 1 | Escopo MVP | **Configurável por empresa**: renomear, reordenar (DnD), **criar** etapas. |
| 2 | Obrigatórios (chave semântica fixa) | `new`, `test_completed`, `hired`, `rejected`, `archived`. Não apagar; label pode renomear; ordem pode mudar. |
| 3 | Escopo da config | **Por empresa** (todas as vagas compartilham o mesmo funil). |
| 4 | Apagar / fundir | Se a coluna tiver **qualquer candidato** (na empresa), **bloquear** exclusão (e fundir fora do MVP). |
| 5 | Relatórios / Overview | Custom e defaults não-obrigatórios agregam via `canonical_key` (estágio canônico). Custom novo → default `screening`. |
| 6 | Permissão | **admin, direction e hr** da empresa (gestores com sessão de empresa). Super-admin edita a empresa alvo. |
| 7 | Hired / rejected | Continuam **ações especiais** (fluxo de hire + motivo de rejeição); não viram só “coluna genérica”. |

### Fronteiras

| É | Não é |
|---|--------|
| Funil da empresa (labels + ordem + etapas extras) | Funil distinto por vaga (MVP) |
| Bloquear delete com candidatos | Merge/fundir colunas com remapeamento |
| Canonical key para métricas | Quebrar hire/reject/archive |

### Defaults de seed (primeira carga)

Ordem inicial = funil atual: `new` → `interview` → `test_completed` → `screening` → `approved` → `hired` → `rejected` → `archived`.  
`interview` / `screening` / `approved` são seed **editáveis** (renomear/reordenar/apagar se vazias).

### Impacto técnico (resumo)

- Tabela `company_pipeline_stages` (`company_id`, `stage_key`, `label`, `sort_order`, `system`, `canonical_key`, soft delete).
- Lazy seed na 1ª leitura; Kanban / APIs de estágio passam a resolver via empresa.
- Validação: estágio desconhecido ou deletado → rejeitar move; delete só com count 0.
- UI: editor no painel (vagas/empresa) + DnD; i18n pt-BR+en; CAP/tenant.

## B-RH2-15 — Avaliação formal (entregue)

Substitui o diferimento anterior. Ciclo **leve** (B-1004 metas → PDI) e side review token (B-2704) **permanecem**; B-RH2-15 é módulo **novo** de competências (não só metas).

**Implementação:** `migrations/108_formal_competency_reviews.sql`, `lib/people/formal-competency-reviews.js`, APIs admin/public/employee, UI em Avaliações → Competências, público `/formal-review/[token]`, colaborador vê só após envio.

### Decisões (respostas do produto)

| # | Tema | Decisão |
|---|------|---------|
| 1 | Escopo | **Novo módulo de competências** (banco + avaliação por competência). Não é só polish do review por metas. |
| 2 | Modelos | Gestor/direção **escolhe** no ciclo: **90°** / **180°** / **360°** + checkbox opcional de **autoavaliação** do liderado (vale para qualquer modelo). |
| 2a | 90° | Só o **gestor** avalia o liderado. |
| 2b | 180° | Gestor avalia o liderado **e** o liderado avalia o gestor (via de mão dupla). |
| 2c | 360° | Tudo do 90° **+** terceiro avaliador: gestor informa **nome, e-mail e cargo** (pode ser **cliente / externo**). |
| 2d | Autoavaliação | Checklist/flag: incluir ou não self do liderado em 90, 180 ou 360. |
| 3 | Anonimato | **Sempre nominais** (sem anonimato). |
| 4 | Escala | Likert **1–5** por competência. |
| 5 | Competências | Catálogo **por cargo** (principais do `job_roles`) **e** livre: em ambos os modos há ação para o gestor **adicionar** competências relevantes ao ciclo. |
| 6 | Visibilidade durante o processo | **Só gestor e RH** (não o colaborador). |
| 7 | Encerramento | Ao finalizar, gestor pode **enviar resultado** ao liderado. Depois disso a avaliação **não edita**: só **visualizar** ou **arquivar**. |
| 8 | MVP | **Tudo** acima na primeira entrega (não fatiar fora). |

### Fronteiras

| É | Não é |
|---|--------|
| Avaliação formal por competências + papéis 90/180/360 | Substituição de 1:1 / PDI / review leve de metas |
| Convite externo (nome/e-mail/cargo) no 360 | Folha / RHIS / assinatura ICP |
| Envio explícito do resultado ao liderado | Colaborador edita respostas após envio |

### Impacto técnico (resumo)

- Schema novo (ou extensão forte): competências (empresa/cargo), ciclo formal, itens Likert, respostas por papel (gestor / liderado→gestor / self / terceiro), status draft→…→finalizado→enviado/arquivado.
- Reusar padrões: token público (`/avaliacao` ou rota dedicada), `FormField`, CAP RH, `audit()`, i18n pt-BR+en; hedging na copy.
- Review leve B-1004 continua para metas → PDI; não misturar nas mesmas telas sem progressive disclosure.

### Aberto só se contradizer o produto

Nada bloqueante se 2b (180° = liderado avalia gestor) estiver correto como escrito.

## Mapa das abas de análise (B-RH2-19)

| Aba | Pergunta |
|-----|----------|
| Encaixe em pares | Quem tende a se complementar / atritar em trabalho conjunto? |
| Comparativo T1–T9 | Como cada pessoa pontua nos nove estilos lado a lado? |
| Grupos | Qual o mix / pulso deste subconjunto salvo? |
| Liderança | Sinais de liderança / núcleo no recorte |
| Equipe | Roster + estágio + gestão da pessoa (não é compat) |
