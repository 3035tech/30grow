# Jornada em validação — comunicação e liberação

Decisão de produto de 26/10/2026: apresentar o módulo como **Controle de jornada em validação**. A adequação para uso como registro eletrônico oficial de ponto está em andamento. Nesta fase, orientar a empresa a manter o seu sistema oficial de jornada.

## Comunicação vigente

- Aviso permanente, sem depender de configuração fiscal ou certificado cadastrado, nas telas de jornada do RH e do colaborador web/app e na oferta pública de planos.
- Descrever o recurso em validação também nas funcionalidades públicas, páginas de soluções e respostas sobre o portal do colaborador, nos idiomas disponíveis.
- Não anunciar “100% regularizado”, “ponto homologado”, conformidade integral, garantia de validade jurídica ou substituição do sistema oficial.
- Demonstrações e pilotos devem explicitar esse limite. O aviso não autoriza usar o piloto como sistema oficial e não substitui os requisitos técnicos/documentais.

Esta entrega altera comunicação. Não interrompe batidas, solicitações, consulta de histórico, assinaturas ou exportações; não apaga ou converte registros. Não modifica leiautes fiscais ou o conteúdo de arquivos já emitidos. Cadastrar INPI ou certificado não remove o aviso nem declara conformidade automaticamente.

Em 18/11/2026, a produção passou a usar a revisão ECS 198, com a referência do segredo de assinatura, prefixo privado do S3 e bundle de raízes ICP-Brasil configurados. Em 19/11/2026, um upload real chegou ao prefixo privado de produção; a consulta de metadados confirmou objeto de 9.275 bytes e os logs filtrados não mostraram falha. Ainda falta confirmar a ativação da versão no Secrets Manager pela projeção pública do sistema, validar titularidade/cadeia/validade e verificar assinaturas reais de comprovante, AFD e AEJ. O estado continua **Controle de jornada em validação**.

O espelho mensal individual foi implementado localmente para impressão/salvamento em PDF, com dados do empregador e do vínculo, jornada cadastrada e marcações tratadas. Falta validar o leiaute legal integral e aceitar a funcionalidade em homologação; a mudança ainda não está publicada.

A pré-assinalação de intervalo também foi implementada localmente como configuração efetiva da jornada, com marcações derivadas no espelho e no AEJ sem gravá-las como batidas originais. A migration 180 não foi aplicada e a regra ainda precisa de validação independente nos leiautes oficiais e em homologação. Nenhuma dessas mudanças está publicada.

A exclusão lógica e a reinclusão de trabalhadores no cadastro REP-P foram implementadas localmente para gerar operações AFD tipo 5-E e 5-I, preservando o histórico fiscal e bloqueando novas batidas enquanto o trabalhador estiver excluído. Dependem da migration 181 e de validação em homologação; não estão publicadas.

O endpoint autenticado `/api/cron/rep-clock-adjustment` e a migration 184 foram preparados localmente para registrar ajustes de relógio realmente aplicados, com horários anterior/ajustado, CPF responsável, ID idempotente e geração de AFD tipo 4 por estabelecimento. Ainda falta configurar o agente da infraestrutura e o segredo dedicado `REP_CLOCK_ADJUSTMENT_SECRET`; o evento deve ser enviado apenas após a sincronização da frota. NTP permanece apenas observacional. A migration não foi aplicada e a alteração não está publicada.

## Antes de revisar esse posicionamento

Comprovar e registrar, para a versão e infraestrutura oferecidas:

1. Registro do programa no INPI: certificado `BR512026010154-9` emitido em 10/11/2026 para `30Grow Ponto - REP-P`, com hash SHA-512 documentado em [registro INPI 30Grow Ponto](../registro-inpi-30grow-ponto.md). Confirmar que a versão oferecida corresponde ao código identificado por esse hash antes de anunciar cobertura daquela versão.
2. Atendimento aos requisitos aplicáveis da Portaria 671, inclusive art. 78 e Anexo IX.
3. Atestado Técnico e Termo de Responsabilidade emitido e assinado pelos responsáveis pertinentes, disponibilizado ao empregador.
4. Certificado ICP-Brasil real, titularidade/cadeia/validade e assinaturas de comprovantes/AFD/AEJ verificadas de modo independente, nos leiautes vigentes.
5. Provas de integridade, relógio, disponibilidade, permissões, retenção, backups/restauração e operação LGPD; homologação funcional em dispositivos físicos.
6. Revisão técnica e jurídica documentada e decisão explícita de liberação.

Para REP-P, não confundir registro INPI com homologação pelo MTE: o MTE esclarece que não exige homologação prévia do REP-P. O registro no INPI não comprova sozinho atendimento integral às demais obrigações.

Referências oficiais consultadas em 26/10/2026:

- [Orientações do MTE](https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/inspecao-do-trabalho/fiscalizacao-do-trabalho/Perguntas%20e%20Respostas%20REP)
- [Registro eletrônico de ponto — documentos e leiautes](https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/inspecao-do-trabalho/fiscalizacao-do-trabalho/rep)

Pendências técnicas e operacionais detalhadas: [REP-P: implementação técnica e limites](rep-p-671.md). Publicação deste aviso depende do deploy web e da distribuição da versão atualizada do app; alteração no código local não é prova de publicação.

Checklist para concluir o módulo, separado entre implementação, documentos e validação operacional: [Checklist de conclusão do módulo REP-P](time-clock-module-completion.md). O checklist registra também o protocolo e processo do pedido no INPI.
