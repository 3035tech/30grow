# Checklist de conclusão do módulo de ponto — REP-P

Atualizado em 19/11/2026. Este documento organiza o trabalho restante para liberar o 30Grow Ponto como REP-P. **A existência de código ou certificado do INPI, isoladamente, não declara conformidade nem autoriza remover o estado “Controle de jornada em validação”.** Cada item de liberação precisa ter evidência na versão e infraestrutura efetivamente oferecidas.

## Situação do pedido no INPI

- Pedido da 3035Tech protocolado em 04/11/2026; a GRU correspondente consta como paga.
- Protocolo: `870260113840`.
- Processo: `512026010154-9`.
- Certificado expedido em 10/11/2026 (despacho 730, RPI 2914). O certificado visualizado em 18/11/2026 confere processo `BR512026010154-9`, titular, título e SHA-512 com os dados do pedido. Arquivar o PDF oficial junto aos documentos da empresa.
- Histórico da solicitação: [registro INPI 30Grow Ponto](../registro-inpi-30grow-ponto.md).

## Implementação já identificada no código

Estes pontos existem no repositório, mas ainda precisam de aceite no ambiente de liberação:

- Cadastro fiscal de estabelecimento e trabalhadores vinculados à empresa.
- Registro de marcações REP-P com NSR por estabelecimento, hash, validação de integridade e proteção dos registros originais.
- Geração de AFD e AEJ, com validações de período e cenários fiscais não resolvidos bloqueados.
- Comprovantes PDF com código de registro/hash e fluxo de assinatura PAdES; consulta autenticada dos comprovantes recentes pelo portal/app.
- Implementação de assinatura CAdES destacada para arquivos fiscais e monitor administrativo para falhas, relógio, disponibilidade e certificado.

## Código implementado localmente e pendências de aceite

- [x] **Eventos do AFD e trilha operacional:** implementação local completa para inclusão/alteração e exclusão/reinclusão de trabalhador (tipo 5 I/A/E), transições confirmadas de disponibilidade (tipo 6 07/08) e ajustes efetivamente aplicados reportados pela infraestrutura (tipo 4). Os registros são imutáveis, usam NSR por estabelecimento e não inferem retorno de energia (02), ajuste ou indisponibilidade a partir de sinais diferentes. Migrations 181–184, endpoints e utilitário de envio via stdin (`scripts/report-rep-clock-adjustment.mjs`) estão no workspace; ainda não foram aplicados. [ ] Configurar o monitor de disponibilidade e o hook do host para chamar o utilitário após ajuste concluído em toda a frota, definir `REP_CLOCK_ADJUSTMENT_SECRET` e validar arquivos em homologação. NTP continua apenas observacional. Códigos 01/03/05/06 são específicos de funções REP-C; 02 é retorno de energia.
- [x] **Campo de local no comprovante:** o PDF inclui o `workplace` cadastrado como “Local de prestação/endereço” quando preenchido, para atender ao art. 79, IV, em atividade externa ou em instalações de terceiros. A configuração correta do local por estabelecimento e a conferência do PDF assinado continuam pendentes no aceite do ambiente/cliente.
- [x] **Espelho formal de ponto (art. 84):** acesso mensal individual e impressão/salvamento em PDF implementados no portal do colaborador. A revisão documental/código em 19/11/2026 conferiu os seis grupos mínimos: empregador e identificador complementar quando existente; trabalhador, CPF, admissão e cargo/função; emissão e período; jornada contratual; marcações originais e tratadas; duração com redução noturna quando aplicável. Campos obrigatórios ausentes bloqueiam a impressão. [ ] Fazer conferência visual, conferir dados sintéticos e homologar. A exibição da pausa contratual não é marcação nem suporte à pré-assinalação.
- [x] **Pré-assinalação de intervalo:** configuração explícita por jornada da empresa ou do empregado; marcações de saída/retorno são derivadas no espelho, apuração e AEJ sem alterar registros originais. [ ] Aplicar migration 180 em homologação e conferir dias incompletos, jornada noturna/virada de dia e intervalo já marcado manualmente contra o registro 05 e o leiaute oficial; manter indisponível até homologação.
- [x] **Escopo fiscal não suportado, com bloqueio explícito:** múltiplos cadastros do mesmo CPF no estabelecimento agora bloqueiam AFD e AEJ; jornadas 12×36 continuam bloqueando AEJ até definição da regra de DSR e dos vínculos. Não inferir DSR, vínculo ou consolidação entre estabelecimentos. Uma implementação futura exige regra fiscal documentada e modelagem própria antes de remover os bloqueios.
- [ ] **Contrato independente AFD/AEJ:** conferência documental/estática dos leiautes AFD/004 e AEJ/002 registrada em `rep-layout-corrections.md`; falta comparar bytes e posições com referência independente dos formatadores, usar dados sintéticos, verificar assinaturas e homologar. Links oficiais do MTE atualizados em 31/07/2026.
- [x] **Fluxos AEJ:** implementação preserva marcações originais e representa inclusões, desconsiderações, pré-assinalação e justificativas; cenários permanecem sujeitos à validação independente dos campos e do arquivo.
- [x] **Exclusão lógica de trabalhador:** tipo 5 “E/I”, identidade do responsável, preservação do histórico, bloqueio de novas marcações e bloqueio da desativação durante jornada aberta na API e no banco. [ ] Aplicar migration 181 em homologação e validar o registro fiscal antes de liberar.

