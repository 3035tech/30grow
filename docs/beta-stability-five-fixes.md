# Estabilidade do beta — UX-01 a UX-05

## Entrega

1. **Rascunhos**: `PromptFormDialog` compara os valores iniciais com os atuais. `AdminRichFormDrawer` protege formulários com footer e aceita estado controlado `dirty` para editores complexos (vaga e cargo). Fechar, Escape, Cancelar, clique no fundo e navegação do painel pedem descarte; Continuar editando mantém os valores. Recarregar/sair da página usa o aviso nativo. Formulários limpos não pedem confirmação. A confirmação privilegia continuar editando, mantém Tab/Shift+Tab entre suas ações e devolve o foco ao formulário ao cancelar o descarte. Candidatura com responsável salvo automaticamente não passa a ser tratada como rascunho. Não há armazenamento permanente de rascunhos nem recuperação após fechamento forçado do navegador.
2. **Validação**: Zod retorna `fieldErrors` seguros e localizados, sem ecoar entrada, mensagens de refinamento ou detalhes internos. Os formulários compartilhados validam obrigatório, e-mail, número e tamanho; exibem a orientação junto ao campo e focam o primeiro erro. Editar um campo limpa apenas o seu erro; os avisos dos demais campos permanecem visíveis. Cargo preserva formulário e exibe erros da API junto à descrição. Descrição salva limita 8000 caracteres de texto visível; sugestão de pesos com IA limita 4000, com transporte separado de 100000 caracteres. Formatação colada não consome o limite de texto. Falhas de IA/uso mantêm códigos próprios.
3. **Clima**: Rascunho usa Criada em; abertura futura usa Abertura prevista e chip Programada; Aberta em requer data de abertura. Data de criação não é apresentada como abertura quando a data real não existe.
4. **Textos**: Motivadores usa o catálogo de dimensões; fontes do painel usam rótulos traduzidos (Desenvolvimento, Perfil da equipe, Clima, Motivadores, Liderança). A referência legada Academy foi padronizada para Biblioteca nos textos em português, preservando chaves e relações técnicas.
5. **Suporte**: triagem e notas internas ficam privadas. Resposta ao solicitante é texto publicado no histórico Meus pedidos de suporte, acessível no assistente. Só resposta publicada conta para primeira resposta; status/notas não contam. Encerrar um pedido exige resposta visível. O usuário consulta somente os próprios pedidos na empresa da sessão (últimos 20). Não há envio automático de e-mail nesta entrega; o canal de acompanhamento é o próprio aplicativo. O formulário de revisão continua aberto se o salvamento falhar.

## Modelagem da migration 168

`first_triaged_at TIMESTAMPTZ` registra a primeira atividade interna. `public_response TEXT` é um atributo livre, limitado a 4000 caracteres, contendo a resposta atual visível ao solicitante; não é cadastro nem lista de opções e não usa JSONB. Não foi introduzida uma conversa de múltiplas mensagens. A identidade e o isolamento continuam em `product_feedback.user_id` e `company_id`, com as relações existentes. O índice por empresa/data existente atende a leitura limitada; nenhum índice novo foi adicionado sem evidência de necessidade.

Historicamente `first_response_at` marcava atividade interna. A migration copia essa evidência para `first_triaged_at` e preserva **todos** os campos antigos. A aplicação só considera `first_response_at` como resposta quando existe `public_response` não vazia. Ao publicar a primeira resposta real, o timestamp passa a registrar esse momento; edições seguintes não reiniciam o prazo. Notas históricas não são promovidas a respostas públicas.

Expandir antes de publicar: aplicar `168_support_response_visibility.sql` e registrar em `schema_migrations` em Dublin e produção. Scripts foram executados com limites de lock/tempo e checksum dos campos antigos; Dublin preservou 1 registro e produção tinha 0 registros. A migration foi reaplicada no teste PostgreSQL. Rollback do código mantém as colunas, respostas e evidências; não apagar os campos para reverter. Durante deploy gradual, clientes antigos podem continuar registrando atividade no campo legado, mas a aplicação nova só conta resposta com conteúdo público.

## Prova

- Teste local em navegador usando os componentes reais e somente dados fictícios: obrigatório/e-mail no campo, foco, ×, Escape, Cancelar, manutenção ao continuar editando e alteração isolada de select.
- `test/unit/beta-readiness.unit.test.js`: erros seguros, limites de texto visível, rótulos e datas por estado.
- `SUPPORT_PG_TEST=1 node --experimental-vm-modules --test test/unit/support-response.postgres.test.js`: alvo local fixo e descartável; preservação/reaplicação, triagem privada, primeira resposta real, fechamento e isolamento por usuário/empresa.
- Gate de segurança, regressão offline e build do projeto.

Estas correções não substituem os demais critérios de liberação e a auditoria completa de permissões do SaaS.
