# Ponto: visão do gestor (fases 1 e 2)

DP → Ponto (`TimeClockWorkspace`) com as abas Controle de ponto, Solicitações, Banco de horas, Feriados e Fechamento. Capacidade: `dp.view` ou `team.view` (mesmo ACL do ponto MVP).

## Controle de ponto

- Lista paginada de colaboradores (busca, filtro por unidade, marcador de dias a revisar nos últimos 31 dias): `GET /api/admin/time-clock/people`.
- Espelho por período (≤ 62 dias, limitado a hoje): `GET /api/admin/time-clock/mirror?candidateId&from&to`. Por dia: ocorrência, marcações, trabalhado, extra, falta, feriado, jornada do dia e saldo corrido do banco calculado (ver Banco de horas).
- Ações (`POST /api/admin/time-clock/mirror`, `action`):
  - `adjust`: anula até 12 marcações (`voided_at`, `voided_by_user_id`, `void_reason`) e inclui até 4 novas com `source = manager`. A original nunca é apagada.
  - `justify` / `unjustify`: uma justificativa por pessoa/dia (`employee_time_day_justifications`, motivo em domínio fechado).
- Todas as ações vão para `audit_log` (`time_clock.day_*`).

## Banco de horas (calculado, fase 2)

- Saldo = saldo de abertura + Σ por dia (extra − falta do espelho, só para quem tem ponto) + lançamentos aprovados que não vêm do ponto, aplicando o teto da empresa dia a dia (`stepHourBank`: o que passa do teto não entra; débitos sempre entram).
- Início: `company_time_schedules.hour_bank_started_on` (migration 143; padrão = data da migration; volta para hoje quando o banco é religado). Saldo de abertura = soma do ledger antigo (`employee_hour_bank_entries` aprovados) antes do início, então nada se perde. Créditos antigos gerados do ponto depois do início são ignorados para não contar duas vezes.
- Congelamento: ao concluir um fechamento, o saldo de cada pessoa do escopo vai para `time_clock_closure_balances`. O cálculo seguinte parte do último snapshot (corte por `period_end`), então ajustes em dias já fechados não mexem no saldo. Ajustes em dias **não** fechados anteriores a um fechamento também não mudam o snapshot: feche os períodos em sequência.
- A janela viva vai do último fechamento (ou do início) até hoje. Empresas que nunca fecham recalculam desde o início: o custo é por página (≤ 100 pessoas, `HOUR_BANK_BATCH`) e em lote (marcações, justificativas, jornadas, feriados e lançamentos em uma query cada).
- "Gerar do ponto do dia" saiu (API `action: generate` e botão). Lançamento manual e aprovação recusam dia em período fechado (`TIME_CLOCK_PERIOD_CLOSED`).
- Lista de saldos agora ordena por nome (saldo é calculado por página), com `overCapMinutes`. Fila de aprovação, lançamento manual e CSV continuam no `HourBankAdminBlock`.

## Jornada por colaborador (fase 2)

- `employee_time_schedules` com vigência (`valid_from`): entrada, saída, intervalo (início/fim opcionais) e dias da semana (`SMALLINT[]` 0–6, 0 = domingo, CHECK no banco). Linha com `follows_company = TRUE` volta para a escala da empresa a partir da data. Uma versão por pessoa/data (`uq_employee_time_schedules_from`).
- API: `GET/POST/DELETE /api/admin/time-clock/people/[candidateId]/schedule`. Recusa com `TIME_CLOCK_PERIOD_CLOSED` se a vigência começa em (ou antes de) um dia já fechado para a pessoa.
- Usada no espelho (horas previstas, dia útil), na batida (`suggestPunchFlag` com a jornada do dia) e no banco calculado. UI: bloco Jornada no espelho do colaborador.

## Feriados (fase 2)

- `company_holidays`: empresa ou unidade (`org_unit_id` opcional, vale para subunidades), `recurrence` `once`/`yearly`, `source` `manual`/`national`. Unicidade por empresa + unidade + data.
- Feriado não tem horas previstas: sem marcação vira ocorrência "Feriado"; trabalhado conta como extra.
- API: `GET/POST /api/admin/time-clock/holidays` (lista por ano com busca e paginação; `action: import` inclui os nacionais do ano, inclusive Sexta-feira Santa calculada pela Páscoa e Consciência Negra a partir de 2024) e `PATCH/DELETE /api/admin/time-clock/holidays/[id]`. Criar, editar ou excluir feriado que cai em período fechado é recusado; a importação pula essas datas.

