# Performance hot paths (B-2800 / B-2801 / B-2802)

Checklist operacional após os sprints Perf-A/B/C e P3 (colaborador). Não substitui o DBA checklist em `AGENTS.md`.

## Baseline P2 (já no produto)

| Peça | Onde |
|------|------|
| SSR só da aba ativa | `app/dashboard/page.jsx` + `load-dashboard-data.js` |
| Caps compat / intel | `COMPAT_PEOPLE_CAP`, `COMPAT_PAIR_PAYLOAD_CAP` |
| Vagas paginadas | `lib/vacancies-admin.js` |
| Índices | `migrations/006_performance_indexes.sql`, `061_performance_indexes.sql`, `079_candidates_name_trgm.sql` |
| Pool PG | `PG_POOL_MAX` em `lib/db.js` |
| Export streamado + cap | `lib/export-assessments-csv.js` / `EXPORT_MAX_ROWS` |
| Slow query log | `LOG_SLOW_MS` + `lib/monitoring.js` / `lib/db.js` |
| Troca de aba percebida | `useDashboardNavigation` (`router.push` em `useTransition` → `navPending` / `pendingTab`): destaque do menu, título, `NavLoadBar` e skeleton na hora do clique |
| Pré-carga de aba | `app/dashboard/dashboard-tab-preload.js`: chunk JS da aba no hover/focus/touch do menu (mesmo `import()` do `dynamic()`) |

**Medição set/2026 (DTOV, gestor RH demo):** servidor em produção (`next start`) responde a troca de aba (payload RSC) em ~20–300 ms; `next dev --webpack` leva ~86 s na primeira compilação do `/dashboard` e ~100–300 ms depois. Painel baixa ~2,6 MB de JS (~800 KB gzip) na entrada. Lentidão percebida em dev = compilação sob demanda; em prod = falta de feedback no clique (corrigido acima).

## P3 — colaborador + gaps (B-2802)

| Peça | Onde |
|------|------|
| Home colaborador paralelo + PDI batch | `lib/employee-home.js`, `listActiveDevelopmentPlansWithItems` |
| Portal `/e` | `lib/people/employee-portal.js` |
| Inbox pesquisas (batch invite + reads) | `lib/employee-surveys.js` — 1 upsert batch, sem N+1 |
| Jornada GET sem ensure | `getEmployeeOnboardingJourney({ ensure })` — ensure no hire/admin |
| Clima aggregate SQL + benchmark batch | `lib/people/climate-surveys.js` |
| Sucessão readiness batch | `lib/succession-plans.js` |
| HR Score cache TTL | `getHrScore` → `hr-score-cache.js`; invalidate em `saveHrScore` |
| Caps assessments / timeline | `candidates/[id]` LIMIT 30; `buildCandidateTimeline` caps |
| LMS lessons por curso | `ROW_NUMBER` ≤ `LMS_LESSON_CAP` |
| `notifyCandidates` unnest | `lib/employee-notifications.js` |
| Crons em chunks paralelos (20) | LMS overdue + vacancy deadlines |
| Mail retry (até 3) | `lib/mail.js` / `MAIL_RETRY_ATTEMPTS` |
| HTTP cache público curto | `/api/public/vacancy-link`, `company-link`; `/api/health` max-age=5 |
| Code-splitting dashboard | já via `next/dynamic` em `DashboardClient` |
| CDN | infra (Cloudflare na borda) — sem mudança de app |

## Medir (P2)

Env:

- `LOG_SLOW_MS` — default `1000` (queries e `measureAsync`)
- `LOG_LEVEL` — `info` / `warn` / …

Operações nomeadas (warn + breadcrumb Sentry se DSN):

- `dashboard.overviewMetrics`
- `dashboard.compatBundles`
- `hrScore.recalculateCompany`
- `turnover.getCompanyRisks`
- `vacancies.listCandidates`
- `vacancies.ranking`

