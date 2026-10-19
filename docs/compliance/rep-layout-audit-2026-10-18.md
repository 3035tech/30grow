# Conferência AFD/AEJ — 18/10/2026

**Registro da auditoria anterior às correções.** Os defeitos e reproduções abaixo descrevem o estado anterior. Consulte [correções e validação](rep-layout-corrections.md) para o resultado atual e os bloqueios mantidos.

**Resultado original: reprovado para declaração de conformidade dos arquivos fiscais.** Os testes locais anteriores verificam várias propriedades corretas, mas não cobrem todas as divergências encontradas nesta revisão. Não há evidência de que as divergências tenham surgido em julho de 2026: comparamos a implementação com os documentos hoje disponibilizados pelo MTE, sem uma cópia histórica para estabelecer o que mudou.

Não houve alteração de código de produto, migration, arquivo fiscal persistido ou ambiente externo nesta conferência.

## Referências fixadas

Portal: https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/inspecao-do-trabalho/fiscalizacao-do-trabalho/rep . A página identifica atualização dos links em 31/07/2026. Os PDFs vinculados ainda especificam AFD `004` e AEJ `002`.

- [AFD oficial](https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/inspecao-do-trabalho/fiscalizacao-do-trabalho/leiaute-do-arquivo-fonte-de-dados-afd.pdf), 6 páginas. SHA-256 `0e7d6c5a967c8e7b211b17e5930a25f26db4db3155a7ed36eac94561bf537cbd`.
- [AEJ oficial](https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/inspecao-do-trabalho/fiscalizacao-do-trabalho/leiaute-do-arquivo-eletronico-de-jornada-aej.pdf), 6 páginas. SHA-256 `e1ff56a62f01411a91020633ecf0f68f746f61cbcab55dd9a7d2ec99c71af5dc`.
- [Perguntas do MTE](https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/inspecao-do-trabalho/fiscalizacao-do-trabalho/Perguntas%20e%20Respostas%20REP), questão 49: referência complementar para representar o registro do INPI.

Downloads e texto extraído: `/private/tmp/mte-layout-review/`. Tabelas do AEJ, páginas 3–4, também inspecionadas visualmente. Base web: `86d6e03a`, incluindo o trabalho local de REP-P e polish. Valores usados nas reproduções são sintéticos.

## Divergências que exigem correção

### 1. Cadastro do INPI e serialização no AFD

`lib/rep/registry.js:32`, `app/_components/RepAdminSettings.jsx:185` e a constraint de `migrations/160_rep_original_records.sql:11` obrigam exatamente 17 dígitos. Um registro sintético `5120261234567` é recusado. O tamanho do campo fiscal não deve virar exigência de comprimento do número cadastrado.

Ao chamar o gerador diretamente com esse número, `lib/rep/formats.js:128` produz `00005120261234567`. O AFD exige preenchimento à esquerda e espaços nas posições não utilizadas; para o INPI, a orientação complementar do MTE explicita os espaços à direita. O nome ZIP/TXT é montado a partir desse mesmo campo em `app/api/admin/time-clock/rep/export/route.js:27`, propagando a representação incorreta.

Correção necessária: representar o identificador sem inventar dígitos; aceitar o registro numérico real no cadastro; aplicar preenchimento por campo na exportação e construir o nome pelo identificador canônico. Qualquer mudança de schema deve ser nova migration, preservando originais e identificadores existentes para revisão explícita.

### 2. Campos opcionais no AFD completados com zeros

`lib/rep/formats.js:126` transforma a ausência de documento complementar em `00000000000000`. A montagem SQL do registro 2 também usa `lpad` para documento complementar e CPF responsável (`160_rep_original_records.sql:114`). O preenchimento deve ser revisto campo a campo contra a regra geral do AFD, evitando aplicar indiscriminadamente a política de zeros de `field(..., true)`.

A exceção de CPF do empregado admitida pelo FAQ não é autorização geral para alterar todos os campos. O CRC deve ser calculado sobre os bytes finais corretos. Não reescrever eventos imutáveis antigos para corrigir padding.

### 3. AEJ noturno perde a redução da hora contratual

`lib/rep/exports.js:129–138` soma somente minutos físicos e identifica a jornada apenas pelos pares de horários, sem considerar `nightRule`. Reprodução: 22:00–05:00, sem intervalo, `urban_clt`, gera `04|1|420|2200|0500||`. A observação 3 do registro 04 exige duração considerando a redução noturna; nesse exemplo urbano são 480 minutos equivalentes.

Correção necessária: cálculo contratual noturno específico do AEJ e chave de jornada que inclua a regra relevante. Não mudar silenciosamente o banco físico ou aplicar convenção coletiva não configurada. Definir arredondamento para exemplos fracionários e testar viradas/intervalos.

### 4. AEJ omite banco histórico quando a configuração atual está desligada

`lib/rep/exports.js:103–114,175` condiciona saldo inicial e movimentos a `mirror.schedule.hourBankEnabled`, uma configuração geral atual. Não acompanha a regra histórica por data usada no cálculo do espelho. Com saldo diário histórico de 60 e banco atual desligado, a reprodução não emite nenhum registro 07 de banco.

