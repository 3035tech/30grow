# 30Grow · Catálogo de funcionalidades

Referência funcional do produto, organizada por área. O README traz a visão geral e como rodar; aqui fica o detalhe de cada módulo (onde está na UI, APIs, libs e migrations principais). Para o uso passo a passo pelo gestor, a fonte é o **Guia do painel** (aba Ajuda, `lib/i18n.js` → `panel.help.*`).

Convenções que valem para todos os módulos:

- Isolamento por `company_id` (só `admin` é cross-tenant). Acesso por capability em `lib/permissions.js` (`CAP`).
- Links públicos por token (`/t`, `/v`, `/r`, `/e`, `/prep`, `/clima`, `/ouvidoria`, `/feedback`) ficam fora do ACL de gestor.
- Perfis e leituras usam linguagem de hipótese (“tende a”, “há indícios”); T1–T9 **não** é diagnóstico clínico.

---

## 1. Aquisição e conta

### Landing page e SEO (`/`)

- HTML rastreável, JSON-LD e `/llms.txt`; narrativa candidato → colaborador, T1–T9 e inventário real dos módulos.
- CTA principal **30 dias grátis** → `/signup`. Acessos de gestor (`/login`) e colaborador (`/employee/login`) separados.
- Copy por idioma em `lib/product-landing-seo.js` (pt-BR, pt-PT, en, es-419, es-ES; fr-FR/de-DE herdam do inglês até a tradução).
- Analytics de conversão: tabela `landing_analytics` (pageview → cta_click → signup_start → signup_complete → login).

### Self-service signup e ativação

- `/signup` cria usuário pendente (`signup_pending`, role `direction`), empresa nova e token de ativação (72h) enviado por e-mail.
- Join por domínio (`SIGNUP_DOMAIN_MATCH=true`) associa à empresa existente com role `hr`. **Manter `false` em produção.**
- Rate limit 8/15 min por IP; Turnstile opcional (`TURNSTILE_SECRET_KEY`).
- Ativação e reset de senha: `/a/set-password?token=…`.
- Limites de trial por env: `TRIAL_MAX_VACANCIES` (2), `TRIAL_MAX_CANDIDATES` (50), `TRIAL_MAX_USERS` (3), `TRIAL_MAX_MOTIVATORS` (10), `TRIAL_MAX_CLIMATE_SURVEYS` (2).
- Detalhe: [`self-service-signup.md`](self-service-signup.md). Migrations `051`–`053`.

### Primeiros passos e onboarding do gestor

- Wizard para todo gestor novo vinculado a empresa (`onboarding_completed = FALSE`): começa pelo objetivo, sugere módulos, permite revisão. Super admin não recebe o wizard.
- Tour pós-signup e playbooks contextuais no topo das abas (RH contratando, gestor de time, liderança).
- Detalhe: [`onboarding-contextual.md`](onboarding-contextual.md).

### Planos, módulos e licenças

- Página `/pricing` com calculadora por faixa de colaboradores ativos: preço fixo por faixa, equivalente por pessoa até 200 colaboradores; acima disso a página mostra "sob consulta" e troca o CTA de cadastro por contato comercial (tabela única `PUBLIC_PRICING_TIERS` em `lib/pricing-currency.js`).
- Módulos por empresa (`company_modules`): seleção vazia = só `core`; `NULL` = legado irrestrito. Remuneração é módulo sensível separado (`compensation.view` / `compensation.manage`, migration `112`).
- Detalhe: [`company-modules.md`](company-modules.md), [`company-licenses.md`](company-licenses.md).

### Administração da plataforma (super admin)

- **Empresas**, **Usuários** (papéis `admin`, `direction`, `hr`), **Leads** (`/dashboard?tab=leads`, cohort do signup), **Sugestões de produto** (`?tab=product-feedback`, migration `082`), **Auditoria** (`?tab=audit`, append-only; ver [`audit-log.md`](audit-log.md)).
- Super admin sem empresa fixa usa o filtro **Empresa** no topo (lembrado entre abas). Criação: `npm run db:create-super-admin`.
- Usuário com vínculo em várias empresas: [`user-company-memberships-expand.md`](user-company-memberships-expand.md).

---

## 2. Recrutamento

### Vagas e pipeline

- Workspace da vaga por tarefa: **Pipeline**, **Candidatos**, **Informações**, **Divulgação**, **Configurações** (`vacancySection` na URL).
- Kanban configurável: responsáveis, busca, filtros, visões salvas, densidade compacta, colunas vazias ocultáveis, tempo na etapa, lista recolhível no mobile.
- **Modelos de funil** por empresa: padrão pré-selecionado, snapshot em `vacancy_pipeline_stages`, editar/reordenar/duplicar/arquivar, “Salvar como modelo”. Migrations `111`, `113`.
- Analytics do funil: entradas, tempo médio, conversão e gargalos com amostra mínima.
- Rubrica T1–T9 por vaga ou herdada do cargo; ranking/fit explicável; scorecard de entrevista; oferta. Ver [`rubrica-por-vaga.md`](rubrica-por-vaga.md).
- Assistentes de IA (opcionais, `OPENAI_API_KEY`): descrição da vaga, rubrica, parecer do relatório `/r`.