Buscar em logs JSON: `"message":"Slow operation detected"` ou `"Slow Postgres query"`.

## Varredura de performance (set/2026)

Navegação, carregamento e salvamento. Sem mudança de API nem de regra de negócio.

**Bundle / cliente**
- Catálogos i18n fora do bundle inicial: `lib/i18n/bundled-catalogs.js` só no servidor; no browser o webpack troca por `bundled-catalogs.client.js` (vazio) e `lib/i18n-client.js` carrega o chunk do locale (`i18n-pt-BR`, `i18n-en-US`, …). `I18nBoot` (layouts/páginas) suspende a hidratação até o catálogo chegar; `useLocale.setLocale` carrega antes de trocar.
- `next/dynamic` para tour/wizard de onboarding, radar de motivadores e Sentry Replay (lazy integration).
- Grupo: derivados (`groupBase`, sugestões, tensões) só com a aba ativa, com `Map`/`Set`; `PersonMini` no escopo do módulo (não remonta a cada render).
- Notificações: throttle de 2 s, sem fetch duplicado no mount; clique navega antes do PATCH (otimista, `keepalive`).
- Playbook do persona: cache de 60 s por papel/aba e sem fetch quando o card foi dispensado.
- Busca global com `AbortController` (resposta lenta não sobrescreve a nova).

**Salvamento sem “piscar”**
- Equipe: `loadDetail(id, { silent: true })` após salvar (1:1, PDI, OKR, etapa, retake): mantém a pessoa montada, descarta resposta atrasada se trocar de pessoa.
- LMS, DP, PDI, OKR: skeleton só na primeira carga por chave; recargas após salvar ficam no lugar. LMS recarrega detalhe + lista em paralelo.
- Kanban de vaga: mover card é otimista (rollback se o PATCH falhar).
- Clima: lista + benchmark e detalhe + agregado em paralelo (antes 4 requests em série).

**Servidor / SQL**
- Sessão do gestor: `enabled_modules` vem no mesmo SELECT de `users`; overrides de capability e cache Redis em paralelo (4 idas sequenciais → 2). Perfil do chrome (`resolveDashboardAuth`) em paralelo com a hidratação.
- Proxy: `/api/*` não faz mais self-fetch de `session-edge` (todas as rotas já re-hidratam a sessão com `session_version`); páginas continuam com a checagem para o redirect `reason=expired`.
- `load-dashboard-data`: vagas, rubrica da vaga, contagem por área, cadeia de área e rubricas em `Promise.all`; página da Equipe especulativa em paralelo com a contagem (re-consulta só se a página for ajustada); onboarding em paralelo com o overview.
- Sucessão: sucessores de todos os papéis em 1 query (`ROW_NUMBER() OVER (PARTITION BY critical_role_id)`), antes 1 por papel.
- Migration `138_performance_indexes_hotpaths.sql`: `manager_notifications (type, entity_id, created_at)`, `ae_invites (company_id, candidate_id)`, `candidate_invites (vacancy_id, candidate_id)`, `ae_attempts (company_id, candidate_id, completed_at) WHERE completed`, `climate_survey_responses (company_id, submitted_at)`, `vacancy_candidates (company_id|vacancy_id, pipeline_stage)`, `assessment_pipeline_history (assessment_id, changed_at DESC NULLS LAST, id DESC)`.

**Banco de horas incremental (B-2804.1, migration 148)**
- O saldo parte do mais recente entre fechamento e checkpoint diário (`hour_bank_checkpoints`, cron `hour-bank-checkpoints`): custo ∝ pessoas × ~32–39 dias, não × dias desde o início do banco.
- Marcações, justificativas e lançamentos são lidos por janela própria de cada pessoa (`unnest(ids, from_days)` + range scan em `idx_time_punches_candidate_day` / `idx_hour_bank_candidate`), sem over-fetch pelo mínimo do lote.
- Cache seguro: triggers invalidam em toda entrada do cálculo; lock consultivo por empresa evita corrida cron × edição. Detalhe: `docs/time-clock-manager.md` § Banco de horas.

