# Referência técnica por módulo

> Detalhe de implementação (migrations, APIs, libs) de cada módulo. Visão funcional: [`FEATURES.md`](./FEATURES.md). Setup e comandos: [`../README.md`](../README.md).

## Self-Service Signup + Onboarding (Early Access)

A partir da versão com migrations `051`, `052` e `053`:

- **Landpage** (`/`) → CTA direto para `/signup` (sem `mailto`)
- **Signup** cria automaticamente:
  - User pendente (`signup_pending = TRUE`, `onboarding_completed = FALSE`, role `direction`)
  - Company nova (ou associa a existente por `@domain` se `SIGNUP_DOMAIN_MATCH=true` — **manter false em prod**; join usa role `hr`, não `direction`)
  - Rate limit no signup (8/15min por IP); resposta `{ ok: true }` sem IDs no body
  - Token de ativação (72h) enviado por e-mail
- **Confirmação** via `/a/set-password?token=...` → usuário define senha e entra
- **Admin Leads** (`/dashboard?tab=leads`) — cohort `/signup` para contato futuro (pendentes e ativos). Em **Usuários**, cadastro normal = Origem Painel; quem veio do onboarding = Early access (também aparece em Usuários quando já está no sistema).
- **Sugestões de produto** (`/dashboard?tab=product-feedback`) — inbox super admin de ideias/bugs/UX enviados pelos gestores pelo assistente de Ajuda (“Sugerir melhoria”). Migration `082_product_feedback.sql`.
- **Jornada P0** (`102`): trilha LMS por cargo (auto-enroll no hire), decisão de experiência (`pass`/`extend`/`terminate` + prorrogação de prazos), template D1 configurável no hub DP.
- **Banco de horas** (hub DP → Banco de horas; saldo/pedido em `/employee/time-clock`) — saldo calculado do espelho (extras − faltas) + lançamentos manuais, teto por empresa, congelado no fechamento, CSV mensal. Migrations `099_hour_bank.sql` e `143_time_clock_schedules_holidays_bank.sql`. **Não** é folha/acordo coletivo.
- **Mural e reconhecimento** (`/dashboard?tab=company-feed`, `/employee#feed` / `#kudos`) — avisos da empresa (rich text) + kudos peer-to-peer (≤280); notif ao destinatário; contagem no digest semanal. Migration `085_company_feed_kudos.sql`. Sem chat.
- **Prep de entrevista** (`/prep/<token>`) — perguntas hedged para o candidato (notas só no dispositivo); RH vê chip “Preparou-se”. Migration `086_interview_prep.sql`.
- **OKRs leves** (aba Pessoas → OKRs) — ciclo/área/atividade, peso 0–10, check-ins, vínculo de pessoas, hub `/employee` → Meus OKRs + notificação. Migrations `096`+`097`+`098`+`104`.
- **Ouvidoria** (`/dashboard?tab=whistleblowing`, `/ouvidoria/{token}`) — canal anônimo + triagem RH. Migration `090`.
- **Organograma** + **feedback contínuo** (Equipe/Grupos + `/employee` / `/feedback/{token}`). Migration `090`.
- **Bônus / remuneração variável** (proposta RH → aprovação; status no hub). Migration `090`.
- **Auditoria** (`/dashboard?tab=audit`) — trilha append-only (super admin). Filtro **Empresa** por nome (alinha ao filtro do painel). Ver [`docs/audit-log.md`](./audit-log.md).
- **Super admin sem empresa fixa:** use o filtro **Empresa** no topo (lembrado entre abas). Ops: `npm run db:create-super-admin`.
- **Wizard “Primeiros passos”** para todo gestor novo vinculado a uma empresa (`onboarding_completed = FALSE`); começa pelo objetivo, sugere módulos e permite revisão. Super admin não recebe o wizard e mantém acesso integral.
- **Inteligência comportamental** na Visão geral (`behavioralIntel`): no topo (funil recolhido); filtro ou **grupo salvo** (`teamGroup`); perfis, motivadores, forças/atenções (até 5), Top 5 e ações — agregado, hedged, sem nomes.
- **Wizard de onboarding** (primeiro acesso):
  - 4 steps guiados: boas-vindas, criar vaga, convidar pessoas, recursos
  - Dismissível a qualquer momento (nunca mais aparece após completar/pular)
  - Marca `users.onboarding_completed = TRUE`
