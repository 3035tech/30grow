# REP-P: implementação técnica e limites

Estado: implementação local, sem publicação e sem declaração de conformidade integral.

## Entregas

A migração 160 registra originais de novas marcações de trabalhadores explicitamente cadastrados no REP, com NSR por estabelecimento, encadeamento SHA-256, CRC nos eventos aplicáveis e proteção contra alteração/exclusão dos originais. Revisões administrativas preservam os originais. Registros antigos não recebem NSR retroativo.

Há cadastro fiscal por empresa, exportações AFD/AEJ com assinatura CAdES destacada em ZIP, comprovantes PDF com assinatura PAdES e consulta autenticada das últimas 48 horas no portal e aplicativo. A assinatura falha de forma fechada quando falta configuração. O relógio exibido usa uma referência do servidor; isso não comprova sincronização do servidor com a Hora Legal Brasileira. GPS indisponível não impede a marcação online.

## Pré-requisitos antes da ativação

- Conferir registro do programa no INPI, identidade do desenvolvedor, versão e Atestado Técnico e Termo de Responsabilidade com os responsáveis pertinentes.
- Configurar as variáveis REP_* descritas em .env.example. Manter o A1 ICP-Brasil em objeto privado do S3 e montar apenas a cadeia de confiança no servidor. Guardar a senha separadamente no AWS Secrets Manager; não incorporar segredos à imagem, código, aplicativo ou repositório. Confirmar titularidade, validade, política de assinatura e procedimentos de revogação. Os testes usam certificados efêmeros, não ICP-Brasil reais.
- Validar arquivos e assinaturas com ferramentas independentes e os leiautes vigentes antes de disponibilizar uso fiscal.
- Atualizar todas as instâncias do backend antes de cadastrar estabelecimentos e trabalhadores. Aplicar a migração por operação controlada, com backup e plano de restauração. Depois disponibilizar web e app; testar dispositivos físicos iOS e Android.
- Executar a aplicação com usuário PostgreSQL sem propriedade das tabelas, DDL ou capacidade de desabilitar triggers. As proteções SQL não defendem contra o proprietário/superusuário.
- Monitorar sincronização de horário, desvios e disponibilidade externamente; configurar monitor independente para POST autenticado em /api/cron/rep-service-state com available boolean. Esse endpoint não cria sozinho um monitor de disponibilidade.
- Validar backups redundantes, retenção, restauração, controles de acesso e operação LGPD. Código e criptografia isolados não demonstram cumprimento integral.

## Limites atuais

Exportação admite até 62 dias e 200 colaboradores por chamada e recusa marcações não administrativas sem origem fiscal no período. O AEJ exige intervalos contratuais explícitos. A evolução em time-clock-evolution.md adiciona virada de dia e 12×36 explícita; estes casos também exigem ensaio fiscal com dados de referência. Revisar regras de apuração, jornadas, DSR e banco de horas com casos reais antes de uso fiscal. Configurações de identidade do estabelecimento e vínculo fiscal são imutáveis; mudanças exigem procedimento próprio, não edição silenciosa.

Não inclui marcação offline com sincronização, integração externa com folha, marcação/assinatura por WhatsApp, reconhecimento facial, totem ou garantia de apuração de escalas complexas e adicional noturno. A confirmação interna do espelho pelo colaborador tem finalidade distinta da assinatura ICP-Brasil do desenvolvedor nos arquivos e comprovantes.

## Validação reproduzível

- test/rep/ledger.test.js: concorrência, NSR, integridade, imutabilidade, isolamento, disponibilidade e reaplicação da migração.
- test/rep/schema.test.js: bootstrap e migrações completos, cadastro, API de domínio e exportações reais sobre PostgreSQL descartável.
- test/rep/formats.test.js: campos, documentos e serialização.
- test/rep/signing.test.js: verificação criptográfica CAdES e assinatura PDF com certificado efêmero de teste.
- Aplicativo: suíte Jest, TypeScript e lint; validação em aparelhos físicos ainda necessária.

## Reversão

É possível reverter a interface e interromper novos cadastros, preservando tabelas, colunas, originais e comprovantes. Não remover a migração nem apagar registros para reverter o código. Uma versão antiga que tente alterar originais protegidos poderá falhar; avaliar compatibilidade antes de rollback.

## Referências oficiais

- https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/inspecao-do-trabalho/fiscalizacao-do-trabalho/Perguntas%20e%20Respostas%20REP
- https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/inspecao-do-trabalho/fiscalizacao-do-trabalho/leiaute-do-arquivo-fonte-de-dados-afd.pdf
- https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/inspecao-do-trabalho/fiscalizacao-do-trabalho/leiaute-do-arquivo-eletronico-de-jornada-aej.pdf

## Refinamento da interface

Configuração oferece seleção de estabelecimento e dia do descanso por nome, limites nos campos, mensagens distintas para consulta/cadastro/exportação e confirmação de sucesso. Comprovantes exibem datas no fuso da jornada, janela de 48 horas e estados de carregamento/vazio/erro. O aplicativo permite repetir a consulta e ignora respostas de paginação de contextos anteriores. Leituras periódicas não se sobrepõem; chamadas web têm prazo limite. A troca de empresa remonta a configuração para descartar estado anterior.

Validação após refinamento: 265 testes do aplicativo (26 suítes), TypeScript, lint e testes de formato/assinatura. A validação visual em navegadores e em aparelhos físicos continua pendente; não houve alteração em produção.


## Certificado A1: S3 e super admin

