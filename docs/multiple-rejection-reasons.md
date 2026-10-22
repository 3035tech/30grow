# Motivos múltiplos de reprovação

A reprovação aceita de 1 a 18 códigos do domínio fixo `REJECTION_REASONS`. A seleção é explícita, sem motivo pré-selecionado. A API deduplica os códigos e recusa a lista inteira se qualquer código for inválido. Clientes antigos continuam enviando `rejectionReason`; o novo campo é `rejectionReasons`.

## Modelagem

São atributos de seleção de domínio fixo, sem identidade, edição ou cadastro próprio. Usamos `TEXT[]` com `CHECK` de códigos permitidos, dimensão única, limite de 18 itens e proibição de elementos nulos. Não são textos livres nem JSONB. A cardinalidade é 0..18 no registro; a API exige pelo menos um item na transição para reprovação. A aplicação remove duplicatas antes de gravar. O isolamento por empresa continua pertencendo aos registros de avaliação e vínculo com a vaga, sem criar referências independentes que permitam cruzar empresas.

A migration 167 acrescenta `rejection_reasons` a assessments, vacancy_candidates e aos dois históricos. O primeiro item também é gravado no campo singular antigo (`rejection_reason` ou `reason`), mantido por compatibilidade. Não se apagam nem se reescrevem os valores antigos. Motivos históricos conhecidos são copiados para listas de um item. Valores legados fora do domínio são preservados no campo antigo e continuam legíveis pela compatibilidade de leitura.

As leituras usam a lista quando seu primeiro item corresponde ao campo antigo; caso contrário, usam o motivo singular. Isso permite ler gravações de versões antigas durante o rollout, incluindo limpeza do motivo. Ao sair da reprovação, os motivos atuais são limpos; o histórico conserva a seleção daquele evento. Registros e histórico são gravados na mesma transação. Os indicadores contam cada motivo selecionado; por isso a soma de motivos pode superar a quantidade de reprovações.

Não há índice GIN: os motivos são lidos por registro/vaga e os indicadores expandem eventos já filtrados por período. Não existe filtro independente pelos motivos nesta entrega.

## Publicação e reversão

1. Aplicar a migration aditiva antes de publicar o aplicativo. Verificar contagens e checksum dos campos anteriores, além da cópia dos motivos existentes.
2. Publicar a aplicação; validar checkboxes, gravação, histórico, recarga e seleção vazia.
3. Para rollback do aplicativo, manter as colunas novas. A versão antiga apresenta o primeiro motivo e as listas permanecem armazenadas. Não remover colunas nem executar contração destrutiva.

A migration é reaplicável: não substitui listas já preenchidas. Testes cobrem payload antigo, listas múltiplas, domínio inválido, preservação de histórico, saída da reprovação e rollback atômico. A regressão PostgreSQL usa exclusivamente o banco descartável `rejection_validation` em localhost:55488 (`REJECTION_PG_TEST=1 node --experimental-vm-modules --test test/unit/rejection-reasons.postgres.test.js`).
