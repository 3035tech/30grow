# Equipe de campo, push por destino e copiloto de pessoas

Entregas B-2725, B-2721 (item 9) e B-3011. Migrations `153_mobile_push_destinations.sql`, `154_field_team.sql`, `155_ai_feature_people_copilot.sql` (também em `scripts/scripts-banco-pendentes.sql`, idempotentes).

## Equipe de campo (B-2725)

**Acesso:** mesmo gate do ponto no nível empresa (`getTimeClockAccess(...).moduleEnabled`: módulo DP ligado + pessoa `employee`). Gestor: `dp.view` **ou** `team.view`. Não depende do vínculo CLT/PJ: PJ em campo também pede reembolso.

**Modelo**

| Tabela | Destaques |
|---|---|
| `field_visits` | `visit_date`, `planned_time`, `title`, `address`, `status` CHECK (`planned` / `checked_in` / `done` / `cancelled`), check-in com lat/long `NUMERIC(9,6)` + precisão; CHECK exige `checkin_at` quando o status passou do planejado. Foto opcional (`photo_file_key`). Índices `(company_id, candidate_id, visit_date)` e `(company_id, visit_date)`. |
| `field_expenses` | `category` CHECK (`mileage`, `fuel`, `meal`, `parking`, `toll`, `transport`, `lodging`, `other`), `amount_cents` 1..10.000.000, `currency` CHAR(3), `status` CHECK (`pending` / `approved` / `rejected` / `cancelled`), comprovante, decisão (quem/quando/nota), `visit_id` FK `ON DELETE SET NULL`, `idempotency_key` com índice único parcial. Fila: `(company_id, status, created_at DESC)`. |

Constantes em `lib/domain-status.js` (`FIELD_VISIT_STATUS`, `FIELD_EXPENSE_STATUS`, `FIELD_EXPENSE_CATEGORY`); erros `FIELD_VISIT_NOT_OPEN` / `FIELD_EXPENSE_NOT_PENDING` (409).

**Regras (lib `lib/people/field-team.js`)**
- Check-in exige coordenadas válidas (`parsePunchCoordinates`, mesmo do ponto); repetir o check-in devolve `replayed` sem alterar. Concluir só a partir de `checked_in`. Gestor cancela só visita `planned`.
- Reembolso: data não futura (fuso da empresa), visita relacionada precisa ser da própria pessoa, `Idempotency-Key` no POST (app). Decisão é um `UPDATE … WHERE status='pending'` (sem lost update). Cancelar pendente apaga o comprovante do S3.
- Arquivos: foto (JPEG/PNG) em `field-visits/<candidato>/<id>/`, comprovante (PDF/JPEG/PNG) em `field-expenses/<candidato>/<id>/`; download sempre pelo servidor com checagem de tenant. Arquivo inválido devolve `FIELD_FILE_TYPE` / `FIELD_FILE_SIZE` (400, máx. 5 MB), não as mensagens de currículo do upload genérico.
- Caps: rota do dia 50 visitas; últimas 30 despesas do colaborador; listas do gestor paginadas.
- Notificações: `field_visits_assigned` (dedupe por pessoa/dia) e `field_expense_decided` ao colaborador; `field_expense_submitted` aos gestores (`notifyCompanyManagers`). Auditoria `field.*`. Rate limit 60/h escrita, 30/h arquivos por pessoa.

**APIs**
- Colaborador (web `/api/employee/field/**`, app `/api/mobile/v1/employee/field/**`, mesmos handlers em `lib/people/field-team-http.js`): `GET /` (dia: `?day=YYYY-MM-DD`), `POST /visits`, `POST /visits/:id` (`{action:'check_in', latitude, longitude, accuracy}` ou `{action:'complete', note}`), `GET|POST /visits/:id/photo`, `POST /expenses`, `DELETE /expenses/:id`, `GET|POST /expenses/:id/receipt` (multipart `file`).
- Gestor: `GET|POST /api/admin/field/visits`, `DELETE /api/admin/field/visits/:id`, `GET /api/admin/field/visits/:id/photo`, `GET /api/admin/field/expenses`, `POST /api/admin/field/expenses/:id` (`{decision:'approve'|'reject', note}`), `GET /api/admin/field/expenses/:id/receipt`. `GET /api/admin/dp/attention` inclui `pendingFieldExpenses`.

**UI:** `/employee/field` (menu Visitas e reembolsos) e DP → Campo (`FieldTeamWorkspace`: Reembolsos / Visitas do dia). Fora de escopo: roteirização, quilometragem automática por GPS contínuo, pagamento/folha.

## Push com destino próprio (B-2721 item 9)

O app declara quais telas sabe abrir; o servidor nunca manda um destino que a versão instalada não conhece.

- `POST /api/mobile/v1/employee/push-token` aceita `appVersion` (≤ 32) e `destinations` (lista; valores fora do catálogo são descartados). Resposta inclui `destinations` aceitos. Persistido em `mobile_employee_push_tokens.app_version` / `push_destinations` (CHECK `<@ {'time_clock','field'}`). Re-registrar sem a lista zera o opt-in.
- Destinos opt-in: `time_clock` (pedido de ponto decidido, espelho disponível) e `field` (visitas atribuídas, reembolso decidido). Sem opt-in o push vai com `today`, como antes.
- `GET /api/mobile/v1/employee/notifications?destinations=time_clock,field` aplica a mesma regra a `items[].destination`.
- Helpers: `mobilePushDestinationFor`, `resolveMobilePushDestination`, `normalizeMobilePushDestinations` (`lib/mobile-employee-push.js`).

## Copiloto de pessoas (B-3011)

`POST /api/admin/people/copilot` (`overview.view`), corpo `{ question: 'radar' | 'person', candidateId?, explain?, locale? }`. Empresa sempre da sessão (admin pode passar `companyId`).

- Ferramentas tipadas fixas em `lib/people/people-copilot.js` (sem SQL gerado, a IA não escolhe ferramentas): radar de rotatividade (`getCompanyTurnoverRisks`, médio+), cadência de 1:1 (`listStaleOneOnOnes`, 30 dias, compartilhado com o digest semanal), itens de PDI atrasados (`getCompanyPdiPulse`), atenção de retenção (`listCompanyRetentionWatches`). Rodam em paralelo com `Promise.allSettled`; falha de uma vira `tools[].ok=false` e a UI avisa lista parcial.
- Ranking por pesos fixos, até 8 pessoas. Modo pessoa confere `employee` da empresa antes de ler sinais.
- `explain: true`: IA (`AI_FEATURE.PEOPLE_COPILOT`, migration 155, conta na cota) recebe só refs `P1…P8` + códigos/números; devolve resumo + até 3 tópicos por ref, remapeados no servidor. Sem IA ou falha: `ai: null` e as sugestões determinísticas (`panel.copilot.topic.*`) continuam.
- Rate limit 20 / 15 min por usuário (429 + `Retry-After`). Auditoria `people.copilot_query` só com contagens (`copilotAuditMetadata`).
- UI: `PeopleCopilotCard` em Visão geral → Sinais operacionais. Separado do assistente de Ajuda (que segue só Guia).

## Provas

- Unit: `test/unit/field-team-copilot.unit.test.js`, `test/unit/mobile-employee-push.unit.test.js`.
- DTOV: `test/dtov/field-team-copilot.dtov.test.js` (tenant, CHECKs, máquina de estados, idempotência, opt-in de push, escopo do copiloto).
