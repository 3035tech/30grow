# Privacidade e dados sensíveis no piloto

Checklist interno. Não substitui revisão jurídica. As minutas técnicas públicas estão em `/terms` e `/privacy`; a aprovação jurídica continua sendo gate de go-live.

| Classe | Exemplos | Persistência | Acesso / tratamento |
|---|---|---|---|
| Identificação | nome, e-mail, currículo | `candidates`, S3 | tenant; corrigir/exportar; anonimizar/excluir conforme obrigação |
| Avaliações | respostas, T1–T9, Motivadores | `assessments`, `answers`, `ae_*` | tenant/link autorizado; não tratar como diagnóstico |
| Recrutamento | vaga, etapa, nota, oferta | vacancies/pipeline/offer | tenant; revogar links e reter por prazo aprovado |
| DP | documentos, licenças, ponto | `employee_*`, S3 | capabilities DP/People; prazo legal/contratual |
| Remuneração | salário, reajuste, variável | compensation tables | capability dedicada e auditoria |
| Cultura | clima, pulso, ouvidoria | climate/pulse/whistleblowing | acesso específico; preservar anonimato |
| Autenticação | hash, sessão, 2FA | users/sessões/audit | usuário/admin; nunca exportar segredo |

Objetos usam `companies/{companyId}/...` e nome opaco. Tokens são credenciais e não entram em analytics, tickets ou logs.

## Pedido do titular

Canal inicial definido: `info@30grow.com`, assunto **Privacidade 30Grow**. Procedimento completo: [`data-subject-request-runbook.md`](./data-subject-request-runbook.md). Política operacional: [`privacy-retention-policy.md`](./privacy-retention-policy.md).

1. Registrar identidade validada, empresa, escopo e prazo.
2. Localizar por `company_id` + e-mail; nunca mesclar por nome.
3. Exportar apenas dados do titular e explicar fontes/finalidades.
4. Corrigir na fonte canônica, mantendo auditoria sem conteúdo sensível.
5. Para exclusão, verificar retenção; revogar links/sessões; preferir soft delete/anonimização e remover objetos aprovados.
6. Confirmar sem anexar dados pessoais ao ticket.

## Gate humano antes do cliente

Registre responsável, data e resultado em [`pilot-go-live-signoff.md`](./pilot-go-live-signoff.md). A engenharia não substitui a aprovação jurídica dos textos públicos.

- [x] Canal técnico de entrada definido e publicado; responsável nominal ainda deve constar no sign-off.
- [ ] Bases, finalidades, prazos e subprocessadores aprovados.
- [ ] Minutas de Termos e Política publicadas e coerentes com módulos; aprovação jurídica pendente.
- [x] Acesso/correção/exclusão do cadastro e retenção ensaiados no DTOV com rollback; escopo e limites em `validation/MVP-06-2026-09-29.md`.
- [ ] Exportação completa de todas as classes, objetos e execução em homologação ainda precisam de prova.
- [x] Logger estruturado testado com dados sintéticos sensíveis; logs locais revisados e vazamentos de tokens/e-mail corrigidos.
- [ ] Validar logs de homologação, proxy/provedor, Sentry e retenção dos logs anteriores.
- [x] Escopo tenant de remuneração e DP coberto no smoke HTTP; ouvidoria usa `company_id` em listagem, atualização e agregados e entra na validação automatizada desta entrega.
- [ ] Retenção de backup/S3 documentada com o provedor.

## Evidência técnica

Ver [MVP-06 — revisão de 29/09](validation/MVP-06-2026-09-29.md) e [matriz para aprovação](privacy-approval-matrix.md). O item não equivale a aprovação jurídica ou a eliminação integral ensaiada.