## Fechamento

- `GET/POST/PATCH /api/admin/time-clock/closures` (listar, criar, cancelar com motivo).
- Só período já encerrado no fuso da escala, até 92 dias. Escopo: empresa inteira ou uma unidade (vale para subunidades).
- Sobreposição rejeitada na mesma unidade ou quando um dos dois é da empresa inteira (serializado com `FOR UPDATE` na empresa).
- Dia fechado bloqueia ajuste, justificativa, revisão de marcação e marcação manual (`TIME_CLOCK_PERIOD_CLOSED`, 409).

## Ponto por colaborador

- `candidates.time_clock_override BOOLEAN NULL` (migration 140): `NULL` segue o vínculo (`work_format`), `TRUE`/`FALSE` é exceção do RH. Sem ponto por padrão: `pj` e `cooperative`. CLT, estágio e vínculo vazio têm ponto (comportamento anterior preservado).
- Regra única em `lib/people/time-clock-eligibility.js` (`resolveTimeClockEligibility` + `timeClockEnabledSql`). `getTimeClockAccess` (`lib/people/time-clock.js`) junta módulo DP da empresa e regra da pessoa numa query.
- Edição: DP → Editar → Controle de ponto (`PATCH /api/admin/candidates/[id]` com `timeClockOverride`: `null` / `true` / `false`; exige `dp.view` ou `team.view`). Mudança gera `candidate.time_clock_override` no `audit_log` com de/para.
- Portal: seção, atalho, badge e card de boas-vindas somem (`timeClockEnabled` em `GET /api/employee/home`); `/employee/time-clock` redireciona para `/employee`. Mobile: `features.timeClock` em `GET /api/mobile/v1/employee/home`.
- API: `GET/POST /api/employee/time-clock` e mobile recusam com `TIME_CLOCK_DISABLED` (403), inclusive quando o módulo DP está desligado na empresa (antes não checava).
- Gestor: lista mostra "Sem controle de ponto" (essas pessoas vão para o fim); espelho não calcula falta nem horas faltantes, mas mostra marcações antigas. Ajuste de dias passados pelo RH (`source = manager`) continua permitido.

## Localização da batida

- Obrigatória em toda batida do colaborador. Web: o portal sempre pede a localização (sem checkbox) e `POST /api/employee/time-clock` recusa sem coordenadas válidas com `GEOLOCATION_REQUIRED` (400). Mobile também exige, agora pelo mesmo `parsePunchCoordinates` (`null`/vazio não viram mais 0,0; erro segue `INVALID_DATA`, contrato mantido). Ajuste do RH (`source = manager`) não tem localização.
- `parsePunchCoordinates` (`lib/time-clock-format.js`, puro) valida faixa e formato; `createTimePunch` grava com 6 casas (`latitude`/`longitude` em `employee_time_punches`).
- Antes desta mudança o cabeçalho `Permissions-Policy: geolocation=()` (em `proxy.js` e `next.config.js`) bloqueava a localização no navegador, então batidas web antigas não têm coordenadas. Agora é `geolocation=(self)` só em `/employee*`; o resto do site (painel, `/t`, `/v`, assessment) segue `geolocation=()`.
- Gestor: no detalhe do dia do espelho, cada batida do colaborador tem "Ver local no mapa" (`CollapsibleBlock`). O mapa é um iframe do OpenStreetMap (sem chave de API) montado só ao abrir, então as coordenadas só saem para o OpenStreetMap quando o gestor pede. CSP: `frame-src` inclui `https://www.openstreetmap.org`.
- Tela de batida (web `/employee/time-clock` e app mobile, pedido do RH, fase 3): card **Bater ponto** com indicador de localização (Não obtida / Obtendo / Pronta / Indisponível), hora e precisão da última leitura, botão **Obter/Atualizar localização** e o botão de batida (Bater entrada / Bater saída). Se a permissão já foi concedida, a localização é lida ao abrir. A batida reaproveita uma leitura de até 60 s; senão lê de novo. Sem localização a batida não é enviada.
- **Localização da última batida**: `getEmployeeTimeClockToday` devolve `lastLocation` (`latitude`, `longitude`, `punchedAt`, `punchKind`) da batida mais recente não anulada com coordenadas (índice `(candidate_id, punched_at DESC)`, `LIMIT 1`). Campo aditivo no GET/POST web e mobile. Web mostra o mapa sob demanda (`PunchLocationMap`, mesmo componente do espelho do gestor); o app abre o OpenStreetMap.
- Portal: enquanto pede a localização o botão mostra "Obtendo localização…"; se negada/indisponível, o card de localização mostra o motivo e o botão Tentar de novo.
- LGPD: o portal avisa "A localização é registrada a cada batida". A finalidade é comprovar o local do registro de ponto; não há rastreio contínuo, só o ponto no momento da batida.