- **Trial limits** (soft caps via env):
  - `TRIAL_MAX_VACANCIES` (default 2)
  - `TRIAL_MAX_CANDIDATES` (default 50)
  - `TRIAL_MAX_USERS` (default 3)
  - `TRIAL_MAX_MOTIVATORS` (default 10)
  - `TRIAL_MAX_CLIMATE_SURVEYS` (default 2)
- **Analytics** de landpage: `landing_analytics` table + tracking de conversão (pageview → signup → ativação)

Tabelas novas:
- `users.signup_pending`, `users.signup_source`, `users.signup_metadata`, `users.onboarding_completed`
- `companies.signup_auto_created`, `companies.signup_creator_user_id`
- `landing_analytics` (events: pageview, cta_click, signup_start, signup_complete, login)

---

## Epic B-1000 — Plataforma GP (B-1001 a B-1004 entregues)

A partir da migration `054`, `055` e `056`:

### B-1001 — HR Score + Predições
- **HR Score (0-100)** consolidando 7 sinais comportamentais: perfil T1-T9 (15%), Motivadores (20%), Fit (15%), PDI (20%), Check-ins (10%), Clima (10%), Retenção (10%)
- **Predições** derivadas dos sinais: risco de turnover (low/medium/high) e áreas de gap PDI
- UI: `HrScoreCard` na Visão Geral (média empresa, por área, top/bottom 5) e `HrScoreBadge` nas listagens
- APIs: `GET /api/admin/hr-score/:candidateId`, `GET /api/admin/hr-score/company`, `POST /api/admin/hr-score/recalculate`
- Migration: `054_hr_score.sql` (tabela `hr_scores`)

### B-1002 — Radar de Rotatividade (Multi-sinal)
- **Turnover Radar** focado em 4 sinais críticos de saída: Clima (30%), Motivadores/retenção (30%), PDI concern (25%), Check-ins concern (15%)
- Calcula risco de turnover (low/medium/high) e sugere ações
- UI: `TurnoverRadarCard` na Visão Geral com distribuição low/med/high + lista top at-risk e breakdown visual de sinais
- API: `GET /api/admin/turnover-radar/company` (inclui `distribution`)
- Lib: `lib/turnover-radar.js` (calcula radar, detecta trend change para notificações futuras)
- **Viz lean P3:** ouvidoria (funil/categorias), pool de férias no inbox DP (`VacationPoolBlock`, `mode=pool`)

### B-1003 — Engenharia de Cargos (Leve)
- **Cargos (Job Roles)** com rubrica T1-T9 que podem ser herdados por vagas via FK `vacancies.job_role_id`
- CRUD completo: listar, criar, editar, desativar (soft)
- UI: `JobRolesAdminTab` (admin), campo `jobRoleId` no formulário de vagas (`VacanciesAdminTab`), componente `RubricEditor` para editar pesos visuais
- APIs: `GET/POST /api/admin/job-roles`, `GET/PATCH/DELETE /api/admin/job-roles/[id]`
- Lib: `lib/job-roles.js` (`getRubricForVacancy` resolve herança: job_role → vacancy rubric)
- Migration: `055_job_roles.sql` (tabela `job_roles`, FK em `vacancies`)

### B-1004 — Avaliação de Desempenho + Metas → PDI
- **Performance Cycles** (company-wide): rascunho → ativo → fechado
- **Goals** (metas por candidato em um ciclo): título, descrição, peso (%), outcome (`met`, `exceeded`, `develop`, `not_met`)
- **Reviews** (avaliação por candidato): draft → submitted
- **Auto PDI**: ao submeter review, metas com outcome `develop` geram automaticamente itens PDI com `source: 'performance_review'` e `performance_goal_id` linkado
- UI: `PerformanceReviewsAdminTab` (criar/listar ciclos), review form (metas + outcomes + auto-confirm de PDI)
- APIs: `/api/admin/performance-cycles` (CRUD cycles), `/api/admin/performance-goals` (CRUD goals), `/api/admin/performance-reviews` (GET/POST draft, POST submit → auto PDI)
- Lib: `lib/performance-reviews.js` (ciclos, goals, reviews, `autoGeneratePdiFromReview`)
- Migration: `056_performance_reviews.sql` (tabelas `performance_cycles`, `performance_goals`, `performance_reviews`; estende `development_plan_items.source` para incluir `'performance_review'` e adiciona FK `performance_goal_id`)

