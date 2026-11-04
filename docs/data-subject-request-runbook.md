# Runbook de pedido do titular

Canal inicial: `info@30grow.com`, assunto **Privacidade 30Grow**. Não solicitar documento completo, senha, token ou conteúdo sensível no primeiro e-mail.

## Triagem

1. Registrar identificador interno, data, empresa relacionada, e-mail usado, tipo de pedido e responsável.
2. Definir quem é o controlador do fluxo. Em recrutamento e gestão, normalmente é a empresa cliente; no cadastro/site da 3035Tech, pode ser a própria 3035Tech.
3. Validar identidade de forma proporcional. Se o pedido vier por outro e-mail, pedir comprovação mínima por canal seguro.
4. Confirmar recebimento e informar que o pedido será tratado nos prazos legais e contratuais aplicáveis, sem prometer prazo não aprovado.

## Localização e escopo

1. Resolver primeiro o `company_id`.
2. Localizar por `company_id` + e-mail normalizado. Nunca mesclar por nome.
3. Mapear superfícies: candidato, assessments T1–T9, Motivadores, vagas/pipeline, pessoa/employee, 1:1/PDI, desempenho, LMS, clima/pulso, remuneração, DP, auditoria e objetos.
4. Para ouvidoria anônima, não tentar reidentificar o titular. Se a pessoa fornecer protocolo ou dados do próprio relato, encaminhar ao responsável restrito.

## Resposta por tipo

- **Confirmação/acesso:** exportar somente os dados do titular e explicar origem, finalidade e compartilhamentos relevantes.
- **Correção:** alterar na fonte canônica e preservar auditoria mínima sem replicar o dado anterior no ticket.
- **Exclusão/anonimização:** consultar `privacy-retention-policy.md`; aplicar legal hold quando houver; revogar sessões/links; executar somente o escopo aprovado.
- **Revogação/oposição:** registrar o fundamento, interromper o tratamento dependente quando aplicável e encaminhar divergências ao controlador/DPO.
- **Revisão de decisão:** encaminhar a uma pessoa responsável; T1–T9, Motivadores, ranking e HR Score nunca devem decidir sozinhos.

## Fechamento

1. Fazer revisão por duas pessoas em exportação ou exclusão de dado sensível.
2. Enviar a resposta pelo canal validado, com arquivo protegido quando necessário.
3. Registrar ações, sistemas e data sem anexar cópia desnecessária do conteúdo pessoal.
4. Confirmar ao titular o encerramento e manter somente a evidência mínima exigida.

## Escalonamento imediato

Escalar para responsável de privacidade e segurança quando houver suspeita de vazamento, acesso cross-tenant, pedido judicial, risco ao denunciante, dado de criança/adolescente, conflito de identidade ou dúvida sobre obrigação de preservação.

## Limites técnicos verificados em 29/09/2026

- `GET /api/admin/candidates/{id}` fornece um dossiê parcial (inclui até 30 avaliações); não é exportação integral do titular. A exportação CSV geral também não substitui a coleta por classe/empresa.
- O ensaio `node --experimental-vm-modules test/dtov/privacy-rehearsal.test.js` usa apenas PostgreSQL local DTOV em transação revertida. Executa os handlers reais com autenticação simulada; não prova UI, cookies reais, S3 ou entrega de arquivo ao titular.
- `PATCH` corrige cadastro; `DELETE` remove a pessoa e pode acionar cascatas. Confirmar obrigações e vínculos antes de executar. Objetos S3, backups e registros legados sem relação de identidade precisam de tratamento separado.
- Não usar busca por nome para apagar `results`. Registrar a pendência de vínculo legado e informar o escopo efetivamente atendido.