A tela Administração → Certificado digital está disponível somente para o super admin da plataforma (admin sem empresa). Não fica disponível a gestores, colaboradores ou administradores vinculados a empresa. A configuração vale para o desenvolvedor da plataforma, não para o certificado individual de cada empregador.

### Provisionamento

1. O upload usa o bucket privado fixo `30grow`, região `us-west-2`. Configurar no servidor `REP_SIGNING_UPLOAD_PREFIX=private/homolog/rep/a1/` em Dublin; o padrão de produção é `private/rep/a1/`. A tela não permite alterar o destino. Não existe fallback para REP_SIGNING_P12_PATH.
2. Pré-criar um segredo dedicado no AWS Secrets Manager com valor JSON `{}` e configurar `REP_SIGNING_SECRET_ID` e sua região `REP_SIGNING_SECRET_REGION`. A aplicação pode ler e criar versões desse segredo; não cria, lista ou exclui segredos pela tela. Em homologação, o segredo `/homolog/30grow/rep-signing` já foi provisionado vazio, assim como a pasta privada do A1 no bucket existente.
3. Configurar `REP_SIGNING_CA_PATH` para as raízes confiáveis e `REP_OPENSSL_PATH` para OpenSSL 3. Configurar a identidade do desenvolvedor nas variáveis REP_DEVELOPER_*.
4. Na tela, selecionar o arquivo .p12/.pfx (até 1 MiB) e informar sua senha. Testar valida o arquivo, a cadeia, as datas e uma assinatura sem enviar ao S3 ou ativar. Validar e salvar valida primeiro, envia para uma chave UUID nova na pasta fixa e só então atualiza o segredo. A senha em branco significa senha vazia do novo arquivo; não reutiliza a senha anterior. Falha de validação ou upload preserva a referência ativa. Em timeout ambíguo ao gravar o segredo, consultar novamente o estado antes de tentar de novo; o objeto novo não é excluído, pois pode já estar ativo. Objetos antigos não são sobrescritos ou excluídos automaticamente.

5. Validar com o A1 real em homologação antes de produção. Os testes automatizados usam mocks AWS e certificado efêmero; não comprovam acesso à conta, role, bucket ou segredo reais.

O segredo contém bucket, key, region, versionId, password e metadados da última validação. O GET da tela devolve somente uma projeção explícita sem senha, conteúdo do A1 ou identificação do segredo. A senha é digitada em campo protegido; pode ser substituída, nunca consultada. Após salvar ou falhar ela é limpa; após testar com sucesso permanece apenas no formulário até salvar ou sair. Não há armazenamento local no navegador.

Sem `REP_SIGNING_SECRET_ID`, é possível configurar o S3 pelas variáveis REP_SIGNING_S3_* e injetar REP_SIGNING_P12_PASSWORD como segredo do servidor. A tela fica somente para consulta. Quando SECRET_ID está definido, falhas no Secrets Manager não provocam fallback para as variáveis antigas.

### Permissões e limites

A role precisa de `s3:GetObject` no objeto/prefixo dedicado; se VersionId for utilizado, também `s3:GetObjectVersion`. Precisa de `secretsmanager:GetSecretValue` e `secretsmanager:PutSecretValue` somente no segredo dedicado. Se forem usadas chaves KMS próprias, configurar as permissões KMS e políticas das chaves correspondentes. O upload precisa de `s3:PutObject` somente na pasta fixa do A1; não conceder exclusão ou acesso genérico a outros segredos. Os objetos usam criptografia AES256, sem ACL pública, com Cache-Control private/no-store.

O download do A1 tem limite de 1 MiB e prazo de 15 segundos, inclusive no consumo do corpo. O material temporário é criado em diretório privado e removido ao terminar. Não há cache permanente do certificado. A cadeia e o vencimento são verificados novamente em cada nova operação de assinatura; a configuração no super admin é uma referência, não garantia de acesso futuro à AWS.

A tela exibe titular, emissor, impressão SHA-256, início/fim da validade e data da última validação. Mostra os dias restantes e aviso visual quando faltam até 30 dias. Não envia alertas automáticos por e-mail/push. Certificado vencido impede novas assinaturas; a batida de ponto e os registros originais não dependem desse carregamento. Comprovantes já assinados permanecem preservados.

POST exige sessão autorizada, origem igual à URL canônica do aplicativo e limite de 10 operações por usuário a cada 15 minutos. Os eventos rep.certificate.updated/tested usam a auditoria existente (best-effort), sem senha, objeto S3 ou conteúdo do certificado no metadata. A tela recebe somente o A1 e a senha por multipart. Não aceita credenciais AWS, URL pública, bucket, chave ou região. O corpo é limitado durante leitura mesmo sem Content-Length; arquivos e campos inesperados são rejeitados antes de operações AWS.

Evidência da integração do certificado: 43 testes focados de assinatura, S3/Secrets Manager, autorização, navegação e isolamento passaram. O teste criptográfico valida CAdES/PAdES e usa um A1 efêmero para exercitar teste/salvamento, senha incorreta e certificado vencido; alterações inválidas não criam uma nova versão do segredo. Playwright verificou o componente real em desktop e viewport móvel com APIs simuladas: aviso de renovação, vencimento, segredo não preenchido no GET, teste sem ativação, salvamento e modo somente leitura. Capturas e roteiro de ensaio ficam em /private/tmp; a página temporária de preview foi removida. Não houve acesso ou alteração em recursos AWS reais.

Referência operacional: https://docs.aws.amazon.com/secretsmanager/latest/userguide/intro.html
