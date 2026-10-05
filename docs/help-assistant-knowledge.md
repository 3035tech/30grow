# Assistente de Ajuda — base de conhecimento

O botão flutuante **“Pergunte à IA”** / **“Ask AI”** (canto inferior direito) abre um **chat com assistente de IA** do produto. Não confundir com a aba **Ajuda** do menu (Guia em texto fixo). A fonte de verdade continua o **Guia do painel** (`panel.help.*` em `lib/i18n.js`), indexada por `lib/help-assistant.js`.

## Arquitetura

| Camada | O quê |
|--------|--------|
| **Guia** | `HelpTab` apresenta busca, atalhos, categorias (`HELP_GUIDE_GROUPS`) e um artigo por vez; conteúdo em `panel.help.{section}Title/Body/StepN` (pt-BR **e** en) |
| **Ajuda contextual** | O cabeçalho do dashboard usa `HELP_BY_DASHBOARD_TAB` para abrir `?tab=help&helpSection=<section>` no artigo ligado à tela atual |
| **Seções canônicas** | `lib/help-sections.js` → `HELP_GUIDE_SECTIONS` (ordem do índice) |
| **Retrieval** | `buildHelpChunks()` lê todas as seções canônicas no locale |
| **FAQ** | `FAQ` em `lib/help-assistant.js` + `panel.helpAssist.faq*` (resposta instantânea, sem LLM) |
| **LLM** | OpenAI opcional; contexto = top 4 chunks lexicais do Guia |

**Regra:** o assistente **não** tem base paralela. Se está no Guia, entra no retrieval; FAQ só acelera perguntas frequentes.

## Checklist obrigatório — toda feature nova para gestor/RH

Após **Test pass** (pipeline Dev → Test → Validate), antes de dar a entrega como pronta:

1. **Guia** — adicionar ou estender seção em `lib/i18n.js`:
   - `{section}Title`, `{section}Body`, `{section}Step1…` em **pt-BR e en**
   - Se for fluxo novo: incluir `{section}` em `HELP_GUIDE_SECTIONS` (`lib/help-sections.js`) se ainda não existir
   - Ajustar `HELP_SECTION_STEP_COUNTS` se houver passos novos
2. **Assistente de Ajuda**
   - Garantir que a seção está em `HELP_GUIDE_SECTIONS` (indexação automática via `buildHelpChunks`)
   - Mapear a tela em `HELP_BY_DASHBOARD_TAB`; `test/unit/help-context-coverage.unit.test.js` protege cobertura e destinos inválidos
   - Se a pergunta for muito comum (“como…”, “onde…”), adicionar entrada em `FAQ` + `panel.helpAssist.faq*` (pt-BR+en)
   - Ampliar vocabulário em `PRODUCT_HINT` (`lib/help-assistant.js`) se surgirem termos novos do domínio
3. **Docs técnicas** (quando aplicável) — `README` / `docs/` para setup, URLs, migrations
4. **Prova** — `npm run test:full:offline` inclui `help-assistant` + `validateHelpGuideCoverage`

## Onde documentar por tipo de feature

