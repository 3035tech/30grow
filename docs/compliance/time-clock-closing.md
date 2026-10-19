# Fechamento operacional do ponto — escopo e decisões

Registro da primeira etapa. O escopo atual, incluindo desligamentos, turnos, fila durável e CSV v2, está em [time-clock-evolution.md](./time-clock-evolution.md).

Completar os fluxos existentes de fechamento/reabertura, sem testar o A1 real nesta etapa. Reutilizar o motor diário, o calendário e os snapshots atuais. Não implementar cálculo de folha, integração proprietária, WhatsApp ou marcação offline.

Aceite: conferência por período/unidade, identificação de marcações incompletas/revisões/solicitações pendentes, recusa de fechamento inconsistente, reabertura com motivo e preservação dos resumos anteriores, CSV contábil documentado e avisos ao colaborador com deduplicação. Validar faltas, feriados, tolerância, abono parcial e banco de horas. Jornadas noturnas e 12x36 não são presumidas suportadas.

Segurança: autorização por DP/Equipe e empresa resolvida no servidor; paginação e limites de período; CSV privado e proteção contra fórmulas; notificações sem detalhes de remuneração ou documentos. A conferência é refeita ao fechar. Locks por colaborador serializam fechamento e edição; triggers rejeitam escrita em período fechado. Não alterar originais ou snapshots concluídos.

Abonos parciais só creditam o tempo da jornada que não foi trabalhado, excluindo o intervalo contratual explícito. Quando há intervalo em minutos mas sem horários e isso torna o cálculo ambíguo, solicitar revisão de jornada. Checkpoints antigos serão recalculados com versão nova; snapshots de fechamentos já existentes ficam preservados.

Migração aditiva 161: funções/triggers em tabelas existentes, sem remover dados. Aplicar antes de ativar a conferência obrigatória. Rollback de interface mantém as proteções e os registros; não apagar fechamentos ou originais para reverter código.

Avisos: disparo explícito pelo gestor, somente nos canais internos existentes, com prazo informado e chave de deduplicação por pessoa/período/prazo. Não agendar cron ou enviar mensagens reais durante testes. O app continua usando a fachada autenticada, sem novos transportes.

## Entrega no colaborador e no app

O histórico web e mobile apresenta pendências aguardando o RH e sinaliza dias que precisam de revisão da jornada/intervalo. Ajustes e abonos continuam pelos fluxos existentes e são bloqueados em períodos fechados; conferir/contestar o espelho continua disponível após o fechamento. A reabertura notifica os integrantes do snapshot, mesmo após mudança de unidade. Lembretes incluem período e prazo na central de avisos; o push respeita a preferência já existente de Ponto. Nenhum certificado ou senha é enviado ao app.

## CSV contábil `30grow-time-v1`

Ação no resumo do fechamento. CSV UTF-8, separado por vírgulas, com cabeçalho e proteção contra fórmulas em texto; valores numéricos negativos continuam numéricos. Exporta somente fechamento ativo, não vazio e sem espelhos contestados. O arquivo de auditoria anterior continua separado e acessível para históricos cancelados.

Colunas, na ordem: `layout_version,company_id,closure_id,period_start,period_end,candidate_id,name,expected_minutes,worked_minutes,extra_minutes,missing_minutes,absence_days,bank_balance_minutes,ack_status,snapshot_hash`.

Datas em YYYY-MM-DD; durações e saldo em minutos inteiros (saldo vazio quando indisponível). `ack_status` informa a conferência do colaborador, inclusive `pending`; a exportação não substitui essa conferência. Totais e hash vêm do snapshot, preservados após a reabertura. Identificação e nome permitem ao contador relacionar sua matrícula externa; o layout é genérico, sem promessa de importação automática em folha proprietária. Não calcula valores salariais, adicionais ou encargos.

## Validação local em 18/10/2026

- Migrações canônicas completas aplicadas em banco PostgreSQL descartável e reentrada verificada; pacote PgAdmin registra a migração 161.
- Integração comprova recusa de solicitações/marcações pendentes, snapshot, isolamento entre empresas, proteção de fórmulas no CSV, reabertura sem apagar os totais e serialização entre fechamento e escritor concorrente.
- 78 testes focados de cálculo, calendário, banco, contratos mobile e avisos passaram. Build web passou. Tela de conferência verificada no Chromium em desktop e largura de 390px, sem overflow da página.
- App: lint e typecheck passaram; suíte completa com 265 testes passou, seguida pelo teste adicional de pendência/revisão (10 testes do histórico passaram).
- Duas falhas em `contextual-notifications.unit.test.js` ao ampliar a seleção: mock antigo não fornece `getEmployeeProfile`, importado pela rota de notificações que não foi alterada nesta entrega. Não equivalem a validação de entrega de push real.

Não executado: A1 real, publicação, migrações de produção, entrega de push em aparelho físico e ensaio contábil com software do cliente. O fechamento mantém o escopo existente de colaboradores ativos elegíveis; desligamentos e escalas noturnas/12x36 exigem tratamento específico antes de ampliar a oferta. Infraestrutura e procedimentos legais continuam necessários para a conformidade integral.

### Acabamento da interface

Conferir novamente o mesmo período refaz a leitura. O período do formulário acompanha o fechamento feito no modal, e as datas de ocorrência seguem o idioma da interface. Removido aviso duplicado no histórico do colaborador. Exportação contábil visualmente indisponível quando o resumo tem contestação, mantendo a validação autoritativa do servidor. Regressões de histórico e espelho do app: 16 testes passaram; navegador confirmou nova leitura sem alterar datas, sincronização do período e layout desktop/mobile.
