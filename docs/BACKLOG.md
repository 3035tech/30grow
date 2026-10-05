# Backlog — 30Grow

Ideias de funcionalidades **ainda não implementadas**.

**Pedidos do RH (testes Maria/Duda):** ver [`docs/BACKLOG-RH-TESTES.md`](./BACKLOG-RH-TESTES.md) (`B-RH1-*` / `B-RH2-*`). Fonte Word: [`docs/30TEAM_Backlog_Consolidado_Observacoes.docx`](./30TEAM_Backlog_Consolidado_Observacoes.docx).

**Benchmark Sólides/RHGestor:** ver [`docs/BACKLOG-BENCHMARK-SOLIDES.md`](./BACKLOG-BENCHMARK-SOLIDES.md). O documento registra a análise crítica dos prints, o modelo organizacional recomendado e os itens `B-ORG-*` para evolução futura. Não implica paridade de funcionalidades com o concorrente.

**Auditoria UI/UX de todas as telas:** ver [`docs/BACKLOG-UI-AUDIT-ALL-SCREENS.md`](./BACKLOG-UI-AUDIT-ALL-SCREENS.md). O inventário `B-UIA-*` mapeia hierarquia, uso de espaço, densidade, navegação, ações, estados e responsividade em todas as superfícies do dashboard, colaborador e fluxos públicos.

**Prioridade de lançamento do MVP:** ver [`docs/BACKLOG-MVP-LAUNCH.md`](./BACKLOG-MVP-LAUNCH.md). A lista aberta `MVP-03`–`MVP-16` separa bloqueadores do primeiro cliente, melhorias para os pilotos e escala condicionada a métricas reais. Os gates `MVP-01` e `MVP-02` foram entregues.

## Como usar (humano + agente)

| Ação | O que fazer |
|------|-------------|
| Nova ideia | Usuário pede → agente **adiciona** item (id estável + instruções) |
| Implementada | Ao entregar → **remover** o item deste arquivo (não riscar) |
| Em andamento | Mover para “Em andamento” com nota de branch/PR se houver |
| Epic grande | Manter sub-itens; ao fechar um sub-item, apagar só ele; apagar o epic quando todos os filhos sumirem |

Não usar para bugs pontuais. Aqui só **produto / capacidade nova**.

**Antes de implementar qualquer item:** ler `AGENTS.md`, reutilizar o que já existe, rodar Dev → Test → Validate, atualizar README/Guia quando houver uso novo. Mapa do que **já existe:** [`docs/PRODUCT-FEATURES-PROMPT.md`](./PRODUCT-FEATURES-PROMPT.md).

---

## Diferenças (30Grow vs produtos típicos) — base do epic B-400

Gerado a partir do mapa de features atuais (ago/2026). **Não** copiar feature de concorrente se já cobrimos o job-to-be-done com T1–T9 + Motivadores + compat.

| Família de produto | O que costumam ter | 30Grow hoje | Gap / oportunidade |
|--------------------|--------------------|-------------|--------------------|
| **ATS** (Gupy, Greenhouse, Lever) | Pipeline custom, CV/LinkedIn, scorecards, calendário, oferta | Pipeline + kanban + notes + scorecard leve + pool + /j SEO + /r | Fechado no escopo B-400 (sem virar ATS genérico) |
| **Assessment puro** | Bateria própria + PDF + benchmarks | T1–T9 + Motivadores + rubrica + PDF briefing + print /r | Aprofundar Eneagrama e Motivadores sem adicionar outro instrumento |
| **People / engajamento** | Ciclos de review, engajamento | 1:1 + hipóteses + retention + digest + kit hire + 360 + 9Box | Calibração / OKR / ouvidoria → **B-3000** |
| **Team analytics** | Heatmaps, org chart | Compat / Grupos / Overview heat T1–T9 | Organograma visual → **B-3006** |
| **Carreiras / employer brand** | Portal rico | `/j` + `/c` + funil | OK |
| **Cliente / consultoria** | Portais white-label | `/r` + print/PDF | OK |
| **Suíte RH+DP** (Sólides, InCicle, Taggui) | Ponto/folha/admissão + desempenho | DP leve (férias/docs) + GP estratégico no mesmo login | Folha/ponto → **B-2721+**; unificar, não Tangerino |
| **Suíte performance pura** (TeamCulture, Qulture, Alina, ImpulseUp) | OKR, 1:1, calibração, SSO; **sem** DP | 1:1, 360, 9Box, PDI, clima, HR Score, radar, LMS | OKR/calibração/mapa salarial/RV → **B-3000** |

**Princípio de prioridade:** empacotar o que já medimos > fechar fricção no funil RH > novos scores ou instrumentos.

**Explicitamente fora:** conta de candidato; merge por nome; segundo hub paralelo a `candidates`; projetos/Gantt/chat/TV/lojinha (amplitude InCicle); segundo instrumento comportamental. DP → **B-2700**. Gaps vs 7 players (ago/2026) → **B-3000**.

---

## Aberto — Epic B-400 (empacotar perfil + fechar gaps)

_(entregue — B-401–B-412: print briefing, kit hire, fit vs núcleo, grupos salvos, digest, aging, scorecard, pool, clonar vaga, overview heat, lote Motivadores, print `/r`.)_

---

## Aberto — Epic B-500 (PDI + clima)

_(entregue — estrutura 042 + B-501–B-506 + polish UX/indicadores/visões: progresso PDI, barras clima, pulse Overview, benchmark com Δ.)_

---

## Aberto — Epic B-600 (assessment → ação)

_(entregue — B-601–B-605 + polish: revisão retenção na UI, leitura hedged do pulso, prep `/e`, Guia passo a passo.)_

---

## Aberto — qualidade / testes

- **B-I18N-01 · Revisão nativa fr-FR / de-DE.** Catálogos e landing gerados por `npm run i18n:translate`. Revisar termos de RH, tom formal (vous/Sie) e textos longos do Guia; corrigir direto em `lib/i18n/catalogs/fr-FR.js`, `de-DE.js` e `lib/i18n/landing/*`.
- **B-I18N-02 · Conteúdo por idioma além de pt/en.** Perguntas/tipos/escala do Eneagrama (`lib/i18n-data.js`, `lib/data.js`, `lib/type-en.js`), banco e templates de Motivadores (`lib/ae/*`), prompts de IA e PDFs usam `contentLocale` (fr/de/es caem em inglês). Traduzir exige validação psicométrica das perguntas antes de trocar o texto.
- **B-I18N-03 · Documentos legais em fr/de/es.** `lib/public-legal.js` só tem pt/en; tradução precisa de revisão jurídica.

---

## Aberto — Epic B-100 (SEO / distribuição pública)

_(entregue — ver `docs/job-seo-and-distribution.md`. Inclui agregadores B-119 e logo empresa via S3.)_

### B-120 — Página `/c` mais rica (carreiras da empresa)
_(entregue — hero logo+nome+CTA, breadcrumb `/j` → empresa, meta local/faixa/prazo nos cards, “sobre” com RichTextEditor no admin. Filtros leves / JSON-LD Organization ficam fora deste corte.)_

---

## Aberto — performance (audit dashboard)

### B-2800 — Hot-path performance (Perf-A + Perf-B + Perf-C) ✅ ENTREGUE

Sprint de escala sem rewrite: batch HR Score + núcleo único; `LIMIT`/página em candidatos da vaga; compat top-N pairs no payload; bloquear admin `company=all` em Overview/Compat; Overview sem LATERAL por vaga aberta (stats em batch nas 8 listadas); Turnover scan cap 500 + flag `truncated`; `area_stats` sem write-on-read no dashboard; caps job-roles/`forSelect`/leadership; ranking vaga cap 200; histograma T1–T9 só em Compat/Overview (Equipe só `COUNT`).

### B-2801 — Performance P2 (medir + EXPLAIN + baseline) ✅ ENTREGUE

Baseline documentada (`docs/performance-hotpaths.md`): SSR por aba, caps, export stream, `PG_POOL_MAX`, índices `006`/`061`. `measureAsync` nos hot paths + breadcrumb Sentry em slow; `npm run dtov:explain` (`scripts/explain-hotpaths.js`) para checklist EXPLAIN no DTOV.

### B-2802 — Performance P3 (colaborador + gaps restantes) ✅ ENTREGUE

Home/`/e` em paralelo + PDI batch; inbox de pesquisas com batch invite (sem N+1); jornada GET sem ensure; clima aggregate SQL; sucessão batch; HR Score cache wired; caps assessments/timeline; LMS lessons `ROW_NUMBER` cap; `notifyCandidates` unnest; crons em chunks paralelos; índice trigram `079`; mail retry; Cache-Control em links públicos + health. Detalhe: `docs/performance-hotpaths.md`.

### B-2803 — Varredura de performance (navegação / carregamento / salvamento) ✅ ENTREGUE

