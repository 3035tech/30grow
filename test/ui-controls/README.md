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