| Público | Onde |
|---------|------|
| Gestor precisa *saber fazer* | Guia + FAQ opcional |
| Colaborador (`/employee`) | Seção `employeeHome` no Guia (RH convida/configura) |
| Fronteiras PDI/OKR/1:1 + inclusão fora do funil + check-ins D30/60/90 | Guia `team` passo 8 + FAQ `faqEmployeeJourney` + `docs/RH2-decisions.md` |
| HR Score / sinais de retenção / Preparar conversa / DP→cadastrais | Guia `b1000HrScore` + `b1000TurnoverRadar` + `b1900Packaging` + FAQ `faqHrScore` / `faqTurnoverRadar` + `docs/RH2-decisions.md` |
| Clima versionado (arquivar / nova versão / perguntas travadas) | Guia `climate` + `docs/RH2-decisions.md` (B-RH2-16) |
| Benefícios por colaborador | Guia `b1000Benefits` + Equipe → Remuneração + `docs/RH2-decisions.md` (B-RH2-14) |
| Avaliação formal por competências (90/180/360) | Guia `formalCompetency` + Avaliações → Competências + `/formal-review/[token]` + `docs/RH2-decisions.md` (B-RH2-15) |
| Módulos da empresa (SKU / acesso) | Guia `companyModules` + Meu perfil + onboarding wizard + `companies.enabled_modules` + `lib/company-modules.js` |
| Motivadores: copy situacional + templates hedged + sync sem DELETE | Guia `motivators` + `npm run db:seed-motivators-all` + `docs/RH2-decisions.md` (B-RH2-20) |
| Super admin (auditoria, leads, sugestões) | Seção `access` (passos 10–11) + `productFeedback` |
| Suporte do piloto (canal, prazo de 1 dia útil, tipo/severidade/módulo, duplicatas) | Seção `productFeedback` (passos 1–4) + FAQ `faqProductFeedback` + `lib/product-feedback.js` |
| Remover módulo da empresa (aviso + confirmação com nomes) | Seção `companyModules` (passo 5) |
| Funil do onboarding (super admin: Empresas → Onboarding) | Ops/admin interno: `docs/BACKLOG-MVP-LAUNCH.md` MVP-08 + `lib/onboarding-funnel.js` (não exposto a gestor) |
| DP leve (ficha / docs / assinatura interna / férias / saldo / template D1) | Seção `dpLight` + FAQ `faqDpLight` / `faqLeaveBalance` |
| Limite mensal de IA por empresa / IA indisponível (kill switch) | FAQ `faqAiLimit` (seção `access`); no teto, o assistente responde pelo Guia (`source: retrieve`). Admin vê o consumo em Empresas → Consumo de IA. Ops: README + `docs/BACKLOG-AI-COST-CONTROL.md` |
| Ponto digital MVP + visão do gestor (Controle de ponto / espelho por período, ajuste com anulação, justificativa, Fechamento) + pedidos de ajuste/abono do colaborador com aprovação (Solicitações) + jornada por colaborador e Feriados + tela de batida com localização (web e app) | Seção `timeClock` (passos 5–14; passo 8 = ponto por colaborador / PJ e Cooperado; 10 = pedidos do colaborador; 11 = aprovação; 12 = jornada; 13 = feriados; 14 = tela de batida e localização) + FAQ `faqTimeClock` + `docs/time-clock-manager.md` |
| Banco de horas calculado (extras − faltas do espelho + lançamentos, teto, congelado no fechamento) | Seção `hourBank` (passo 2) + FAQ `faqHourBank` |
| Banco de horas | Seção `hourBank` + FAQ `faqHourBank` |
| Reativar ex-colaborador / filtro Ex-colaboradores | Seção `b1000Exit` (passos 2 e 7) + FAQ `faqRehire` |
| Mural / kudos | Seção `companyFeed` + FAQ `faqCompanyFeed` |
| OKRs + bônus variável | Seção `b3000Pack` + FAQ `faqOkr` / `faqVariablePay` |
| Ouvidoria / organograma / feedback contínuo | Seção `b3005Pack` + FAQ `faqWhistleblowing` |
| Prep de entrevista | Seção `interviewPrep` + FAQ `faqInterviewPrep` |
| Dev/ops (migrate, env, DTOV) | README / `docs/` / `test/README.md` |

## Exemplos de seções

