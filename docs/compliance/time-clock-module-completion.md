# Checklist de conclusão do módulo de ponto — REP-P

Atualizado em 18/11/2026. Este documento organiza o trabalho restante para liberar o 30Grow Ponto como REP-P. **A existência de código ou certificado do INPI, isoladamente, não declara conformidade nem autoriza remover o estado “Controle de jornada em validação”.** Cada item de liberação precisa ter evidência na versão e infraestrutura efetivamente oferecidas.

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

## Pendências de código

- [ ] **Eventos do AFD e trilha operacional:** definir a aplicabilidade dos eventos tipo 4 (ajuste de relógio), tipo 5 (exclusão lógica de empregado) e tipo 6 (eventos de energia). Implementar os eventos aplicáveis e seus dados/responsáveis ou documentar, com evidência, por que a operação não existe no REP-P. Não gerar eventos fictícios.
- [x] **Campo de local no comprovante:** o PDF inclui o `workplace` cadastrado como “Local de prestação/endereço” quando preenchido, para atender ao art. 79, IV, em atividade externa ou em instalações de terceiros. A configuração correta do local por estabelecimento e a conferência do PDF assinado continuam pendentes no aceite do ambiente/cliente.
- [ ] **Espelho formal de ponto (art. 84):** confirmar se a tela/relatório atual contém todos os campos regulamentares e se o colaborador consegue acessá-lo mensalmente. Se não contiver, implementar o relatório eletrônico com dados do empregador e trabalhador, admissão/cargo, período/emissão, jornada contratual, marcações originais e tratadas e duração considerando redução noturna.
- [ ] **Escopo de jornadas:** decidir se serão implementados múltiplos vínculos do mesmo CPF e exportação 12x36 com regra de DSR adequada. Até lá, manter bloqueios explícitos e não oferecer esses casos como suportados.
- [ ] **Contrato independente AFD/AEJ:** fechar validação dos serializadores contra os leiautes oficiais atuais, com bytes/posições de referência independentes do próprio formatador e cenários com dados sintéticos. Os links do MTE foram atualizados em 31/07/2026; conferir AFD/004 e AEJ/002 antes do aceite.
- [ ] Conferir todos os campos e fluxos de inclusão, desconsideração, pré-assinalação e justificativa no AEJ, sem modificar marcações originais.

## Certificado, assinatura e documentos

- [x] Certificado INPI expedido e conferido: titularidade, título, hash e número do processo coincidem com o pedido. Arquivar o PDF oficial junto aos documentos da empresa.
- [x] Preparar a configuração AWS de produção para receber o A1: segredo dedicado no Secrets Manager, permissões da role ECS limitadas ao segredo e ao prefixo privado do S3, e bundle de raízes ICP-Brasil configurado na revisão ECS 198. A task está saudável; isso habilita o formulário, mas não comprova upload ou validação de um certificado real.
- [ ] Enviar e validar o A1 ICP-Brasil real do desenvolvedor em homologação e produção, com chave privada em armazenamento privado e senha em segredo separado; documentar renovação, expiração e revogação. A credencial real ainda não foi fornecida no sistema.
- [ ] Assinar AFD/AEJ em CAdES destacado `.p7s` e comprovantes eletrônicos em PDF/PAdES com certificado ICP-Brasil válido. Validar os arquivos com ferramentas independentes; os certificados efêmeros dos testes não contam como aceite.
- [ ] Preparar o Atestado Técnico e Termo de Responsabilidade conforme o modelo vigente do MTE, identificando REP-P/PTRP, programa, versão, registro/certificado INPI e destinatário. Obter as assinaturas qualificadas requeridas dos responsáveis técnico e legal, em PDF PAdES.
- [ ] Entregar o atestado a cada empresa cliente e instruí-la a mantê-lo disponível para fiscalização. Não assinar declaração de conformidade antes de fechar os requisitos técnicos e operacionais.

