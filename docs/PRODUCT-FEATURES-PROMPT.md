# Prompt — funcionalidades atuais do 30Grow

Copie o bloco abaixo para um chat / agente quando precisar de contexto de **produto já entregue** (não de backlog). Data de referência: **set/2026**. Fonte: `AGENTS.md`, Guia (`HelpTab` / `panel.help.*`), `docs/BACKLOG.md` (epics fechados), código em `app/` + `lib/`.

---

```
Você está trabalhando no 30Grow (30team) — produto de RH da 3035Tech para perfil de trabalho e recrutamento.

## O que é (e o que NÃO é)
- Instrumento principal: avaliação inspirada no Eneagrama, tipos T1–T9 (estilo de trabalho).
- Instrumento secundário: Motivadores (Assessment Engine em lib/ae/).
- NÃO é diagnóstico clínico, NÃO substitui entrevista técnica, NÃO é DISC nem cópia de baterias proprietárias.
- Linguagem de produto: hedging (“tende a”, “há indícios”). Hipóteses ≠ rótulo definitivo.
- Candidatos NÃO têm conta. Gestores: landpage `/` → CTA “Acessar o sistema” → `/login` → `/dashboard` (roles admin | direction | hr).

## Stack (resumo)
Next.js 16.3.3 App Router + React 19.3 JSX (sem TypeScript) + PostgreSQL 16 + JWT cookie team30_session + Tailwind (tokens brand/pipeline) + i18n pt-BR e en. Multi-tenant por company_id. Scoring autoritativo no servidor. Soft delete em companies/vacancies/users.

## Identidade da pessoa
Hub = tabela candidates (company_id + e-mail). O mesmo candidate_id une:
- Eneagrama (assessments)
- Motivadores (ae_attempts / convites AE)
- People (one_on_ones, hipóteses, briefing, PDI, check-ins, oferta, pré-onboarding)
Não inventar merge por nome nem segundo hub paralelo.

## Superfícies públicas
| URL | Uso |
|-----|-----|
| `/` | Landpage SEO (capacidades, FAQ, ficha, JSON-LD, early access) + CTA → `/login` |
| `/llms.txt` | Inventário plano do produto para crawlers de IA |
| /login | Login gestor; “Esqueceu a senha?” → e-mail `/a/set-password` (72h; SMTP) |
| /t/{token} | Assessment Eneagrama da empresa (time interno; noindex) |
| /v/{token} | Assessment Eneagrama da vaga (candidato; noindex) |
| /assessment/motivators/{token} | Motivadores |
| `/jobs`, `/jobs/{slug}-{id}` | Índice e anúncio SEO da vaga (marketing; distintos do teste) |
| /jobs/remote , /jobs/city/{slug} | Agregadores públicos (massa mínima) |
| /companies/{companySlug} | Carreiras da empresa (opt-in; hero logo+sobre) |
| /r/{token} | Relatório shortlist para o cliente (+ print/PDF) |
| /clima/{token} | Pesquisa de clima anônima (um uso; Likert + texto descritivo) |
| /pulso/{token} | Pulso curto de grupo (anônimo, um uso) |
| `/e/{token}` | Espaço mínimo do colaborador (PDI + combinados + prep 1:1 + LMS; sem conta) |
| `/employee` | Hub do colaborador (senha): chegada, OKRs, mural/kudos, feedback, LMS/DP/ponto |
| `/ouvidoria/{token}` | Canal de ouvidoria anônimo |
| `/a/set-password` , `/a/unsubscribe` | Setup/reset de senha / cancelar job alert |

Nunca misturar: `/t` = time; `/v` = teste candidato; `/jobs` = anúncios; `/companies` = carreiras; `/r` = cliente.

## Painel — abas / módulos (CAP)
Visão geral · Equipe · Compatibilidade · Comparativo · Grupos · Liderança · Vagas · Motivadores · Clima · Empresas (admin) · Usuários (admin) · **B-1000** (Cargos, Avaliações, Sucessão, Saídas, Academy, Benefícios — CAPs dedicadas assignáveis; defaults hr/direction) · Banco de talentos (`vacancies.view`) · Guia · Meu perfil.
Cards Overview (HR Score / Turnover / Exit / Cultura) + analytics: CAP `overview.view`. Usuários/Empresas/Leads: `users.manage` / `companies.manage` (admin-only). GET cargos: `vacancies.manage` **ou** `job_roles.view`.
Overrides por usuário (whitelist de módulos, incl. B-1000). Links públicos já emitidos NÃO são invalidados ao revogar CAP do gestor.
Assistente flutuante de ajuda (B-801): FAQ + retrieval + LLM barato — só navegação/Guia, canto inferior direito.

Gap vs roteiro de demo concorrentes (cliente oculto): `docs/GAP-cliente-oculto-rh.md` — epic **B-1900 entregue** (dossier, tensão de time, workbench, IA interpretativa).

## Funcionalidades entregues (por área)

### Auth e acesso
- Login JWT; roles admin / direction / hr.
- Convite de usuário com /a/set-password (72h) ou senha no cadastro; reenvio de convite.
- Esqueceu a senha (mesmo fluxo de token 72h; resposta genérica anti-enumeration; bump session_version ao concluir).
- Módulos visíveis customizáveis; defaults por role.
- Logout / troca de senha / desativar usuário → sessão derrubada (session_version).
- i18n do painel (pt-BR / en); perfil do gestor (nome, idioma, senha).

### Visão geral (Overview → decisão, B-900)
- Snapshot / métricas da empresa (coorte filtrável).
- Mapa heat T1–T9 + frase hedged de composição (concentração / lacunas).
- Fila de atenção (scorecard incompleto, gaps de hire, retenção, check-ins, PDI, clima…).
- Chip de gaps aprovados vs posições; pulse de clima; fila PDI.
- Mix T1–T9 × rubricas / motivos × tipo / temas de clima / concern ∩ retenção (leituras hedged).

### Equipe
- Lista + kanban de roster; filtros Time interno / Candidatos de vaga / Todos + área, vaga, T1–T9, pipeline, busca.
- Detalhe da pessoa: Briefing e 1:1 · Estilo · Histórico · Cadastro.
- Sub-abas em “Briefing e 1:1”: **Dossier** (visão unificada B-1901) | Briefing | 1:1 | Jornada (PanelSubNav).
- Dossier: perfil + briefing + PDI + desempenho + retenção + HR Score + clima da empresa (anônimo) + IA interpretativa opcional.
- Cadastro/perfil: dados de contato + notas RH em rich text; LinkedIn; marcar funcionário / status de pipeline.
- Adicionar à vaga (pool): vincula candidato existente a outra vaga aberta.
- Timeline do candidato (cadastro, convites, testes, estágios, hire).
- Export CSV de avaliações (cap de linhas + stream).

### People (gestão)
- Briefing de decisão (HrActionBrief): alertas, faça/evite, perguntas de entrevista, dicas de composição com o time — a partir de Eneagrama + Motivadores. Imprimir / PDF (one-pager). Fit vs núcleo do time no briefing quando houver.
- Mesmo briefing no detalhe do candidato na vaga (“Notas / ações”) + faixa Fit (por quê / o que sondar) + checklist orientativo “Pronto para contratar?”.
- Hipóteses de gestão (tom “tende a”) + registro de 1:1 (data, notas ricas, próximos passos) — separado de hr_notes de triagem.
- Notificação in-app retention_watch (limiar RETENTION_WATCH_MIN_SCORE, padrão 55); deep-link Equipe; card Atenção na Overview; fluxo acionável (pergunta + plano PDI + marcar revisão).
- Notificação hire_onboarding_kit ao marcar contratado.
- PDI: planos + itens; editar/arquivar; seed da síntese; vínculo opcional a 1:1; checkbox feito; barra de progresso; ciclo (período); responsável; converter próximos passos do 1:1; Overview lista + fila.
- Check-ins pós-hire D30/D60/D90: criados no hire; bloco na Equipe; Overview atrasados/próximos 14d; outcome develop/concern → item PDI (onboarding).
- Checklist D1 (pré-onboarding leve): kit de boas-vindas, call RH, onboarding gestor — status pending/done/skipped + notas.
- Jornada contínua (HireJourneyBlock): D1 → check-ins → PDI na sub-aba Jornada.
- Oferta mínima no funil (salário, data início, status proposed/accepted/declined, notas) — não é ATS de documentos.
- Pulso de grupo: Grupos → grupo salvo → /pulso/{token}; interpretação hedged + mix T1–T9.
- Link do colaborador /e/{token}: PDI, combinados, prep 1:1 (marcar preparação + nota ao gestor), LMS.
- Sessão /employee (B-2500): magic link por e-mail; inbox (Motivadores, LMS, PDI) + marcar aulas.
- Ranking: explicar Fit (pesos × T1–T9; exclusões) — VacancyFitDecisionStrip.
- Retenção: lista de acompanhamentos + marcar revisão com nota.
- Clima: ver seção Clima abaixo.

### Clima
- Aba Clima (climate.view): campanhas anônimas por empresa; perguntas Likert + texto descritivo; abrir/encerrar; link /clima/{token} (um uso).
- Médias agregadas só após mínimo de respostas; barras por pergunta; benchmark com média geral e Δ; temas agregados; pulse na Visão geral.
- Lote de links / e-mail; comparativo entre campanhas.

### Análises de perfil
- Compatibilidade: pares / matriz sinergia–tensão–neutro (caps).
- Comparativo: lado a lado de perfis.
- Grupos: base + membros; tensões internas; composição do núcleo; grupos salvos por empresa.
- Liderança: analytics (caps).
- Ranking da vaga: aderência rubrica + coluna vs time interno (sinergia/tensão).

### Vagas e recrutamento
- CRUD em drawer (lista primeiro): título, status, posições, data-alvo, contrato, modalidade/UF/cidade IBGE, faixa salarial, descrição rica.
- Assistência de descrição: template de seções + “Criar/melhorar com IA” (OpenAI opcional).
- Rubrica por vaga: pesos T1–T9 (não muda o teste); aderência 0–10; sugestão/geração com IA opcional.
- Links: `/v` (teste) e `/jobs/{slug}-{id}` (página pública: ativar, indexar, mostrar empresa, salário); score de completude SEO.
- Cadastro de candidatos (e-mail = chave); convite eneagrama por e-mail; notes ricas; scorecard 1–5 (perguntas do briefing).
- Pipeline kanban: new → interview → test_completed → screening → approved → hired | rejected | archived (drag-and-drop; rejeição com motivo; hire com data de início; auto-close ao preencher posições). Badge aging “N d” (≥7 / ≥14) no kanban da vaga e da Equipe.
- Detalhe da vaga: Pipeline e Candidatos em evidência; Aderência, Funil, Indicação, Relatório e Config em “Mais…”.
- Clonar vaga (campos + rubrica; sem candidatos; página pública off).
- Funil analytics (views → apps → entrevistas → hires; UTM/ref) — precisa página pública.
- Indicação: códigos ?ref= (escopo vaga ou empresa).
- Relatório cliente /r: shortlist + parecer (≥80 chars); modelos / IA opcional; validade 7/14/30 dias; revogar; editar parecer ativo; preencher parecer a partir do briefing; Imprimir / PDF.
- Notificações: prazo da vaga, vaga fechada, teste concluído, kit pós-hire, digest semanal do gestor, etc.

### Página pública / SEO
- Índice `/jobs` (busca, filtro contrato, paginação); JobPosting JSON-LD; sitemap/robots.
- Share WhatsApp/LinkedIn/copiar com UTM; cookie de atribuição sem PII.
- Job alerts por e-mail + unsubscribe.
- Agregadores /jobs/remote e /jobs/city/{slug}.
- Perfil /companies/{slug} (opt-in: site, sobre rich text, logo S3; hero + breadcrumb).
- Google Indexing API (opt-in via env; mock em DTOV).

### Motivadores (AE)
- Banco situacional v4 (linguagem de trabalho; dimensões só no servidor).
- 13 dimensões + grupos de leitura + cores de dimensão; insights faça/evite; NÃO entra no ranking de aderência da vaga.
- Dashboard RH + Convites (1 a 1 ou lote do time interno, cap 25) + Resultados; config avançada do banco (permissão).
- Sync/desativar perguntas; nunca DELETE de ae_questions com tentativas.

### Empresas e usuários (admin)
- Empresas: drawer (site, logo S3, sobre, opt-in carreiras `/companies/{companySlug}`).
- Usuários: criar em 2 passos (identidade → módulos); editar; reenviar convite; soft delete.

### Guia e ajuda
- Guia do painel (HelpTab) com passos por fluxo + catálogo T1–T9.
- **Roteiro de demo (7 passos)** (`demoRoteiro`): assessment → Motivadores → Equipe/Dossier → Compat/Grupos → Overview → Avaliações/PDI → Cultura/Exit/Sucessão.
- Mapa do sistema (HelpSystemMap): diagrama BPM em faixas + tabela de links públicos.
- Assistente flutuante (HelpAssistantWidget): FAQ + retrieval sobre **todo** o Guia (`HELP_GUIDE_SECTIONS` em `lib/help-sections.js`); ver `docs/help-assistant-knowledge.md`.
- Jornada colaborador: checklist D1 (kit, acessos, Meet RH/gestor) + D30/D60/D90; colaborador vê **Minha chegada** em `/employee` — `docs/employee-onboarding-journey.md`.
- 2FA opcional (gestor + colaborador); auditoria append-only (super admin).
- Chrome admin consistente: empty states com 1 CTA; Vagas com `AdminEdit`/`AdminDelete`; dark `bg-surface` no painel (print/público light-first).
- Roster empty com CTAs (Time interno → candidatos de vaga / todos); Overview “Sinais operacionais” lazy; busca por nome nas grids B-1000 + Empresas.
- **Aniversários (B-2300):** Overview card (nascimento + tempo de casa via `start_date` + aniversário da empresa); `birth_date` na Equipe; `anniversary_date` em Empresas.
- **LMS (B-2400 + B-2401):** menu LMS → Cursos; aulas URL/PDF (S3); matrícula individual/lote/turma; prazo + obrigatório; progresso no `/e` e em `/employee` (marcar/desmarcar); PDI↔curso; Overview/Equipe atraso; notifs + cron overdue. Academy continua catálogo PDI (sem progresso).
- **Login colaborador (B-2500):** convite set-password → `/employee`; cookie `team30_employee_session`; hub PDI/LMS/tarefas/empresa. Equipe → Convidar acesso.

### Notificações e ops
- Sino in-app (Eneagrama/Motivadores concluídos, retention_watch, kit pós-hire, digest semanal, prazo, vaga fechada).
- Crons: lembretes de convite, deadline de vaga, retenção de notificações, digest semanal (CRON_SECRET).
- Retenção LGPD: purge em lotes (admin).
- Health endpoints; audit de ações sensíveis.
- Feedback UI: confirm/notice/promptForm/toast (nunca window.confirm/alert/prompt).
- Notas ricas: RichTextEditor + RichTextView + sanitize-html.

### Qualidade / provas
- DTOV (Postgres efêmero) + HTTP smoke + Playwright; npm run test:full:offline / dtov:full-app.
- Após feature: atualizar README/docs + Guia; rodar Dev → Test → Validate.

## Regras duras ao propor/implementar
1. Reutilizar componentes (app/_components, dashboard-shared) e helpers (lib/) antes de criar.
2. i18n pt-BR + en; tokens Tailwind/theme; sem segundo design system; sem TypeScript/src/.
3. Tenant company_id; SQL parametrizado; query vs queryRead; paginação/caps; sem N+1.
4. Após implementação de produto: docs/Guia + Dev→Test→Validate (DTOV quando tocar SQL/API/dados).
5. Não inventar DISC, conta de candidato, merge por nome, ou segundo hub de pessoa paralelo a candidates.
6. Backlog aberto está em docs/BACKLOG.md — itens removidos = já entregues (não reimplementar).
7. UI: lista antes de formulário; progressive disclosure; uma tarefa principal por viewport.

## Onde olhar no código
- Domínio / regras: AGENTS.md
- People / jornada: lib/people/* (decision-brief, onboarding-checkins, pre-onboarding, candidate-offer, development-plans, climate-*, team-pulses, employee-portal…)
- Equipe UI: PeopleManagementPanel, HireJourneyBlock, HrActionBrief, OnboardingCheckinsBlock
- Motivadores: lib/ae/*, app/api/ae/*, app/api/admin/ae/*
- Vagas/pipeline: lib/pipeline.js, lib/hire.js, app/dashboard/vacancies/*, VacancyFitDecisionStrip, VacancyOfferBlock
- Público SEO: docs/job-seo-and-distribution.md, app/jobs, lib/job-*
- Landpage SEO: `app/page.jsx`, `lib/product-landing-seo.js`, `ProductLandingClient`, `/llms.txt`
- Blog: `app/blog/*`, `lib/blog/*` (artigos estáticos pt-BR), `BlogPostCard`; entra em `app/sitemap.js` e `/llms.txt`
- Guia / mapa / assistente: HelpTab, HelpSystemMap, HelpAssistantWidget + panel.help.* / panel.assistant.*
- Auth reset: lib/user-password-invite.js, POST /api/auth/forgot-password
```

---

## Uso sugerido

| Contexto | Como usar |
|----------|-----------|
| Ideação / roadmap | “Com base neste mapa do 30Grow, proponha a próxima feature de maior valor sem duplicar o que já existe.” |
| Implementação | Colar o prompt + pedido específico; reforçar “reusar antes de criar”. |
| Onboarding de agente | Colar no início da sessão junto com `AGENTS.md`. |
| Pitch / vendas | Usar as seções “O que é”, superfícies públicas e pilares (recrutar / perfil / time / pós-hire). |

Atualize este arquivo quando um epic relevante fechar (ex.: novo módulo no painel ou superfície pública nova).
