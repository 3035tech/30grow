# Evolução do ponto

Aceite: incluir desligados que trabalharam no período, excluir dias fora do vínculo, preservar mudanças futuras de unidade/regra; jornadas por data com virada de dia e 12x36 ancorada; minutos noturnos físicos e equivalentes urbanos separados, sem cálculo salarial; conciliação de snapshots antes de exportar; monitor operacional no superadmin; fila durável de push com tentativas e reenvio controlado.

Reutilizar exit_records/rehired_at, jornadas vigentes, snapshots, central de avisos e autenticação cron. Mudanças novas de configuração serão versionadas; dados históricos não registrados não podem ser reconstruídos com certeza. Nunca sobrescrever snapshots concluídos para acomodar cálculo novo. Migrações aditivas, sem apagar originais. Implantação de schema precede código. Rollback preserva tabelas e histórico.

Referência para os indicadores urbanos noturnos: CLT art. 73, https://www.planalto.gov.br/ccivil_03/decreto-lei/del5452compilado.htm . Equivalência de 52m30s é indicador separado para conferência contábil; não aplicar percentuais ou regras de convenção coletiva implicitamente. Escala 12x36 exige âncora e cadastro explícito; não inferir pelo número de batidas.

## Entrega e compatibilidade

- Migrações 162–164 adicionam versões de configuração por dia, parentela de unidades, parâmetros de escala, indicadores noturnos, fila de push, tentativas e observações operacionais. Nenhum registro original ou fechamento antigo é regravado.
- Desligamento inclui o último dia do vínculo; a lacuna até a recontratação não gera faltas. Recontratação sem admissão antiga conhecida exige revisão. O RH pode informar a admissão histórica com vigência e referência documental; a ação fica auditada e exige reabertura se afetar fechamento ativo.
- Regras e unidade antigas conhecidas são resolvidas por data; mudanças novas passam a ter histórico. A instalação fornece uma linha de base da configuração atual e não inventa configurações anteriores que nunca foram registradas. Versões do mesmo dia representam a configuração válida para a data, com alterações auditadas nas APIs existentes.
- 12×36 é opt-in por jornada própria, com data de primeiro trabalho e span contratual de 12 horas. Escalas semanais continuam compatíveis. Saída/retorno após meia-noite usa o dia lógico do turno; ajustes do RH somam um dia aos horários da madrugada. Os indicadores noturnos urbanos são opcionais: minutos físicos e equivalentes de 52m30s separados; o banco segue tempo físico, sem percentuais salariais implícitos. Prorrogação noturna, regimes rurais e regras específicas de convenção coletiva não são presumidos.
- Fechamento espera o fim contratual do turno. Reabertura preserva snapshots. Triggers impedem alterações nos totais congelados e mudanças retroativas de jornada/desligamento que afetariam períodos fechados. Uma nova marcação original continua sendo recebida: se pertencer a turno já fechado, a conciliação exige revisão/reabertura em vez de impedir a marcação.
- Conciliação verifica totais diários, hash versionado, contestação, solicitações pendentes e banco recalculado a partir da âncora anterior ao período. CSV contábil v2 acrescenta `night_minutes` e `night_equivalent_minutes` ao final do cabeçalho v1; o identificador passa a `30grow-time-v2`. O contador deve atualizar seu mapeamento. Arquivos de auditoria continuam disponíveis.
- App e portal mostram os indicadores noturnos do histórico e dos novos espelhos sem recalcular no cliente. Campos novos são opcionais nos contratos mobile para compatibilidade com o backend anterior. Não foram criadas telas de gestor no app.

## Operação

O superadmin consulta a saúde do ponto na tela de certificado digital: vencimento, comprovantes sem assinatura há mais de dez minutos, falhas de assinatura em 24h, última indisponibilidade informada do REP, desvio de relógio e fila de push. A consulta não acessa o arquivo A1 nem testa assinatura. Metadados de validade dependem de validação anterior do certificado.

A rotina `POST /api/cron/time-clock-maintenance` exige o `CRON_SECRET` existente e JSON `{}`. Para uma medição externa confiável, aceita também `{ "clock": { "offsetMs": 0, "observedAt": "<ISO recente>", "source": "a.ntp.br" } }`. Medições antigas/inválidas são recusadas. Sem medição recente (15 min), o painel mostra estado desconhecido; não registra sucesso fictício.