### B-1005 — Plano de Sucessão
- **Critical Roles** (papéis críticos da empresa): título, descrição, área, nível de impacto (high/critical)
- **Succession Plans** (sucessores por papel): candidato, prontidão (`not_ready`, `developing`, `ready`, `now`), notas, data-alvo
- **Readiness Score**: combina HR Score (70%) + Leadership Potential (30%) para ranquear candidatos
- Integração com `lib/hr-score.js` (B-1001) e `lib/leadership-analytics.js` (potencial de liderança já existente)
- UI: `SuccessionAdminTab` (criar/listar papéis críticos, ver contadores de sucessores)
- APIs: `/api/admin/succession/critical-roles` (CRUD roles), `/api/admin/succession/plans` (CRUD succession plans), `/api/admin/succession/critical-roles/[id]/successors` (list successors)
- Lib: `lib/succession-plans.js` (CRUD roles/plans, `calculateSuccessionReadiness`, `getPotentialSuccessors`)
- Migration: `057_succession_plans.sql` (tabelas `critical_roles`, `succession_plans`)

### B-1006 — Análise Demissional
- **Exit Records** (registro de saída): candidato alumni, data, tipo (voluntary/involuntary/mutual), motivo (16 razões: better_offer, compensation, career_growth, performance, culture_fit, manager_relationship, etc.), notas (contexto/feedback)
- **Agregação**: motivos × tipo T1–T9 × área para padrões de rotatividade
- **Insights automáticos**: categoriza em M1 (seleção: compensação não competitiva, fit cultural, desempenho) e M3/M4 (gestão: relação com gestor, falta de crescimento). Apresenta % e sugestões hedged.
- UI: `ExitAnalysisAdminTab` (registrar/listar saídas), `ExitInsightsCard` no Overview (padrões M1/M3/M4)
- APIs: `/api/admin/exit-analysis` (CRUD exit records), `/api/admin/exit-analysis/insights` (agregações + insights)
- Lib: `lib/exit-analysis.js` (CRUD, `getExitReasonAggregation`, `getExitsByTypeProfile`, `getExitInsights`)
- Migration: `058_exit_analysis.sql` (tabela `exit_records`)
- **Recontratação (várias passagens):** `POST /api/admin/exit-analysis/rehire` (`CAP.EXIT_ANALYSIS_VIEW`, Zod, audit `employee.rehire`) → `rehireEmployee` em `lib/hire.js`; fecha a saída aberta (`rehired_at`, `rehired_by_user_id`) e volta a pessoa a colaborador, com convite de acesso opcional. `markCandidateHired` (vaga ou inclusão direta) também fecha a saída aberta. Filtro **Ex-colaboradores** na Equipe (`ROSTER_SCOPE.ALUMNI`, SQL em `lib/roster-scope-sql.js`); "Time interno" exclui ex-colaboradores. Migration `135_exit_records_rehire.sql` (uma saída **aberta** por pessoa, índice parcial).

### B-1007 — Cultura Organizacional
- **Leitura hedged**: sintetiza clima (Likert mean level), mix T1–T9 (arquétipo dominante, % homogeneidade), pulsos recentes (engajamento), e valores declarados (`companies.about_html`)
- **Insights categorizados**: saúde geral (positivo ≥4.0, neutro ≥3.0, atenção <3.0), arquétipo cultural (tipos dominantes ≥20%), homogeneidade (>50% em um tipo), engajamento (frequência de pulsos), alinhamento declarado × praticado
- **Sem novo instrumento**: reusa climate surveys, T1–T9 assessments, team pulses, company profile
- UI: `CultureInsightsCard` no Overview (resumo + insights completos expandíveis)
- API: `/api/admin/organizational-culture` (GET com `?summary=true` para rollup)
- Lib: `lib/organizational-culture.js` (`getOrganizationalCulture`, `getCultureSummary`, `synthesizeCultureInsights`)

