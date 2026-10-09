# Contratos mobile aditivos — 2026-10-09

Acompanhamento do app: `../30-team-app/docs/employee-equalization-2026-10-09.md`.

- Home: `page` inteiro positivo até 10000; 20 tarefas por página; `taskPagination` com page/totalPages/total; prazo OKR preservado a partir do domínio. Campos antigos mantidos.
- Home: `attention` retorna surveys, urgentOkrs, dp, timeClock, overdueCourses, feedback, proposedCompensation. Serviços existentes reutilizados, identidade exclusivamente da sessão; módulos indisponíveis/falhas isoladas retornam null. Até cinco serviços adicionais em paralelo, sem nova migration/query própria. Medir SQL/p95 em staging antes de promover; contagens de listas limitadas não equivalem a totais globais.
- Notificações: copy usa preferredLocale do empregado autenticado; sem troca de domínio/autorizações.
- GET `/api/mobile/v1/auth/captcha-config`: required/siteKey/origin públicos, no-store; nunca retorna segredo. CAPTCHA verificado no POST existente.
- Solicitação mobile de magic-link usa destino fixo team30://magic-link com token; fluxo de e-mail web permanece com `/employee/enter`. Expiração, uso único, rate limit, CAPTCHA e 2FA existentes preservados.

Validação: 44 testes mobile unit/VM passaram, incluindo paginação, degradação parcial, scope autenticado, notificação localizada e configuração pública. `npm run build` passou. Não houve deploy. Mocks não substituem teste negativo tenant A/B com banco real; e-mail/CAPTCHA/aparelhos e latência pendentes.

Rollout: backend antes do app; contratos antigos preservados na janela suportada. Rollback do app mantém backend compatível. Rollback do backend remove novos campos/configuração e impede recursos novos; não promove app dependente do endpoint antes da homologação.