**Avaliação formal em lote (B-2804.2/3)**
- Publicar ciclo: `publishFormalReviewCycle` faz as mesmas validações e escritas de `openFormalReview` para todas as avaliações em 6 queries fixas (antes ~15–20 por pessoa dentro da transação com lock do ciclo). Primeira avaliação inválida por id decide o erro; a rota faz rollback. As regras de abertura ficam numa função pura única (`formalReviewOpenError`), usada pelos dois caminhos (prova: `test/unit/formal-review-open-rules.unit.test.js`).
- Confirmação: `GET /api/admin/formal-review-cycles/[id]/respondents` devolve a matriz do ciclo (cap 200 + total) em 2 queries; antes o cliente fazia 1 GET de detalhe por pessoa e só via as 40 da lista.
- Trocar questionário: 1 `INSERT … SELECT unnest … WITH ORDINALITY` por tabela (competências do ciclo, perguntas abertas, itens de todos os rascunhos).
- Prova: `test/dtov/formal-cycle-publish-batch.dtov.test.js` (lote = caminho por avaliação em 90/180/360 com autoavaliação, contagem de queries, rollback, troca de questionário).

**HR Score em lote (B-2804.4)**
- `recalculateCompanyScores`: além das 8 leituras em lote dos sinais, tendência de risco em 5 queries (`detectTrendChanges`: riscos salvos + `loadTurnoverRadars`) e notas de 1:1 em 1 (`loadRecentOneOnOneNotes`), lidas antes de gravar; predições sem query (`predictionsFromSignals`; `profile_fit` não é persistido); 1 upsert `unnest` (`saveHrScores`). Antes: ~9 queries por pessoa. Notificação de piora só para quem piorou, depois do upsert.
- Um único cálculo do radar (`loadTurnoverRadars`) serve o radar individual, a lista da empresa (`getCompanyTurnoverRisks`) e a tendência; `notifyTurnoverRiskChanges` também usa o lote.
- Recálculo de uma pessoa (`GET /api/admin/hr-score/[id]` quando vencido, `POST …/recalculate` com `candidateId`): `recalculateCandidateHrScore`, mesma regra tendência → grava → notifica.
- Prova: `test/dtov/hr-score-batch.dtov.test.js` (lote = caminho por pessoa em radar, tendência e predições; contagem de queries igual para 3 ou 40 pessoas; notificação de piora; `saveHrScore` individual).

Pendências maiores (escopo/risco) estão em `docs/BACKLOG.md` § Performance.

## EXPLAIN checklist (DTOV)

```bash
npm run dtov:reset
npm run dtov:explain
npm run dtov:down
```

Script: `scripts/explain-hotpaths.js` (recusa host ≠ DTOV).

Aceite manual: planos sem Seq Scan óbvio nas tabelas quentes (`assessments`, `candidates`, `vacancy_candidates`, `ae_attempts`) no tenant demo. Seq Scan em demo pequeno pode ser ok — revalidar com volume real.

## Caps de referência (após B-2800 / B-2802)

| Cap | Valor |
|-----|-------|
| Compat people | 150 |
| Compat pair payload | 120 |
| Vacancy candidates page | ≤300 |
| Vacancy ranking | 200 |
| Job roles list | 500 |
| Companies `forSelect` | 500 |
| Leadership scores sample | 800 |
| Leadership potentials scan | 500 |
| Turnover employee scan | 500 |
| Candidate assessments (detail API) | 30 |
| Timeline events | 120 |
| LMS lessons / course (employee list) | 60 |
| Employee notify batch | 200 |
| Cron notify chunk | 4 (`DB_FANOUT_CONCURRENCY`, `lib/concurrency.js`) |
| Fan-out por item com várias queries (notificação de piora no HR Score lote, resultados de avaliação formal) | 4 em paralelo (`mapWithConcurrency`) |
