# Reações aos kudos

Cada colaborador pode escolher uma das 17 reações do catálogo fixo, com cinco atalhos (👍 ❤️ 👏 🎉 🙌) e mais opções pelo botão +, em
qualquer kudos ativo da própria empresa, inclusive quando é autor ou destinatário.
Escolher outra substitui a reação atual; tocar novamente na própria reação a
remove. A lista mostra contagem, escolha atual e nomes de quem reagiu, sob demanda.

## Dados e permissões

A migration 171 é aditiva: não altera as mensagens nem os participantes existentes.
`company_kudo_reactions` relaciona empresa, kudos e colaborador. Sua chave primária
garante uma reação por pessoa por kudos, inclusive sob concorrência. Chaves
estrangeiras compostas impedem vínculos entre empresas; o CHECK restringe os emojis.
O índice da chave primária atende as consultas por empresa e kudos.

Trata-se do estado atual de uma reação, sem histórico de trocas: guardar cada
troca não é necessário para esse fluxo. A remoção é física; apagar o kudos ou
colaborador fisicamente remove suas reações por cascata. A moderação lógica do
kudos impede imediatamente novas reações e consultas aos nomes.

A identidade e a empresa vêm da sessão autenticada, nunca do corpo da requisição.
O envio exige vínculo atual de colaborador e módulo Mural habilitado. Nomes de
quem reagiu são consultados em páginas de 40, sem e-mails, com respostas privadas
sem cache. Não são geradas notificações para cada reação.

## Contrato e publicação

- `PUT /api/employee/kudos/:id/reactions`, corpo `{ "emoji": "👏" }`.
- `DELETE` no mesmo endereço remove apenas a reação da pessoa autenticada.
- `GET` no mesmo endereço lista os nomes; `offset` pagina os resultados.
- A API mobile oferece o mesmo contrato com autenticação bearer em
  `/api/mobile/v1/employee/kudos/:id/reactions`.
- O feed inclui `reactions: [{ emoji, count, mine }]`. A consulta é em lote por
  página. Clientes antigos podem ignorar esse campo adicional.

A interface foi implementada no portal web do colaborador. No app nativo, a interface foi implementada em 25/10/2026 no branch `feat/community-files-reactions` do repositório `30-team-app`: escolha, troca e remoção de reação, contagens e nomes paginados. Lint, TypeScript e 328 testes passaram. A validação em aparelhos e distribuição permanecem pendentes; consulte `docs/community-files-reactions.md` no repositório do app.

Aplicar a migration 171 antes da publicação. Durante a expansão, a ausência da
tabela não impede a leitura das mensagens antigas; escrever reações exige a
migration. Para retornar à versão anterior, manter a tabela e os dados, sem
executar DROP: o código antigo ignora as reações. O SQL operacional está no
bundle `scripts/scripts-banco-pendentes.sql`.

## Validação

O teste de integração usa apenas o PostgreSQL local e registros sintéticos.
Verifica reaplicação da migration, preservação do kudos existente, concorrência,
troca e remoção idempotentes, chaves estrangeiras, domínio dos emojis, isolamento,
desligamento e moderação. Os testes de interface verificam o fluxo mobile e uma
falha de rede seguida de nova tentativa explícita.

Nenhuma configuração AWS é necessária para implementar ou testar esta funcionalidade.

Em 24/10/2026, migrations 170 e 171 registradas e verificadas em Dublin
(`team`) e produção (`grow30`), incluindo permissões da conta de execução.
O acabamento do portal foi validado em cinco casos de interface e no build: foco
após reagir, fechamento por Escape, anúncios acessíveis, falhas de rede e
tamanho legível dos anexos em B/KB/MB.

## Ampliação do catálogo — migration 173

O domínio passa a aceitar 😊 💪 🚀 ⭐ 🔥 💯 🤝 🏆 🙏 🤩 💡 🥳 além dos cinco atalhos. Mantido TEXT com CHECK de domínio fixo: emojis não são um cadastro editável, não têm identidade/histórico próprios e não precisam de JSONB ou de nova tabela. PK, FKs, cardinalidade, índices e updated_at permanecem. A alteração é uma única instrução DO, com lock_timeout local de cinco segundos, sem apagar/regravar linhas; pode ser reaplicada.

Compatibilidade: apps com schema antigo não podem receber os novos valores. O mobile anuncia X-Kudo-Reaction-Catalog: 2; o feed devolve reactionCatalogVersion 2 para o opt-in e 1 para o legado. Feed e respostas de mutação legados omitem emojis desconhecidos; a consulta paginada de nomes filtra antes de LIMIT/OFFSET. O web usa o catálogo completo. Não se acrescentam novas chamadas ou dados pessoais. Apps novos continuam usando somente os cinco atalhos quando o servidor não anuncia suporte.

Sequência: aplicar 173 em Dublin e produção; verificar CHECK/registro da migration; publicar backend com leitores compatíveis; depois liberar o cliente que oferece opções ampliadas. As duas bases reais ainda não foram alteradas nesta entrega. SQL canônico em migrations/173_expanded_kudo_reactions.sql; bundle operacional também atualizado.

Rollback: retirar a oferta das opções extras nos clientes, mantendo o CHECK ampliado e os leitores compatíveis enquanto existirem reações novas. Não reduzir a constraint nem voltar leitores que rejeitem/emitam valores desconhecidos para clientes antigos. Nenhuma exclusão ou conversão de reações é autorizada implicitamente.

Prova local: migration aplicada pelo harness DTOV e reaplicada duas vezes; dados e timestamps preservados. Seis casos de integração passaram, cobrindo os 17 valores, unicidade, isolamento, ex-colaborador, moderação e paginação legada. Oito casos de contrato/payload passaram. Liberação remota depende da aplicação da migration e dos gates finais.

### Situação operacional desta entrega

Build Next/webpack e lint dos arquivos alterados aprovados. Produção: preflight confirmou database grow30 na instância general, TLS verificado com CA oficial, role grow30_app e owner admin3035tech. Tentativa de 173 foi recusada com 42501 e a transação foi revertida; nenhum grant ou alteração de credencial foi feito. Precisa de credencial administrativa existente para continuar. Dublin: aguarda reconexão do controle do Chrome/pgAdmin web. Não declarar a migration aplicada nos ambientes reais.
