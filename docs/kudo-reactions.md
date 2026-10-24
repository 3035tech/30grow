# Reações aos kudos

Cada colaborador pode escolher uma das cinco reações (👍 ❤️ 👏 🎉 🙌) em
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

A interface foi implementada no portal web do colaborador. A interface do app
nativo não foi alterada nesta entrega.

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
