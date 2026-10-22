# E-mails na jornada da pessoa

## Regra de uso

- Candidatura: e-mail pessoal.
- Contratação no funil: data de início e corporativo opcional. O pessoal é preservado automaticamente; um pessoal já preenchido nunca é sobrescrito. Com corporativo, ele se torna contato principal e login, recebendo notificações e convite de senha. Sem ele, o pessoal é temporário.
- Corporativo criado depois: RH altera somente o e-mail corporativo em Equipe → pessoa → Cadastro. Senha, convite de senha, links de login, links do portal e sessões antigos são revogados. Um novo convite é emitido inclusive se ainda não havia acesso de colaborador. O endereço anterior pode receber um aviso de segurança sem link de acesso.
- Contratação em lote: não há campo de corporativo compartilhado. Cada pessoa mantém o próprio contato, com pessoal preservado e convite automático. Corporativos são informados individualmente.
- Desligamento: status passa a ex-colaborador; contato principal volta ao pessoal e todos os acessos de colaborador são revogados. Isso não cria acesso de candidato com senha nem reabre processos automaticamente. Novos convites de recrutamento usam o pessoal.
- Cadastros antigos: conferir/preencher o pessoal antes do desligamento ou no campo opcional do formulário de saída. Sem pessoal, o contato fica vazio: não se reutiliza o corporativo desativado. Se o pessoal conflitar com outro contato principal na mesma empresa, o desligamento inteiro é desfeito e o RH recebe conflito de e-mail.
- Recontratação: mesmo cadastro e histórico; permite novo corporativo opcional e mantém a opção existente de enviar convite. Não reaproveita automaticamente a caixa corporativa antiga. Corrigir/excluir um desligamento restaura o status, mas não restaura e-mail, senha ou links antigos; revisar a ficha e convidar novamente.

O sistema não cria nem exclui caixas Google/Microsoft/S3 ou de outro provedor. Mensagens já entregues não podem ser redirecionadas. Contas administrativas/gestores em `users` e assinaturas independentes de alertas de vagas não são a identidade do colaborador.

## Modelagem e compatibilidade

Sem migration: reutiliza `candidates.personal_email` (124) e `candidates.email` (contato principal/login, único por empresa). São atributos de contato da pessoa, sem identidade própria nem cadastro de opções. O ID da pessoa, avaliações, documentos e relações não mudam. Nenhum JSONB, tabela ou domínio novo é necessário. O endereço corporativo anterior fica registrado na auditoria do desligamento; os snapshots de convites antigos são preservados.

A contratação e a troca de contato usam a mesma transação. O desligamento grava saída, troca contato e revoga credenciais na mesma transação; colisões não deixam saída parcial. A versão de sessão é atualizada no cache após commit. Repetir contratação de quem já é colaborador não reenvia convite nem permite trocar sua identidade pelo funil; usar a ficha com permissões existentes.

Lembretes de teste e motivadores consultam o contato atual da pessoa vinculada, com isolamento por empresa, em vez de usar o destinatário histórico. Convites novos, entrevistas, portal e convites de clima usam o contato atual; clima redireciona um endereço pessoal conhecido para o contato atual sem gravar identidade na pesquisa anônima. Convites antigos sem ID tentam resolver o contato por endereço na própria empresa; correspondência ambígua não autoriza envio.

O convite é um efeito após commit, usando a fila SMTP existente. Falha não desfaz contratação; a interface avisa para reenviar em Convidar acesso. `inviteSent` confirma enfileiramento, não entrega na caixa. Não há nova fila durável ou garantia de entrega neste escopo.

Deploy gradual é compatível com o schema atual em Dublin e AWS. Rollback de código não apaga pessoal/histórico; manter os campos existentes. Alterações de contato já efetuadas permanecem; para corrigir, usar a ficha, nunca restaurar credenciais revogadas.

## Guia, FAQ e IA

`panel.help.employeeHomeStep1` e os passos 7–9 são as fontes indexadas pela IA. `panel.helpAssist.faqEmailLifecycle` e a entrada prioritária em `lib/help-assistant.js` respondem dúvidas específicas sem chamar o modelo. Conteúdo disponível em pt-BR, inglês, francês e alemão.

## Validação

- `EMAIL_LIFECYCLE_PG_TEST=1 node --test test/unit/employee-email-lifecycle.postgres.test.js`: alvo fixo PostgreSQL local descartável, SMTP simulado; contratação com/sem corporativo, pessoal preservado, reenvio idempotente, endereço conflitante e rollback, contato na saída, revogação dos acessos e recontratação sem duplicação. As fixtures ficam no banco descartável devido ao histórico imutável de ponto.
- `node --experimental-vm-modules --test test/unit/recruiting-pipeline-move.unit.test.js test/unit/email-lifecycle-help.unit.test.js test/unit/help-guide-ia.unit.test.js`: rotas e cobertura do conhecimento.
- Gate de segurança e build do projeto.

## SaaS: mesma pessoa em empresas diferentes

A chave de unicidade do contato principal é `(company_id, LOWER(email))`, não o e-mail global. O cenário X → Y → Z usa três IDs distintos em `candidates`. X mantém sua candidatura/reprovação e avaliações; Y mantém o período como colaborador e desligamento; Z mantém nova candidatura/contratação. A mudança de contato e credenciais em Y/Z não altera X. Nenhuma avaliação, nota, documento, salário, vínculo ou histórico é importado entre empresas por este fluxo. Os próprios dados cadastrais também são independentes hoje; não se introduz cadastro global compartilhado nesta entrega.

O teste PostgreSQL reproduz o mesmo e-mail pessoal nas três empresas, reprovação em X, contratação e desligamento três anos depois em Y, contratação em Z, IDs distintos e resolução de contato limitada à empresa. A FAQ `faqCandidateTenancy` e o Guia explicam essa separação para a IA. Isso prova este fluxo; não substitui a auditoria integral de autorização de todos os módulos do SaaS antes do beta.

O super admin da plataforma pode consultar dados de todas as empresas para operação do SaaS. Esse perfil global fica reservado ao proprietário do 30Grow; contas dos clientes devem usar os perfis de RH/Direção/proprietário da empresa. O teste do cenário não certifica todas as permissões do produto.
