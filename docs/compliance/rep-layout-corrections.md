# Correções dos leiautes AFD/AEJ

Correções locais posteriores à [auditoria de 18/10/2026](rep-layout-audit-2026-10-18.md). Não representam certificação jurídica nem publicação em produção.

## Resultado

1. O cadastro aceita o número numérico do INPI com até 17 dígitos, sem exigir que o identificador tenha o tamanho do campo. AFD preenche o restante à direita com espaços; nomes do TXT/p7s/ZIP usam o identificador sem padding.
2. Campos complementares opcionais do cabeçalho e dos novos eventos de empresa recebem espaços. O CPF responsável em novos eventos tipo 2 também recebe o preenchimento apropriado. CRC é calculado após a montagem final. Contadores do trailer seguem preenchimento à direita; CPF empregado e originais antigos não são reescritos.
3. AEJ calcula a duração contratual urbana com redução noturna: 22:00–05:00, sem intervalo, resulta em 480 minutos. Intervalos e virada são considerados, com arredondamento do total contratual uma única vez ao minuto mais próximo. O leiaute não especifica a convenção de arredondamento de frações; essa política está explícita e testada. A chave do horário inclui a regra noturna e a duração. Banco e marcações continuam em minutos físicos. Sem regra noturna explícita em horário noturno, recusa a exportação.
4. AEJ usa o movimento diário efetivo do cálculo histórico do espelho, independente do banco estar desligado hoje. O movimento representa a variação diária consolidada reconhecida pelo cálculo, incluindo manuais aprovados e limites; não pretende listar cada lançamento bruto individual. Diferenças entre a âncora congelada e o recálculo impedem exportar.
5. Admissão atual não é mais usada para classificar o vínculo anterior no AEJ. Histórico incerto, pendências e inconsistências de conciliação geram erro de revisão. DSR semanal exige vínculo ativo, declaração fiscal de descanso, jornada compatível e ausência de feriado. Descanso de escala cíclica não é convertido automaticamente em DSR.
6. IDs internos grandes são remapeados para identificadores locais curtos do AEJ. Validação final confere limites, CPF, referências, horários, motivos obrigatórios, movimentos e duplicidades. Múltiplos vínculos do mesmo CPF continuam fora do suporte e são recusados.

## Migração e preservação

Aplicar `165_rep_layout_corrections.sql` antes da nova aplicação. Está incluída no bundle de pgAdmin e no gate estático (165 migrations). A alteração relaxa o comprimento do identificador e substitui apenas a montagem de eventos futuros. Não atualiza dados fiscais, números ou hashes existentes.

Para um INPI antigo completado com zeros, o usuário pode salvar explicitamente o mesmo identificador sem esse preenchimento. A API e o banco só permitem essa correção quando o valor antigo de 17 posições é exatamente o novo valor completado à esquerda com zeros. A operação acrescenta um evento de configuração com CPF responsável. Não permite trocar arbitrariamente INPI, empregador, empresa ou fuso. Reaplicar a migration não corrige dados automaticamente nem altera originais.

O gate de exportação AFD detecta os registros tipo 2 antigos com preenchimento conhecido como incompatível no período selecionado e recusa o arquivo. Não recalcula o CRC de um registro original para disfarçar a incompatibilidade. Esses períodos precisam de revisão técnica documental; preservação não equivale a correção retroativa. Períodos sem esses registros podem ser exportados após os demais gates.

Rollback: manter schema e originais. Uma imagem antiga continua com serializadores conhecidos como incorretos; portanto, bloquear o endpoint de exportação fiscal no ambiente caso seja necessário voltar a ela, ou usar uma imagem de rollback que já contenha estas correções. Não anunciar reversão para a versão antiga como fiscalmente validada. Cadastros de INPI mais curtos também não são editáveis pela validação antiga de 17 dígitos.

## Limitações explícitas

- AEJ de escala 12×36 exige regra fiscal específica de DSR; a exportação é bloqueada com mensagem própria. O cálculo de ponto, banco, fechamento, portal e app continuam disponíveis.
- Horários noturnos sem configuração urbana explícita, outras categorias e prorrogação com regra específica exigem definição adequada antes de exportar. Não há inferência de CCT ou regime rural.
- Registros operacionais de ajuste de relógio, retorno de energia, exclusão lógica no REP e categorias não implementadas continuam com aplicabilidade a resolver, conforme a auditoria. Estas correções não criaram eventos fictícios nem novas marcações.
- App e portal não receberam campos novos por HTTP: os metadados fiscais só são solicitados internamente pelo exportador. A tela administrativa mostra os erros específicos retornados pelo servidor.
- A1 ICP-Brasil real, registro INPI, atestado, infraestrutura e aceite em aparelho permanecem pendentes.

## Validação

- 106 testes focados passaram, incluindo 11 novos casos de contrato/rota. Conferem posições fixas, bytes, padding, horários noturnos, referências, banco histórico, limites, nomes do pacote e recusa antes da assinatura.
- 3 testes de integração no PostgreSQL descartável passaram: schema completo, originais/concorrência e fechamento. A prova do schema também confirma 105 minutos de movimento fiscal (60 calculados históricos + 45 manuais aprovados) com banco atual desligado, reaplicação da migration, correção explícita do INPI e preservação dos bytes/hashes antigos.
- 68 testes de segurança passaram. Gate estático confirma migration 165 e inclusão no bundle.
- Build web de produção aprovado após as alterações finais.
- Não houve escrita em produção, acesso ao A1 real, push real nem alteração de horário.