### B-1008 — Academy (Learning Resources)
- **Catálogo leve** (não é LMS): título, descrição rica, temas em tags (`TagInput`), tipo, URL, duração
- **Link com PDI**: Equipe → PDI → item → botão Academy (`development_plan_resource_links`); listagem GET também para `TEAM_VIEW`
- Sem player, SCORM ou progresso
- UI: `LearningResourcesAdminTab`; APIs `/api/admin/learning-resources`; lib `lib/learning-resources.js`
- Migrations: `059_learning_resources.sql`, `063_learning_theme_tags.sql`

### B-1009 — Benefícios da Empresa (Company Benefits)
- **Catálogo informativo** de benefícios oferecidos pela empresa: nome, descrição, categoria (livre), tipo (health/dental/vision/life_insurance/retirement/vacation/flexible_hours/remote_work/gym/meal_voucher/transport_voucher/education/daycare/other)
- **Contexto de retenção/oferta**: lista serve como referência em conversas de retenção e na composição de ofertas de emprego
- **Sem adesão, sem folha, sem clube**: não há sistema de inscrição, desconto em folha ou gestão de adesão. Apenas catálogo de benefícios que a empresa oferece
- UI: `CompanyBenefitsAdminTab` (CRUD com filtro por categoria)
- APIs: `/api/admin/company-benefits` (list com `?category=`, `?categories=true`, POST), `/api/admin/company-benefits/[id]` (GET, PATCH, DELETE)
- Lib: `lib/company-benefits.js` (CRUD, `getCompanyBenefitCategories`)
- Migration: `060_company_benefits.sql` (tabela `company_benefits`)

### B-2510 — Remuneração interna (RH)
- **Histórico leve** de salário e reajustes por colaborador — **não** é folha, holerite ou ponto
- Equipe → ficha da pessoa (contratado/alumni) → aba **Remuneração**: salário vigente + timeline; import opcional da oferta aceita na vaga
- APIs: `GET/POST /api/admin/candidates/[id]/compensation`, `PATCH/DELETE …/compensation/[eventId]`
- Lib: `lib/people/employee-compensation.js`; migration `072_employee_compensation.sql`
- **Faixa de mercado (B-2711):** Cargos com `market_salary_min`/`max` + `candidates.job_role_id`; compare na Remuneração e Atenção na Overview (`084_market_salary_bands.sql`). Não é pesquisa live.

**Epic B-1000 completo** (B-1001 a B-1009) ✅

### Epic B-1200 — conectar + UX + profundidade
- Sidebar agrupado (Análise / Recrutamento / Pessoas / Catálogos / Conta / Ajuda)
- Overview Atenção: PDI atrasado, clima aberto, check-in pós-hire, papel crítico sem sucessor
- Kit de hire notifica com trecho de benefícios (`formatBenefitsForOnboarding`)
- PDI ↔ Academy na UI; tour pós-signup aponta `#overview-tab` / `#vacancies-tab` / `#team-tab` / `#help-tab`
- Fit da vaga mostra top contribuições da rubrica

---

---

## Fluxos principais

### Candidato / colaborador

```
1. Assessment: abre /t/<token> (empresa) ou /v/<token> (vaga) → responde o teste
2. Página pública SEO (opcional): /jobs/<slug>-<id> → lê a vaga → CTA para o /v/…
3. Índice: `/jobs` lista vagas públicas abertas
4. POST /api/results → grava no Postgres; vê o resultado na tela
5. Pós-hire (token): /e/<token> — PDI, combinados, prep 1:1, LMS (sem conta)
6. Sessão colaborador: Equipe → Convidar acesso (e-mail set-password) → /employee/set-password
   → login e-mail/senha em /employee/login (cookie team30_employee_session; PDI self-serve,
   hub “Hoje” + páginas dedicadas **/employee/lms**, **/employee/dp**, **/employee/time-clock**;
   LMS: detalhe do curso em abas persistentes (Conteúdo, Matrículas, Acompanhamento),
   layout do colaborador (lista + player), cadastro único de aula com descrição e
   escolha vídeo/link ou PDF, retoma vídeo YouTube/Vimeo, PDF in-app, quiz,
   certificado print; hub resume prazos;
   jornada **Minha chegada**, **Meus OKRs**, mural/kudos/feedback,
   notifs Motivadores/PDI/LMS/OKR; não acessa /dashboard). Quando o mesmo e-mail possui
   vínculos em mais de uma empresa, o login permite escolher a empresa e o menu do perfil
   permite trocar o contexto mediante senha do vínculo e 2FA, quando ativo. A troca substitui
   a sessão inteira para preservar o isolamento por `company_id`.
   Magic link opcional. Ver `docs/employee-onboarding-journey.md`. /e/<token> continua sem conta.
```

