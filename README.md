# 30Grow

> Gestão de pessoas e recrutamento orientados a perfil de trabalho. Next.js + PostgreSQL + Docker/K8s.

Avaliação baseada no **modelo do Eneagrama** (tipos **T1–T9**) e em **Motivadores** (Assessment Engine): mapa de perfil de trabalho para triagem, comparativos e conversas. **Não** substitui entrevista técnica nem é diagnóstico clínico.

Sobre isso o produto cobre o ciclo da pessoa na empresa: vagas e funil, contratação, onboarding, PDI, 1:1, clima, OKRs, DP (ponto, férias, documentos), remuneração, LMS, análise demissional e recontratação, além do portal do colaborador (`/employee`) e do app mobile (`../30-team-app`).

| Onde ler | O quê |
|----------|-------|
| [`docs/FEATURES.md`](docs/FEATURES.md) | Catálogo de funcionalidades por área |
| [`docs/modules-reference.md`](docs/modules-reference.md) | Referência técnica por módulo (APIs, libs, migrations, fluxos) |
| [`AGENTS.md`](AGENTS.md) | Regras de arquitetura, UI/UX, DBA e constantes de domínio |
| [`test/README.md`](test/README.md) | Provas: DTOV (Postgres efêmero), HTTP smoke, Playwright |
| [`migrations/README.md`](migrations/README.md) | Schema canônico e convenções de migration |
| [`docs/release-runbook.md`](docs/release-runbook.md) | Homologação, produção e rollback |
| [`docs/job-seo-and-distribution.md`](docs/job-seo-and-distribution.md) | Página pública da vaga, SEO, Indexing API, funil |
| [`docs/analytics-api.md`](docs/analytics-api.md) | API de relatórios para integrações |
| [`docs/help-assistant-knowledge.md`](docs/help-assistant-knowledge.md) | Guia do painel e assistente de Ajuda (IA) |
| [`docs/privacidade-lgpd-interno.md`](docs/privacidade-lgpd-interno.md) | LGPD interno; públicas em `/privacy` e `/terms` |
| [`docs/BACKLOG.md`](docs/BACKLOG.md) | Ideias pendentes |

---

## Stack

```
Navegador (React) → Next.js (App Router, Proxy) → PostgreSQL 16 (+ réplica opcional) · Redis opcional
```

| Camada | Detalhe |
|--------|---------|
| Frontend | React 19.3 + Next.js 16.3.8 (App Router) + **Tailwind CSS** (tokens em `tailwind.config.js` / `lib/theme.js`). JSX, sem TypeScript |
| Backend | API Routes finas + regras em `lib/` · `pg` com SQL parametrizado (`query` primário / `queryRead` réplica) |
| Auth gestor | Tabela `users` + JWT em cookie httpOnly `team30_session` (8h, sliding; `session_version` revoga) |
| Auth colaborador | `team30_employee_session` (12h) em `/employee`; candidato **não** tem conta (links por token `/t`, `/v`, `/r`, `/e`) |
| Roles | `admin` (única cross-tenant), `direction`, `hr` · capabilities em `lib/permissions.js` (`CAP`) |
| Observabilidade | Logs JSON em stdout, Sentry opcional, `GET /api/health` e `/api/health/status` |
| Runtime | Node **22** (imagem `node:22-alpine`) |

## Estrutura

```
app/                  páginas e API Routes (finas)
  dashboard/          painel do gestor (SSR só da aba ativa; Guia = HelpTab)
  employee/           portal do colaborador (LMS, DP, ponto, OKRs, PDI)
  t/ v/ r/ e/         entradas públicas por token (assessment, relatório, pós-hire)
  jobs/ companies/    páginas públicas de vagas e carreiras (SEO)
  api/                admin, auth, public, employee, mobile/v1, cron…
lib/                  regras: scoring, pipeline, i18n, mail, db, permissões
  ae/                 Motivadores (separado do T1–T9)
migrations/           schema canônico (hoje até 136)
scripts/              migrate, seeds, ops
test/                 DTOV + unit + Playwright
docs/                 referência, runbooks, LGPD, backlog
```

Na raiz só há `init.sql` (stub de montagem Docker). Schema e deltas ficam em `migrations/`.

---

## Quickstart

### 1. Configurar

```bash
cp .env.example .env
# Ajuste POSTGRES_*, JWT_SECRET, BOOTSTRAP_ADMIN_*, NEXT_PUBLIC_APP_URL
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"   # JWT_SECRET
```

### 2. Rodar

| Modo | Comando |
|------|---------|
| Docker (produção local) | `docker compose up -d` → http://localhost:3000 |
| Docker com hot reload | `docker compose -f docker-compose.dev.yml up` |
| Local (Postgres já rodando) | `npm install && npm run db:migrate && npm run dev` |

