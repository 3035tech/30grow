# Security hardening (ago/2026)

Hardening após auditoria estática das ~171 rotas API (auth, rate limit, sessão, tenant).

## Correções aplicadas (fase 1)

| Severidade | Item | Mudança |
|------------|------|---------|
| Alta | JWT revogado em `/api/me/notifications` | `verifySessionWithCapabilities` (checa `session_version` / active / deleted) |
| Alta | Idem em `GET /api/results` (legado admin) | Mesma hidratação de sessão |
| Alta | Scraping `GET /api/ae/questions` | Rate limit 60 / 10 min por IP |
| Alta | Signup spam / domain-match | Rate limit 8 / 15 min; join com `SIGNUP_DOMAIN_MATCH` → role `hr` |
| Média | GETs públicos sem limite | climate, team-pulse, employee-portal, invite-track, ae-invite-track, job-alerts/unsubscribe |
| Média | `POST /api/analytics/landing` | Rate limit + allowlist de `eventType` + caps de string |
| Média | Assessments UPDATE/DELETE | `AND company_id = $n` para não-admin |
| Média | Brute force senha autenticada | Rate limit em `change-password` e `PATCH /api/me` (senha) |

## Correções aplicadas (fase 2)

| Item | Mudança |
|------|---------|
| Upload logo / PDF LMS | Magic bytes (`lib/file-magic.js`) — PNG/JPEG/WebP/PDF além de MIME |
| CSP enforced (opt-in) | `ENABLE_CSP=true` → `Content-Security-Policy` via `lib/identity/security-csp.js` (YouTube/Vimeo + Turnstile no `frame-src`) |
| Health metrics secret | `/api/health` detalhado só via `Authorization: Bearer` ou `X-Health-Metrics-Token` — **sem** `?token=` |

## Correções aplicadas (fase 3)

| Item | Mudança |
|------|---------|
| Turnstile no signup | `lib/identity/turnstile.js` + widget em `/signup`; opcional se `TURNSTILE_SECRET_KEY` unset |
| Revogação no Proxy | `session_version` via Redis + `GET /api/auth/session-edge`; dashboard/API admin revalidam. Fallback: se o self-fetch do Proxy falhar, confia no JWT assinado; se Edge não validar JWT mas session-edge OK, deixa passar. |
| Health status token | `/api/health/status` — só header/Bearer; `?token=` rejeitado |
| Sanitizer HTML | Allowlist de tags em notas ricas (`allowlistInterviewNotesHtml`) |
| HTTP smoke | employee login/home, compensation CRUD, revogação no Proxy, health query rejected |
| Pentest local | `scripts/security-zap-baseline.sh` + `test/security/README.md` |

## Correções aplicadas (fase 4)

| Item | Mudança |
|------|---------|
| Turnstile no login / forgot-password | `TurnstileField` em `/login`; `POST /api/auth/login` e `forgot-password` validam token quando `TURNSTILE_SECRET_KEY` setado |
| 2FA TOTP **opcional** | Migration `073_user_totp_2fa.sql` (gestores) + `074_candidate_totp_2fa.sql` (colaboradores); ativa/desativa no perfil; login só pede código se `totp_enabled_at` preenchido |
| Bots de IA no robots.txt | `AI_CRAWLER_USER_AGENTS` em `lib/crawler-guard.js` — Disallow `/` com Allow `/llms.txt` (GPTBot, ClaudeBot, etc.) |

## Correções aplicadas (fase 5 — auth colaborador)

| Item | Mudança |
|------|---------|
| Set-password sem bypass 2FA | Se `totp_enabled_at` ativo → `{ requires2fa, challengeToken }` sem cookie; senão auto-login com JWT `sv` |
| Turnstile no login colaborador | `POST` login / magic / forgot / set-password / 2fa/verify + `TurnstileField` em `/employee/login` e set-password |
| `candidates.session_version` | Migration `081`; JWT claim `sv`; `GET /api/auth/employee/session-edge` + Proxy; bump em troca/reset de senha, desativar 2FA e troca do e-mail corporativo pelo gestor (que também zera a senha e reenvia o convite) |
| Magic consume atômico | `UPDATE … WHERE used_at IS NULL … RETURNING` (sem TOCTOU) |
| Anti-enumeração | magic/forgot públicos respondem `{ ok: true }` (sem `sent`); delay ~500 ms em falha de login; RL por e-mail + peek set-password |

## Correções aplicadas (fase 6 — anti-vazamento)

| Item | Mudança |
|------|---------|
| Auth colaborador multi-empresa | Após senha OK: se 2+ vínculos, escolhe empresa **pelo nome** (`needsCompanyPick` + `pickToken`). Lista só empresas cuja senha bateu. Magic/forgot: um e-mail por vínculo (sem slug). |
| Signup anti-enum | Conta já ativa → `{ ok: true }` + e-mail de lembrete (sem 409 `EMAIL_ALREADY_REGISTERED`) |
| Login gestor | `password_setup_token` pendente → mesmo `INVALID_CREDENTIALS` + delay (sem `PASSWORD_SETUP_PENDING`) |
| Tokens públicos | `/e` TTL default **14** dias (máx. 90); `/r` default 14; `lib/identity/redact-secrets.js` em audit metadata |
| Vagas públicas | Sem `publicShowCompanyInfo`: não expõe `companyId` / `slug` no payload |
| Turnstile | Também em `/a/set-password`, magic `POST /session` e set-password colaborador |

## Correções aplicadas (fase 7 — sliding session)

