# Identidade visual 30grow

Implementação: 29/09/2026. Mensagem: **Pessoas crescem. Empresas vão mais longe.**

## Marca

O símbolo é o 30: 3 navy em forma cheia e zero verde com seta vazada para cima/direita. O wordmark `grow` é verde, em minúsculas. Em fundos navy só o 3 fica branco; zero, seta e `grow` preservam o verde (variante `-dark` do kit).

Origem: brand kit oficial `30grow-brand-kit.zip` (vetores sem fonte, favicon ajustado para 16px, PWA com maskable). Os arquivos do kit são copiados sem redesenho.

- Símbolo: `public/brand/logo-symbol.svg` (+ `logo-symbol-dark.svg`), viewBox 140×110.
- Logo completo: `public/brand/logo-wordmark.svg` (+ `-dark`, `-white`), viewBox 368×114.
- Paths vetoriais: `LOGO_PATHS` em `lib/marketing/brand-tokens.cjs`, consumidos pelo `BrandMark` (3 em `currentColor`, restante `--grow-primary`); sem `<text>` nem imagem raster.
- Favicon (`favicon.ico`, `public/brand/favicon.svg`, `logo-16…64.png`), Apple icon (180px), PWA (`logo-192/512.png` + `logo-maskable-192/512.png` no `site.webmanifest`).
- Atualizar a partir de um kit novo: descompactar e rodar `node scripts/brand/generate.cjs <pasta-do-kit>`. Sem argumento, só regenera `app/brand-tokens.css`.
- E-mails transacionais (convites, acesso, relatório de Analytics) usam `GROW.action` / navy em vez do roxo antigo.
- Ícones iOS/Android do kit (`app/ios`, `app/android`) pertencem ao app mobile (`30-team-app`) e não foram aplicados neste repositório.

## Fonte de verdade

`lib/marketing/brand-tokens.cjs` centraliza cores, escala verde, tipografia e sombras. O gerador produz `app/brand-tokens.css` e os assets. Tailwind e o tema JS consomem os mesmos valores. Aliases históricos (`PURPLE`, `C.purple`, `FONTS.serif`) permanecem para compatibilidade, mas resolvem para a nova identidade.

| Papel | Valor |
| --- | --- |
| Navy / texto principal | #111827 |
| Grow / identidade e progresso | #22C55E |
| Teal / dados secundários | #14B8A6 |
| Fundo | #F8FAFC |
| Superfície | #FFFFFF |
| Borda | #E5E7EB |
| Borda de campo | #D1D5DB |
| Texto secundário | #64748B |
| Muted decorativo | #94A3B8 |
| Ação com texto branco | #15803D |
| Hover da ação | #166534 |

`#22C55E` com branco não atinge AA para texto pequeno. Por isso, botões claros usam o tom de ação mais escuro; no dark mode, usam verde Grow com texto navy. Textos pequenos `brand-500/600` são mapeados para um tom legível. `#94A3B8` fica disponível para decoração; texto de apoio utiliza #64748B no modo claro.

## Linguagem de interface