Correção necessária: resolver vigência e saldo anterior ao período pelo mesmo serviço histórico do espelho. Revalidar também movimentos sujeitos a limite, ajustes manuais e reversões, sem presumir que diferença líquida representa cada lançamento individual.

### 5. AEJ permite exportar histórico ainda não resolvido

`lib/rep/exports.js:164–174` usa a admissão atual de `mirror.person.startDate` e o dia semanal estático para faltas/DSR; não interrompe o arquivo quando `day.historyReview` está pendente. Uma fixture de domingo marcado como `rest` e `historyReview:true` ainda gera `07|1|1|2026-10-04||`.

Correção necessária: não certificar uma classificação que o próprio cálculo marcou como incerta; resolver vínculo histórico e DSR efetivo, ou recusar o AEJ com motivo de revisão. Cobrir desligamento, recontratação e 12×36; não inferir DSR apenas pela ausência de trabalho num domingo.

## Matriz da conferência estrutural

| Área | Resultado da inspeção |
|---|---|
| Ambos: codificação, CRLF, ausência de linhas vazias | Implementados com Latin-1 e validação de caracteres; término final de linha não equivale a registro vazio. |
| Ambos: data/hora e versões | Formatação com segundos `00`, offset e versões corretas. |
| AFD 1 | 302 posições e CRC; ressalvas de INPI/complemento acima. |
| AFD 2 | 331 posições e CRC; ressalva de padding SQL acima. |
| AFD 3 | Não emitido: marcação REP-C/REP-A fora do escopo REP-P. |
| AFD 4 | Não implementado; cobertura de eventos reais de ajuste de relógio permanece não comprovada. |
| AFD 5 | 118 posições; inclusão/alteração implementadas. Exclusão lógica ainda não tem fluxo correspondente. |
| AFD 6 | 36 posições, disponibilidade `07`/`08`; retorno de energia `02` não é emitido pelo fluxo atual. Aplicabilidade operacional precisa ser documentada. |
| AFD 7 | 137 posições, coletor web/mobile e cadeia SHA-256 implementados; emissão on-line. |
| AFD 9 e assinatura | Contadores, 64 posições e linha de assinatura de 100 posições presentes. |
| AEJ 01–03 | Estrutura presente; cadastro do INPI e limites dos identificadores precisam de ajuste/validação. |
| AEJ 04 | Estrutura presente, duração noturna divergente. |
| AEJ 05 | Referências, fonte, tipo e pares presentes. Falta validação final independente dos produtores. |
| AEJ 06 | Ausente; múltiplos vínculos do mesmo CPF não são suportados pelo cadastro atual. |
| AEJ 07 | Estrutura presente; conteúdo histórico divergente nos casos reproduzidos. Folga compensatória de feriado não possui mapeamento explícito. |
| AEJ 08/99 e assinatura | Identificação do programa, contagens e linha de assinatura presentes. |
| Pacote assinado | Rota inclui TXT e TXT.p7s; OpenSSL usa CMS detached com `-cades`. Validação ICP-Brasil real continua pendente. |

## Limites e validações adicionais

- `buildAej` não impõe todos os limites de tamanho e referências: aceitou `id=1000000000` e emitiu vínculo com 10 dígitos. O cadastro usa BIGSERIAL. A ocorrência em produção não foi demonstrada, mas o exportador deveria remapear IDs internos para IDs locais limitados ou rejeitá-los.
- O builder também não exige motivo de inclusão/desconsideração nem referência de jornada na primeira entrada. Os fluxos atuais de ajuste exigem motivo; a ausência no builder é uma lacuna de defesa final, não prova de que o caminho normal produza motivo vazio.
- Registro 06, pré-assinalação, ponto por exceção, múltiplos REPs e tipos adicionais de compensação exigem suporte explícito ou restrição declarada de escopo. Não gerar linhas fictícias para preencher tipos opcionais.
- CPF empregado com zero inicial é admitido pelo FAQ; não foi classificado como defeito. Não propomos alterar hash, CPF ou NSR de registros existentes.
- A presença dos campos e o sucesso criptográfico não comprovam integralmente conformidade jurídica, assinatura ICP-Brasil real ou correção de todos os eventos operacionais.

## Evidências e decisão

As reproduções chamaram os builders reais e `fiscalExport` real com dependências de banco/espelho simuladas, sem dados pessoais reais ou AWS. Resultados preservados em [JSON de evidência](evidence/rep-layout-audit-2026-10-18.json). O roteiro temporário é `/private/tmp/mte-layout-review/probe.mjs`; os asserts confirmam a existência das divergências, não aprovação normativa.

Os três testes atuais de formatos e assinatura passaram novamente, inclusive assinatura efêmera verificável. Isso demonstra a insuficiência da cobertura, não elimina os achados. O ensaio de assinatura registrou uma falha sanitizada ao tentar gravar uma observação no banco indisponível; a verificação criptográfica continuou passando. Não houve teste de banco real nesta revisão.

**Liberação fiscal bloqueada até corrigir os cinco grupos de divergência, cobrir os cenários com testes de contrato independentes e concluir as verificações condicionais aplicáveis.** Testes futuros devem conferir offsets e bytes esperados a partir da especificação, sem reutilizar o próprio formatador para construir o resultado esperado. Depois, executar o ciclo completo com A1 real e validação externa das assinaturas.