O produto também possui um aplicativo nativo do colaborador em `../30-team-app`, desenvolvido com Expo para iOS e Android. Ele usa `/api/mobile/v1` e preserva o isolamento por empresa, sessão revogável, refresh rotativo, 2FA e troca de empresa. A experiência mobile cobre Hoje, notificações, onboarding, perfil, pesquisas, PDI, OKRs, avaliações recebidas, feedback e LMS. O app está em validação em dispositivo; o portal web `/employee` continua sendo a referência funcional e o canal disponível até a distribuição nativa.

### Gestor no dashboard

As áreas densas usam navegação local orientada à tarefa: curso LMS (Conteúdo, Matrículas, Acompanhamento), campanha de Clima (Resultados, Distribuição, Questionário), DP (Pendências, Férias/Afastamentos, Documentos, Ponto/Banco de horas, Admissão), Remuneração (Pessoas/Salários, Mapa/Aprovações) e Perfil (Conta, Módulos, Segurança).

```
1. /login → JWT em cookie httpOnly (TTL **8h**; claim `sv` = `users.session_version`)
2. Sliding no Proxy do Next.js: gestor (`/dashboard`, `/api/admin`, `/api/me`, TTL **8h**) e colaborador (`/employee`, `/api/employee`, TTL **12h**) — se a sessão ainda é válida e faltam ≤ **2h**, reemite o cookie. Sem uso pelo TTL respectivo a sessão cai; `session_version` continua revogando na hora
3. Logout / troca de senha / desativação incrementam `session_version` e invalidam JWTs antigos
4. APIs admin e SSR do painel revalidam usuário live (active, role, company) a cada request
5. /dashboard → auth leve pinta o shell (sidebar); queries da aba em Suspense (`load-dashboard-data.js`)
6. Abas: visão geral, equipe, compatibilidade, vagas, motivadores, Guia (Ajuda), etc.
   O menu usa seis grupos orientados ao trabalho, mantém apenas o grupo atual aberto no primeiro acesso e preserva a preferência depois disso. Tabs locais são reservadas para tarefas equivalentes sobre o mesmo objeto. Ver [`docs/dashboard-navigation-pattern.md`](./dashboard-navigation-pattern.md).
7. Em Vagas: link /v/… (teste) e, se habilitado, página /jobs/{slug}-{id} (divulgação/SEO)

### Modelos de funil de vagas

O módulo de Recrutamento/Vagas mantém modelos de funil isolados por empresa (`company_id`). Ao criar uma vaga, o modelo padrão já vem selecionado, mostra a prévia das etapas e copia seu snapshot para `vacancy_pipeline_stages`; ajustes posteriores afetam apenas aquela vaga. Em “Configurar funis”, o gestor cria modelos, edita e reordena etapas por arraste ou controles acessíveis, duplica, define o padrão e arquiva com restauração imediata. No detalhe da vaga, “Salvar como modelo” captura as etapas atuais. O Kanban oferece responsáveis por vaga/candidato, busca, filtros, visões pessoais salvas, densidade compacta, ocultação de colunas vazias, indicadores de permanência e navegação mobile em lista recolhível. Analytics mostra entradas, tempo médio, conversão histórica e sinais explicáveis de gargalo com amostra mínima. A migration `113_recruiting_workspace.sql` adiciona ownership e visões sem alterar registros existentes. Eventos de abertura, cancelamento, seleção de modelo e conclusão da criação são agregados no `audit_log`, sem conteúdo da vaga ou dados de candidato. Vagas anteriores à migration `111_vacancy_pipeline_templates.sql` continuam compatíveis pelo fallback para `company_pipeline_stages`.

O workspace da vaga é organizado pelas tarefas do recrutador: **Pipeline**, **Candidatos**, **Informações**, **Divulgação** e **Configurações**. A seção ativa fica em `vacancySection` na URL; links antigos de Fit, Funil, Indicação e Relatório são direcionados para a nova seção equivalente. Analytics permanece recolhível abaixo do Kanban e a configuração das etapas fica fora da operação diária.

A **listagem de vagas** é uma tabela (`AdminTableShell` + `AdminListPager`): vaga (título, #ID, modalidade, responsável), situação, candidatos (+ novos em 7 dias), contratações vs posições, prazo, estado do link e ações (ver, editar, `Mais ações` com clonar / rotacionar link / fechar ou reabrir / arquivar). Faixa salarial e data de criação viram colunas só em telas ≥ 1536 px; abaixo disso o salário compacto aparece na linha da vaga. `GET /api/admin/vacancies` aceita `q` (título ou `#id`, máx. 120 chars) e `status` (`all` | `open` | `closed` | `attention`) e devolve `summary` (`all`, `open`, `closed`, `attention` no escopo antes do filtro de status) + por item `activeToken`, `activeTokenExpiresAt`, `needsAttention`, `candidatesCount`, `candidatesRecentCount`, `hiredCount`. As contagens por vaga rodam só nas linhas da página (CTE materializada + LATERAL). “Precisa de atenção” = vaga aberta com link ausente/expirado ou `target_date` vencida. Busca e filtro ficam na URL (`vacanciesQ`, `vacanciesStatus`).