| Tema | Seção Guia |
|------|------------|
| Jornada D1 + D30/D60/D90 | `b700Onboarding` + `employeeHome` |
| Login colaborador / Minha chegada / OKRs no hub | `employeeHome` (`/e` token ~30d vs `/employee` senha; passo OKRs) |
| 2FA gestor/employee | `access` (Step10) |
| Filtro de empresa / sticky (admin + super admin) | `access` (Step6) + `dashboardCohort` + FAQ `faqDashboardCohort` |
| Auditoria (super admin) | `access` (Step11) + FAQ `faqAudit` |
| Remuneração interna + bônus variável | `compensation` + `b3000Pack` / FAQ `faqVariablePay` |
| Cargos | `b1000JobRoles` (rubrica + faixa mercado opcional) |
| Avaliação formal (competências 90/180/360) | `formalCompetency` |
| Módulos da empresa (SKU / acesso) | `companyModules` |
| LMS / cursos / trilha por cargo | `lmsBasic` (Nova aula unifica vídeo/link ou PDF + descrição; player, quiz, certificado; Cargos → Trilha LMS + auto-enroll no hire, `102`) |
| OKRs (ciclo / peso 0–10 / check-in / assignees) | `b3000Pack` + FAQ `faqOkr` |
| Primeira semana (risco · fit · PDI) | `firstWeek` |
| Roteiro demo | `demoRoteiro` |
| HR Score | `b1000HrScore` |
| Radar de rotatividade | `b1000TurnoverRadar` (+ distribuição low/med/high na Overview) |
| Gráficos lean (padrão) | `b3020Viz` (mapa salarial, calibração, saídas, sucessão, HR Score área, OKR, ouvidoria, turnover, pool de férias) |
| **Para que serve cada tela** | `screens` (mapa aba → função + conexões) |
| **Você é novo / configurar o sistema** | `setupPath` (pré-requisitos e ordem por módulo) + FAQ `faqSetupPath` |
| Motivadores (mapa radar no perfil) | `motivators` + FAQ `faqMotivators` |

**FAQ rápido — novo no sistema:** “sou novo”, “como configurar”, “o que cadastrar antes”, “passo a passo”, “antes de OKR/vaga/PDI” → `faqSetupPath` + seção Guia `setupPath`. O prompt da IA exige listar dependências primeiro.

**FAQ rápido — mapa de telas / contexto:** “para que serve cada tela”, “mapa de abas” → `faqScreens` + seção `screens`. Com a aba aberta, o widget envia `activeTab` / `activeSection`; perguntas “para que serve esta tela”, “dicas desta aba”, “o que posso fazer aqui” e “dicas do sistema” usam `lib/help-screen-context.js` (sem LLM). Sugestões do chat: chips da tela atual + chips de sistema (`suggestSetupPath`, `suggestThisScreen`, `suggestSystemTips`, …).

**FAQ rápido — OKR / ouvidoria / variável:** “como criar OKR”, “Meus OKRs”, “ouvidoria”, “denúncia”, “bônus/PLR” → `faqOkr`, `faqWhistleblowing`, `faqVariablePay` (seção Guia `b3000Pack` / `b3005Pack`).

**FAQ rápido — remuneração:** perguntas com “salário/aumento/reajuste + colaborador/equipe” (ou “lista de salários”) caem em `faqCompensation`. Link canônico da lista: `/dashboard?tab=compensation`; ficha: Equipe → Remuneração (`&section=compensation`). Folha/holerite continua fora de escopo.

**FAQ rápido — coorte admin:** “escolher empresa”, “visão geral vazia”, “comparar pede empresa” → `faqDashboardCohort`. HR Score / radar / cargos → `faqHrScore`, `faqTurnoverRadar`, `faqJobRoles`.

Detalhe operacional da jornada colaborador: [`employee-onboarding-journey.md`](./employee-onboarding-journey.md).

Performance (ops): [`performance-hotpaths.md`](./performance-hotpaths.md) — `LOG_SLOW_MS`, `npm run dtov:explain`.

**Idiomas:** a seção `languages` do Guia (`panel.help.languagesTitle/Body`) cobre troca de idioma, detecção pelo navegador e o fallback para inglês em conteúdo só pt/en. Ao criar chave nova em `panel.help.*`, escreva pt-BR e en; `npm run i18n:translate` gera fr-FR/de-DE depois.

## Manutenção do prompt de produto

Atualize [`PRODUCT-FEATURES-PROMPT.md`](./PRODUCT-FEATURES-PROMPT.md) quando um epic relevante fechar — útil para agentes externos; o assistente in-app usa o Guia, não esse arquivo.

## Referências

- `AGENTS.md` § Pós-implementação
- `.cursor/skills/dev-test-validate/gates.md` § Final validation
- `lib/help-assistant.js`, `lib/help-sections.js`, `HelpAssistantWidget.jsx`