i18n por chunk de locale (`I18nBoot`), lazy de tour/wizard/radar/Sentry Replay, sessão do gestor 4→2 idas ao banco, proxy sem self-fetch em `/api/*`, loader do dashboard em paralelo (+ página da Equipe especulativa), sucessão em 1 query, fan-out limitado (`lib/concurrency.js`), saves sem skeleton (Equipe/LMS/DP/PDI/OKR), kanban otimista, clima sem waterfall, migration `138` (índices de hot path). Polish: etapa em lote na Equipe confere cada resposta (falhas ficam selecionadas, até 4 em paralelo); exclusão de convite concluído em transação única, sem leitura em réplica logo após o delete e sem apagar `results` legado (global, sem tenant) fora de `LEGACY_RESULTS_WRITE=true`. Detalhe: `docs/performance-hotpaths.md` § Varredura.

### B-2804 — Performance: pendências da varredura (escopo maior)

1. **Banco de horas calculado em escala**: `computeHourBankBalances` refaz extras − faltas desde o início do banco a cada leitura (custo ∝ pessoas × dias). Para empresas grandes ou bancos antigos, partir do último saldo congelado no fechamento (`time_clock_closure_balances`) e só recalcular os dias abertos.
2. **Publicar ciclo de avaliação formal**: ~20 queries por avaliação dentro de transação com lock; reescrever em set-based (raters `INSERT … SELECT`, um `UPDATE` por ciclo) + endpoint de matriz de respondentes para a confirmação (hoje N GETs no cliente).
3. **Trocar questionário do ciclo**: DELETE + INSERT por item por rascunho → `INSERT … SELECT … CROSS JOIN unnest(...)`.
4. **HR Score em lote**: `detectTrendChange` recalcula o radar por pessoa (reusa sinais já carregados em batch); `saveHrScore` em upsert `unnest`.
5. **OKR hierarquia**: carrega áreas/atividades/assignees só para derivar ids; caps aplicados em JS; joins O(n·m) com `filter`.
6. **Navegação client-only** para abas que buscam os próprios dados (Vagas, Usuários, LMS, OKR, Clima, PDI): hoje cada troca passa pelo loader SSR antes do fetch da aba.
7. **Overview**: 8+ cards com fetch próprio após o SSR; avaliar dobrar resumos baratos em `buildOverviewMetrics`.
8. **Notificações**: endpoint só de contagem para o polling (lista só ao abrir o dropdown), leitura em `queryRead`.
9. **`DISTINCT ON` por empresa** (behavioral intel, liderança, cultura): dirigir por `candidates` + `LATERAL … LIMIT 1`.
10. **Convites em lote de clima/pulso**: validação por convite + SMTP síncrono no request.
11. **Purge de `candidate_notifications`** (gestor já tem `purgeOldManagerNotifications`).

### B-202 — (opcional) caps/API restantes do audit
_(fechado como “monitorar prod” — sem gap aberto claro.)_ Já entregue: vac-n1 LATERAL, export cap, purge batches, AE analytics sample, notify unnest, email unique idx (025), compat/leadership caps, indexes `061`. Reabrir só com evidência de produção.

---

## Aberto — Epic B-300 (acionar perfil)

_(entregue — B-301 briefing Equipe, B-302 briefing na vaga, B-303 notif `retention_watch`, B-304 composição do núcleo em Grupos.)_

---

## Aberto — Epic B-700 (pós-hire leve)

Escopo **deliberadamente estreito** vs “jornada completa” (LMS/AVD/desligamento ficam fora).

_(entregue — B-701 check-ins D30/D60/D90; B-702 checklist D1; B-703 proposta/aceite mínimo no funil; jornada contínua na Equipe via `HireJourneyBlock`.)_  
**Fora deste epic:** trilhas LMS, avaliação 360/AVD, desligamento formal, portal colaborador full.

---

## Aberto — Epic B-900 (Overview → decisão)

Sprint **A** entregue (atenção scorecard + hire gaps, digest, hireGapsChip).  
Sprint **B** entregue (B2 Fit na vaga, B8 nucleus fit no briefing, B9 preencher /r do briefing).  
Sprint **C** entregue (C1 mix×rubrica, C4 motivo×tipo, C5 temas clima, C10 concern∩retenção).

_(epic fechado — itens A/B/C entregues.)_

---

## Aberto — Epic B-1000 (plataforma GP sem DP)

Pedido (ago/2026): completar o ciclo **módulos geram → núcleo transforma → inteligência volta como decisão**, **sem** o Módulo 2 (DP). Hub continua `candidates`. Reusar o que já existe; não reconstruir ATS, PDI, clima, Motivadores nem Overview.

**Fora do epic B-1000 na época (DP):** admissão documental, GED, ponto, férias, holerite, app folha/ponto. Absenteísmo no radar ficou de fora até haver fonte DP. **Agora rastreados em B-2700** (DP **B-2721–B-2727**, benefícios clube **B-2731**) — um produto/login, não segundo app tipo Tangerino.

**Já coberto (não reimplementar):**

| Bloco da arquitetura | 30Grow hoje |
|----------------------|-------------|
| M1 Portal / funil / perfil | `/j` `/c` `/v` `/t`, pipeline, rubrica, T1–T9, Motivadores, Fit, `/r` |
| M3 PDI + jornada leve | PDI, 1:1, check-ins D30/D60/D90, `/e`, seed concern→PDI |
| M4 Clima + retenção parcial | `/clima`, pulso `/pulso`, `retention_watch` (Motivadores) |
| Núcleo parcial | Overview, núcleo T1–T9 do time (`company-nucleus`), intel comportamental, Fit vs núcleo |

**Sinal DP (parcial):** absenteísmo leve no Overview a partir de atestados (`sick`, aprovados/taken) nos últimos 90 dias. Radar/HR Score ainda não reponderam pesos por absenteísmo.

### Ordem de entrega (conectar antes de expandir)

1. **B-1001 — Núcleo HR Score + predições** (liga os módulos)
2. **B-1002 — Radar de rotatividade multi-sinal** (M4; alimenta o núcleo)
3. **B-1003 — Engenharia de cargos leve** (M1; cargo → rubrica/fit)
4. **B-1004 — Avaliação de desempenho + metas → PDI** (M3; gap vira plano)
5. **B-1005 — Plano de sucessão** (M3; usa HR Score + prontidão)
6. **B-1006 — Análise demissional** (M4; fecha o loop seleção/gestão)
7. **B-1007 — Cultura organizacional** (M4; leitura hedged, não survey isolada)
8. **B-1008 — Academy leve** (M3; trilhas/ações ligadas ao PDI — **não** LMS)
9. **B-1009 — Benefícios (catálogo leve)** (M4; **não** clube/folha)

### B-1001 — Núcleo: HR Score + predições ✅ ENTREGUE

_(migration 054 + lib/hr-score.js + APIs + UI Equipe/Overview)_ Consolida 7 sinais em score 0–100. Predições: risco, gaps PDI.


### B-1002 — Radar de rotatividade (multi-sinal) ✅ ENTREGUE

_(lib/turnover-radar.js + API `/api/admin/turnover-radar/company` + TurnoverRadarCard UI)_ Calcula risco de turnover (low/medium/high) consolidando 4 sinais críticos: clima (30%), retention Motivadores (30%), PDI atraso/concern (25%), check-ins concern (15%). Lista top at-risk na Overview com drill-down por sinal. **Polish P-1020:** notificação `turnover_risk_change` ao piorar (hook em `recalculateCompanyScores` / GET HR Score); links Equipe com `candidate=` + filtro `filter=turnover_risk`.

### B-1003 — Engenharia de cargos leve ✅ ENTREGUE (UI+rubric+FK wired)

_(migration 055 + lib/job-roles.js + APIs REST + i18n + JobRolesAdminTab drawer/RubricEditor + vacancies.job_role_id on create/update)_ Tabela `job_roles` com rubrica T1-T9. Vagas herdam cargo via FK `job_role_id` (persistido no create e no PATCH). CRUD completo (list, create, update, deactivate). UI admin com `AdminRichFormDrawer` + `RubricEditor`; prévia compacta da rubrica ao selecionar cargo na vaga.

### B-1004 — Avaliação de desempenho + metas → PDI ✅ ENTREGUE

_(migration 056 + lib/performance-reviews.js + APIs + UI PerformanceReviewsAdminTab)_ Ciclo leve (gestor → colaborador; não 360). Metas no ciclo com outcome (`met`, `exceeded`, `develop`, `not_met`). Outcome `develop` gera item PDI automaticamente com `source: 'performance_review'` e `performance_goal_id`. Tabelas `performance_cycles`, `performance_goals`, `performance_reviews`. UI admin de ciclos + review form (draft → submitted).

### B-1005 — Plano de sucessão ✅ ENTREGUE

_(migration 057 + lib/succession-plans.js + APIs + UI SuccessionAdminTab)_ Papéis críticos (`critical_roles`) com sucessores (`succession_plans`) + prontidão (`not_ready`, `developing`, `ready`, `now`). Readiness score combina HR Score (70%) + Leadership Potential (30%). Integra com `lib/hr-score.js` e `lib/leadership-analytics.js`. UI admin de papéis críticos + contador de sucessores.

