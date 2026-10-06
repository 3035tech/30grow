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
Segurança: 68 casos; consistência: 30 casos. Naquele momento, a suíte ampliada
apontou calendário e overflow das listas como pendências. Ambos foram corrigidos
na rodada de RH/admin abaixo. A expectativa de foco do formulário foi corrigida
no teste, preservando a ordem acessível real e simulando uma submissão assíncrona.

O polish posterior dos cabeçalhos, perfil e cursos também passou no build e nos
30 testes de consistência. Dos 13 casos de navegador, 12 passaram juntos;
a identidade em 768 px passou na repetição após o build, depois de um erro
transitório de leitura de JSON no servidor de desenvolvimento. Revisão visual
no Chrome em desktop e celular, nos modos claro e escuro, com dados sintéticos.

## Correções e validação de RH/admin — 2026-10-06

Todas as falhas confirmadas na avaliação inicial foram corrigidas. Os critérios
locais passaram: **37 testes de navegador**, **68 de segurança** e **48 de
navegação, escopo, permissões, paginação e consistência**. `npm run build`
concluiu com sucesso; `git diff --check` também passou. Nenhum caso ignorado.

### Correções entregues

- `DateField`: preserva hora, minuto e segundo ao abrir, cancelar ou aplicar.
  O popup mede sua altura depois de montar e acompanha alterações de tamanho,
  mantendo o botão Aplicar dentro da janela e rolagem em janelas menores.
- Menu móvel de gestão: diálogo modal, isolamento com inert, foco inicial,
  contenção de Tab/Shift+Tab, Escape, retorno ao gatilho e limpeza de scroll.
  O gatilho não cobre o logo. A navegação fecha antes da confirmação de saída;
  cancelar não encerra a sessão nem envia escrita.
- Perfil: 2FA distingue status carregando, erro e confirmado. Falhas HTTP,
  respostas inválidas e falhas de rede permitem tentar novamente. Trocar e-mail
  fica bloqueado enquanto o status é desconhecido. Recuperar o status preserva
  o rascunho e mantém as exigências de senha/código. Autorizações da API intactas.
- Layout do perfil alinhado ao cabeçalho, sem card externo duplicado; painéis
  usam os tokens compartilhados. Botões principais ocupam a largura no celular.
- Cadastro de empresas usa `S.input`: 16 px e toque mínimo de 44 px no celular,
  consistente com o calendário. Mensagens em Usuários e Perfil usam callouts
  acessíveis. Textos de cadastro mais claros nos quatro idiomas; página pública
  continua exigindo ativação explícita. Biblioteca distingue recursos de Cursos.
- Overflow de listas: a bisseção identificou o `sr-only` de `DisclosureToggle`
  dentro da tabela de modelos. O texto absoluto não tinha ancestral posicionado
  e ampliava o documento para 555 px em 375 px. `relative` no próprio componente
  contém o texto sem retirar o nome acessível. As tabelas continuam roláveis;
  nenhuma regra global foi usada para esconder overflow.

### Evidências

A suíte inclui Equipe, PDI, Perfil, Empresas e Usuários em 390/768/1440 px,
um único h1, sem overflow do documento, cancelamento de criação sem escrita,
navegação RH/admin, recuperação do 2FA e preservação de rascunhos. Os testes
existentes cobrem colaborador, calendário, seletores, OKR, organograma e anexos.

Revisão manual no Chrome em desktop e celular, claro e escuro, com os componentes
reais e dados sintéticos locais. Capturas da rodada: `/private/tmp/rh-admin-final-ui`.
Capturas manuais: `/private/tmp/30grow-admin-mobile-final.png` e
`/private/tmp/30grow-rh-profile-final.png`. O Chrome com Grammarly emite um aviso
por atributos injetados pela extensão no body; não houve esse aviso no navegador
isolado dos testes. O tamanho temporário do Chrome foi restaurado ao concluir.

### Reexecutar

```sh
npx playwright test --config test/ui-controls/playwright.config.js
npm run test:security
node --test test/unit/dashboard-navigation.unit.test.js test/unit/dashboard-company-scope.unit.test.js test/unit/company-owner-permissions.unit.test.js test/unit/admin-list-pager.unit.test.js test/unit/p3-ui-consistency.test.js
npm run build
```

O teste de organização visual em `module-hardening` foi atualizado para reconhecer
o mesmo botão primário com classes responsivas; suas verificações de segurança
não foram removidas.

### Limites

Os fixtures `/dashboard` renderizam o `DashboardClient` real apenas neste app
isolado. `persona=hr/admin` escolhe identidades sintéticas; não autentica nem
comprova autorização em produção. APIs administrativas locais são GET; escritas
de testes específicos são interceptadas. Não há banco ou dados reais.

A sessão de produção estava expirada na avaliação inicial. Esta entrega não
inclui publicação ou E2E autenticado em produção, nem valida todos os módulos,
combinações de permissões, leitor de tela, cadastros reais e volume de dados.


## Cobertura da landing — 2026-10-06

A seção de funcionalidades apresenta 46 recursos em seis grupos. Os seis
principais de cada grupo ficam visíveis; os demais podem ser expandidos e
recolhidos por teclado ou toque. A lista completa também alimenta o JSON-LD.

Carreiras, sucessão e ouvidoria ganharam destaque. O novo grupo Organização
inclui organograma, áreas, assistente de ajuda, guia, permissões e 2FA da gestão.
Os textos foram atualizados em português, inglês, espanhol, francês e alemão;
variantes regionais mantêm o mecanismo existente de seleção de idioma.
O inventário de llms.txt passou a mencionar organização e biblioteca.

Validação: `landing.spec.js` e `brand.spec.js`, **10 casos aprovados** em
390/768/1440 px, incluindo expansão com Enter/Space, preservação do foco,
conteúdo completo, tradução e ausência de overflow horizontal. O teste unitário
`product-landing-seo.unit.test.js` verifica os 46 itens e sua presença no JSON-LD
para todas as cópias e variantes verificadas, sem fallback de texto inglês.

Revisão visual no Chrome desktop/mobile; tamanho temporário restaurado.
Capturas automatizadas: `/private/tmp/30grow-landing-final-tests`.
Captura manual: `/private/tmp/30grow-landing-desktop-final.png`.
O build de produção e `git diff --check` passaram.
As rotas de preview não expõem dados reais nem publicam a alteração.

```sh
npx playwright test --config test/ui-controls/playwright.config.js landing.spec.js brand.spec.js
node test/unit/product-landing-seo.unit.test.js
npm run build
```
