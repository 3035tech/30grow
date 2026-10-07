# Política operacional de retenção e exclusão

Documento interno do 30Grow para o piloto. A versão pública está em `/privacy`. Este documento orienta engenharia e operação, mas os prazos legais e contratuais precisam de aprovação do controlador e da assessoria jurídica antes do go-live.

## Princípios

1. Manter apenas o necessário para a finalidade informada.
2. Escopar toda operação por `company_id`; identificar a pessoa por empresa + e-mail, nunca apenas por nome.
3. Revogar acesso antes de remover conteúdo: sessões, convites e links públicos.
4. Preferir exclusão lógica ou anonimização quando houver dependências, histórico ou obrigação de preservação.
5. Usar exclusão física somente em rotina aprovada, limitada em lotes e com evidência de execução.
6. Nunca apagar conteúdo sujeito a litígio, investigação, auditoria ou obrigação legal ativa.

## Matriz mínima

| Classe | Enquanto ativa | Encerramento / pedido | Automação atual |
|---|---|---|---|
| Conta de gestor e vínculos | vigência do acesso | revogar sessão, desativar e aplicar soft delete após validação | revogação de sessão; soft delete |
| Candidato, candidatura e avaliação | processo seletivo + prazo aprovado pela empresa | exportar/corrigir; anonimizar ou excluir se elegível | `RETENTION_DAYS` + purge de avaliações por empresa; simulação por padrão; pessoas nunca são removidas por ausência de avaliação |
| Currículo e anexos de recrutamento | processo + prazo aprovado | remover objeto e referência após verificar vínculo | exige rotina operacional/S3 lifecycle validado |
| Colaborador e gestão | vínculo + prazo contratual/legal | restringir como alumni; excluir/anonimizar somente o que não precisa ser preservado | soft delete e escopo tenant; sem purge genérico |
| Remuneração | vínculo + prazo legal/contratual aprovado | acesso restrito; não apagar automaticamente | capability dedicada + auditoria |
| DP, ponto, férias e documentos | conforme natureza do documento e obrigação aplicável | preservar ou eliminar por classe documental aprovada | capability dedicada; S3 exige lifecycle aprovado |
| Clima e pulso | campanha + período analítico aprovado | preservar agregado; remover vínculo quando aplicável | sem purge genérico |
| Ouvidoria | prazo da investigação e preservação jurídica | acesso restrito; anonimato preservado; descarte aprovado por caso/classe | sem purge automático; texto fora de analytics |
| Auditoria e segurança | janela operacional/contratual aprovada | minimizar e expurgar conforme política do ambiente | políticas por empresa + cron audit-retention (simulação padrão); legal hold; execução desativada sem prazo aprovado |
| Backups | ciclo técnico do provedor | dado desaparece quando a cópia é sobrescrita | confirmar janela e restore no provedor |

## Rotina disponível

`POST /api/admin/retention/purge` exige sessão de superadmin com permissão de usuários, `companyId` explícito e `days` inteiro positivo. Não usa `CRON_SECRET`. `dryRun` é `true` por padrão; somente o booleano `false` executa a exclusão física de avaliações. Clientes da API que omitiam empresa precisam ser atualizados. Não há migration nem mudança nos dados existentes.

Exemplo de corpo para simular (substituir por empresa e período aprovados):

```json
{"companyId": 123, "days": 365, "dryRun": true}
```

O período acima é apenas exemplo técnico, não prazo jurídico aprovado. O retorno informa `eligibleAssessments`; não contém respostas nem dados pessoais. A execução com `dryRun: false` retorna os totais removidos e `truncated`. Limites: `RETENTION_BATCH_SIZE` e `RETENTION_MAX_BATCHES`.

Antes da execução, registrar escopo, aprovação, período e responsável; confirmar backup e ausência de obrigação de preservação; revisar a simulação com uma segunda pessoa. A simulação não reserva um snapshot: novas avaliações podem se tornar elegíveis até a execução. A função não implementa legal hold automático; se houver preservação ativa ou dúvida, não executar o purge da empresa.

Pessoas não são mais apagadas pelo purge: ausência de avaliação/1:1 não prova ausência de vínculos de DP, remuneração ou recrutamento. A exclusão individual existente pode atingir relações com `ON DELETE CASCADE`; exige revisão do escopo e das obrigações antes do uso. Não é uma rotina universal de atendimento LGPD.

A tabela legada `results` não tem vínculo confiável de candidato/empresa. A exclusão individual não a remove por nome: homônimos não podem ser confundidos. Registros legados exigem identificação e descarte separados, com evidência; não declarar eliminação completa enquanto restarem dados elegíveis, objetos ou backups.


## Gate antes do primeiro cliente

- Definir em contrato ou anexo os prazos por classe.
- Confirmar lifecycle de S3 e janela de backups com o provedor.
- Ensaiar exportação, correção e exclusão com dados fictícios.
- Registrar aprovação no `docs/pilot-go-live-signoff.md`.

## Retenção de auditoria no banco

A infraestrutura técnica está em `docs/audit-company-retention.md`. Sem política aprovada, todos os eventos permanecem preservados. Não há prazo jurídico padrão nem agendamento de exclusão habilitado por esta entrega. Logs do provedor e backups continuam sujeitos a políticas separadas.
