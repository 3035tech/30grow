# Controles web: prova isolada

Executar da raiz: `npx playwright test --config test/ui-controls/playwright.config.js`.

Usa as dependências e componentes reais do repositório. Inicia Next somente
em 127.0.0.1:3098, sem .env do produto, banco, autenticação ou chamadas de negócio.
O servidor é encerrado pelo Playwright. Não existe rota de teste em app/.

Cobertura: teclado, opções desabilitadas, Escape, typeahead, required,
FormData/reset, ref, propagação de clique em cards e ausência de nova mutação
ao escolher o valor atual. Capturas em 375/768/1440 px e dark mode ficam em results/.
Não substitui E2E das telas autenticadas nem teste de leitor de tela.

As rotas `/employee`, `/employee/profile`, `/employee/pdi`, `/employee/dp`,
`/employee/lms`, `/employee/time-clock` e `/employee/login` renderizam os clientes
reais com respostas sintéticas locais. Não usam sessões ou dados de produção.
`employee-ux.spec.js` cobre cabeçalhos em 390/768/1440 px, tipografia dos contatos,
menu modal e foco, estados de carregamento/erro do 2FA, recuperação do login,
preservação de rascunhos e cancelamento da saída sem encerrar a sessão.

Na validação de 2026-10-06, os 13 casos de `employee.spec.js`,
`employee-ux.spec.js` e `brand.spec.js` passaram na execução final conjunta.
Segurança: 68 casos; consistência: 30 casos. A suíte ampliada mantém três falhas
reproduzidas também no HEAD anterior às alterações: botão Aplicar do calendário
fora da área visível, expectativa de foco no diálogo com formulário e overflow
horizontal das listas administrativas no celular. Esses casos não pertencem
à navegação do colaborador e continuam pendentes.

O polish posterior dos cabeçalhos, perfil e cursos também passou no build e nos
30 testes de consistência. Dos 13 casos de navegador, 12 passaram juntos;
a identidade em 768 px passou na repetição após o build, depois de um erro
transitório de leitura de JSON no servidor de desenvolvimento. Revisão visual
no Chrome em desktop e celular, nos modos claro e escuro, com dados sintéticos.

## Validação de RH e admin — 2026-10-06

Resultado: **ainda não aprovado nos mesmos critérios do colaborador**.
Nenhum arquivo de produto em `app/` ou `lib/` foi alterado nesta avaliação.
Os novos fixtures renderizam o `DashboardClient` real em `/dashboard` somente
neste aplicativo isolado. `persona=hr` e `persona=admin` selecionam identidades
sintéticas; isso não representa autenticação real nem prova autorização da API
de produção. As APIs locais de administração e perfil só possuem handlers GET.
A produção redirecionou para login com sessão expirada e não foi validada com
RH/admin autenticados.

### Provas que passaram

- 68 testes de segurança: `npm run test:security`.
- 48 testes de navegação, escopo de empresa, permissões, paginação e consistência:
  `node --test test/unit/dashboard-navigation.unit.test.js test/unit/dashboard-company-scope.unit.test.js test/unit/company-owner-permissions.unit.test.js test/unit/admin-list-pager.unit.test.js test/unit/p3-ui-consistency.test.js`.
- Matriz com Equipe, PDI, Perfil, Empresas e Usuários em 390/768/1440 px:
  um único h1 e ausência de overflow horizontal nas cinco páginas com os dados
  sintéticos. Menu de RH oculta Empresas/Usuários; admin expõe esses destinos.
- Cancelar criação de empresa não faz requisição de escrita e devolve o foco.
- Seletores, OKR, organograma e anexos privados: sete casos existentes passaram.
- Diálogo de formulário: foco inicial, navegação de teclado, calendário,
  cancelamento e bloqueio de submissão concorrente passaram após corrigir o
  fixture/teste. Ao circular a partir de Salvar, o primeiro controle é Fechar,
  seguido por Nome. A operação simulada agora aguarda uma resposta assíncrona;
  duas operações síncronas já concluídas não testavam concorrência.
