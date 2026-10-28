# Participação individual no banco de horas

O banco de horas continua tendo um controle geral por empresa. Quando ele é ativado, a seleção de colaboradores abre automaticamente acima da tabela. A seleção também pode ser aberta depois por **Selecionar colaboradores** em **DP → Controle de horas → Banco de horas**. Colaboradores com ponto habilitado participam por padrão; cada caixa marcada ou desmarcada é salva na data de vigência escolhida. Busca e paginação permitem percorrer a equipe.

`employee_hour_bank_participation` guarda somente as mudanças individuais. A chave `(company_id, candidate_id, valid_from)` impede versões duplicadas na mesma data; a chave estrangeira composta impede associação entre empresas. `enabled` é booleano, e a ausência de versão anterior significa seguir a empresa. Esse cadastro é separado da jornada porque mudar a escala não deve alterar a participação, nem o contrário.

A partir de uma exclusão, extras e faltas deixam de movimentar o saldo. O saldo anterior e lançamentos já aprovados permanecem; novos lançamentos manuais e pedidos de uso são bloqueados nas datas sem participação. Uma inclusão posterior retoma o cálculo. A API rejeita mudanças que reescreveriam períodos fechados. O gatilho invalida checkpoints do colaborador a partir da data alterada; não é necessário recalcular todos os colaboradores.

Migration: `176_employee_hour_bank_participation.sql`. É aditiva e reaplicável. Para rollback de código, manter a tabela e as versões gravadas até que o código volte a usá-las; apagar a tabela perderia o histórico de escolhas individuais.
