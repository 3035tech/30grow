# `test/` — pacote de provas (não é produto)

Separado de `scripts/` (migrate/seed/ops) e de `app/` / `lib/` (código do 30Grow).

```
test/
  dtov/                 # Postgres efêmero + regressão SQL/HTTP
    docker-compose.dtov.yml
    harness.js          # reset | up | down | migrate | seed | smoke
    fixtures/           # massa demo (catalog.json + seeders)
    full-regression.js  # SQL + libs offline
    http-smoke.js       # APIs / páginas via fetch (People/1:1 via candidato fixture)
    ai-usage-proof.js   # teto de IA por empresa (admin → 429 AI_MONTHLY_LIMIT → Ajuda pelo Guia → ai_usage_events → relatório /api/admin/ai-usage); servidor :3010 no ar
    run-full-app.js     # orquestra SQL → Next :3010 → HTTP → Playwright
  e2e/                  # Playwright (Chromium) — layout e navegação
    browser-smoke.spec.js
    pilot-primary-journey.spec.js # aceite: vaga pública → pipeline → Equipe
    assessment-submit.spec.js   # B-001: /t assessment completo → resultado
    vacancy-kanban-dnd.spec.js  # B-002: DnD kanban da vaga (HR)
    fixtures.js         # tokens/creds + helpers (login, e-mail único, HTML5 DnD)
  unit/                 # One-offs / unitários (sem Playwright)
    ae-scoring.js       # scoring Motivadores offline
    motivators-invite-flow.js  # bootstrap + insert de convite (precisa Postgres)
    decision-brief.js          # estrutura do briefing acionável (B-301)
```

Config Playwright na raiz: `playwright.config.js` (`testDir: ./test/e2e`).

Wrappers legados em `scripts/test-*.js` só reexportam `test/unit/*`.

## Comandos

| npm | O quê |
|-----|--------|
| `dtov:reset` | Sobe Postgres :55432 + Redis :56379, migrate, seed, smoke SQL |
| `dtov:explain` | `EXPLAIN` checklist dos hot paths (só DTOV; ver `docs/performance-hotpaths.md`) |
| `dtov:full` | Reset + regressão SQL/libs |
| `dtov:full-app` | Reset + SQL + Next + HTTP + browser |
| `test:http` | Só HTTP (app já no ar) |
| `test:browser` | Só Playwright (app já no ar) |
| `test:ae-scoring` | Unitário offline do scoring Motivadores |
| `test:full:offline` | Só libs offline (inclui SMTP/OpenAI mock + Indexing) |
| `db:test-motivators` | Fluxo de convite Motivadores (Postgres + migrate) |
| `DTOV_SKIP_BROWSER=1 …` | Pula Chromium no full-app |

Provas pontuais em `test/dtov/*.dtov.test.js` rodam com o env do harness (após `dtov:reset`), ex.: `node --input-type=module -e "import {dtovEnv} from './test/dtov/harness.js'; import {spawnSync} from 'node:child_process'; process.exit(spawnSync('node',['test/dtov/perf-sweep.dtov.test.js'],{env:dtovEnv(),stdio:'inherit'}).status)"` (sucessão em lote, HR Score com fan-out limitado, sessão em 1 query, índices da migration 138). `dtovEnv()` já define `NEXT_PUBLIC_APP_URL=http://127.0.0.1:3010` se ausente (fluxos de convite/senha). Testes que tocam Redis devem chamar `closeRateLimitRedis()` no fim, senão o processo não encerra.

Suporte do piloto e onboarding (migration 145): `product-feedback.dtov.test.js` (severidade, módulo pela aba, prazo de 1 dia útil, duplicatas, filtros, atrasados) e `onboarding-funnel.dtov.test.js` (eventos idempotentes, `CHECK` de domínio, funil por etapa e primeiro valor). Helpers puros em `test/unit/pilot-support-onboarding.unit.test.js`.

