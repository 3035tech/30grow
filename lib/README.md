# Organização dos módulos

Os arquivos de `lib` ficam junto ao domínio que mantém seu comportamento:

- `ae/`: avaliações e Motivadores.
- `analytics/`: métricas, comparações, alertas e visão geral.
- `assessment/`: pontuação, filtros e exportação de avaliações.
- `billing/`: cobrança e licenças.
- `blog/`: artigos e publicação.
- `company/`: cadastro, perfil, módulos, mural e benefícios da empresa.
- `development/`: aprendizagem, OKRs, integração e avaliações de desempenho.
- `employee/`: acesso, sessão, perfil, notificações e importação de colaboradores.
- `i18n/`: catálogos e recursos de idioma.
- `identity/`: autenticação, sessões, permissões e usuários.
- `marketing/`: páginas públicas, marca, preços e aquisição.
- `mobile/`: contratos, sessão e notificações da API móvel.
- `people/`: clima e operações de pessoas já agrupadas por área.
- `recruiting/`: candidatos, vagas, funil, entrevistas e contratação.
- `rep/`: registro eletrônico de ponto e certificados.

Arquivos usados por vários domínios podem permanecer na raiz, como `db.js`,
`api-error.js` e `sanitize-html.js`. Ao adicionar um módulo, escolha o domínio
responsável antes de criar outro arquivo na raiz. Imports relativos devem apontar
diretamente para o arquivo canônico; não há cópias ou reexports de compatibilidade.