| Item | Mudança |
|------|---------|
| Extensão no uso (gestor) | Proxy `/dashboard`, `/api/admin`, `/api/me`: JWT válido e `exp` ≤ **2h** → reassinatura Edge + cookie **8h** |
| Extensão no uso (colaborador) | Proxy `/employee` + `/api/employee`: mesma janela de 2h → cookie **12h** |
| Sem refresh token | Mesmos cookies (`team30_session` / `team30_employee_session`); claims/`sv` preservados; JWT expirado **não** renova |
| Idle implícito | Sem request autenticado pelo TTL respectivo → cai; revoke por `session_version` inalterado |
| Edge-safe TTL/cookie | `lib/identity/session-ttl.js`, `lib/identity/session-cookie.js`, `EMPLOYEE_SESSION_MAX_AGE` em constants (Proxy sem bcrypt) |

### Ops / tokens

- Trate URLs `/r/…`, `/e/…`, `/v/…`, convites e magic links como **segredo** (não logar URL completo; validade curta).
- Produção: `TURNSTILE_*`, `CRON_SECRET`, `HEALTH_*` obrigatórios e fortes.
- Página `/jobs` e perfil `/companies` só com flags opt-in da empresa/vaga.

### 2FA (opcional por usuário)

- **Default:** desligado — login com e-mail/senha (+ Turnstile se configurado).
- **Ativar:** Perfil → Configurar 2FA → escanear QR/secret → confirmar código de 6 dígitos.
- **Desativar:** Perfil → senha atual + código TOTP.
- **Gestores:** `/dashboard` perfil → `GET/PATCH/DELETE /api/me/2fa`; login em `/api/auth/login` + `/api/auth/2fa/verify`.
- **Colaboradores:** `/employee/profile` → `GET/PATCH/DELETE /api/employee/me/2fa`; login em `/api/auth/employee/login` + `/api/auth/employee/2fa/verify` (link mágico e set-password também exigem 2FA **só se** ativo).

Não há política global que force 2FA — cada gestor/colaborador escolhe.

## Fluxos públicos (sem login)

O Proxy **só** exige sessão de gestor em `/dashboard` e `/api/admin/*`, e sessão de colaborador em `/employee` + `/api/employee/*` (exceto login/set-password).

**Permanecem públicos** (token de link ou anônimo):

| Superfície | Auth |
|------------|------|
| `/t/<token>`, `/v/<token>`, `/assessment/*`, `/clima`, `/pulso`, `/e`, `/r` | Token no URL |
| `POST /api/results` | Token convite / company / vacancy no body |
| `GET/POST /api/ae/*`, `/api/public/*` | Token ou anônimo + rate limit |
| Landpage, `/signup`, `/login`, `/jobs` | Público |

O hardening **não** adicionou login ao teste T1–T9 nem ao submit de candidato — apenas rate limits anti-abuso.

## Ops / produção

1. **`SIGNUP_DOMAIN_MATCH`** — deixar unset/`false` salvo intenção explícita.
2. **`REDIS_URL`** — recomendado em multi-instância (rate limit + cache `session_version`).
3. **`ENABLE_CSP=true`** — após smoke em staging (Next ainda precisa `unsafe-inline` / `unsafe-eval` no script-src). A política padrão em `lib/identity/security-csp.js` já permite Turnstile (`challenges.cloudflare.com`) e **Cloudflare Web Analytics** (`static.cloudflareinsights.com` + `connect-src` para `cloudflareinsights.com`) — o beacon é injetado pela borda Cloudflare quando Insights está ligado na zona.
4. **`CSP_POLICY`** — override opcional da política padrão.
5. **`HEALTH_METRICS_SECRET`** / **`HEALTH_STATUS_TOKEN`** — usar header, não query string.
6. **Turnstile** — `TURNSTILE_SECRET_KEY` + `NEXT_PUBLIC_TURNSTILE_SITE_KEY` no gitops quando ativar CAPTCHA.
7. **Uptime Kuma** — monitor `/api/health/status` com `X-Health-Status-Token` ou `Authorization: Bearer`.
8. TLS/HSTS no reverse proxy; app seta HSTS quando `NEXT_PUBLIC_APP_URL` é `https://`.

Gitops: `gitops/dublin/team/helm-values.yaml` (`SIGNUP_DOMAIN_MATCH`, `ENABLE_CSP`, placeholders Turnstile).

## Prova

- HTTP smoke: `auth/notifications-revoked`, `auth/dashboard-revoked-middleware`, `health/status-query-rejected`, `employee/*`, `compensation/*`.
- Signup flow + assessment E2E (`/t` submit) no `dtov:full-app`.
- `lib/file-magic` + `lib/sanitize-html` no `full-regression.js`.
- ZAP baseline opcional: `./scripts/security-zap-baseline.sh`.

## Fora de escopo

Upgrade massivo de deps (`npm audit` high em devDeps Playwright) — revisar separadamente.

## Anti-crawler (camada 1 — app)

Regras em `lib/crawler-guard.js` (fonte única para `app/robots.js` + Proxy):

| Protegido (Disallow + `X-Robots-Tag: noindex`) | Permanece indexável |
|------------------------------------------------|---------------------|
| `/t/`, `/v/`, `/assessment/`, `/clima/`, `/pulso/`, `/e/`, `/r/` | `/jobs`, `/jobs/*` |
| `/employee/`, `/signup`, `/login`, `/dashboard` | `/companies/*` (opt-in) |
| `/api/`, `/a/unsubscribe` | `sitemap.xml`, `/llms.txt` |
| Bots IA (GPTBot, ClaudeBot, …) | `/llms.txt` only — resto Disallow `/` |

Scrapers agressivos ignoram `robots.txt` — complementar com Cloudflare Bot/WAF na borda (gitops Dublin).
