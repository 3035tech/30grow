# Padrão de navegação do dashboard

Este documento define a fundação de navegação do painel 30Grow. O objetivo é reduzir procura, preservar contexto e impedir que telas grandes sejam resolvidas apenas com mais cards ou mais rolagem.

## Menu lateral

O menu contém somente destinos. Ações como criar vaga, buscar pessoa ou tratar pendências devem aparecer na tela em que a decisão acontece, nunca em um bloco fixo no menu.

Os destinos são agrupados em até seis áreas:

1. **Início:** Visão geral.
2. **Pessoas:** Equipe, Remuneração, DP e Benefícios.
3. **Recrutamento:** Vagas, Banco de talentos e Cargos.
4. **Desenvolvimento:** Avaliações, OKRs, Sucessão, Academy e LMS.
5. **Cultura e RH:** análises de equipe, Motivadores, Clima, Mural, Saídas e Ouvidoria.
6. **Administração:** Usuários, Empresas, Leads, Feedback de produto e Auditoria, conforme permissão.

No primeiro acesso, somente o grupo da tela atual fica aberto. A preferência de grupos abertos é preservada no navegador. Guia e Sair permanecem no rodapé e não competem com os módulos.

A fonte canônica de pertencimento das telas é `lib/dashboard-navigation.js`. Breadcrumb e sidebar devem usar esse mesmo mapa.

## Cabeçalho de página

Cada tela deve ter:

- breadcrumb com área e destino atual;
- um único título;
- descrição curta apenas quando orientar a tarefa;
- uma ação primária, quando existir, no canto superior direito;
- ações secundárias agrupadas de forma discreta.

Abas que já exibem o título no shell não devem repetir um segundo título visual idêntico dentro do conteúdo. Listagens administrativas continuam usando `AdminPageHeader` quando o cabeçalho pertence ao próprio workspace.

## Quando usar tabs

Tabs servem para tarefas equivalentes sobre o mesmo objeto. Uma tela longa, por si só, não justifica tabs.

Use tabs quando:

- o objeto permanece o mesmo durante a troca;
- cada seção representa uma tarefa recorrente e independente;
- a URL pode identificar a seção;
- cada painel pode carregar seus dados sem buscar todos os demais.

Não use tabs para:

- etapas sequenciais de um formulário;
- esconder campos raramente usados, caso em que `CollapsibleBlock` é mais adequado;
- trocar entre entidades diferentes;
- criar subtabs dentro de drawers.

Limites e comportamento:

- até seis tabs visíveis; excedentes vão para `Mais`;
- tab ativa deve estar na URL em workspaces com deep link;
- voltar do detalhe preserva tab e filtros;
- mudança com formulário sujo exige confirmação;
- painéis usam loading independente;
- teclado: setas, Home e End movem o foco;
- contagens pendentes podem aparecer como badge, sem usar cor de marca como status de domínio.

O componente canônico é `PanelSubNav`. Cada tela continua responsável por sincronizar a seleção com sua URL por meio de `navigateDashboard` ou do roteador existente.

## Hierarquia recomendada

```text
Menu lateral
  Área do produto
    Tela ou objeto
      Tabs locais, quando necessárias
        Seções secundárias recolhíveis
```

Em mobile, o menu vira drawer e workspaces de lista + detalhe passam a telas sequenciais. Não se deve comprimir duas colunas de trabalho em uma largura insuficiente.

### Ajuste do beta — 22/10/2026

A ausência de preferência salva abre só a área ativa já na primeira renderização. Uma preferência existente de lista vazia significa que o usuário escolheu manter todos os grupos abertos; isso continua preservado. Preferências inválidas voltam ao padrão seguro de abertura, e destinos removidos não permanecem no estado do menu.

Organização é o destino da edição de unidades, hierarquia e organograma. Grupos reúne composição e colaboração, com atalho para Organização apenas para quem pode abrir essa tela. A simulação de um grupo não monta nem salva alterações estruturais no organograma.
