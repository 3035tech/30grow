# Navegação, mobile e estados — beta, 22/10/2026

Entrega dos três itens de prioridade média solicitados: navegação (UX-12/13), acesso móvel aos registros e indicadores (UX-14/15) e contratos dos componentes (UX-19).

## Resultado

- **Menu:** primeiro acesso abre só a área ativa, desde a primeira renderização. Preferências existentes são respeitadas, inclusive a escolha de manter tudo aberto. O grupo da tela atual reabre ao navegar. Dados inválidos de armazenamento usam o padrão inicial; grupos removidos são descartados. Aplica-se ao componente compartilhado de menu, preservando permissões e o mapa de destinos.
- **Organograma:** edição concentrada em Organização. Grupos não monta mais o organograma nem sua interação de arrastar/salvar gestor; há atalho para Organização, condicionado à permissão de acesso.
- **Registros no celular:** cabeçalhos compartilhados colocam ações antes das descrições/metadados longos. O detalhe da vaga segue a mesma ordem. O título na primeira coluna da tabela de vagas tem alvo de toque mínimo e indicação Abrir no celular, preservando tabela e rolagem comparativa no desktop.
- **Relatórios:** introdução curta no celular, exportação como ação secundária acessível, período formatado por locale e amostra antes dos indicadores. Os indicadores antecedem os filtros de data, que ficam recolhíveis. Cálculos, parâmetros de exportação e contratos de URL continuam os mesmos.
- **Visão geral:** Atenção agora precede os filtros de coorte. Quando falta empresa, o seletor continua disponível para sair desse estado.
- **Estados:** EmptyState aceita os textos `message` e `description`, evitando instruções silenciosamente ausentes. Skeleton tem rótulo acessível e elementos decorativos ocultos de tecnologias assistivas. InlineCallout anuncia erros como alert e demais estados como status, respeitando override explícito. Toasts usam a mesma semântica. Rodapés de editores informam rascunho e processamento, com a proteção de descarte existente preservada.
- **Aplicação dos estados:** erros com tentativa novamente em Organização, Cargos, Vagas, Empresas, Usuários e Relatórios; carregamento de Empresas/Usuários não aparece como base vazia; falha sem registros não é apresentada como lista vazia em Vagas/Empresas/Usuários; filtro de Cargos sem resultado tem orientação própria e ação de limpar filtros.

O guia de componentes documenta vazio, filtro sem resultado, carregamento, erro, sucesso, alterações pendentes, processamento, validação e ação destrutiva. A ajuda consumida pelo assistente foi atualizada nos quatro idiomas.

## Validação

- Build de produção Next.js aprovado.
- 544 testes unitários; 78 verificações de segurança; 40 verificações offline.
- 642 verificações HTTP com Next de produção, PostgreSQL e Redis locais: leitura, escrita negada, exportações e SSR, incluindo Relatórios e Grupos com empresa de URL forjada.
- Chrome, componentes reais e dados fictícios: apenas uma área inicialmente aberta; expansão por Enter e persistência após recarregar; vazio com instrução e CTA; carregamento; erro com retry e confirmação de sucesso; edição com rascunho visível e confirmação de descarte; filtros do relatório acessíveis pelo teclado.
- Prévia estreita do relatório mostra período, amostra e primeiro indicador sem abrir filtros, sem overflow horizontal global. Viewport solicitado de 390×844; DOM informou largura efetiva de 433 px. Não equivale a ensaio em aparelho físico ou certificação de leitor de tela.

Sem migration, alteração de fórmula, envio externo ou uso de pessoas reais nos testes. Os demais itens médios da auditoria, como simplificação do formulário de vaga e revisão completa de números/textos, não são considerados concluídos por esta entrega.

## Acabamento adicional solicitado

Após a primeira publicação, houve uma segunda passada: o controle do relatório passou a se chamar “Filtrar período”; scores e percentuais usam separador decimal do idioma; cabeçalhos e avisos quebram textos longos; títulos de avisos usam tipografia normal legível; Cargos começa em carregamento quando há empresa, evitando o flash inicial de lista vazia. A prévia confirmou `87,5%` e `8,0/10` em português e continuou sem overflow global. Os 544 testes unitários passaram novamente. Esta formatação pontual não encerra a revisão ampla de nomenclatura e pluralização da auditoria.