### B-1006 — Análise demissional ✅ ENTREGUE

_(migration 058 + 065 enums ampliado + lib/exit-analysis.js + APIs + UI ExitAnalysisAdminTab + ExitInsightsCard no Overview)_ Registro de saída (`exit_records`) com tipo (voluntary/involuntary/mutual), motivo (**taxonomia fechada multi-segmento** em `EXIT_REASON`) e notas. Agregação por motivo × tipo T1–T9 × área. Insights M1/M3/M4 (compensação/benefícios, fit, gestor, carga/burnout, carreira, desempenho). Card no Overview com % e sugestões hedged. Motivo/tipo **não** são cadastrais por empresa.

### B-1007 — Cultura organizacional ✅ ENTREGUE

_(lib/organizational-culture.js + API `/api/admin/organizational-culture` + CultureInsightsCard no Overview)_ Leitura hedged a partir de clima + mix T1–T9 + pulso + valores declarados (`companies.about_html`). Síntese automática em categorias (climate, type_mix, pulse, alignment) com força (strong/medium/high concern) e hedging. Card no Overview com resumo (health overall, dominant archetype) + drill-down para insights detalhados. Sem segundo instrumento, apenas consolidação de dados existentes.

### B-1008 — Academy leve (não LMS) ✅ ENTREGUE

_(migration 059 + lib/learning-resources.js + APIs + LearningResourcesAdminTab)_ Catálogo simples de recursos de aprendizagem (título, descrição, tema, tipo, URL, duração). Tipos: course, article, video, book, workshop, mentoring, other. PDI pode linkar recursos via `development_plan_resource_links` (muitos-para-muitos) ou referenciar no texto. Sem player, sem SCORM, sem acompanhamento de progresso — apenas catálogo de ações/trilhas que o gestor pode apontar no plano de desenvolvimento.

### B-1009 — Catálogo de benefícios (não clube/folha) ✅ ENTREGUE

_(migration 060 + 062 categorias + 065 enums ampliado + lib/company-benefits.js + APIs + CompanyBenefitsAdminTab)_ Catálogo simples de benefícios da empresa (nome, descrição, **categoria cadastral por empresa**, tipo enum multi-segmento) para contexto de retenção/oferta. Tipos fechados em `BENEFIT_TYPE` (saúde, PLR, home office, cesta, etc. + other). Sem adesão, sem desconto em folha, sem "clube". CRUD com filtros por categoria.

---

## Epic B-1100 (Analytics avançado) — ✅ 100% COMPLETO

Transformar dados comportamentais em **inteligência acionável** para decisões estratégicas de RH. Foco: métricas de efetividade, tendências, comparativos e alertas proativos.

**Progresso:** 7/7 features entregues (100%)

**Princípios:**
- Reusar dados já coletados (T1–T9, Motivadores, PDI, clima, turnover)
- Export estruturado (não só CSV genérico)
- Dashboards focados em **decisão**, não vanity metrics
- Alertas baseados em thresholds (não só notificação pontual)

**Fora deste Epic:** BI genérico (Metabase/Looker embed), data lake, ML custom, dashboards 100% customizáveis pelo usuário final.

### B-1101 — Métricas de efetividade (hiring ROI) ✅ ENTREGUE

_(lib/analytics-metrics.js + API /api/admin/analytics/metrics + AnalyticsTab UI)_ 

Dashboard com métricas de **impacto real** do processo seletivo:
- **Time-to-hire** (dias: vaga aberta → contratação)
- **Time-to-productivity** (dias até HR Score > 60 ou primeira review positiva)
- **Custo-por-contratação** (opcional: campo manual)
- **Taxa de retenção** (% contratados que ficam 6m/12m/24m)
- **Fit médio contratados** vs **fit médio pool**
- **Aderência rubrica** (fit T1–T9 contratados vs expectativa da vaga)

**Onde:** nova aba **Analytics** no dashboard (ou sub-aba da Overview)

**Saída:**
- Cards com número + Δ período anterior
- Gráfico de tendência (últimos 6/12 meses)
- Drill-down por vaga/área/gestor
- Export de métricas

**Reuso:**
- `vacancies` (created_at, deadline)
- `candidates` + `hire_date` (já existe via B-700)
- `hr_scores` (B-1001)
- `assessments` + rubrica da vaga
- `vacancy_links` (funil)

### B-1102 — Tendências temporais (time series) ✅ ENTREGUE

_(lib/analytics-trends.js + API /api/admin/analytics/trends + UI com toggle Tendências)_

Gráficos de **evolução ao longo do tempo** (últimos 6/12/24 meses):
- HR Score médio do time (mensal)
- Turnover risk (% alto risco, mensal)
- Clima médio (mensal)
- PDI completion rate (mensal)
- Contratações × desligamentos (mensal)

**Onde:** aba Analytics, sub-seção "Tendências"

**Saída:**
- Line charts (últimos 12/24 meses)
- Marcadores de eventos (ex: "ciclo de review Q2")
- Filtro por área/grupo
- Export PNG/CSV

### B-1103 — Comparativos (área, período, rubrica) ✅ ENTREGUE

_(lib/analytics-comparisons.js + API /api/admin/analytics/compare + UI com toggle Comparar)_

**Comparar** métricas entre segmentos side-by-side:
- Área A vs Área B (clima, HR Score, turnover)
- Período A vs Período B (antes/depois de ação)
- Rubrica A vs Rubrica B (fit médio, retenção)
- Gestor A vs Gestor B (time-to-hire, retenção)

**Onde:** aba Analytics, sub-seção "Comparativos"

**Saída:**
- Tabela side-by-side
- Bar chart comparativo
- Testes de significância (opcional: t-test se N > 30)
- Export

### B-1104 — Alertas e anomalias ✅ ENTREGUE

_(lib/analytics-alerts.js + API /api/admin/analytics/alerts)_

**Detecção proativa** de padrões anormais com thresholds configuráveis:
- Clima caiu > 15% em 1 mês (área/empresa)
- Turnover risk subiu > 20% em 1 trimestre
- Time-to-hire > 90 dias (vaga específica)
- HR Score médio < 50 (área)
- PDI completion < 30% (empresa)

**Onde:** notificações in-app + email digest

**Saída:**
- Alerta com contexto (o quê mudou, onde, quando)
- Link para drill-down
- Sugestão de ação (ex: "Revisar clima na área X")

**Reuso:** `manager_notifications` (já existe), novo tipo `ANALYTICS_ALERT`

### B-1105 — Export estruturado (JSON/Excel) ✅ ENTREGUE

_(lib/analytics-export.js + API /api/admin/analytics/export)_

Export **rico** além do CSV básico:
- JSON (API-friendly, estruturado)
- Excel com múltiplas abas (overview, detalhes, gráficos)
- Filtros aplicados no export (não dump completo)

**Onde:** botão "Export" em cada visão de Analytics

**Saída:**
- Arquivo baixável
- Metadados (período, filtros, gerado em X)
- Formato escolhido pelo usuário (CSV/JSON/XLSX)

**Reuso:** `lib/export-assessments-csv.js` (já existe), estender

### B-1106 — API de métricas (externas/integrações) ✅ ENTREGUE

_(lib/analytics-rate-limit.js + aplicado em todas as 5 rotas + docs/analytics-api.md)_

API REST autenticada (JWT) para expor métricas:
- `GET /api/admin/analytics/metrics` (HR Score, clima, turnover)
- `GET /api/admin/analytics/trends` (time series)
- `GET /api/admin/analytics/compare` (segmentação)
- `GET /api/admin/analytics/alerts` (anomalias)
- `GET /api/admin/analytics/export` (JSON/CSV)

**Implementado:**
- ✅ Autenticação JWT de gestor (mesmo padrão `/api/admin/*`)
- ✅ Rate limiting (100 req/min por user_id)
- ✅ Headers HTTP (`X-RateLimit-*`, `Retry-After`)
- ✅ Documentação completa (endpoints, exemplos cURL/JS/Python)
- ✅ Multi-tenant isolado por `company_id`

**Uso:** integrações com BI externo (Metabase, Looker), automações, Slack, webhooks

### B-1107 — Relatórios agendados (email/PDF) ✅ ENTREGUE

_(lib/analytics-scheduled-reports.js + API /api/cron/analytics-report)_

**Envio automático** de relatórios de Analytics:
- Weekly/monthly digest com métricas de efetividade inline
- HTML responsivo (não requer PDF reader)
- Tendências (últimos 3 meses): HR Score, turnover, clima
- Alertas ativos destacados (severity high/medium/info)
- Destinatários automáticos: `direction` + `admin` da empresa
- Multi-idioma (pt-BR / en)

**Implementado:**
- ✅ Email HTML inline (métrica cards, trend table, alerts)
- ✅ Cron job (`POST /api/cron/analytics-report`)
- ✅ Rate: processa até 50 empresas/execução
- ✅ Reutiliza estrutura de `manager-weekly-digest`
- ✅ CTA direto para `/dashboard?tab=analytics`