## Pedidos de ajuste e abono (colaborador → gestor)

- Colaborador em `/employee/time-clock` → **Meu histórico**: período (7 dias, 30 dias, mês atual, mês anterior), totais e lista de dias. Tocar num dia abre o detalhe com marcações, abono e pedidos do dia (sem nome de quem ajustou e sem coordenadas).
- **Ajuste de ponto**: a pessoa edita a lista de marcações do dia (incluir, alterar horário/tipo, remover), com justificativa (3–1000 caracteres) e até 8 marcações novas por pedido. O pedido guarda as anulações e inclusões em `employee_time_request_punches`.
- **Abono**: tipo (atestado, falta abonada, folga, outro), dia inteiro ou intervalo (início/fim), justificativa e comprovante opcional (PDF/JPG/PNG até 5 MB, S3 em `time-requests/{candidato}/{pedido}/`).
- Um pedido pendente por pessoa, dia e tipo (`uq_employee_time_requests_pending`). Dias futuros, período fechado e horários depois de agora (hoje) são recusados. A pessoa pode cancelar enquanto está pendente.
- Gestor: DP → Ponto → **Solicitações** (card "Pedidos de ponto" no topo do DP e badge na sub-aba). Notificação in-app `time_request_submitted` a cada pedido.
- **Aprovar** aplica na mesma transação o caminho do gestor: ajuste = anula a marcação original (nunca apaga) e insere as novas com origem `manager`; abono = justificativa do dia com `excused_start`/`excused_end` e `source_request_id`. Se as marcações mudaram depois do pedido, a aprovação falha com `TIME_REQUEST_STALE` (reprove e peça outro). Dia em período fechado só pode ser reprovado.
- **Reprovar** aceita motivo opcional (≤ 500). O colaborador recebe `time_request_decided` nos dois casos.
- Abono por intervalo desconta só o intervalo das horas faltantes; abono de dia inteiro zera a falta (regra anterior). O banco de horas usa o espelho recalculado.

## Regras assumidas

- Escala da empresa = seg–sex; jornada própria pode trocar dias e horários; tolerância = carência de atraso da escala.
- Dias antes da admissão contam como descanso.

## Deploy

Aplicar `migrations/137_time_clock_manager.sql` (aditiva; colunas novas nulas em `employee_time_punches` + 2 tabelas). Rollback: a UI nova para de funcionar, os dados antigos ficam intactos.

`migrations/140_candidate_time_clock_override.sql`: coluna nula aditiva em `candidates`; ninguém perde o ponto até o vínculo ser PJ/Cooperado. Atenção: colaboradores **já cadastrados** como PJ ou Cooperado deixam de ver o ponto no deploy (é a regra pedida); para mantê-los, marque "Sempre ativo" no perfil.

`migrations/142_time_clock_requests.sql`: aditiva (2 tabelas novas + 3 colunas nulas em `employee_time_day_justifications`). Aplicar antes do deploy web. Rollback: as telas de pedidos param; ajustes já aprovados continuam como marcações normais.

`migrations/143_time_clock_schedules_holidays_bank.sql`: aditiva (3 tabelas novas + `hour_bank_started_on`). Aplicar depois da 142 e antes do deploy web. **Muda o comportamento do banco:** a partir da data da migration o saldo passa a ser calculado do espelho (saldo anterior preservado como abertura) e "Gerar do ponto" some. Rollback: o código antigo ignora as tabelas novas e volta ao saldo por lançamentos.

## Prova

- `node --test test/unit/time-clock-manager.unit.test.js test/unit/time-clock-calendar.unit.test.js`
- DTOV: `test/dtov/time-clock-manager.dtov.test.js`, `time-clock-requests.dtov.test.js`, `time-clock.dtov.test.js`, `time-clock-per-employee.dtov.test.js`, `hour-bank.dtov.test.js`, `time-clock-calendar.dtov.test.js`