Playwright aceita `BASE_URL` em `127.0.0.1` ou `localhost`: `next.config.js` libera `127.0.0.1` em `allowedDevOrigins` (sem isso o Next 16 bloqueia o HMR e a página não hidrata).

### Mocks SMTP / OpenAI (B-003)

Sem serviços externos: envios de e-mail e assistentes de IA usam stub in-process.

| Env | Comportamento |
|-----|----------------|
| `SMTP_MOCK=1` | `sendTransactionalMail` grava em memória (`__getMailMockLog`); `isMailConfigured()` = true |
| `DTOV=1` sem `SMTP_HOST`+`MAIL_FROM` | mesmo mock SMTP automático |
| `OPENAI_MOCK=1` ou `DTOV=1` | `openAiChatCompletion` devolve stub (JSON pesos / HTML); health marca `mocked` |
| SMTP real opcional | apontar `SMTP_*` para Mailhog (`1025`) se quiser captura via UI — **não** está no compose DTOV |

Prova: `npm run test:full:offline` (checks `smtp-mock-capture` e `openai-mock-assistants`).

Provas relevantes à página pública / funil / referral (epic B-100 / **B-126**):

| Camada | Cobertura |
|--------|-----------|
| Offline libs | `slugify` (acentos), JobPosting (open/closed/noindex/expirada), share UTM, cookie atribuição, referral normalize, canonical `/j`, Indexing mock, **SMTP mock** (`SMTP_MOCK` / DTOV sem SMTP), **OpenAI mock** (`OPENAI_MOCK` / `DTOV=1`), SEO score, job-alerts gates, índice `/j` paged — `full-regression.js` |
| SQL | sitemap só abertas indexáveis; funil/referral seed — fixture `public-vacancy-page` |
| HTTP | `/j`, redirects legado, `team30_job_attr`, analytics, referral CRUD — `http-smoke.js` |
| Browser | páginas públicas + navegação vagas — `browser-smoke.spec.js` |
| Browser | assessment completo (/t) até thank-you — `assessment-submit.spec.js` (~3 min; 54 Likert) |
| Browser | kanban vaga DnD (Nina new→interview) — `vacancy-kanban-dnd.spec.js` |
| Browser | early-access `/signup` → set-password → login — `signup-early-access.spec.js` |
| HTTP | early-access signup completo (create/resent/activate/login/409) — suite `signup` em `http-smoke.js` |
| HTTP | session revocation (`notifications-revoked`, `dashboard-revoked-middleware`), health header-only, employee login/home, compensation — `http-smoke.js` |
| HTTP | anti-crawler camada 1 (`robots.txt` tokens, `X-Robots-Tag` /v vs /jobs) — `http-smoke.js` |
| Security (opcional) | OWASP ZAP baseline — `scripts/security-zap-baseline.sh`, `test/security/README.md` |

Rodar tudo: `npm run dtov:full-app`.

Só Playwright (app + DTOV já no ar em `:3010`):

```bash
npm run test:browser
# gate completo do piloto (DTOV + HTTP + browser + matriz tenant)
npm run release:pilot-check -- --full
# ou um spec:
npx playwright test test/e2e/assessment-submit.spec.js
npx playwright test test/e2e/vacancy-kanban-dnd.spec.js
npx playwright test test/e2e/pilot-primary-journey.spec.js
```

O aceite visual do piloto conecta a vaga pública ao pipeline autenticado e à
Equipe. Submissão da avaliação e drag-and-drop ficam em specs mutáveis separados.

**Flakes:** assessment depende do fade ~280ms entre questões (timeout do spec 180s). Kanban usa `DataTransfer` sintético (HTML5) porque o `dragTo` do Playwright nem sempre preenche `dataTransfer` nos handlers React; o spec é idempotente (move Nina a partir da coluna atual).

## Onde **não** colocar

- Seeds de demo “reais” / migrate → continuam em `scripts/`
- Código de produto → `app/`, `lib/`, `migrations/`
- Artefatos Playwright (`test-results/`, `playwright-report/`) → gitignored