- Sans-serif: preservada a stack moderna de sistema, com Inter como primeira preferência se disponível. Nenhum download de fonte externa é necessário. Títulos antes serifados agora usam essa mesma família.
- `font-mono` virou Inter com `tabular-nums` (labels/meta/números alinhados); monoespaçada de verdade só com `font-code` (URLs, `kbd`, códigos TOTP, JSON de auditoria).
- H1 700; H2/H3 600 (títulos `font-display` nunca `font-normal`); corpo 400; labels 500; ações principais 600. Valor de KPI em `StatMetricTile` usa `S.cardMetricLg`.
- Um CTA verde por tela: ações de criar de uma subseção usam `AdminCreateButton variant="secondary"`; exportar/filtros usam `S.btnGhost`.
- Ações de linha (`AdminView/Edit/Delete/IconButton`): repouso neutro (`border-line bg-surface`) com o ícone na cor semântica; o fundo tintado só aparece no hover.
- Cabeçalhos de tabela (`SortableTh`, `AdminTh`, `AdminActionsTh`) e células usam `px-4` para alinhar coluna e conteúdo.
- `cn()` não faz merge de classes: para padding próprio em card, partir de `S.cardShell` (sem padding), não de `S.card`/`S.cardTight`.
- Cards e modais 16px, campos/botões 10px; bordas leves, sombra de card 0 1px 2px / 4%.
- Superfícies planas: sem gradientes, texto com gradiente, brilho radial ou vidro (`backdrop-blur`) em cards/modais. `.bg-radial-glow*` permanecem como hooks sem efeito.
- Sombras só por token: `shadow-card`, `shadow-menu` (dropdowns), `shadow-dialog` (modais/tour), `shadow-toast`. Raios ad hoc foram normalizados para `rounded-card` / `rounded-control` (exceção: moldura do celular no mockup da landing).
- Botões de ação: `bg-action` + `text-action-ink` (nunca somar `text-white`, que quebra o contraste no dark mode).
- Menu lateral em coluna única (`SidebarNav` em `app/_components/SidebarNav.jsx`), igual no painel do gestor e no portal do colaborador: fundo `surface` (branco no claro, superfície escura no escuro), borda fina `ink/12` com o conteúdo. Logo no topo, grupos com título clicável (`DisclosureToggle`, `aria-expanded`) que abrem e fecham; vários podem ficar abertos, o estado fica no `localStorage` (`30team_nav_closed_groups` / `30team_employee_nav_closed_groups`) e o grupo da tela atual sempre reabre. Item ativo: fundo `brand-50`, texto `brand-800` e barra de 3px `brand-700` à esquerda. Ajuda/Perfil/Sair no rodapé com divisória. Recolhido (só desktop, 64px) = faixa de ícones das telas com tooltip (`SidebarRailButton`). No celular, a mesma coluna abre como drawer.
- Modo escuro: só na tela (`dark-mode.css` em `@media screen`); impressão e PDF sempre claros. Painel: claro até o usuário escolher. Fluxos públicos sem toggle (`/t`, `/v`, `/jobs`, assessment…): escolha salva no navegador ou, sem escolha, tema do aparelho. Regras em `lib/theme-mode.js`.
- Campos brancos, labels visíveis, foco verde com outline acessível.
- Tabelas neutras com header e hover off-white. Status preservam sucesso, aviso, erro e neutro.
- Dark mode existente preservado com fundos navy/slate e texto claro.
- Ícones: preservada a biblioteca outline central `Icon` (24×24, stroke consistente); não foi introduzida uma segunda biblioteca.
- Site: hero claro, headline da marca nos idiomas existentes, composição de UI e jornada de pessoas. Ilustração antiga retirada do layout, sem nova fotografia genérica. Seções de contraste usam navy.
- APIs, permissões, dados, preços e fluxos de negócio não foram alterados.

## Verificação

- Testes de identidade: cores de ação e apoio com contraste AA, consistência do CSS gerado, manifesto e existência dos assets.
- Teste de SEO/copy institucional preservado.
- Playwright: 390, 768 e 1440px, light/dark, sidebar recolhida, campos, cores de ação e ausência de overflow; regressão da visão do colaborador.
- Identidade/SEO: **5 testes aprovados** (inclui checagem dos vetores oficiais do kit) (`node --test test/unit/brand-identity.test.cjs test/unit/product-landing-seo.unit.test.js`).
- Interface: **3 cenários de marca aprovados** em 390/768/1440px; **2 cenários do colaborador aprovados** em execução isolada. Uma primeira execução concorrente excedeu o tempo de carregamento do início; a repetição passou sem mudanças funcionais.
- Lint com regras Next/core-web-vitals: comparação com HEAD encontrou **78 erros existentes antes e depois, nenhum erro adicional** nos arquivos comparados. Arquivos novos, marca e shells adicionais passaram na execução focalizada. O projeto não possuía configuração própria de lint; foi usada configuração temporária, sem suprimir regras.
- `git diff --check`: aprovado.
- Build de produção executado em `.next-brand-build`, separado do servidor de desenvolvimento. **Build final aprovado (exit 0)**, incluindo compilação, geração de 138 páginas e finalização dos artefatos (`NEXT_DIST_DIR=.next-brand-build npm run build`).
