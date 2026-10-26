# Importação CSV de colaboradores atuais

Primeira versão: `Equipe → Importar CSV`. Aceita pessoas que já trabalham na empresa. A empresa é resolvida pela sessão do gestor; o arquivo não escolhe empresa. A carga não envia convites, não inicia onboarding, não altera candidatos ou colaboradores existentes e não cria cargos/unidades. Convites posteriores continuam sendo uma ação explícita na ficha.

## Modelo

Cabeçalhos canônicos: `nome_completo,email_corporativo,data_admissao,email_pessoal`. Os três primeiros são obrigatórios; `email_pessoal` é opcional. Datas usam `AAAA-MM-DD` e não podem estar no futuro. CSV UTF-8 com BOM, vírgula ou ponto e vírgula; aspas escapadas e quebras de linha em campos são aceitas. Máximo de 64 KB e 100 pessoas por arquivo. Cabeçalhos desconhecidos ou repetidos são recusados, para não descartar dados silenciosamente.

## Fluxo e integridade

O navegador lê o arquivo localmente e envia seu conteúdo à API autenticada somente para prévia ou confirmação. Não há armazenamento do arquivo nem dados pessoais em logs. A prévia devolve valores normalizados e erros por linha. Na confirmação, o servidor refaz a análise, resolve conflitos de e-mail no escopo da empresa e verifica a capacidade do plano. Um lock na empresa serializa as cargas; a unicidade de e-mail no PostgreSQL protege a concorrência. A transação cria todos os registros ou reverte todos. Uma repetição do arquivo encontra as identidades existentes e não as recria.

O domínio de admissão existente persiste a data de início e a escolha de nenhuma etapa de onboarding. O caminho de criação de candidato recebe um modo de inserção sem atualização para impedir que a carga transforme um candidato em colaborador. `consent_at` não é preenchido pela importação. Os efeitos normais de admissão necessários são executados após o commit; convites por e-mail permanecem desabilitados. Auditoria registra empresa, ator, quantidade e IDs, sem copiar linhas do CSV.

## Provas

- Parser: BOM, delimitadores, aspas, quebras de linha, linhas físicas, datas, cabeçalhos e duplicatas.
- PostgreSQL descartável: isolamento entre empresas, gravação de dois colaboradores, contato opcional, ausência de convites, repetição, candidato existente, concorrência e limite do plano.
- Interface: prévia inválida bloqueia confirmação, arquivo corrigido habilita, resultado aparece em 390 e 1440 px sem overflow do documento.
- ESLint dos arquivos alterados e build Next aprovados.

Sem migration nesta entrega. Novas admissões, atualização/fusão de pessoas, criação de referências organizacionais e convite em massa ficam fora deste fluxo.
