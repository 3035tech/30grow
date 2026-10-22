# Security tests (manual / CI optional)

Complemento ao DTOV (`test/dtov/http-smoke.js`) para varredura externa.

## Gate obrigatório

`npm run test:security` executa os contratos de hardening, os handlers reais de
arquivos de DP com SQL/storage simulados, o domínio de downloads, revogação da
sessão do colaborador, cabeçalhos privados e cache de uploads. Não precisa de
credenciais nem banco. O GitHub Actions e o build Docker executam esse gate
antes de publicar a imagem; o GitHub Actions também bloqueia vulnerabilidades
de runtime high/critical com `npm audit --omit=dev --audit-level=high`.

Para a prova com SQL real, usar `test/dtov/dp-download.test.js` após o build
isolado e o seed DTOV, seguindo `docs/DP-PRIVATE-ATTACHMENTS.md`. São 22
verificações, incluindo auditoria e revogação de gestor/colaborador. A suíte
remove o banco efêmero no final e não pode compartilhar o DTOV com outra tarefa.

## OWASP ZAP baseline

Requer Docker e app no ar (staging recomendado — **não** aponte para produção sem aviso).

```bash
BASE_URL=https://staging.team.example.com ./scripts/security-zap-baseline.sh
```

Saída: `test/security/zap-report.html` (HTML local).

O script usa `-I` (não falha o CI por alertas médios/baixos); revise o relatório manualmente.

## O que o DTOV já cobre

| Área | Prova |
|------|--------|
| Sessão revogada | `auth/notifications-revoked`, `auth/dashboard-revoked-middleware` |
| Health tokens | `health/status-authed`, `health/status-query-rejected` |
| Signup + set-password | bloco `signup/*` em `http-smoke.js` |
| Colaborador | `employee/login`, `employee/home` |
| Remuneração interna | `compensation/*` |
| Sanitizer HTML | `full-regression.js` → `lib/sanitize-html` |

Detalhe das mudanças: `docs/security-hardening-2026-08.md`.

## Isolamento por empresa e perfil (beta)

A matriz HTTP local está em `test/dtov/tenant-permissions.http.test.js` e o contrato
compartilhado em `test/unit/tenant-scope.unit.test.js`. Preparação, resultados,
correções, limites e pendências anteriores estão em
[`docs/tenant-permissions-audit-2026-10-22.md`](../../docs/tenant-permissions-audit-2026-10-22.md).
A execução exige `TENANT_AUDIT=1` e fixa banco e aplicação em localhost.
