# MVP 1 web — pendências para entrega

Revisão de 26/10/2026. Objetivo: entregar o web para os primeiros clientes, com módulos já implementados e limites explícitos. Uma pendência de validação não é um bug confirmado; um teste local não comprova funcionamento externo.

## O que precisa fechar

| Prioridade | Entrega | Evidência atual | Critério de conclusão |
| --- | --- | --- | --- |
| Bloqueador | Cobrança pela interface | Backend Stripe sandbox e webhooks reais de Dublin passaram por active/past_due/recuperação/cancelar/retomar/canceled, com licença preservada. Checkout, portal e operações pela interface ainda constam pendentes. | Empresa fictícia percorre aceite/checkout, retorno, atualização de cartão, recuperação, cancelamento e reembolso no sandbox, com acesso/licença corretos e replay idempotente. |
| Bloqueador | Jornada por perfil no ambiente publicado | Jornada principal e matriz HTTP automatizadas aprovadas; falta aceite dedicado completo de gestor e portal do colaborador no ambiente publicado. | Contas de teste RH, gestor, dono e colaborador percorrem suas jornadas; negativas cross-tenant e de permissão, exportações e retorno após recarregar comprovados. |
| Bloqueador | E-mails operacionais reais | Contratação/desligamento e contatos corporativo/pessoal passaram com SMTP simulado; entrega externa final ainda consta pendente. | Destinatário de teste autorizado recebe convites e comunicações, com links absolutos válidos, remetente e destino corretos; tratamento de falha e bounce verificado. Não enviar mensagens sem autorização específica. |
| Bloqueador | Arquivos e isolamento reais | Anexos sintéticos do mural enviados e baixados em Dublin com hash idêntico; sem sessão negado. Role de produção passou no preflight privado. | Fechar upload/preview/download/remoção pela interface em dados sintéticos; negar outra empresa e sem sessão; conferir os prefixos de logo, LMS e DP usados pelo MVP em produção. |
| Bloqueador | Recuperação e alertas | RDS general disponível, backup automático de 7 dias, criptografia e proteção contra exclusão habilitadas, ponto restaurável recente em 26/10. Runbooks existem. Consulta CloudWatch por nomes contendo 30grow/grow30 não retornou alarmes; isso não exclui monitoramento com outros nomes ou provedores. | Restore em ambiente isolado com schema e amostra verificados; confirmar monitoramento efetivo de indisponibilidade/5xx/DB/cron e entrega de alerta de prova ao responsável. Registrar rollback da imagem anterior. |
| Aceite responsável | Privacidade e operação do piloto | Termos, política, inventário, retenção e runbooks existem; matriz e sign-off disponíveis ainda sem registro de aprovação nominal. | Responsáveis confirmam textos vigentes, prazos, subprocessadores/transferências, canal do titular, suporte/SLA e data/referência do aceite. Não inferir aprovação jurídica da existência dos textos. |
| Publicação | Versão final e smoke | Migration 173 aplicada em Dublin/produção; catálogo v2 e anexos seed comprovados em Dublin. Aviso de jornada publicado em Dublin (deployment rev114, pod 1/1) e produção (task 148, rollout COMPLETED); páginas /pricing e /api/health conferidas nos dois ambientes. PR app 2 mergeado, CI da main aprovado e simulador atualizado. | Publicação do aviso comprovada. Concluir smoke das jornadas essenciais e incorporar a correção de cadastro direto do PR 19 (corporativo obrigatório, pessoal opcional e sem confirmação redundante), em validação de publicação. |

## Concluído ou com prova técnica relevante

- Isolamento e permissões com matriz automatizada; não dispensam smoke do ambiente publicado.
- Recrutamento até contratação/ativação explícita e mesma pessoa na Equipe com PostgreSQL descartável e interface.
- Manutenção de dependências, gates de lint/segurança/contratos e correções UX entregues; dívida de lint permanece acompanhada por baseline.
- Webhooks Stripe sandbox: transporte, assinatura, deduplicação e transições de licença comprovados.
- Migrations 170/171/173 registradas nos ambientes; upload/download real de anexos sintéticos em Dublin.
- API seed de reações v2: escolha, troca, remoção, nomes e proteção de clientes legados comprovados; reação original restaurada.

## Limites da oferta e escopo separado

**Jornada:** oferecer como “Controle de jornada em validação” e orientar manutenção do sistema oficial da empresa. INPI, certificado ICP-Brasil real, atestado e comprovação integral REP-P seguem em trilha própria; não anunciar ponto 100% regularizado. Ver `compliance/time-clock-product-status.md` no branch da mudança. O aviso não autoriza substituir o sistema oficial nem resolve sozinho os requisitos para uso fiscal.

**App:** homologação física iOS/Android, VoiceOver/TalkBack, compartilhamento nativo e distribuição são uma frente separada do aceite do web. Não declarar esses cenários aprovados com base em simulador ou Jest. A instalação no iPhone aguarda assinatura/login Apple no Xcode.

## Pode ficar para depois do MVP 1

- Majors de bibliotecas sem vulnerabilidade/bloqueio comprovado, Tailwind 4 e refatorações amplas.
- Remoção integral da dívida de lint, preservando o bloqueio de regressões novas.
- Microsserviços, filas e infraestrutura de escala sem evidência de necessidade.
- Otimizações de performance orientadas por medição, sem aceitar um problema observado como “apenas melhoria”.
- Novas funcionalidades sem decisão de produto, como autoria de kudos pelo painel RH/admin.

## Ordem de fechamento

1. Confirmar publicação e smoke da versão final.
2. Executar uma aceitação web integrada com dados sintéticos, cobrindo perfis, cobrança, arquivos e e-mail autorizado.
3. Ensaiar recuperação e alertas; registrar os responsáveis.
4. Reunir os aceites de privacidade/contrato e suporte no sign-off e decidir go-live.

Não é necessário criar outro módulo para encerrar esta lista. O critério é evidência de uso e operação dos fluxos já oferecidos.

## Fontes e limites

- `docs/pendencias-consolidadas-2026-10-24.html` (atualização declarada 25/10; contém itens já concluídos e referências históricas).
- `docs/stripe-billing.md`, `docs/company-post-attachments.md`, `docs/RETOMADA-2026-10-26.md`.
- `docs/pilot-acceptance-checklist.md`, `docs/pilot-go-live-signoff.md`, `docs/privacy-approval-matrix.md`.
- Consultas somente leitura RDS/CloudWatch em 26/10; nenhum restore ou alteração de infraestrutura executado nesta revisão.