Na **Equipe**, a lista prioriza identificação e sinais acionáveis; atributos secundários aparecem apenas em telas largas. Recalcular HR Score e excluir ficam em `Mais ações`. A ficha mantém a seção ativa em `section` na URL (`oneOnOne`, `journey`, `compensation`, `dp`, `style`, `history` ou `profile`) e limpa `candidate`/`section` ao fechar, preservando deep links e o retorno ao contexto de trabalho.

O chrome administrativo compartilhado usa `AdminPageHeader`, `AdminListFilters`, `AdminTableShell`, `AdminListPager` e botões `Admin*`. Cabeçalhos reorganizam ações em telas estreitas; tabelas largas preservam comparação por rolagem horizontal; ações usam fonte de interface, foco visível e tooltip nos controles somente por ícone. Não envolva `AdminTableShell` em outra `<table>`: o componente já cria a tabela canônica.

Remuneração é um módulo sensível separado (`compensation.view` / `compensation.manage`). A migration `112_compensation_module_entitlement.sql` mantém o acesso de empresas restritas existentes e separa novas configurações do núcleo geral. Seleção vazia de módulos passa a significar somente `core`; `NULL` permanece apenas como compatibilidade irrestrita legada.
```

---

## Página pública da vaga (`/jobs/{slug}-{id}`)

- URL canônica indexável: `/jobs/{slug}-{id}` (id = `vacancies.id`; JobPosting JSON-LD, Open Graph / Twitter com imagem da marca).
- O link `/v/{token}` continua sendo o **assessment** (noindex; token pode rotacionar).
- Flags na vaga: página pública, permitir indexação, mostrar empresa, mostrar salário.
- Perfil da empresa (admin → Empresas): no modal criar/editar — `website`, texto “sobre”, flag **página pública de carreiras** (`public_profile_enabled`) e **logo** (crop 1:1 + compressão no cliente ≤512 KB / lado ≤768 px; origem até 20 MB; S3 → `logo_url` / `logo_key`). Canônica: `/companies/{slug}` (neutra pt/en). Sem opt-in → 404.
- Índice `/jobs`: busca, filtro de contrato, paginação; rodapé com **alerta de vagas** (`POST /api/public/job-alerts`). Cancelar: `/a/unsubscribe?token=…`. Ao publicar página pública (create ou ligar flag), dispara e-mail aos alertas ativos que casam com filtros — exige SMTP; sem SMTP é no-op e não bloqueia o save.
- Agregadores SEO (automáticos): `/jobs/remote` e `/jobs/city/{slug}` só se houver ≥ `PUBLIC_JOB_AGGREGATOR_MIN_COUNT` vagas indexáveis (default **3**); sem massa → 404. Preencher modalidade/cidade no drawer. Sem JobPosting nestas listas.
- Conteúdo exibido quando existir: título, empresa (logo se houver), tipo de contrato, modalidade/cidade, salário (flag), datas (publicação / `target_date`), descrição, CTA, share.
- Sem campos no schema hoje (omitidos de propósito): senioridade, skills/benefícios separados.
- Encerrada ou `target_date` passado: agradecimento + relacionadas + `/jobs`; sem JobPosting / noindex / sem CTA de apply.
- SEO: `robots.txt` + `sitemap.xml` (só vagas `open`, indexáveis e prazo ok; inclui agregadores que passam o limiar). Crawlers de busca e IA podem descobrir apenas superfícies públicas; painel, APIs, autenticação e links por token continuam bloqueados. `/llms.txt` mantém o inventário verificável do produto.
- Google Indexing API (opcional): `GOOGLE_INDEXING_ENABLED=true` + service account — push ao criar/atualizar/fechar página pública indexável (`lib/job-indexing.js`). Desligado por padrão; falha não bloqueia o save da vaga.
- Atribuição / funil: query `utm_*` e `?ref=` → cookie httpOnly `team30_job_attr` (7 dias, sem PII). Persistido em `assessments.attr_*` no submit da vaga; eventos em `job_funnel_events`. Analytics: `GET /api/admin/vacancies/[id]/analytics`.
- Referral (indicação): tabela `referral_codes`; APIs admin + **aba Indicação** no detalhe da vaga (criar, copiar `/jobs/…?ref=`, desativar, métricas). Analytics: `GET /api/admin/referral-codes/analytics`.
- Logo empresa: `S3_BUCKET` + chaves AWS (ver `.env.example`). Sem S3 o upload fica desligado; páginas públicas usam `logo_url` quando existir (incl. `hiringOrganization.logo` no JSON-LD).

Para upload de logos e PDFs do LMS, a identidade configurada nas credenciais AWS precisa gravar nos dois prefixos usados pelo produto. Exemplo mínimo para o bucket `30team` (inclua `s3:DeleteObject` para permitir substituição e remoção dos arquivos):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "Team30ObjectFiles",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:DeleteObject"],
      "Resource": [
        "arn:aws:s3:::30team/companies/*",
        "arn:aws:s3:::30team/image/logo/companies/*"
      ]
    }
  ]
}
```