- Landpage: `/` (CTA early access → `/signup`)
- Painel: `/login` ("Esqueceu a senha?" envia link `/a/set-password`, 72h; requer SMTP)
- Colaborador: `/employee/login`
- Teste público: crie uma empresa no painel e abra o link `/t/<token>`

### 3. Dados de demonstração

```bash
# Eval 20 (tenant eval-20-demo) · login admin@eval-20.demo / EvalDemo!2026
psql "$DATABASE_URL" -f scripts/seed-eval-20-employees.sql

# Todos os Dados (tenant todos-os-dados-demo; todos os módulos)
#   hr@todos-os-dados.demo · direction@todos-os-dados.demo → /login
#   colaborador@todos-os-dados.demo → /employee
#   senha: DemoTodosDados!2026
npm run db:seed-demo-todos-os-dados:confirm

# Board /jobs (10 empresas demo-board-*, 50 vagas) · hr@demo-board-nortech.demo / DemoBoard!2026
npm run db:seed-demo-client-jobs-board:confirm

# Motivadores (perguntas + templates)
npm run db:seed-motivators-all

# Super admin sem empresa fixa (SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD no .env)
npm run db:create-super-admin
```

Os scripts `:confirm` apagam e recriam **apenas** o tenant de demo correspondente (`CONFIRM_DEMO_PURGE=1`). As senhas podem ser trocadas via `DEMO_TODOS_PASSWORD`, `DEMO_BOARD_PASSWORD` e `DEMO_30PAY_PASSWORD`.

---

## Banco de dados

| Comando / arquivo | Quando usar |
|-------------------|-------------|
| `npm run db:migrate` | Aplica `migrations/*.sql` pendentes (idempotente) |
| `npm run db:validate-schema` | Gate somente leitura: migrations aplicadas + contrato mínimo |
| `scripts/rds-bootstrap-completo.sql` | Postgres novo: bootstrap base; depois `npm run db:migrate` |
| `scripts/scripts-banco-pendentes.sql` | Bundle das migrations recentes para pgAdmin |
| `npm run db:seed` / `npm run db:clear` | Massa sintética de desenvolvimento |

Em produção, aplique as migrations **antes** de subir a imagem nova (as migrations são expansivas; a versão anterior tolera colunas novas). Detalhe em [`docs/release-runbook.md`](docs/release-runbook.md).

---

## Testes

| Comando | O quê |
|---------|-------|
| `node --experimental-vm-modules --test test/unit/*.test.js` | Unitários (sem banco) |
| `npm run test:security` | Suite de hardening |
| `npm run test:full:offline` | Regressão offline (inclui cobertura do Guia `panel.help.*` + FAQ) |
| `npm run dtov:reset` … `npm run dtov:down` | Sobe/derruba Postgres + Redis efêmeros (DTOV) |
| `npm run dtov:full-app` | Regressão completa: SQL + HTTP + browser (`DTOV_SKIP_BROWSER=1` pula o browser) |
| `npm run dtov:explain` | `EXPLAIN` dos hot paths ([`docs/performance-hotpaths.md`](docs/performance-hotpaths.md)) |
| `npm run release:pilot-check` | Gate local de release (schema estático, permissões, contrato SEO) |
| `PILOT_SMOKE_BASE_URL=https://host npm run release:post-deploy-smoke` | Smoke pós-deploy |

Nunca aponte o DTOV para Postgres de desenvolvimento ou RDS. Detalhes em [`test/README.md`](test/README.md).

**Build:** `npm run build` (Webpack, suportado pelo Next 16). Use `NEXT_DIST_DIR` para isolar o diretório de saída em CI ou validações concorrentes.

---

## i18n

- Copy de UI sempre via `t(locale, 'chave')` (`lib/i18n.js`). Catálogos completos em `lib/i18n/catalogs/` (`pt-BR`, `en-US`, `fr-FR`, `de-DE`); `pt-PT` e `es-*` são overrides em `lib/i18n/regional.js`.
- Primeira visita: o `proxy.js` escolhe o idioma pelo `Accept-Language` (fallback inglês) e grava o cookie `NEXT_LOCALE` por 1 ano (`lib/locale-negotiation.js`).
- Conteúdo só em pt/en (Eneagrama, Motivadores, prompts de IA, PDFs): `contentLocale(locale)` e `localizedField(locale, { pt, en })`.
- Tradução por IA de chaves ausentes: `npm run i18n:translate -- --locale fr-FR` (ou `de-DE`; requer `OPENAI_API_KEY`, modelo em `OPENAI_TRANSLATE_MODEL`). Resultado é rascunho para revisão nativa.

---

## Variáveis de ambiente

Lista completa e comentada em [`.env.example`](.env.example). As essenciais:

