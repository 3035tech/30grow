# Polish & Refinamento — Epic B-1000

Oportunidades de melhoria incremental das features B-1001 a B-1009, **sem criar features novas do zero**.

Princípio: **valor rápido** (< 1 dia por item) + **reutilizar** componentes/padrões existentes.

---

## 🎨 Categoria 1 — UX/UI (melhorar experiência)

### P-1001 — HR Score Badge na listagem Equipe
**O quê:** Adicionar `HrScoreBadge` (compacto) na linha de cada pessoa na tab Equipe  
**Por quê:** Gestor vê score/risco sem precisar abrir o perfil individual  
**Onde:** `app/dashboard/tabs/TeamTab.jsx` (ou similar)  
**Esforço:** 🟢 Pequeno — componente já existe, só plugar

### P-1002 — Turnover Radar: drill-down por pessoa
**O quê:** Clicar em pessoa no `TurnoverRadarCard` → abrir `HrScoreDisplay` full em modal/drawer  
**Por quê:** Overview mostra lista, mas gestor quer detalhes sem navegar para outra tab  
**Onde:** `app/dashboard/tabs/overview/TurnoverRadarCard.jsx`  
**Esforço:** 🟡 Médio — precisa modal/drawer + fetch de dados

### P-1003 — Job Roles: UI de cadastro/edição mais rica
**O quê:** Substituir `promptForm` por `AdminRichFormDrawer` similar ao de Vagas  
**Por quê:** Rubrica T1-T9 fica mais visual com `RubricEditor` inline (não só texto)  
**Onde:** `app/dashboard/tabs/JobRolesAdminTab.jsx`  
**Esforço:** 🟡 Médio — já temos `AdminRichFormDrawer` + `RubricEditor`, adaptar

### P-1004 — Performance Reviews: visualização de metas na review
**O quê:** Mostrar metas (goals) + outcomes lado a lado na tela de review, não só JSON  
**Por quê:** UX de preenchimento fica mais clara (goal → escolher outcome + notes)  
**Onde:** `app/dashboard/tabs/PerformanceReviewsAdminTab.jsx`  
**Esforço:** 🟡 Médio — adicionar sub-componente de review form

### P-1005 — Succession: indicador visual de readiness
**O quê:** Adicionar badge/cor para readiness (not_ready = vermelho, ready = verde, etc.)  
**Por quê:** Lista de papéis críticos + sucessores fica mais escaneável  
**Onde:** `app/dashboard/tabs/SuccessionAdminTab.jsx`  
**Esforço:** 🟢 Pequeno — só CSS/classes

### P-1006 — Exit Analysis: gráfico de motivos (top 5)
**O quê:** Adicionar gráfico de barras simples (top 5 motivos) no `ExitInsightsCard`  
**Por quê:** Visual rápido > só texto de insights  
**Onde:** `app/dashboard/tabs/overview/ExitInsightsCard.jsx`  
**Esforço:** 🟡 Médio — usar lib de gráficos leve ou Canvas

### P-1007 — Culture: expandir/colapsar insights por categoria
**O quê:** `CultureInsightsCard` já tem expand, mas melhorar com tabs por categoria (climate, type_mix, pulse, alignment)  
**Por quê:** Evitar wall of text quando há muitos insights  
**Onde:** `app/dashboard/tabs/overview/CultureInsightsCard.jsx`  
**Esforço:** 🟢 Pequeno — UI condicional

### P-1008 — Learning Resources: filtro por tipo (course, video, etc.)
**O quê:** Adicionar filtro de `resourceType` ao lado do filtro de tema  
**Por quê:** Gestor quer filtrar "só vídeos" ou "só workshops"  
**Onde:** `app/dashboard/tabs/LearningResourcesAdminTab.jsx`  
**Esforço:** 🟢 Pequeno — adicionar select + query param

### P-1009 — Benefits: agrupamento visual por categoria
**O quê:** Agrupar benefícios por categoria em cards/seções (Saúde, Financeiro, etc.)  
**Por quê:** Lista longa fica mais organizada  
**Onde:** `app/dashboard/tabs/CompanyBenefitsAdminTab.jsx`  
**Esforço:** 🟡 Médio — CSS grid + group by lógica

---

## 🔗 Categoria 2 — Integrações (conectar módulos)