## Certificado, assinatura e documentos

- [x] Certificado INPI expedido e conferido: titularidade, título, hash e número do processo coincidem com o pedido. Arquivar o PDF oficial junto aos documentos da empresa.
- [x] Preparar a configuração AWS de produção para receber o A1: segredo dedicado no Secrets Manager, permissões da role ECS limitadas ao segredo e ao prefixo privado do S3, e bundle de raízes ICP-Brasil configurado na revisão ECS 198. A task está saudável; isso habilita o formulário, mas não comprova upload ou validação de um certificado real.
- [ ] **Aceitar a configuração do A1 ICP-Brasil real do desenvolvedor:** houve upload recente no S3 privado de produção (19/11/2026 00:42:48 UTC; objeto com 9.275 bytes). Os logs filtrados não mostraram falha da operação. Isso indica que o arquivo passou pela validação e chegou ao armazenamento, mas ainda não comprova independentemente que a versão do Secrets Manager foi ativada, nem valida titularidade/cadeia/validade e assinatura real. Confirmar a projeção pública da configuração no sistema e testar comprovante, AFD e AEJ com verificação independente; registrar renovação, expiração e revogação. Não ler nem registrar senha ou conteúdo do A1.
- [ ] Assinar AFD/AEJ em CAdES destacado `.p7s` e comprovantes eletrônicos em PDF/PAdES com certificado ICP-Brasil válido. Validar os arquivos com ferramentas independentes; os certificados efêmeros dos testes não contam como aceite.
- [ ] Preparar o Atestado Técnico e Termo de Responsabilidade conforme o modelo vigente do MTE, identificando REP-P/PTRP, programa, versão, registro/certificado INPI e destinatário. Obter as assinaturas qualificadas requeridas dos responsáveis técnico e legal, em PDF PAdES.
- [ ] Entregar o atestado a cada empresa cliente e instruí-la a mantê-lo disponível para fiscalização. Não assinar declaração de conformidade antes de fechar os requisitos técnicos e operacionais.

## Operação e validação de liberação