- Revisão manual no Chrome: desktop/celular e modos claro/escuro; dados sintéticos.
  O build aprovado no polish permanece aplicável ao produto, que não mudou.

### Falhas confirmadas e prioridade de correção

| Prioridade | Falha | Evidência | Correção recomendada |
| --- | --- | --- | --- |
| Alta | Data/hora perde o horário salvo ao abrir | `management-calendar.spec.js`: valor 10:30, seletores exibem 00:00. `DateField.jsx`, função `show`, usa `validDateKey(value)`, que remove a parte do horário. | Preservar hora/minuto do valor válido ao inicializar o rascunho; abrir/cancelar não pode alterar o valor. |
| Alta | Menu móvel não contém foco nem isola o conteúdo | Dois casos de `management-ux.spec.js`: sidebar sem papel de diálogo/aria-modal, main sem inert, Tab sai do menu e Escape não retorna ao gatilho. No Chrome, o botão Abrir menu continua sobre o logo e os destinos do menu fechado permanecem na árvore acessível. | Aplicar ao DashboardClient o comportamento móvel já validado no EmployeeShell, com foco inicial, contenção, isolamento, retorno e limpeza ao redimensionar. |
| Alta | Falha de 2FA fica silenciosa | GET `/api/me/2fa` simulado com 503: a seção de 2FA desaparece da aba Segurança. `ProfileTab.jsx` inicia canUse/enabled em false e ignora a falha. | Separar carregando/erro/confirmado e permitir tentar novamente; ausência de resposta não comprova que a função está indisponível. |
| Média | Aplicar do calendário fica fora da janela | Janela 1280×720: limite inferior do botão medido em 798 px, além dos 720 px disponíveis. Caso existente também não consegue clicar. | Recalcular posição pela altura renderizada e limitar a área rolável, mantendo ações acessíveis após mudanças de conteúdo. |
| Média | Campos de empresas estão abaixo do padrão móvel | Texto de 12 px e altura de 38 px em `management-ux.spec.js`; `CompaniesAdminTab.jsx` usa FIELD_INPUT próprio, sem ui-field. | Reutilizar S.input/FormField, fonte móvel de 16 px e alvo mínimo de 44 px, alinhados ao campo de data. |

### Pendência de layout e recomendações visuais

O caso agrupado `lists.spec.js` continua falhando: documento com 555 px numa
janela de 375 px. As tabelas ficam dentro de regiões de rolagem; a inspeção de
caixas não identificou um elemento sem contenção responsável pela largura.
Logo, a falha **não foi atribuída genericamente às tabelas de produção**.
As cinco páginas canônicas da matriz passaram. O teste salva screenshot antes
da asserção e anexa dimensões para aprofundar a reprodução em contexto real.

No perfil de gestão, o card fica centralizado em relação ao título do shell e
mantém caixas aninhadas. Recomenda-se usar o alinhamento e a hierarquia já
refinados no colaborador. Textos como “roster”, “opt-in”, “slug (URL-friendly)”
e caminhos internos no cadastro de empresas aumentam a carga de leitura;
priorizar termos de uso e deixar detalhes de URL em ajuda secundária.
“Academy” e “Cursos” também precisam explicitar biblioteca versus cursos/trilhas.

### Reexecutar os critérios

`npx playwright test --config test/ui-controls/playwright.config.js management-ux.spec.js management-calendar.spec.js calendar.spec.js lists.spec.js select.spec.js okr.spec.js org-chart.spec.js private-attachment.spec.js`

Os casos novos são critérios de aceitação e permanecem vermelhos enquanto as
falhas acima existirem; não foram ignorados nem alterados para aceitar os bugs.
Resultados consolidados por caso, incluindo reexecuções: 13 casos de navegador
passaram e 8 falharam (há mais de um caso cobrindo menu e calendário).
Os cenários não cobrem todos os módulos, combinações de permissões, registros
longos, leitor de tela ou gravações reais de RH/admin. Nenhum teste de produção
com criação, exclusão, pagamento ou alteração de permissões foi realizado.