**Uso:** cron semanal (`?frequency=weekly`) ou mensal (`?frequency=monthly`). Preferências por empresa: frequência, destinatários (user ids) e anexo PDF (`company_analytics_report_prefs`, migration `064`; UI em Analytics).

_(B-1107 polish entregue — prefs + PDF simples sem puppeteer + filtro de frequência no cron.)_

---

## Aberto — Epic B-1200 (conectar + UX + signup + profundidade)

_(entregue — B-1201–B-1204: Overview attention ← PDI/clima/sucessão/onboarding; hire-kit + benefícios; PDI↔Academy; sidebar agrupado; EmptyState CTAs; tour `#*-tab`; fit strip com contribuições.)_

**Fora deste corte (permanece fora):** LMS, folha, DISC, conta de candidato, segundo design system.

---

## Aberto — Assistente de Ajuda (escopo estrito)

_(entregue — B-1301: gate pré-FAQ/LLM + recusa i18n `offTopic`/`offTopicAgain`; pós-LLM `helpAnswerLooksOffTopic`; system prompt reforçado; tip Guia `tipsStep12`.)_

---

## Aberto — Epic B-2600 (diagnóstico operacional com IA)

Copiloto no painel para perguntas do tipo **“por que o João não aparece na minha lista?”** — não misturar com o assistente de Ajuda (só Guia).

**Princípios (obrigatório):**
- Escopo sempre pelo **`company_id` da sessão** (JWT / CAP); nunca confiar no texto do usuário para tenant; admin só com empresa selecionada.
- **Sem SQL gerado pelo LLM** — tool calling sobre funções tipadas em `lib/` (`queryRead`, parametrizado, `LIMIT`/caps).
- Somente leitura; audit de acesso; rate limit; sem vazar PII além do que o gestor já pode ver na tela (respeitar CAP, ex. remuneração).
- IA só **redige** a resposta a partir do JSON do diagnóstico (hedged); não “adivinha” nem escreve no banco.

### B-2601 — Diagnóstico “por que não vejo X?” (MVP Equipe) ✅ ENTREGUE
**Entregue (UX+API MVP):** `lib/people/list-absence-diagnostics.js` (razões: no_match / homonyms / wrong_roster / alumni / soft_filters / no_assessment) + `POST /api/admin/help-diagnose` (`withAdminApi`, CAP `team.view`, rate limit, audit) + CTA “Por que não aparece?” na Equipe (EmptyState quando busca vazia) via `useAppFeedback` notice/confirm. Guia `panel.help.teamStep7`. Sem SQL gerado por LLM.

**Depois do MVP (não bloquear):** mesmo padrão para Vagas/pipeline e Banco de talentos; redação IA hedged sobre o JSON (epic B-2600).

---

## Aberto — Epic B-2700 (controle de custo de IA)

Teto por empresa, registro de tokens/custo, kill switch, fornecedor/modelo configuráveis e cache. Análise completa (estado atual, estimativa de custo, recomendação de fornecedor e itens B-2701–B-2706): [`docs/BACKLOG-AI-COST-CONTROL.md`](./BACKLOG-AI-COST-CONTROL.md).

---

## Aberto — Logo da empresa (UX de upload)

_(entregue — B-1401: crop 1:1 + compressão cliente ≤512 KB / lado ≤768 px; origem até 20 MB; servidor mantém MIME+tamanho.)_

## Aberto — Controles de formulário (primitivos)

_(entregue — B-1402 tokens + B-1403 migração dos selects ad hoc: page-size, pipeline Equipe, reject reason, grupos, signup, recommendation relatório; `S.selectCompact`.)_

---

## Aberto — Tema / layout dark

### B-1501 — Dark mode completo e confiável _(usable no painel — follow-ups)_
Toggle + `.dark` + tokens Tailwind estão **usáveis no dashboard** (cards `S.card`/`bg-surface`, borders ink, sidebar/drawer mobile, dialogs, tabelas, `bg-white/*` leftovers, `--canvas-alt`). Não reescrever `theme.js` `C.*` globalmente.