### Candidatos e avaliação

- Assessment por link: `/t/<token>` (empresa) ou `/v/<token>` (vaga, noindex). `POST /api/results` grava no Postgres; scoring no servidor (`lib/assessment-score.js`).
- Pessoa = `candidates` (`company_id` + e-mail). Eneagrama, Motivadores e 1:1 no mesmo `candidate_id`.
- **Motivadores** (Assessment Engine, `lib/ae/`): convite, resultado, sugestões “faça / evite”, sinal de retenção.
- **Preparação de entrevista** (`/prep/<token>`): perguntas para o candidato; RH vê “Preparou-se” (migration `086`).
- **Relatório para cliente** (`/r/<token>`): shortlist com parecer.
- **Banco de talentos** e **indicação** (`referral_codes`, aba Indicação na vaga).

### Página pública da vaga e SEO de empregos

- Canônica indexável `/jobs/{slug}-{id}` com JobPosting JSON-LD e Open Graph; `/v/{token}` continua sendo o assessment.
- Flags na vaga: página pública, indexação, mostrar empresa, mostrar salário. Encerrada ou prazo vencido: agradecimento + vagas relacionadas, sem JobPosting.
- Índice `/jobs` com busca, filtro e paginação; **alerta de vagas** (`POST /api/public/job-alerts`, cancelamento em `/a/unsubscribe`).
- Agregadores `/jobs/remote` e `/jobs/city/{slug}` só com ≥ `PUBLIC_JOB_AGGREGATOR_MIN_COUNT` vagas (default 3).
- Perfil público da empresa `/companies/{slug}` (opt-in `public_profile_enabled`, logo em S3).
- `robots.txt` e `sitemap.xml` só com superfícies públicas; Google Indexing API opcional (`GOOGLE_INDEXING_ENABLED`).
- Atribuição: `utm_*` e `?ref=` → cookie `team30_job_attr` (7 dias, sem PII) → `assessments.attr_*` e `job_funnel_events`.
- Detalhe: [`job-seo-and-distribution.md`](job-seo-and-distribution.md). Migrations `030`–`039`.

---

## 3. Pessoas e gestão

### Equipe e ficha da pessoa

- Lista com sinais acionáveis; ficha com seções em `section` na URL: `oneOnOne`, `journey`, `compensation`, `dp`, `style`, `history`, `profile`.
- Perfis T1–T9 e Motivadores, brief de gestão, 1:1, jornada D1/D30–D90, convite de acesso ao portal.
- **Compatibilidade** e **Grupos** (núcleo, complementaridade e tensão), com caps de pares.
- **Organograma** com arrastar e soltar e **unidades organizacionais** ([`organization-units.md`](organization-units.md)).

### Desenvolvimento

- **PDI** com itens, prazos e vínculo a recursos da Academy; itens automáticos a partir de avaliação de desempenho.
- **1:1** com registro e preparação do colaborador.
- **Avaliação de desempenho**: ciclos (rascunho → ativo → fechado), metas com peso e resultado, reviews, calibração e **9-box**. Metas com resultado `develop` geram itens de PDI. Migration `056`.
- **Competências formais** e categorias de competência.
- **OKRs** (ciclo, área, objetivos hierárquicos, peso 0–10, check-ins; migrations `096`–`098`, `104`, `133`).
- **Plano de sucessão**: papéis críticos, sucessores por prontidão, score combinando HR Score e potencial. Migration `057`.
- **LMS**: cursos, aulas (vídeo/link/PDF), quiz, certificado, trilha por cargo com matrícula automática na contratação. **Academy**: catálogo leve de recursos (sem player). Migrations `059`, `063`, `102`.

### Cultura, clima e retenção

- **Pesquisa de clima** anônima (`/clima/<token>`), médias com k-anonimato (`CLIMATE_MIN_RESPONSES`), eNPS e temas.
- **Pulso de grupo** com perguntas fixas (`TEAM_PULSE_MIN_RESPONSES`).
- **Cultura organizacional**: leitura a partir de clima, mix T1–T9, pulsos e valores declarados (sem novo instrumento).
- **HR Score** (0–100) com sete sinais e **Radar de rotatividade** multi-sinal. Migration `054`.
- **Análise demissional**: registros de saída, motivos × perfil × área, insights. Migration `058`.
- **Reativar ex-colaborador (recontratação)**: Equipe → filtro de quadro "Ex-colaboradores" (`roster=alumni`) + selo "Desligado em"; "Reativar colaborador" no menu ⋯, na ficha e na Análise Demissional (`POST /api/admin/exit-analysis/rehire`, CAP `exit_analysis.view`, convite opcional ao portal). A saída anterior não é apagada: `exit_records.rehired_at` fecha a passagem e ela segue no turnover; no máximo uma saída aberta por pessoa (índice parcial `uq_exit_records_open_candidate`). Qualquer volta a colaborador (reativar, incluir de novo o e-mail, contratar por vaga) passa por `markCandidateHired`, que fecha a saída aberta. "Time interno" nunca inclui ex-colaboradores (`lib/roster-scope-sql.js`). Migration `135`.
- **Mural e reconhecimento** (avisos + kudos, migration `085`), **feedback contínuo** e **ouvidoria** anônima (`/ouvidoria/<token>`, migration `090`).