Se o nome do bucket ou `S3_KEY_PREFIX` forem diferentes, ajuste os ARNs. Leitura pública ou por CDN é uma configuração separada; não conceda listagem geral do bucket à aplicação.

Migration: `migrations/030_company_profile_public_vacancy_page.sql` (+ `031` default indexável; `032` atribuição/funil; `033` referral; `035` job alerts; `036` `companies.public_profile_enabled`; `037` workplace; `039` logo).

Doc técnica (arquitetura, envs, Indexing, funil, IA, checklist LGPD): [`docs/job-seo-and-distribution.md`](./job-seo-and-distribution.md). Guia do painel: aba **Ajuda**, com busca, atalhos por tarefa, categorias e um artigo por vez. O botão **Como funciona?** no cabeçalho das telas abre diretamente o artigo contextual correspondente. Assistente flutuante de Ajuda (IA): indexa a mesma base do Guia; ver [`docs/help-assistant-knowledge.md`](./help-assistant-knowledge.md).

---

## Relatórios para gestão de RH (Epic B-1100)

A tela **Início → Relatórios** (`/dashboard?tab=analytics`) consolida indicadores acionáveis sobre recrutamento e gestão de pessoas, reutilizando dados já coletados (T1–T9, Motivadores, PDI, clima e turnover). Ela exige `overview.view`, respeita a empresa ativa e não faz leitura cross-tenant.

### Funcionalidades Principais

| Módulo | O que mede | Onde |
|--------|------------|------|
| **Métricas de Efetividade** (B-1101) | Time-to-hire, retenção 6m/12m/24m, time-to-productivity, fit contratados vs pool, aderência rubrica | `/dashboard?tab=analytics` → Métricas |
| **Tendências Temporais** (B-1102) | HR Score médio, risco de saída, clima, PDI e contratações vs desligamentos (últimos 6/12/24 meses) | Relatórios → Tendências |
| **Comparativos** (B-1103) | Duas áreas, com tamanho da amostra e leitura agregada | Relatórios → Comparar |
| **Alertas** (B-1104) | Clima -15%, turnover +20%, vagas >90 dias, HR Score <50, PDI <30% | Digest proativo |
| **Exportação** (B-1105) | CSV para métricas e JSON para tendências | Botão "Exportar dados" |

