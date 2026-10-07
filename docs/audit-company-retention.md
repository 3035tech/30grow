# Auditoria da empresa e retenção

## Acesso e interface

`audit.view` é concedida ao superadmin e ao dono autenticado da empresa. Não é uma capability delegável ao RH comum nem ao admin de tenant que não é dono. Auditoria aparece no menu do dono, inclusive quando só o módulo core está ativo ou suas capabilities foram personalizadas.

`GET /api/admin/audit-log` mantém paginação e filtros existentes e aceita `targetType`/`targetId`. No painel, ID do colaborador filtra o alvo `candidate`; eventos de outros tipos de alvo não são inferidos como pertencentes a essa pessoa. O dono recebe sempre seu `companyId` da sessão, mesmo se enviar outro ID ou `all`. Eventos globais ou antigos sem empresa não são expostos ao dono.

Para a empresa, metadados ficam limitados aos nomes dos campos alterados: sem IP, valores anteriores ou metadados brutos. O superadmin conserva a visão técnica completa. `format=csv` exporta até 5.000 eventos mais recentes dos mesmos filtros, com IDs, data, ator, ação, alvo e empresa; sem metadados/IP. O painel avisa se houve truncamento. Fórmulas são neutralizadas no CSV, respostas são `no-store`, exportação tem limite de tentativas e registra `audit.export`.

## Modelagem

Migration `156_audit_retention_policies.sql`: uma política por empresa, identidade = `company_id` PK/FK, sem JSONB. Dias e booleano de preservação são campos tipados com CHECK; prazo de segurança não pode ser menor que o comum. Referências de aprovação/preservação são texto curto, pois identificam documentos/casos externos, não entidades gerenciáveis no produto. Nunca inserir conteúdo do caso nesses campos. O aprovador referencia `users`; remover o usuário preserva a política (`SET NULL`). A empresa com política não pode ser removida fisicamente sem revisão (`RESTRICT`).

Nenhum prazo ou política é criado automaticamente. Eventos existentes não são alterados pela migration. O índice já existente `(company_id, created_at DESC)` atende o recorte por empresa e data.

## Operação, aprovação e preservação

Apenas superadmin acessa `GET/POST /api/admin/audit-log/retention`.

POST exige todos os campos: `companyId`, `retentionDays`, `securityRetentionDays`, `approvalReference`, `legalHold` e `holdReference` (nullable). Os prazos devem estar previamente aprovados pelo controlador/jurídico; a API registra a referência, mas não substitui aprovação jurídica. Se `legalHold=true`, a referência de preservação é obrigatória. Uma alteração e sua evidência em `audit_log` são gravadas na mesma transação. Não configurar políticas com períodos estimados pelo agente.

`POST /api/cron/audit-retention` usa CRON_SECRET e **simula por padrão**. Exclusão física requer **ambas** as condições: `?dryRun=false` e `AUDIT_RETENTION_EXECUTE=1`. A flag permanece ausente/desativada nesta entrega. Não foi configurado agendamento em produção.

- Sem política: preservar todos os eventos da empresa.
- Com `legal_hold`: preservar todos os eventos da empresa.
- Sem empresa (`company_id=NULL`): preservar; não há política implícita para eventos globais.
- Eventos `audit.retention.*`: preservar como evidência das decisões e execuções.
- Eventos de autenticação, sessão, senha, 2FA, acesso, segurança e usuários: janela de segurança; demais: janela comum. A classificação está em `SECURITY_ACTION`, em `lib/audit-retention.js`, e precisa acompanhar novos nomes de eventos.

O purge trava a política com `FOR UPDATE`, serializando com mudanças de prazo/hold. A preservação deve ser registrada **antes** da execução: não reverte uma exclusão já confirmada. Faz no máximo 10 lotes de 500 eventos e lê até 50 empresas por chamada. O retorno contém `truncated` e `nextCompanyId`; ao continuar, enviar `?afterCompanyId=<nextCompanyId>` junto ao mesmo modo. Quando uma empresa ainda tem registros elegíveis, o cursor mantém o ponto anterior para retomar essa empresa. Ao finalizar a varredura, reiniciar o cursor em zero no próximo ciclo.

Revisar simulação, aprovação, backup e ausência de preservação antes de habilitar execução. A execução não é um snapshot do dry-run: datas e elegibilidade podem mudar. Hold de ouvidoria/investigação não é inferido automaticamente de outro módulo; deve ser registrado nesta política antes do purge.

## Deploy e rollback

Aplicar a migration antes do código; há espelho no bundle PgAdmin `scripts/scripts-banco-pendentes.sql`. Rollback: desativar execução do cron e voltar o código, mantendo a tabela/políticas. Exclusão executada não é reversível por rollback de código; requer backup apropriado. Nesta entrega, exclusão foi executada somente dentro de transação de testes DTOV com rollback.

## Evidências

- `test/unit/audit-company-access.unit.test.js`: permissão, sessão, tentativa de troca de tenant, minimização, SQL e CSV.
- `test/unit/audit-retention-route.unit.test.js`: cron autenticado, preview padrão e gate de execução.
- `test/dtov/audit-retention.dtov.test.js`: PostgreSQL isolado, prazos distintos, hold, empresa sem política, globais, replay, limite/retomada e reaplicação da migration sem perda de políticas.
- `test/ui-controls/audit.spec.js`: cliente real com dados sintéticos, desktop/celular, filtro persistido na URL e CSV.