### Remuneração e benefícios

- **Remuneração interna**: salário vigente e histórico de reajustes; import da oferta aceita; faixa de mercado por cargo (migrations `072`, `084`). Não é folha.
- **Bônus / remuneração variável**: proposta do RH → aprovação (migration `090`).
- **Benefícios da empresa**: catálogo informativo usado em oferta e kit de contratação (migration `060`).
- **Cargos**: rubrica T1–T9, faixa de mercado, trilha LMS (migration `055`).

### Departamento pessoal (DP leve)

- Hub DP: pendências, férias e afastamentos (saldo por período aquisitivo), documentos com anexo privado, assinatura interna, admissão.
- **Ponto digital** e **banco de horas** (saldo calculado do espelho + lançamentos, teto por empresa, congelado no fechamento, CSV mensal; migrations `099` e `143`), jornada por colaborador e feriados.
- Fora de escopo: eSocial, holerite, folha. Detalhe: [`DP-PRIVATE-ATTACHMENTS.md`](DP-PRIVATE-ATTACHMENTS.md), [`dp-address-and-clock-timeline.md`](dp-address-and-clock-timeline.md).

---

## 4. Portal e app do colaborador

- **Link por token** `/e/<token>` (~30 dias, sem conta): PDI, combinados, preparação de 1:1, LMS.
- **Portal com senha** `/employee` (convite em Equipe → Convidar acesso): hub Hoje, Minha chegada, PDI, OKRs, LMS (`/employee/lms`), DP (`/employee/dp`), ponto (`/employee/time-clock`), mural, kudos, feedback e notificações. Não acessa `/dashboard`.
- Vínculo em várias empresas: escolha no login e troca de contexto com senha e 2FA; a troca substitui a sessão inteira.
- **App nativo** (`../30-team-app`, Expo iOS/Android) sobre `/api/mobile/v1`: sessão revogável, refresh rotativo, 2FA, troca de empresa. Em validação em dispositivo; o portal web é a referência funcional.
- Detalhe: [`employee-onboarding-journey.md`](employee-onboarding-journey.md).

---

## 5. Relatórios e integrações

- **Relatórios** (`/dashboard?tab=analytics`): efetividade (time-to-hire, retenção 6/12/24 meses, time-to-productivity, fit dos contratados vs pool), tendências, comparativo entre áreas, alertas e exportação CSV/JSON.
- **API REST** autenticada (cookie `team30_session`, 100 req/min): `/api/admin/analytics/{metrics,trends,compare,alerts,export}`. Detalhe: [`analytics-api.md`](analytics-api.md).
- **Relatório agendado** por e-mail (semanal/mensal) via cron `POST /api/cron/analytics-report` com `CRON_SECRET`.
- **Visão geral**: fila de atenção (PDI atrasado, clima aberto, check-in pós-contratação, papel crítico sem sucessor) e inteligência comportamental agregada.
- **Notificações in-app** (`NOTIF` em `lib/manager-notification-catalog.js`) e digest semanal do gestor.

## 6. Ajuda

- **Guia do painel** (aba Ajuda): busca, atalhos por tarefa, categorias e um artigo por vez; botão “Como funciona?” abre o artigo da tela.
- **Assistente de Ajuda (IA)** flutuante: indexa o mesmo conteúdo (`lib/help-sections.js`, FAQ em `lib/help-assistant.js`). Ver [`help-assistant-knowledge.md`](help-assistant-knowledge.md).

## 7. Crons

Todos exigem `Authorization: Bearer <CRON_SECRET>` (ou `X-Cron-Secret`):

| Rota | Função |
|------|--------|
| `POST /api/cron/invite-reminders` | Lembretes de convite |
| `POST /api/cron/vacancy-deadline-notifications` | Prazos de vaga |
| `POST /api/cron/notification-retention` | Limpeza de notificações antigas |
| `POST /api/cron/manager-weekly-digest` | Digest semanal do gestor |
| `POST /api/cron/analytics-report?frequency=weekly\|monthly` | Relatório agendado |

Retenção LGPD (`RETENTION_DAYS`) e demais crons: ver `.env.example` e [`privacy-retention-policy.md`](privacy-retention-policy.md).