### P-1010 — HR Score: botão "Recalcular" por pessoa na Equipe
**O quê:** Adicionar botão inline "♻️ Recalcular Score" na linha da pessoa  
**Por quê:** Admin quer recalcular sem ir para Overview ou API manual  
**Onde:** `app/dashboard/tabs/TeamTab.jsx` (ou onde lista pessoas)  
**Esforço:** 🟢 Pequeno — chamada à API existente `/api/admin/hr-score/recalculate`

### P-1011 — Turnover Radar: link para PDI da pessoa
**O quê:** No card de pessoa at-risk, adicionar link "→ Ver PDI" ou "→ Criar Plano"  
**Por quê:** Ação imediata após ver risco  
**Onde:** `TurnoverRadarCard.jsx`  
**Esforço:** 🟢 Pequeno — link para tab Equipe com foco no PDI

### P-1012 — Job Roles: preview de rubrica ao criar vaga
**O quê:** Ao selecionar job role na vaga, mostrar preview da rubrica (T1-T9 weights) inline  
**Por quê:** Gestor confirma que o cargo está certo antes de criar  
**Onde:** `app/dashboard/tabs/VacanciesAdminTab.jsx` (form de criar vaga)  
**Esforço:** 🟡 Médio — fetch job role + render `RubricEditor` compact

### P-1013 — Performance: auto-sugestão de PDI ao revisar
**O quê:** Mostrar sugestão "Outcome 'develop' vai gerar item PDI automaticamente" próximo ao select  
**Por quê:** Gestor entende o fluxo antes de submeter  
**Onde:** Form de review no `PerformanceReviewsAdminTab.jsx`  
**Esforço:** 🟢 Pequeno — tooltip ou texto condicional

### P-1014 — Succession: link para HR Score do sucessor
**O quê:** Na lista de sucessores, adicionar badge com HR Score + link para perfil  
**Por quê:** Prontidão vem do score, mas gestor quer ver breakdown  
**Onde:** `SuccessionAdminTab.jsx` (lista de sucessores)  
**Esforço:** 🟡 Médio — fetch scores + render badges

### P-1015 — Exit: sugestão de rubrica com base em motivos
**O quê:** Insights de M1 (seleção) sugerem "considere pesar mais T[X] na rubrica de [cargo]"  
**Por quê:** Fecha o loop: motivo → ação concreta na seleção  
**Onde:** `ExitInsightsCard.jsx` ou nova lógica em `lib/exit-analysis.js`  
**Esforço:** 🟠 Alto — análise estatística tipo×motivo + sugestão de rubrica

### P-1016 — Culture: link para Climate/Pulse direto do card
**O quê:** Insights de cultura com link "→ Ver pesquisa de clima" ou "→ Ver pulsos"  
**Por quê:** Gestor quer drill-down na fonte do insight  
**Onde:** `CultureInsightsCard.jsx`  
**Esforço:** 🟢 Pequeno — links para tabs existentes

### P-1017 — Learning Resources: sugerir recursos ao criar PDI item
**O quê:** Ao adicionar item no PDI, buscar recursos do catálogo por tema/keyword  
**Por quê:** Facilita linkar PDI → recurso  
**Onde:** Form de PDI item (Equipe → DevelopmentPlansBlock)  
**Esforço:** 🟡 Médio — autocomplete ou modal de busca

### P-1018 — Benefits: mencionar no onboarding kit (hire)
**O quê:** `HireOnboardingKit` (B-402) pode incluir seção "Benefícios da empresa" automaticamente  
**Por quê:** Novo colaborador vê lista de benefícios no kit de boas-vindas  
**Onde:** `lib/hire-onboarding-kit.js` + template  
**Esforço:** 🟢 Pequeno — fetch benefits + render na seção

---

## 🔔 Categoria 3 — Notificações/Automações (proatividade)

### P-1019 — HR Score: notificação quando score cai < 50
**O quê:** Criar tipo de notificação `hr_score_low` no catálogo  
**Por quê:** Gestor é alertado automaticamente de pessoa em risco  
**Onde:** `lib/manager-notification-catalog.js` + cron  
**Esforço:** 🟡 Médio — novo tipo + lógica de detecção