Agendar uma execução por minuto de `node --env-file=.env scripts/time-clock-maintenance.mjs`, com `APP_URL` e `CRON_SECRET` no ambiente protegido. O script processa a fila e, a cada cinco minutos, observa NTP em `a.ntp.br` (configurável em `TIME_CLOCK_NTP_SERVER`). Exige saída UDP/123 e deve rodar no host cujo relógio será monitorado. A observação valida origem da requisição, estado do servidor e atraso; falha de rede não vira offset zero. Não ajusta o relógio: chrony/ntpd e a configuração de todos os nós e do banco continuam sendo responsabilidade da infraestrutura. Referências: https://ntp.br/faq/ e a Portaria oficial em https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/legislacao/portarias-1/portarias-vigentes-3/word-portaria-no-671-de-8-de-novembro-de-2021-compilada-05-10-2023-pdf-versao-para-publicacao.pdf .

A fila é criada no mesmo INSERT da notificação interna. O worker reivindica jobs com `SKIP LOCKED`, recupera leases expirados, valida novamente o contexto empregado/empresa/token e respeita destinos opt-in existentes. São cinco tentativas por ciclo, com backoff e histórico permanente enquanto a notificação for retida. Token inválido é desativado; falha terminal pode ser reenfileirada pelo superadmin com auditoria. Reenvio preserva o total de tentativas e as ocorrências anteriores. Entrega é pelo menos uma vez: falha após o provedor aceitar e antes da confirmação local pode duplicar push; não se promete exatamente uma vez nem leitura pelo empregado. A notificação interna permanece disponível independentemente do push.

## Implantação e rollback

Aplicar schema antes do código, validar o gate e iniciar o scheduler somente após todos os processos antigos serem substituídos. Em atualização com tráfego, as notificações geradas antes do instante de corte podem já ter recebido o envio imediato antigo; identificar esse intervalo e marcar apenas seus jobs pendentes como `skipped` antes de ativar o worker evita reenvio de transição. Não apagar notificações para realizar o corte. Executar uma única rotina agendada por ambiente; múltiplos workers são seguros pelo lease, mas a observação de relógio deve identificar o host monitorado.

Rollback mantém os dados novos; parar o scheduler antes de voltar ao código de envio imediato para evitar dois caminhos de entrega. Não remover as proteções, históricos ou snapshots. Nenhuma migração ou integração externa foi executada em produção nesta implementação; A1 real e ensaio em dispositivo físico permanecem fora desta validação local.

## Evidência local da entrega

- Build de produção do web passou; 82 testes focados de cálculo/calendário/banco/mobile/API/NTP/avisos passaram e 68 testes da suíte de segurança passaram.
- Bootstrap completo até a migração 164 e reaplicação das expansões passaram no PostgreSQL descartável. Integração cobre desligado no mês, recontratação com admissão desconhecida/corrigida, turnos de madrugada, 12×36, transição de unidade, lock concorrente, imutabilidade do snapshot, corrupção simulada, conciliação, isolamento e marcação original recebida após fechamento.
- Fila testada com provedor simulado: falha de rede, sucesso, esgotamento de cinco tentativas, reenvio autorizado, preservação das seis tentativas acumuladas, token inválido e nenhuma repetição de job confirmado.
- App: lint, typecheck e 267 testes passaram. Componentes novos usam o mesmo contrato/fachada e os indicadores vêm do backend; não houve novo transporte HTTP em componentes.
- Chromium: alertas do superadmin, reenvio, seletor 12×36, âncora, opção noturna e formulário de correção histórica passaram. Layout conferido em 1280px e 390px. Página temporária de preview removida e servidor de teste encerrado.
- O cálculo noturno foi medido com 1.000 dias sintéticos: aproximadamente 575 ms antes e 124 ms após reduzir classificações repetidas, preservando os testes. Medição local, sem promessa de latência em produção.
- A observação NTP foi testada com pacotes sintéticos (offset, atraso, resposta incompatível, relógio não sincronizado); nenhum teste alterou relógio, enviou push real, acessou A1 real ou publicou a aplicação.