- [ ] Demonstrar que todos os servidores e coletores mantêm sincronismo com a Hora Legal Brasileira do Observatório Nacional, com desvio máximo de 30 segundos. O código observa NTP, mas a observação não ajusta relógios nem prova sincronismo de todos os nós/banco. Para o evento AFD tipo 4, falta integração confiável com a execução do ajuste no host e identificação do responsável.
- [ ] Demonstrar redundância, alta disponibilidade e confiabilidade do ARP, retenção dos dados pelo prazo legal, backup e restauração real. Validar permissões do PostgreSQL para que a aplicação não seja proprietária das tabelas nem possa contornar as proteções de integridade.
- [ ] Provar que o colaborador pode acessar o comprovante após cada marcação e extrair os comprovantes das últimas 48 horas; verificar todos os campos do art. 79 e a assinatura em aparelhos e navegadores suportados.
- [ ] Provar a geração de AFD por intervalo e a entrega pronta quando solicitada pela fiscalização. Provar a geração mensal e o acesso do trabalhador ao AEJ/Espelho, além do prazo operacional para entregar arquivos/relatórios à fiscalização.
- [ ] Conferir monitoramento independente da disponibilidade e do relógio, alertas para desvio acima de 30 segundos, indisponibilidade, comprovantes sem assinatura, falhas de assinatura, certificado próximo do vencimento e fila pendente. O endpoint de saúde não cria sozinho o monitor externo.
- [ ] Em homologação, executar o ciclo ponta a ponta com dados sintéticos: cadastro, marcação, comprovante, ajuste/tratamento permitido, fechamento/espelho, AFD, AEJ e validação das assinaturas.
- [ ] Confirmar migrations requeridas (160–165, 180 para pré-assinalação, 181 para exclusão lógica REP-P, 182 para transições de disponibilidade, 183 para o formato AFD tipo 4 e 184 para ingestão idempotente de ajustes), schema, versão do backend/web/app e configuração em todas as instâncias dos ambientes. Aceitar primeiro em homologação; publicar em produção apenas a versão aprovada.
- [ ] Validar em dispositivos físicos iOS/Android e navegadores suportados, incluindo indisponibilidade de rede, repetição de requisição e entrega do comprovante.
- [ ] Confirmar isolamento entre empresas, perfis de acesso, auditoria e controles de privacidade/segurança dos dados dos trabalhadores.
- [ ] Atualizar o aviso e o material comercial do produto somente depois de aprovado o aceite técnico, operacional e documental.

## Requisitos de operação dos clientes

- [ ] Cada empregador configura corretamente os dados já previstos no cadastro REP: nome e CNPJ/CPF do empregador, número de registro INPI, responsável e CPF, fuso, local de trabalho, empregados e CPF, jornada semanal/diária, descanso semanal e regra noturna explícita quando aplicável. CAEPF/CNO são opcionais segundo o MTE; endereço/local de prestação deve ser informado quando a atividade for externa ou em instalações de terceiros. O RH também precisa manter admissão e cargo/função do vínculo para compor o espelho mensal.
- [ ] Orientar o empregador a registrar a jornada real, manter o atestado, dar acesso a comprovantes e espelhos e disponibilizar os arquivos/relatórios à fiscalização.
- [ ] REP-P não exige homologação prévia do MTE nem instrumento coletivo próprio para sua modalidade. Isso não dispensa requisitos da Portaria 671 nem regras trabalhistas/convencionais aplicáveis à jornada do empregador.

## Critério de conclusão

Marcar o módulo como liberado somente após todas as pendências aplicáveis estarem fechadas e vinculadas a evidências da versão e infraestrutura de produção. Para requisitos declarados fora de escopo, registrar a decisão e manter bloqueios que impeçam exportar ou anunciar conformidade para esses cenários.

## Referências

- [Portaria MTP nº 671/2021 compilada](https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/legislacao/portarias-1/portarias-vigentes-3/PDFPortarian671de8denovembrode2021compilada07.01.2026.pdf)
- [Perguntas e Respostas do MTE sobre REP](https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/inspecao-do-trabalho/fiscalizacao-do-trabalho/Perguntas%20e%20Respostas%20REP)
- [Página do MTE com os leiautes AFD/AEJ](https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/inspecao-do-trabalho/fiscalizacao-do-trabalho/rep)
- [Leiaute oficial do AFD](https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/inspecao-do-trabalho/fiscalizacao-do-trabalho/leiaute-do-arquivo-fonte-de-dados-afd.pdf)
- [Leiaute oficial do AEJ](https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/inspecao-do-trabalho/fiscalizacao-do-trabalho/leiaute-do-arquivo-eletronico-de-jornada-aej.pdf)
- [Modelo do Atestado Técnico e Termo de Responsabilidade](https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/inspecao-do-trabalho/fiscalizacao-do-trabalho/modelo-do-atestado-tecnico-e-termo-de-responsabilidade.pdf)