### P-1020 — Turnover Radar: notificação de mudança de nível ✅ ENTREGUE
**O quê:** Detectar transição low→medium ou medium→high e notificar  
**Por quê:** Alerta proativo de piora do risco  
**Onde:** `lib/turnover-radar.js` (`detectTrendChange` + `emitTurnoverRiskChangeNotification`) ligado a `recalculateCompanyScores` / GET HR Score; Equipe `filter=turnover_risk`  
**Esforço:** 🟢 Pequeno — função já existe, só plugar notificação

### P-1021 — Performance: lembrete de ciclo aberto
**O quê:** Notificação semanal "Ciclo [X] está aberto, Y pessoas ainda sem review"  
**Por quê:** Gestor não esquece de fechar o ciclo  
**Onde:** Novo cron + `lib/manager-notifications.js`  
**Esforço:** 🟡 Médio — cron + query de ciclos abertos

### P-1022 — Succession: alerta de gap de sucessão
**O quê:** Notificação "Papel crítico [X] sem sucessor 'ready'" quando não há sucessor prontidão ≥ ready  
**Por quê:** RH/direção prioriza desenvolver sucessores  
**Onde:** `lib/development/succession-plans.js` + notificação

**Esforço:** 🟡 Médio — query + lógica de gap

### P-1023 — Exit: digest mensal de motivos
**O quê:** Notificação resumo mensal "Top 3 motivos de saída no último mês"  
**Por quê:** RH acompanha tendências sem entrar no dashboard toda semana  
**Onde:** Cron mensal + `lib/exit-analysis.js`  
**Esforço:** 🟡 Médio — cron + template de resumo

---

## 🧪 Categoria 4 — Testes/Performance (validação técnica)

### P-1024 — DTOV: rodar pipeline completo B-1000
**O quê:** Garantir que Docker funciona no ambiente e rodar `npm run dtov:full-app`  
**Por quê:** Validar todas as features B-1001 a B-1009 com testes automatizados  
**Onde:** Ambiente de CI/local com Docker  
**Esforço:** 🟡 Médio — dependente de Docker; pode estar bloqueado

### P-1025 — Performance: índices de queries B-1000
**O quê:** Revisar queries lentas em `hr_scores`, `performance_reviews`, `exit_records`, etc.  
**Por quê:** Garantir que agregações escalam com volumetria  
**Onde:** Migrations + `EXPLAIN ANALYZE` em queries  
**Esforço:** 🟡 Médio — análise + criação de índices novos se necessário

### P-1026 — HR Score: cache de scores na sessão
**O quê:** Evitar recalcular score toda vez que Overview/Equipe carrega  
**Por quê:** Overview pode ficar lento com muitas pessoas  
**Onde:** `lib/assessment/hr-score.js` (TTL de 1h ou cache em memória)

**Esforço:** 🟠 Alto — arquitetura de cache + invalidação

---

## 🎯 Priorização sugerida (Quick Wins primeiro)

### 🟢 **Nível 1 — Quick Wins (1-2h cada)**
- P-1001 — HR Score Badge na Equipe
- P-1005 — Succession readiness visual
- P-1007 — Culture collapse/expand
- P-1008 — Learning Resources filtro tipo
- P-1010 — HR Score recalcular inline
- P-1011 — Turnover link para PDI
- P-1013 — Performance auto-sugestão PDI
- P-1016 — Culture links para Climate/Pulse
- P-1018 — Benefits no onboarding kit
- P-1020 — Turnover notificação mudança ✅

### 🟡 **Nível 2 — Médio impacto (meio dia cada)**
- P-1002 — Turnover drill-down modal
- P-1003 — Job Roles UI rica
- P-1004 — Performance review form melhor
- P-1006 — Exit gráfico top 5
- P-1009 — Benefits agrupamento
- P-1012 — Job Roles preview na vaga
- P-1014 — Succession HR Score badges
- P-1017 — Learning Resources sugestão PDI
- P-1019 — HR Score notificação low
- P-1021 — Performance lembrete ciclo
- P-1022 — Succession gap alert
- P-1023 — Exit digest mensal
- P-1024 — DTOV completo B-1000
- P-1025 — Performance índices

### 🟠 **Nível 3 — Alto esforço (1+ dia)**
- P-1015 — Exit → sugestão rubrica (análise estatística)
- P-1026 — HR Score cache (arquitetura)

---

## Próximo passo

Escolha um **nível** ou **categoria** para começar, ou indique itens específicos (ex: "P-1001, P-1005, P-1008").
