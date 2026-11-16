
<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Regras de arquivos JSX e rotas

- Não criar, manter ou referenciar cópias de arquivos `.jsx` com sufixos numéricos ou variantes no nome, como `Component 2.jsx` ou `Component 3.jsx`.
- Arquivos relacionados a `route*` devem usar somente o nome canônico esperado pelo framework, normalmente `route.js` ou `route.jsx`.
- Não criar, manter ou referenciar variantes de `route*` com sufixos numéricos, como `route 2.js`, `route 3.js` ou similares.
- Cada diretório de rota deve ter uma única implementação ativa; antes de criar ou duplicar qualquer arquivo `.jsx` ou `route*`, verificar se já existe uma implementação equivalente.

## Modelagem de dados e migrations

- Antes de criar ou alterar campos, avaliar identidade própria, cardinalidade, integridade, consultas/índices, edição, histórico e necessidade de cadastro.
- Não escolher `JSONB` ou `TEXT` apenas pela facilidade de implementação. Justificar quando usar um campo, domínio fixo (`CHECK`/enum) ou tabela com relacionamento.
- Entidades e cadastros gerenciáveis devem ter relações, chaves estrangeiras, unicidade e isolamento por empresa quando aplicável.
- Textos livres podem usar `TEXT`; opções fixas precisam de restrição de domínio. Snapshots históricos também podem ser modelados em tabelas relacionais.
- Registrar decisões relevantes de modelagem e verificar integridade, preservação de dados e reaplicação das migrations antes de concluir a entrega.


## Retomada de trabalho em andamento

Antes de retomar migrations, catálogo de emojis ou atualizações do app 30 Grow, ler [docs/RETOMADA-2026-10-26.md](docs/RETOMADA-2026-10-26.md). O arquivo registra branches/PRs, validações, acessos bloqueados e a ordem autorizada de publicação.

## Feedback e confirmações na interface

- Mensagens de erro, avisos, confirmações e solicitações de entrada devem usar a interface customizada do produto. Nunca usar diálogos nativos do navegador (`window.alert`, `window.confirm`, `window.prompt` ou equivalentes).
- Reutilizar `useAppFeedback` / `AppFeedbackProvider`: `toast()` para retorno breve de sucesso/erro, `notice()` para avisos que exigem leitura, `confirm()` para confirmar ações e `promptForm()` para entrada de dados. Os componentes visuais correspondentes são `ConfirmDialog`, `SystemNoticeModal` e `PromptFormDialog`.
- Erros de validação de formulário devem aparecer junto aos campos ou em componentes próprios do app; não depender dos balões de validação nativos do navegador. Sucesso e falha de operações assíncronas devem sempre dar retorno visível e compreensível.
- Antes de introduzir outro padrão de feedback, procurar e estender os componentes compartilhados existentes. Manter esta regra sincronizada com `.cursor/rules/reuse-before-create.mdc` e `.cursor/rules/30team-context.mdc`.

## Ações na visão do colaborador

- Ações secundárias repetidas por linha/cartão (anexar, baixar, remover, reagir) podem usar ícones via `EmployeeIconButton` e `IconActionTip`, com nome acessível localizado, dica no foco/hover, alvo mínimo de 40px e cor destrutiva para remoção.
- Ações principais ou irreversíveis (bater ponto, pedir férias/reembolso, enviar reconhecimento, responder pesquisa, salvar) mantêm texto visível. Ações destrutivas preservam confirmação customizada.
- Toda mutação atualiza a interface e apresenta retorno localizado em `useAppFeedback`; estados inline podem complementar o toast em falhas recuperáveis. Atualizar também o estado acessível (`aria-live`/`aria-busy`) em operações assíncronas.
- Manter esta regra sincronizada com `.cursor/rules/ui-ux.mdc` e `.cursor/rules/reuse-before-create.mdc`.

## Campos obrigatórios e máscaras

- Esta regra vale para todos os formulários do sistema, existentes e novos, em páginas, modais, drawers, fluxos públicos e administrativos; não se limita aos formulários levantados em uma auditoria pontual.
- Todo campo obrigatório deve ser marcado visualmente junto ao rótulo com `*` em cor de alerta e semanticamente no controle (`required` ou `aria-required="true"`). Não depender apenas de validação no envio nem do atributo HTML para comunicar obrigatoriedade.
- Preferir `FormField`; ele sinaliza automaticamente controles descendentes obrigatórios. Em `PromptFormDialog`, declarar `required: true` no esquema do campo. Controles customizados (por exemplo, `EntitySearchSelect`) precisam expor `required`/`aria-required` e ter validação customizada pelo valor de domínio selecionado.
- Campos obrigatórios devem mostrar mensagens customizadas e localizadas pelo app. O botão de envio não deve ficar desabilitado apenas porque um campo obrigatório está vazio quando isso impedir que a interface explique o que falta.
- Aplicar máscara durante a digitação somente a dados com formato definido, reutilizando `lib/br-masks.js` (CPF, CNPJ, CEP, telefone e valores monetários) ou seus controles compartilhados. Normalizar com `strip*`/`digitsOnly` antes de enviar ou persistir. CNPJ deve aceitar o formato alfanumérico vigente; não restringir sua máscara a dígitos.
- Não aplicar máscara a nomes, e-mails, datas ou identificadores internos. Campos numéricos sem máscara devem usar `inputMode` apropriado e validação de domínio; não transformar identificadores em valores monetários ou documentos.

## E-mails transacionais

- Todo e-mail enviado pelo produto deve passar por `sendTransactionalMail` (`lib/mail.js`), que aplica o layout compartilhado de `lib/email-layout.js`, inclusive quando o conteúdo do corpo for HTML customizado.
- Manter a identidade 30Grow no shell compartilhado; criar conteúdo específico do fluxo dentro dele. Não criar cabeçalho, fundo e rodapé de marca independentes em cada template.
- E-mails de jornada: o resumo semanal vai para gestores/RH; lembretes de dia incompleto vão individualmente ao colaborador com ponto habilitado. Não incluir dados de outros colaboradores no e-mail individual.