### API para Integrações Externas (B-1106)

Todas as métricas são expostas via **REST API** autenticada (JWT de gestor):

```bash
# Métricas de efetividade
GET /api/admin/analytics/metrics?startDate=2025-01-01&endDate=2026-08-27

# Tendências (12 meses)
GET /api/admin/analytics/trends?months=12

# Comparar duas áreas
GET /api/admin/analytics/compare?type=areas&areaA=Engineering&areaB=Sales

# Alertas ativos
GET /api/admin/analytics/alerts

# Export CSV
GET /api/admin/analytics/export?format=csv&type=metrics
```

**Rate Limiting:** 100 req/min por usuário  
**Autenticação:** Cookie `team30_session` (JWT)  
**Roles:** `admin`, `direction`, `hr`

As respostas de métricas e tendências incluem `meta.generatedAt`, período e tamanho da amostra. Valores sem amostra são apresentados como indisponíveis no painel. Filtros ficam na URL para sobreviver ao refresh e os cards levam à lista operacional de Vagas ou Equipe. O CI executa o contrato DTOV do Analytics, isolamento multi-tenant e `EXPLAIN` dos hot paths antes de publicar a imagem.

Documentação completa: [`docs/analytics-api.md`](./analytics-api.md)

Aceite do piloto: [`docs/pilot-acceptance-checklist.md`](./pilot-acceptance-checklist.md). Após implantar, rode `PILOT_SMOKE_BASE_URL=https://host npm run release:post-deploy-smoke`; `HEALTH_STATUS_TOKEN` e `PILOT_SMOKE_COOKIE` habilitam as verificações protegidas sem colocar credenciais no comando ou no repositório.

### Performance & Cache

- **HR Score Cache:** TTL 5min em memória (`lib/hr-score-cache.js`)
- **Índices otimizados:** `migrations/061_performance_indexes.sql` (15 índices estratégicos)
- **Monitoring:** Logs estruturados JSON (`lib/monitoring.js`) + métricas in-memory
- **Health Check:** `GET /api/health/metrics` (admin-only) — cache metrics, memory, request counts

### Exemplo: Comparar Fit Contratados vs Pool

```javascript
const response = await fetch('/api/admin/analytics/metrics?startDate=2026-01-01', {
  credentials: 'include',
});

const { metrics } = await response.json();
console.log(`Fit contratados: ${metrics.fitComparison.hiredAvgFit}`);
console.log(`Fit pool: ${metrics.fitComparison.poolAvgFit}`);
console.log(`Delta: +${metrics.fitComparison.delta}`);
```

### Relatórios Agendados (B-1107)

Digest semanal ou mensal automatizado por email:

```bash
# Cron job (adicionar ao crontab ou scheduler)
# Toda segunda-feira às 9h — empresas com frequency=weekly (default)
0 9 * * 1 curl -X POST "https://30team.app/api/cron/analytics-report?frequency=weekly" \
  -H "Authorization: Bearer ${CRON_SECRET}"

# Mensal (1º do mês) — empresas com frequency=monthly
0 9 1 * * curl -X POST "https://30team.app/api/cron/analytics-report?frequency=monthly" \
  -H "Authorization: Bearer ${CRON_SECRET}"
```

Preferências por empresa: **Relatórios** → Relatório agendado (frequência, PDF). Destinatários custom via `PATCH /api/admin/analytics/report-prefs` (`recipientUserIds`). Sem prefs = direction + admin.

**Conteúdo do email:**
- Métricas de efetividade (time-to-hire, retenção, fit)
- Tendências dos últimos 3 meses (HR Score, turnover, clima)
- Alertas ativos (climate_drop, turnover_risk_increase, etc.)
- Link direto para o dashboard

**Destinatários:** automático para todos os `direction` + `admin` da empresa ativa.

**Roadmap:** Webhooks de alertas, PDF anexo, OpenAPI spec, destinatários configuráveis.

---