| Variável | Descrição |
|----------|-----------|
| `POSTGRES_*` / `POSTGRES_READ_HOST` | Banco primário e réplica opcional; `PG_POOL_MAX` por instância |
| `JWT_SECRET` | Obrigatório em produção (≥ 32 caracteres, não placeholder) |
| `NEXT_PUBLIC_APP_URL` | URL pública; obrigatória em produção para links de e-mail (sem fallback de Host) |
| `BOOTSTRAP_ADMIN_EMAIL` / `_PASSWORD` | Admin criado na primeira subida |
| `SMTP_*` + `MAIL_FROM` | E-mail (convites, senha, alertas de vagas). `SMTP_MOCK=1` captura em memória |
| `REDIS_URL` | Rate limit compartilhado entre réplicas (sem ele, limite por processo) |
| `CRON_SECRET` | Autoriza `POST /api/cron/*` |
| `OPENAI_API_KEY` | Assistentes de IA (opcional; sem chave respondem 503). `OPENAI_MOCK=1` em testes. `OPENAI_BASE_URL` aponta para fornecedor compatível (OpenRouter, Gemini) |
| `AI_ENABLED` / `AI_COMPANY_MONTHLY_CALL_LIMIT` / `AI_GLOBAL_MONTHLY_CALL_LIMIT` | Controle de custo de IA: `AI_ENABLED=0` desliga tudo; teto de chamadas por empresa/mês (default 500, admin ajusta em Empresas → Editar; acima → 429 `AI_MONTHLY_LIMIT`); teto global opcional. Consumo em `ai_usage_events` (migration 144), visível em Empresas → Consumo de IA |
| `AI_MODEL_<FUNCIONALIDADE>` | Modelo por funcionalidade (ex.: `AI_MODEL_HELP_ASSISTANT=gpt-4.1-nano`); vazio = `OPENAI_RUBRIC_MODEL`. Lista em `.env.example` |
| `S3_*` / `AWS_*` | Logos e arquivos (LMS, DP). Política IAM: `npm run ops:render-s3-policy` |
| `NEXT_PUBLIC_SENTRY_DSN` | Sentry (vazio = desligado) |
| `TRIAL_MAX_*` | Limites do early access (vagas, candidatos, usuários, Motivadores, clima) |

---

## Crons

Todos exigem `Authorization: Bearer $CRON_SECRET` (ou `X-Cron-Secret`).

| Endpoint | Função |
|----------|--------|
| `POST /api/cron/invite-reminders` | Lembretes de convite |
| `POST /api/cron/vacancy-deadline-notifications` | Prazos de vaga |
| `POST /api/cron/notification-retention` | Limpeza de notificações antigas (gestores e colaboradores; migration 146 cria o índice da tabela do colaborador) |
| `POST /api/cron/manager-weekly-digest` | Digest semanal do gestor |
| `POST /api/cron/analytics-report?frequency=weekly\|monthly` | Relatório agendado por e-mail |

Retenção LGPD (`RETENTION_DAYS`) e demais crons: ver `.env.example` e [`docs/privacy-retention-policy.md`](docs/privacy-retention-policy.md).

---

## Segurança

| Aspecto | Implementação |
|---------|---------------|
| Isolamento | Toda query multi-tenant filtra `company_id`; só `admin` é cross-tenant |
| Autenticação | JWT httpOnly, revogação por `session_version`, 2FA opcional |
| Autorização | `lib/permissions.js` (`can` / `CAP`) no servidor, não só no menu |
| APIs admin | `withAdminApi` + Zod + rate limit + `audit_log` |
| Senhas | bcrypt em `users.password_hash` |
| Cabeçalhos | Baseline sempre; HSTS automático com HTTPS; CSP via `ENABLE_CSP` |
| SEO | Sitemap/robots só com superfícies públicas; nada de candidato em JSON-LD |

Detalhes: [`docs/security-hardening-2026-08.md`](docs/security-hardening-2026-08.md) e [`docs/audit-log.md`](docs/audit-log.md).

---

## Deploy

Siga [`docs/release-runbook.md`](docs/release-runbook.md) (e, no piloto, `docs/pilot-operations-runbook.md` + `docs/pilot-privacy-checklist.md`). Preflight externo: `npm run ops:pilot-preflight`.

VPS / EC2 com Docker:

1. Docker + Compose, clone e `.env`
2. `npm run db:migrate` contra o banco de destino
3. `docker compose up -d --build`
4. Reverse proxy com TLS apontando para a porta 3000

```nginx
server {
    listen 443 ssl;
    server_name app.exemplo.com;
    ssl_certificate     /etc/letsencrypt/live/app.exemplo.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/app.exemplo.com/privkey.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }
}
```

---

## Comandos úteis

```bash
docker compose logs -f app                                   # logs do app
docker compose exec postgres psql -U enneagram_user -d enneagram
docker compose down -v && docker compose up -d               # reset do volume (dev)
docker compose up -d --build                                 # rebuild
```

---

## Suporte

contact@3035tech.com · +55 51 99644-2104