**Corrigido nesta passagem (polish #12):**
1. Pipeline kanban: `PIPELINE_STAGE_COLORS_DARK` + `getKanbanStages(locale, { isDark })` (Equipe + Vagas) — texto/borda legíveis no dark.
2. Charts/meters: classes `ui-meter-track` / `ui-meter-fill` / `ui-analytics-bar` + regras em `dark-mode.css` (track mais forte, fills saturados/brilhantes).
3. Chrome: remapeamento extra de `bg-white` no dashboard + Help overlay leftovers.
4. `ContentEnter` sem `transform` (só opacity) — popup nativo de `<select>` no Safari/macOS deixa de desalinha sob o wrapper das abas; `.ui-select` reforça chevron no dark.

**Fechado (set/2026):** impressão/PDF sempre claros (`dark-mode.css` só em `@media screen` + troca no `beforeprint`); fluxos públicos (`/t`, `/v`, `/jobs`, assessment, `/r`…) sem trava light: seguem a escolha salva ou, sem escolha, o `prefers-color-scheme` do aparelho (`lib/theme-mode.js`). Preferência só é gravada ao clicar no toggle.

**Ainda aberto:**
1. Atmosfera do `/login` (glow radial) no dark.
2. Revalidar anti-flash após mudanças grandes de chrome.

**Fechado neste corte:** chips T1–T9 / Compare (`TypeBadge` + `typeChipSurfaceStyle` / `typeScoreCellStyle` + classes `ui-type-*` no dark).

**Fora:** segundo tema custom por empresa; modo “auto” OS no painel (só nos fluxos públicos, que não têm toggle).

---

## Aberto — Epic B-1900 (gaps do roteiro cliente oculto × 30Grow)

_(entregue — B-1901 dossier Equipe; B-1902 complementaridade/tensão Overview+Grupos; B-1903 workbench multi-sinal Overview; B-1904 IA interpretativa hedged em dossier/tensão/workbench. Ver Guia `b1900Packaging`.)_

---

## Aberto — Epic B-2000 (aprofundar módulos “leves”)

_(entregue — B-2001 radar `actions[]`; B-2002 Performance↔1:1 CTA; B-2003 PDI sugestões Academy; B-2004 Cultura snippet+CTAs; B-2005 Sucessão/Exit CTAs; B-2006 Banco talentos abrir pessoa + filtro T1–T9. Ver Guia `b2000LightDepth`.)_

Profundidade **média** entregue: conectar e enriquecer o que já existe — **sem** LMS, DISC, ATS ou portal colaborador full.

**Fora (permanece):** feedback formal contínuo tipo Feedz; taxonomia de valores; LMS com conclusão; convite Motivadores em massa.

---

## Aberto — Epic B-2100 (UX / consistência — rápido)

_(entregue — B-2101 empty states CTA + copy nos B-1000; B-2102 Vagas chrome `AdminEdit`/`AdminDelete`; B-2103 dark `bg-surface` leftovers + Analytics sem `C.*` em texto; B-2104 Guia `demoRoteiro` 7 passos. Ver Guia `demoRoteiro`.)_

Corte **rápido/barato**: consistência de chrome e dark no painel + roteiro demo no Guia. **Sem** forçar tabela em Vagas; print/público continuam light-first (resto em B-1501).

---

## Aberto — Epic B-2200 (roster empty + Overview lazy + busca em grids)

_(entregue — B-2201 `RosterEmptyHint` em Equipe/Compat/Comparar/Grupos/Liderança; B-2202 Overview “Sinais operacionais” lazy (fetch só ao expandir); B-2203 busca por nome em Cargos/Avaliações/Sucessão/Exit/Academy/Benefícios + Empresas `q` API.)_

### Epic B-2300 — Aniversários ✅ ENTREGUE
_(entregue — `candidates.birth_date` + `companies.anniversary_date` (`066`); tempo de casa = `candidates.start_date` (hire); card Overview `BirthdaysCard` + `GET /api/admin/upcoming-anniversaries`; Equipe edita nascimento; Empresas edita aniversário institucional; seed demo/eval com datas na janela.)_

### Epic B-2400 — LMS básico ✅ ENTREGUE (MVP)
_(entregue — `067` `lms_courses` / `lms_lessons` / `lms_enrollments` / `lms_lesson_completions`; menu LMS → Cursos; matrícula; progresso no `/e`. **Fora:** quiz, certificado, SCORM, player, login colaborador. Academy continua catálogo PDI separado.)_

### Epic B-2401 — LMS próximo corte ✅ ENTREGUE
_(entregue — `068` turmas/prazo/obrigatório + `development_plan_lms_links`; matrícula em lote (todos/grupo); PDF S3; reordenar/editar aulas; reset/desmarcar; notifs enrolled/overdue/completed; Overview/Equipe atraso; PDI↔curso com matrícula opcional e auto-done no PDI ao concluir; cron `lms-overdue-notifications`; resumo ops no curso. **Fora ainda:** quiz, certificado, SCORM, trilha multi-curso.)_

### Epic B-2500 — Login colaborador + sessão LMS ✅ ENTREGUE
_(entregue — `069`/`070`/`071`; set-password; hub; chrome tema/idioma/notif; perfil + senha; `candidate_notifications`; LMS enroll/overdue → inbox colaborador.)_

### Epic B-2501 — Sessão colaborador + packaging consultoria ✅ ENTREGUE (corte 2)
_(migration `077`; prep 1:1 em `/employee`; clima/pulso autenticado + histórico; playbooks operacionais por persona no dashboard; `/r` com templates técnica/liderança/operacional + riscos de composição na shortlist. **Ainda fora:** folha/ponto/docs completos (DP).)_

### Epic B-2510 — Remuneração interna leve ✅ ENTREGUE
_(migration `072`; `employee_compensation_events`; Equipe → aba Remuneração; salário vigente + timeline; import da oferta aceita; alumni só leitura. **Não** é folha/holerite/ponto.)_

### Aberto — Epic B-2501 (resto)
~~Ideias ainda abertas pela sessão (não `/e` token):~~
~~1. **Prep 1:1 na sessão** — nota ao gestor sem depender do `/e`.~~
~~2. **Clima / pulso autenticado** — responder pesquisas logado + histórico.~~
3. **Fora ainda neste epic:** DP completo — ver **B-2721+** no epic B-2700; remuneração interna leve entregue em B-2510; não misturar com `users` role.

_(Itens 1–2 entregues no corte 2 B-2501 + playbooks + `/r` consultoria.)_

---

## Aberto — Epic B-2700 (gaps vs Sólides — ago/2026)

Fonte: varredura pública [solides.com.br](https://solides.com.br) (home, soluções, planos, ponto/folha/Profiler/benefícios/NR-1). Marketing ≠ produto logado; preços por colab são sinais de terceiros.

### Já cobrimos (job-to-be-done — **não** reabrir como cópia Sólides)

| Família Sólides | 30Grow hoje |
|-----------------|-------------|
| ATS leve (portal, funil Kanban, banco, carreiras `/jobs` `/companies`, indicação, share UTM) | Vagas + pipeline + Talent Bank + SEO + referral |
| Match vaga × pessoa | Rubrica T1–T9 + Fit + ranking (sem “triagem de CV por IA”) |
| Engenharia de cargos | `job_roles` + rubrica herdada na vaga |
| Matcher / comparar pessoas | Compat + Comparativo + intel comportamental |
| Gestão comportamental (fio condutor) | **T1–T9 + Motivadores** como instrumentos canônicos |
| App colaborador leve | `/employee` + `/e` hoje; folha/ponto no app → ondas DP **B-2721+** |
| Benefícios (catálogo) | Company benefits hoje; cartão/marketplace → **B-2731** |
| People analytics | Analytics B-1100 + Overview + digests |
| IA assistida | Help + interpretativa hedged + workbench (não “40+ agentes” nem Folh.AI ainda) |

**Cunha estratégica:** Sólides vende “all-in-one” com **dois logins** (RH × Tangerino/DP). Ao aprofundar DP, preferir **um produto / um `candidates` / um login** — não repetir a dívida de aquisição.

### Ordem sugerida (ondas)

1. GTM + fricção ATS/engajamento (**B-2701–B-2716**)
2. DP em fatias (**B-2721–B-2730**) — ponto → férias/banco → docs/admissão → folha/eSocial por último
3. Benefícios “clube” / cartão (**B-2731**) e NR-1 (**B-2714**) conforme demanda regulatória/parceiro

### Gaps — itens abaixo

### B-2701 — Empacotamento / preço público (GTM) ✅ ENTREGUE
`/pricing` + landpage/signup links; planos early-access + add-ons “em breve”; Guia `panel.help.pricing*`.

### B-2702 — eNPS (pulse de engajamento) ✅ ENTREGUE
`question_kind=enps` (0–10 → −100…+100); Overview + ClimateTab; migration `080`.

### B-2703 — Matriz 9Box (performance × potencial) ✅ ENTREGUE
`lib/people/nine-box.js` + `NineBoxBlock` na aba Avaliações; HR Score × potencial (leadership).

### B-2704 — Avaliação 180° / 360° (opcional no ciclo) ✅ ENTREGUE
Flags no ciclo + `performance_side_reviews` (self/peer por token); `/avaliacao/[token]`.

### B-2705 — Avaliação de experiência (D30/D60/D90 formal) ✅ ENTREGUE
Outcomes `pass`|`fail`|`extend` nos check-ins; PDI/retenção em fail/extend.

### B-2706 — Triagem / parse de CV + match assistido (ATS leve) ✅ ENTREGUE
Upload PDF S3 + extract (`pdf-parse`); sugestão de campos; text-match ≠ Fit T1–T9; `CandidateCvBlock`.

### B-2707 — Agenda de entrevistas (calendário leve) ✅ ENTREGUE
`interview_slots` + UI na vaga; notif gestores + e-mail candidato.

**Polish de adoção (ago/2026):** Overview eNPS clicável + empty gate; badge eNPS no Clima; 9Box i18n/`CollapsibleBlock` + CTA Equipe; dossier com `PerformanceReviewBlock` + sideReview counts; outcomes D30–D90 com help leve vs formal; ranking Fit vs textMatch separados; CV/slots `CopyableLink` (`url`); Help steps `cvUpload`/`interviewSlots` (pt+en); slots colapsáveis quando vazios.

### B-2708 — Recrutamento conversacional WhatsApp (além do share)
Hoje: botões share WhatsApp com UTM. Sólides: funil WhatsApp para micro/PME.
1. MVP: templates de mensagem + deep-link `/v` / `/jobs` + tracking referral já existente.
2. Depois: webhook provedor (Twilio/Z-API) opt-in — **só** se houver decisão de custo/ops; rate limit; sem spam.
3. Pode reutilizar canal WhatsApp de ponto (**B-2721**) só com opt-in e templates separados.

### B-2709 — Simulador / prep de entrevista para o candidato ✅ ENTREGUE
Página `/prep/<token>`; perguntas hedged (`buildInterviewQuestions` + rubrica); notas só no dispositivo; `prepared_at` visível ao RH. Admin: bloco na ficha do candidato na vaga.

### B-2710 — Checagem de antecedentes (integração)
1. Flag + provedor externo (API) no estágio screening/approved; status na ficha.
2. Audit; sem armazenar relatório completo se o provedor hospedar.
3. Fora do MVP se não houver parceiro — manter como integração, não build in-house.

### B-2711 — Pesquisa salarial / benchmarks de mercado ✅ ENTREGUE (MVP manual)
Sólides: avulso. Remuneração interna + faixa no cargo.
1. ~~Campos opcionais: faixa de mercado manual por cargo/`job_roles`.~~ (`market_salary_min`/`max` + `candidates.job_role_id`)
2. ~~Comparar salário vigente × faixa (Equipe Remuneração + Overview Atenção).~~
3. Sem marketplace de benefícios. CSV import / pesquisa live = follow-up.

### B-2712 — Intranet / feed interno leve ✅ ENTREGUE
Posts da empresa (`company_posts`) + mural em `/employee#feed`; admin Catálogos → Mural; soft delete; CAP `company_feed.view`.

### B-2713 — LMS profundidade (quiz / certificado) ✅ ENTREGUE
_(entregue — `094` quiz por aula + gate na conclusão; `/employee/lms` (Continuar, prazos); certificado print/PDF; relatório RH por turma. **Fora:** SCORM, player proprietário.)_

### B-2717 — LMS player “tipo Udemy” (embed + progresso de vídeo) ✅ ENTREGUE
_(entregue — `095` `lms_lesson_watch_progress`; layout curso lista+player em `/employee/lms`; resume YouTube/Vimeo; PDF viewer full-height. **Fora:** MP4 próprio, SCORM, auto-complete por %.)_

### B-2718 — Trilha LMS por cargo + experiência formal + D1 template ✅ ENTREGUE (P0 jornada)
_(entregue — `102_journey_p0_trail_experience_onboarding.sql`: `lms_job_role_courses`; auto-enroll no hire; Cargos → Trilha LMS; decisão `terminate` + `extend_days` nos check-ins D30/60/90; `company_pre_onboarding_templates` no hub DP. **Fora:** MP4 próprio, offboarding checklist completo, SCORM.)_

### B-2714 — NR-1 / riscos psicossociais (conformidade)
Sólides 2026: PGR + eSocial S-2240. Urgência regulatória de venda.
1. Decisão: (a) parceria/white-label, ou (b) módulo leve inventário + questionário + laudo export — **sem** prometer validade jurídica sozinhos.
2. Se (b): reusar clima/Likert; export PDF; audit; Guia “não substitui SESMT”.
3. Integração eSocial alinhada à onda folha (**B-2726**) se ambos existirem.

### B-2715 — Multi-CNPJ / hierarquia enterprise
Sólides fraco em enterprise; oportunidade se atacarmos o gap inverso (PME → grupo).
1. Grupo econômico: várias `companies` sob conta holding; admin vê agregados; hr fica no tenant.
2. Escopo DBA forte (índices, caps); não quebrar isolamento atual.
3. Só após demanda real de cliente.

### B-2716 — Feedback contínuo (reconhecimento / feed) ✅ ENTREGUE
Kudos peer-to-peer (`company_kudos`, ≤280) em `/employee#kudos`; notif destinatário; digest semanal com contagem; moderação no admin Mural.

---

### Onda DP (Departamento Pessoal) — unificado no mesmo produto

Princípios: mesmo tenant `company_id` + hub `candidates`; CAP novas (`dp.ponto`, `dp.folha`, …); `/employee` consome holerite/ponto sem segundo login. Fatias abaixo — **não** big-bang.

### B-2721 — Ponto digital (MVP) ✅ ENTREGUE
1. Batida web em `/employee` + geolocalização opcional; espelho do dia; revisão de inconsistências (ok/flagged) no hub DP.
2. Escala simples por empresa (turno fixo + tolerância); ajuste manual RH; export CSV.
3. **Fora (fase 2):** facial / offline / WhatsApp ponto; folha (**B-2726**).
4. Schema `091_time_clock.sql`; Guia → Ponto digital.
5. **Visão do gestor (fase 1) ✅ ENTREGUE:** DP → Ponto com abas Controle de ponto (lista + espelho por período com extra/falta/saldo, ajuste que anula a marcação original com motivo e inclui a correta, justificativa de dia, histórico), Banco de horas (saldo com cargo/unidade, paginado) e Fechamento (período passado ≤ 92 dias, empresa ou unidade; trava ajustes/justificativas/revisão; cancelamento com motivo). Schema `137_time_clock_manager.sql`.
6. **Pedidos do colaborador (pedido do RH, fase 1) ✅ ENTREGUE:** histórico por período em `/employee/time-clock`; pedido de Ajuste de ponto (incluir/alterar/remover marcações, justificativa) e de Abono (tipo, dia inteiro ou intervalo, comprovante); status por dia; fila DP → Ponto → Solicitações com aprovar/reprovar (motivo opcional) e notificações nos dois sentidos. Schema `142_time_clock_requests.sql`; ver `docs/time-clock-manager.md`.
7. **Fase 2 (pedido do RH) ✅ ENTREGUE:** jornada por colaborador com vigência (início, fim, intervalo e dias da semana, ou voltar à escala da empresa); aba Feriados (empresa ou unidade, anual, busca/ano, importar nacionais do ano); banco de horas calculado (extras − faltas desde o início do banco + lançamentos aprovados, teto da empresa, congelado por pessoa no fechamento). Schema `143_time_clock_schedules_holidays_bank.sql`.
8. **Fase 3 (pedido do RH) ✅ ENTREGUE:** tela de batida com indicador de localização, botão Obter/Atualizar localização e local da última batida (mapa sob demanda); mesmo fluxo no app mobile. Sem migration.
9. **Depois:** assinatura do espelho pelo colaborador; snapshot/resumo por fechamento (totais congelados + export).
10. **Depois (polish):** apagar o comprovante do armazenamento quando o colaborador cancela o pedido (hoje fica guardado junto do pedido cancelado); idempotência no POST de pedidos do app (header `Idempotency-Key`); no app, separar "permissão negada" (atalho para Ajustes) de "localização indisponível".

### B-2722 — Banco de horas / horas extras ✅ ENTREGUE
1. Regras por empresa (ativar + teto de saldo); saldo por colaborador; lançamentos manuais + créditos derivados do ponto (**B-2721**, ≥15 min além da escala, idempotente por pessoa/dia).
2. Aprovação RH (fila pendente); pedido de débito no `/employee`; CSV mensal.
3. Schema `099_hour_bank.sql`; Guia → Banco de horas. **Não** é folha/eSocial/acordo coletivo.

### B-2723 — Férias e afastamentos
1. Solicitação no `/employee`; saldo; aprovação gestor/RH; calendário do time.
2. Tipos: férias, atestado, licença (taxonomia fechada).
3. Integra eventos de folha quando **B-2726** existir.
4. **Entregue (saldo + polish):** pedido → aprovação (1 clique no inbox), calendário 60d expandido por dia, tipos fechados, **saldo de férias no período aquisitivo**, bloqueio por saldo e por sobreposição, cancelamento pelo colaborador (solicitado), anexo de atestado, fila de docs no inbox, export CSV. Sem evento de folha (ver Guia → DP leve).

### B-2724 — Admissão digital + GED + assinatura ✅ ENTREGUE (MVP)
1. Checklist pós-hire (docs: RG, contrato, etc.); upload S3; status por documento.
2. **Assinatura interna** (traço PNG no canvas + nome digitado + consentimento + IP/UA + `audit_log`); **não** ICP-Brasil / ClickSign. Parceiro externo = fase 2.
3. Liga funil `hired` → pasta do colaborador no mesmo `candidate_id`.
4. Schema `083` + `100` + `101_dp_signature_stroke.sql`; Guia → DP leve.

### B-2725 — Equipe de campo (rota / check-in / reembolso)
1. Check-in geolocalizado em visitas; rota do dia; fotos opcionais.
2. Reembolsos com comprovante + aprovação.
3. Reusar ponto (**B-2721**) onde fizer sentido.

### B-2726 — Folha de pagamento + eSocial + holerite
1. Eventos de folha (proventos/descontos) a partir de ponto/férias/banco; fechamento mensal.
2. Integração eSocial (Portaria 671 / eventos relevantes) — provável parceiro ou motor dedicado; escopo jurídico pesado.
3. Holerite digital no `/employee`; central do contador (acesso read-only por CAP).
4. **Folh.AI / BPO** = add-on depois (agentes + fila humana).

### B-2727 — WhatsApp operacional DP
1. Lembretes de batida, aprovação de férias, envio de holerite link (opt-in).
2. Mesmo provedor que **B-2708** se possível; templates e filas separados de recrutamento.

---

### Onda benefícios “clube” (além do catálogo)

### B-2731 — Benefícios operacionais (cartão / parceiros / telemedicina)
Além do catálogo B-1009.
1. Decisão: parceria (Mastercard multibenefícios, Unimed, etc.) vs build mínimo de elegibilidade + deep-link.
2. Módulo reembolso de benefício; telemedicina via parceiro embed.
3. Empréstimo consignado / seguro = só marketplace; não carregar risco de crédito in-house.

---

## Aberto — Epic B-3000 (gaps vs 7 players HR Tech Brasil — ago/2026)

Fonte: varredura pública Sólides, InCicle, TagguiRH, TeamCulture, Qulture.rocks, Alina, ImpulseUp. InCicle/Taggui a partir do menu de produtos; demais por site. Marketing ≠ produto logado.

**Dois blocos (não 7 rivais iguais):**
- **RH+DP:** Sólides, InCicle, TagguiRH — ponto/folha/admissão **e** desempenho. Disputam “sistema único”.
- **Performance/engajamento puro:** TeamCulture, Qulture, Alina, ImpulseUp — **não** fazem DP; integram folha. Disputam “camada estratégica”.

**Onde o 30Grow joga:** profundo no segundo bloco (1:1, 360, 9Box, PDI, clima, eNPS, pulso, LMS, sucessão, exit, HR Score, radar de turnover, analytics) **e** unificando DP leve no mesmo `candidates` / um login (tese B-2700). Cunha = união + T1–T9/Motivadores, **não** amplitude InCicle.

### Já cobrimos (não reabrir como cópia)

| Job | 30Grow hoje | Quem também tem | Quem **não** tem (vantagem nossa) |
|-----|-------------|-----------------|-------------------------------------|
| 1:1s + hipóteses + prep | Equipe + `/e` + `/employee` | TeamCulture, Qulture, Alina, ImpulseUp | **Sólides e Taggui** (gap de mercado do estudo) |
| Avaliação 90/180/360 + 9Box | B-1004 + B-2703 + B-2704 | todos os 7 em algum grau | — |
| PDI ligado a review/concern | B-1004 + People | todos os estratégicos | — |
| Clima + eNPS + pulso de grupo | Clima + B-2702 + `/pulso` | todos | — |
| Predição de turnover | HR Score + radar B-1002 | Sólides, TeamCulture, Alina | InCicle, Taggui, Qulture |
| ATS + Fit T1–T9 + `/j` `/r` | Vagas | só o bloco RH+DP (sem Fit nosso) | **todos os puros** (não fazem R&S) |
| LMS básico | B-2400/2401 | InCicle, ImpulseUp, Sólides parcial | TeamCulture, Qulture, Alina, Taggui |
| Feed + kudos | B-2712 + B-2716 | InCicle, Taggui | puros (Qulture tem elogios) |
| Férias / docs DP leve + ponto MVP | B-2723 + B-2724 MVP + **B-2721** ✅ | bloco RH+DP | **todos os puros** |
| Sucessão + exit + cultura síntese | B-1005–B-1007 | raro neste recorte | suítes largas raramente neste nível |

**Já no B-2700 (não duplicar aqui):** ponto **B-2721**; banco de horas **B-2722**; férias resto **B-2723**; admissão/GED/assinatura **B-2724**; campo/reembolso **B-2725**; folha/eSocial/holerite **B-2726**; WhatsApp DP **B-2727**; benefícios clube **B-2731**; WhatsApp R&S **B-2708**; antecedentes **B-2710**; LMS quiz **B-2713** ✅; LMS player/progresso **B-2717** ✅; NR-1 **B-2714**; multi-CNPJ **B-2715**.

**Explicitamente fora deste epic (não copiar InCicle/Sólides):** gestão de projetos, Kanban/Gantt/5W2H, chat interno, TV corporativa, lojinha/gamificação, 40+ agentes de IA, segundo app de DP, DISC como fio condutor (T1–T9 fica).

### Ordem sugerida

1. Empacotar o estratégico que o comprador DHO espera e nós quase temos (**B-3001–B-3004** ✅).
2. Conformidade + organograma (**B-3005–B-3006** ✅) + SSO (**B-3007**).
3. Canais e folha-como-integração (**B-3008–B-3009**) se B-2726 atrasar ou venda enterprise pedir.
4. Aprofundar feedback (**B-3010** ✅) / copiloto (**B-3011**) sem segundo assistente paralelo ao Help.
5. Viz lean sobre listas existentes → **B-3020** (P1+P2+P3 ✅).

### B-3001 — Calibração de reviews (overall + 9Box) ✅ ENTREGUE
TeamCulture / Qulture / Alina. Ciclo já existia; faltava calibrar scores submetidos.
1. Em Avaliações → ciclo: fila de calibração (`overall_score` 0–100, `nine_box_cell` 1–9 opcional, notas + auditoria).
2. Histograma / ocupação 9Box do ciclo acima da lista (≥3 scores). Linguagem hedged: não é rótulo de promoção.
3. Fora: segundo ciclo paralelo só para calibração; “forced ranking” rígido.

### B-3002 — Mapa salarial por cargo ✅ ENTREGUE
Alina / ImpulseUp. Dados: `job_roles` + salário vigente aprovado.
1. Remuneração (Salários da equipe): below / in band / above + barras empilhadas + simulação de aumento %.
2. Drill-down na tabela; não é folha.
3. Fora: survey salarial externo / benchmarking pago.

### B-3003 — Remuneração variável / bônus proposto ✅ ENTREGUE
Qulture / TeamCulture. Sugestão a partir de review submetida; RH aprova/recusa.
1. Evento `bonus` com `approval_status=proposed`; inbox empresa + ficha; colaborador vê status em `/employee` → Bônus / variável.
2. Não calcula INSS/folha; não substitui PLR jurídico.
3. Cap/listagem por empresa; audit na decisão.

### B-3004 — OKRs leves (empresa / time / pessoa) ✅ ENTREGUE
Puros (Qulture, Alina, ImpulseUp). Árvore leve + KRs numéricos.
1. ~~Aba Avaliações: objetivos com parent + KRs.~~ **Fase 1 (2026-08):** ciclo nomeado + áreas + atividades (`%`, deadline, urgência, barras). Migration `096_okr_cycles.sql` (tabelas leves antigas preservadas).
2. Cap por empresa; MeterBar por atividade/área/ciclo.
3. **Assignees (2026-08):** `097_okr_activity_assignees.sql` — 1+ pessoas por atividade; `/employee#okr` (prazo / progresso / urgência) + notificação `okr_activity_assigned`.
4. **Pesos + check-ins (2026-08):** `098_okr_weights_checkins.sql` + `104_okr_weight_0_10.sql` — `weight` 0–10 (rollup ponderado; 0 não conta); check-in atualiza `%` + nota (RH e colaborador assignee). Aba própria Pessoas → OKRs. Fora ainda: bônus por atingimento.

### B-3005 — Ouvidoria / canal de denúncias ✅ ENTREGUE
InCicle, Taggui, TeamCulture. Distinto de clima (anônimo estatístico) e de kudos.
1. Token público `/ouvidoria/{token}` + CAP `whistleblowing.view`; categorias fechadas; triagem RH.
2. Sem PII no relato anônimo; audit de acesso; prazo de resposta; **não** misturar com pesquisa de clima.
3. Fora: prometar validade jurídica tipo canal Lei 14.457 sozinhos (parceria/advogado se vender compliance).

### B-3006 — Organograma dinâmico ✅ ENTREGUE
Alina (forte), InCicle, Sólides. Hoje: grupos + sucessão, sem árvore visual.
1. `manager_candidate_id` no colaborador; árvore por empresa com cap; clique abre Equipe.
2. Reusar `job_roles` + roster `employee`; empty state se grafo incompleto.
3. Fora: organograma “engenharia organizacional” InCicle; drag-and-drop de reorg como produto.

### B-3007 — SSO (Google / Microsoft)
Table stakes dos puros (TeamCulture, Qulture, Alina, ImpulseUp). Hoje: senha + 2FA.
1. OIDC para gestores (`team30_session`); depois colaborador se a venda pedir.
2. Domínio da empresa allowlist; fallback senha; audit de vínculo.
3. Só priorizar com pipeline enterprise real (mesmo critério B-2715).

### B-3008 — Notificações Slack / Teams
Puros + Qulture. Hoje: in-app + e-mail (digest, alertas).
1. Webhook por empresa (URL + tipos opt-in: digest, turnover, prazo de vaga).
2. Reusar catálogo `NOTIF` + prefs; sem segundo motor de copy.
3. WhatsApp continua B-2708/B-2727 (opt-in separado).

### B-3009 — Integração folha/ERP (consumir, não substituir)
Como Alina/TeamCulture/ImpulseUp: viver **em cima** da folha. Plano B se **B-2726** atrasar.
1. Conector mínimo (CSV/API) de headcount + salário + afastamento → `candidates` / eventos de remuneração; tenant `company_id`.
2. TOTVS/Senior/SAP = parceiro ou mapeamento, não motor próprio.
3. Não duplicar holerite/eSocial aqui; se B-2726 existir, esta item vira sync bidirecional.

### B-3010 — Feedback contínuo estruturado (pedir / dar / receber) ✅ ENTREGUE
Além de kudos B-2716. Job do Qulture; nós já temos 1:1 + kudos.
1. Pedido de feedback (gestor/par) com token ou sessão; resposta curta; aparece no dossier / 1:1.
2. Não virar rede social; cap por pessoa/mês; reusar notif.
3. Só depois de B-3001 se o ciclo de review já cobrir o job.

### B-3011 — Copiloto de pessoas (não misturar com Ajuda)
Sólides Copilot, TeamCulture Axel, Alina-IA, ImpulseUp IAP. Hoje: Help (só Guia) + B-2601 diagnóstico de lista + IA interpretativa hedged (B-1904).
1. Superfície **Equipe/Overview**: “o que olhar no próximo 1:1 / quem está no radar”; tool calling só em `lib/` (HR Score, radar, PDI, clima agregado).
2. Mesmas regras B-2600: sem SQL gerado; tenant da sessão; hedged; rate limit; audit.
3. Nome de produto opcional; **não** segundo chatbot de navegação (Help permanece Guia-only).

---

## Aberto — Epic B-3020 (viz lean: mesmo dado, outra forma)

Lista/CRUD continua a superfície de **trabalho**. Gráfico = resumo **acima** da lista quando a decisão é de padrão (distribuição / tendência / gap), não de item.

**Princípio**
1. Lista = fazer (triage, editar, abrir pessoa). Gráfico = ver padrão em segundos.
2. Preferir `MeterBar` / SVG leve / padrão CSS do Analytics antes de novo chart kit. Recharts só quando multi-eixo (como radar Motivadores).
3. Um gráfico collapsível + empty se N pequeno; drill-down = a lista que já existe. Sem segundo BI paralelo ao Analytics.
4. **Não** forçar: organograma “bonito” tipo InCicle; kudos/mural; segunda cópia de T1–T9/clima; gráfico em cada ficha da Equipe.

**Já temos (não reabrir):** radar Motivadores; trend SVG clima; heat T1–T9 Overview; 9Box; bars Analytics/HR Score; MeterBar em OKR/PDI/LMS.

### Ordem sugerida

1. **P1** (**B-3021–B-3023**): mapa salarial, calibração, motivos de saída. ✅ ENTREGUE
2. **P2** (**B-3024–B-3026**): sucessão, HR Score por área, OKR rollup. ✅ ENTREGUE
3. **P3** (**B-3027–B-3029**): ouvidoria, turnover dist, férias pool. ✅ ENTREGUE

### B-3021 — Mapa salarial: barras below / in / above (P1) ✅ ENTREGUE
Remuneração → `SalaryMapBlock`. Dados já em `listSalaryMapByJobRole`.
1. Barras empilhadas por cargo (below / inBand / above) + total folha; tabela permanece drill-down.
2. Não virar um gráfico por linha da tabela.
3. Reusar `MeterBar` / stacked CSS; simulação continua texto/números.

### B-3022 — Calibração: histograma overall + 9Box do ciclo (P1) ✅ ENTREGUE
Avaliações → topo da fila de calibração.
1. Histograma de `overallScore` 0–100 do ciclo + ocupação 9Box (reusar dados/`NineBoxBlock` se já no ciclo).
2. Lista de calibração continua a superfície de edição.
3. Evitar segundo 9Box redundante na mesma viewport.

### B-3023 — Saídas: barras de motivo (P1) ✅ ENTREGUE
Aba Saídas e/ou Overview. Lib já agrega `reasonAgg` / `typeAgg`.
1. Barras horizontais top ~5 motivos; insights hedged permanecem.
2. Cap de categorias; sem chart se volume baixo.
3. Fora: BI genérico de demissão.

### B-3024 — Sucessão: cobertura de bench (P2) ✅ ENTREGUE
1. Stacked/donut por cargo crítico: pronto / em desenvolvimento / vazio.
2. Tabela de sucessores continua; gráfico = gap de cobertura.
3. Empty se não houver cargos críticos.

### B-3025 — HR Score por área: barras ordenadas (P2) ✅ ENTREGUE
Overview `HrScoreCard` já lista byArea.
1. Trocar/ enriquecer lista por barras horizontais ordenadas.
2. Sem nova API se o payload já basta.
3. Clique → Equipe/filtro área se já existir navegação.

### B-3026 — OKR rollup por nível (P2) ✅ ENTREGUE
1. % médio de attainment (current/target) por nível empresa/time (e pessoa se útil).
2. Não duplicar MeterBar de cada KR; rollup no topo do `OkrBlock`.
3. Cap de objetivos já no lib.

### B-3027 — Ouvidoria: funil status + categorias (P3) ✅ ENTREGUE
1. Funil new→triaging→responded/closed + barras por categoria (`aggregateWhistleblowingReports`; só contagens).
2. Zero texto de relato no gráfico; privacidade.
3. Inbox/lista continua primaria. Chart só com N ≥ `CHART_MIN_N`.

### B-3028 — Turnover: distribuição low/med/high (P3) ✅ ENTREGUE
1. `StackedSegmentBar` no `TurnoverRadarCard` a partir de `distribution` no GET company.
2. Lista at-risk continua a ação (médio/alto).
3. Reusa sinais já calculados em `lib/turnover-radar.js`.

### B-3029 — Férias: pool empresa / cargo (P3) ✅ ENTREGUE
1. `getCompanyVacationPool` + `GET …/dp/leave?mode=pool`; `VacationPoolBlock` no inbox DP.
2. Stacked used/pending/available + barras por cargo (job role). Cap 500 colaboradores.
3. Sem chart em cada dossier DP.

### B-3030 — Explicitamente fora deste epic
1. Organograma visual “engenharia” / drag-and-drop (B-3006 lista indentada basta).
2. Volume de kudos/mural como KPI permanente na Overview.
3. Segundo dashboard customizável tipo Metabase (B-1000 Analytics já cobre tendência).
4. Chart em toda ficha da Equipe.

---

## Aberto — Epic B-3100 (conta multiempresa: consultor / `account_admin`)

Cenário: recrutador ou consultoria independente cria a conta via signup e atende várias empresas clientes. Hoje o dono da empresa (criador no signup) só administra **uma** empresa; o `admin` sem `company_id` é o super admin da plataforma (cross-tenant total). Decisão: **papel novo** `account_admin`, sem reaproveitar `admin` (renomear o admin da plataforma quebraria sessão, permissões, rotas `withAdminApi` e auditoria).

### B-3101 — Modelo de conta (`accounts`)
1. Tabela `accounts` (dono = usuário do signup); `companies.account_id` FK; empresa sem conta = legado / criada pela plataforma.
2. `account_admin` vê só as empresas da própria conta (`company_id IN (empresas da conta)`), nunca cross-tenant da plataforma.
3. Migration aditiva: cada empresa com `signup_creator_user_id` vira uma conta de 1 empresa; nada muda para quem não usa.

### B-3102 — Criar empresas e convidar gestores por empresa
1. `account_admin` cria nova empresa (reusa onboarding/módulos/licença) e convida gestores com vínculo a **uma** empresa (`user_company_memberships`).
2. Gestor convidado vê só a empresa vinculada e seus colaboradores (escopo atual por `company_id`).
3. Senha sempre por convite por e-mail (mesma regra do dono hoje).

### B-3103 — Visão consolidada e seletor de empresa
1. Seletor de empresa no painel para `account_admin` (reusar `companyFilter` do admin, limitado à conta).
2. Visão consolidada: Usuários (criados pela conta) e colaboradores das empresas da conta; Overview agregado com cap.
3. Fora: billing consolidado por conta (avaliar com pricing), white-label.

### B-3104 — Permissões e auditoria
1. `CAP` novo para gestão da conta; `getManagerScope` devolve lista de empresas permitidas; nunca confiar em `companyId` do body sem checar a conta.
2. Audit com `account_id`; testes DTOV de isolamento (conta A não vê conta B; gestor da empresa X não vê Y da mesma conta).

---

## Aberto — Auditoria e LGPD

Já entregue: diferença por campo em ficha, DP (gestor e colaborador) e Usuários, com dado pessoal só como “alterado” (`docs/audit-log.md`).

### B-3201 — Retenção da auditoria
1. Definir prazo com o jurídico (ex. 24 meses para eventos comuns; mais longo para segurança/acesso) e registrar em `docs/privacy-retention-policy.md`.
2. Cron com `LIMIT` por lote apagando `audit_log` vencido (índice em `created_at`); nunca apagar o que estiver sob investigação/litígio.

### B-3202 — Auditoria da própria empresa (controladora)
1. Visão de auditoria filtrada por `company_id` para o dono da empresa (capability nova), sem cross-tenant.
2. Filtros por pessoa (alvo) e por ação; exportação CSV para atender pedido do titular ou fiscalização.

### B-3203 — Reautenticação ao trocar o próprio e-mail
1. Gestor não admin trocando o próprio e-mail: exigir senha/2FA de novo e avisar o endereço antigo.
2. Evita que uma sessão roubada troque o e-mail e recupere a conta por "esqueci a senha".

---

## Aberto — Observabilidade

### B-1701 — Logs estruturados (infra) ✅ ENTREGUE (básico)
JSON stdout via `lib/monitoring.js` ligado a Postgres (`lib/db.js`), Redis (`lib/rate-limit.js`) e S3 (`lib/s3-object-storage.js`). Env: `LOG_LEVEL`, `LOG_SLOW_MS`.

### B-1702 — Sentry (erros de app) ✅ ENTREGUE (SDK)
`@sentry/nextjs` + `instrumentation.js` + `sentry.*.config.js` + `app/global-error.jsx`. Org `3035tech-9t` / project `30team`. Ativar com `NEXT_PUBLIC_SENTRY_DSN` (+ `SENTRY_DSN` server) e opcional `SENTRY_AUTH_TOKEN` no build (source maps).

---

## Aberto — Polish residual (pós waves 1–12 / demo beta)

_(B-2901–B-2906 + adoção/packaging + B-2904 + passada cross-app + residual Audit/Equipe/Analytics/copy/loading — entregues ago/2026. Polish residual vazio.)_

**Skip (explícito):** aliases `/climate`/`/pulse`; DISC/DP.

---

## Notas

- Qualidade/testes **B-001–B-006** entregues.
- Epic **B-100** fechado (SEO, funil, referral, job alerts, agregadores, logo S3).
- **Logo S3:** código pronto; falta só credenciais de produção (`S3_BUCKET` + chaves — ver `.env.example`).
- Epic **B-300** fechado.
- Epic **B-500** fechado (PDI + clima: estrutura + B-501–B-506).
- Epic **B-600** fechado (assessment → ação + polish de revisão/pulso/`/e`/Guia).
- Epic **B-800** / **B-801** entregue (assistente de ajuda no painel — FAQ + retrieval + LLM barato).
- Epic **B-900** entregue (Sprint A/B/C — Overview atenção + Fit/briefing/report + mix/rubrica/clima).
- Polish paleta **P2** entregue (`font-ui` chrome, ícones toast/notice, sync cores Motivadores `052`).
- **Onboarding Contextual** (Melhoria #1 — Sprint Quick Wins) entregue: tooltips contextuais, checklist de progresso (7 tarefas), empty states acionáveis, tour guiado opcional (5 steps). Ver `docs/onboarding-contextual.md`.
- **UX/UI — Categoria Completa** (Melhorias #3-#9) parcialmente: Undo/Confirmação, Loading, Mobile (drawer corrigido), Cmd+K, atalhos. **Modo escuro:** usable no painel; follow-ups (print/público/C.* inline) → **B-1501**.