## Operação e validação de liberação

- [ ] Demonstrar que todos os servidores e coletores mantêm sincronismo com a Hora Legal Brasileira do Observatório Nacional, com desvio máximo de 30 segundos. O código observa NTP, mas a observação não ajusta relógios nem prova sincronismo de todos os nós/banco.
- [ ] Demonstrar redundância, alta disponibilidade e confiabilidade do ARP, retenção dos dados pelo prazo legal, backup e restauração real. Validar permissões do PostgreSQL para que a aplicação não seja proprietária das tabelas nem possa contornar as proteções de integridade.
- [ ] Provar que o colaborador pode acessar o comprovante após cada marcação e extrair os comprovantes das últimas 48 horas; verificar todos os campos do art. 79 e a assinatura em aparelhos e navegadores suportados.
- [ ] Provar a geração de AFD por intervalo e a entrega pronta quando solicitada pela fiscalização. Provar a geração mensal e o acesso do trabalhador ao AEJ/Espelho, além do prazo operacional para entregar arquivos/relatórios à fiscalização.
- [ ] Conferir monitoramento independente da disponibilidade e do relógio, alertas para desvio acima de 30 segundos, indisponibilidade, comprovantes sem assinatura, falhas de assinatura, certificado próximo do vencimento e fila pendente. O endpoint de saúde não cria sozinho o monitor externo.
- [ ] Em homologação, executar o ciclo ponta a ponta com dados sintéticos: cadastro, marcação, comprovante, ajuste/tratamento permitido, fechamento/espelho, AFD, AEJ e validação das assinaturas.
- [ ] Confirmar migrations requeridas (160–165), schema, versão do backend/web/app e configuração em todas as instâncias dos ambientes. Aceitar primeiro em homologação; publicar em produção apenas a versão aprovada.
- [ ] Validar em dispositivos físicos iOS/Android e navegadores suportados, incluindo indisponibilidade de rede, repetição de requisição e entrega do comprovante.
- [ ] Confirmar isolamento entre empresas, perfis de acesso, auditoria e controles de privacidade/segurança dos dados dos trabalhadores.
- [ ] Atualizar o aviso e o material comercial do produto somente depois de aprovado o aceite técnico, operacional e documental.

## Requisitos de operação dos clientes

- [ ] Cada empregador configura corretamente seus estabelecimentos, CNPJ/CPF, local de trabalho, empregados, horários e regras aplicáveis.
- [ ] Orientar o empregador a registrar a jornada real, manter o atestado, dar acesso a comprovantes e espelhos e disponibilizar os arquivos/relatórios à fiscalização.
- [ ] REP-P não exige homologação prévia do MTE nem instrumento coletivo próprio para sua modalidade. Isso não dispensa requisitos da Portaria 671 nem regras trabalhistas/convencionais aplicáveis à jornada do empregador.

## Critério de conclusão

Marcar o módulo como liberado somente após todas as pendências aplicáveis estarem fechadas e vinculadas a evidências da versão e infraestrutura de produção. Para requisitos declarados fora de escopo, registrar a decisão e manter bloqueios que impeçam exportar ou anunciar conformidade para esses cenários.

## Referências

- [Portaria MTP nº 671/2021 compilada](https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/legislacao/portarias-1/portarias-vigentes-3/PDFPortarian671de8denovembrode2021compilada07.01.2026.pdf)
- [Perguntas e Respostas do MTE sobre REP](https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/inspecao-do-trabalho/fiscalizacao-do-trabalho/Perguntas%20e%20Respostas%20REP)
- [Página do MTE com os leiautes AFD/AEJ](https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/inspecao-do-trabalho/fiscalizacao-do-trabalho/rep)
- [Modelo do Atestado Técnico e Termo de Responsabilidade](https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/inspecao-do-trabalho/fiscalizacao-do-trabalho/modelo-do-atestado-tecnico-e-termo-de-responsabilidade.pdf)
