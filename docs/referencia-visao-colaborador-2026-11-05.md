# Referência visual — visão do colaborador

Origem: captura de referência enviada na conversa em 05/11/2026. A tela apresenta um painel de colaborador com cartões para cronômetro/ponto, horário, agenda, tarefas, eventos, celebrações e estado da equipe.

## Princípios que aproveitamos no 30Grow

- Colocar a ação diária mais importante no primeiro plano: ponto e jornada de hoje.
- Mostrar o horário previsto e as marcações feitas sem exigir que a pessoa abra outro módulo para consultar o resumo.
- Dar acesso direto ao módulo completo de ponto pelo cartão da jornada.
- Usar uma composição horizontal em telas largas e empilhar os cartões em telas pequenas.
- Manter tarefas e alertas em um bloco separado, com contagens legíveis e links para resolver cada pendência.
- Preservar a navegação e os módulos existentes do 30Grow; os cartões são atalhos e resumos, não uma nova fonte de dados.

## Adaptação implementada

A página inicial autenticada do colaborador agora reserva o cartão de destaque para a jornada: escala prevista, estado do dia, até quatro registros e ação direta para bater entrada ou saída. O botão reutiliza o fluxo autenticado existente, com localização opcional e chave de idempotência; o link secundário abre o ponto completo. Ao lado, o resumo de hoje reúne pendências, pesquisas abertas e pontos de atenção. O cartão só aparece quando o ponto está habilitado para aquela pessoa.

## O que não entra nesta primeira adaptação

Agenda de eventos, celebrações e status geral da equipe foram deixados fora do painel do colaborador. Eles dependem de dados e permissões próprios, podem gerar ruído no uso diário e não são necessários para resolver o objetivo imediato de acesso ao ponto e às pendências pessoais.

## Polimento transversal da visão do colaborador

O levantamento cobriu as áreas Hoje (tarefas, chegada e pesquisas), Desenvolvimento (PDI, avaliações, metas, cursos, combinados e feedback), Rotina e empresa (DP, ponto, visitas/reembolsos, remuneração variável, mural, reconhecimentos e empresa), além de perfil e segurança.

- Ações secundárias repetidas por registro agora usam `EmployeeIconButton`: anexar/baixar/remover documentos, anexar comprovantes ou fotos, reagir e atualizar localização. Em telas estreitas o rótulo continua visível; em telas largas a ação fica compacta em ícone com dica no foco/hover, nome acessível e alvo de 40px.
- Ações principais continuam explícitas em texto: bater ponto, pedir férias ou reembolso, enviar reconhecimento, responder pesquisa, assinar ou contestar espelho, salvar perfil.
- Remoções e cancelamentos continuam exigindo confirmação do sistema. O atalho de remoção de anexo usa cor destrutiva.
- Falhas de carregamento em notificações, pesquisas, cursos, bônus, saldo de horas e espelhos de ponto agora distinguem erro de lista vazia e oferecem nova tentativa quando a recuperação é possível.
- Ações do mural e dos reconhecimentos preservam atualização do conteúdo e feedback customizado; exclusão de comentário pede confirmação.

O padrão para futuras mudanças está em `AGENTS.md` e `.cursor/rules/ui-ux.mdc`. O levantamento não cria um calendário de eventos: a referência visual contém eventos e celebrações, mas o produto ainda não tem um cadastro genérico de eventos para alimentar essa área.
