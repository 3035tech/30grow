# Validação — estrutura organizacional e headcount

Entrega local de 15/10/2026. Nenhuma migration ou publicação em produção. Corte: posições estruturais, ocupação primária e recrutamento vinculado sobre os cadastros existentes.

## Aceite entregue

- Organização mantém estrutura/organograma por pessoa e ganha a subvisão Posições e headcount, com filtros/estado na URL, tabela responsiva e teclado.
- Unidade recebe tipo fixo; unidades antigas continuam válidas sem inferência de tipo. A posição tem identidade/código próprios por empresa, unidade, cargo, FTE, vigência e aprovação com autor/data.
- Ciclo planejada → aprovada → congelada/encerrada; congelada pode ser reativada. Ocupação e recrutamento precisam ser liberados antes de congelar/encerrar. Planejamento só é editável antes de aprovar, com versão otimista.
- Uma pessoa ativa por posição e uma posição primária por pessoa; transferência encerra o vínculo anterior e conserva histórico/motivo/autor. Cargo/unidade da pessoa são sincronizados. Editores legados não podem contradizer a posição atual.
- Vínculo a vaga aberta do mesmo cargo, respeitando quantidade de contratações. Pipeline, pessoa e posição são gravados em uma transação nos caminhos com e sem assessment. Excedentes, vaga fechada/capacidade reduzida e datas históricas conflitantes são bloqueados; retry não duplica ocupação.
- Desligamento fecha a ocupação automaticamente; liberação manual mantém a pessoa no time. Liberação/desvínculo usam o ID exato revisado, protegendo contra diálogo desatualizado.
- Indicadores de aprovadas, ocupadas, disponíveis e pessoas sem posição, com apoio de planejadas/congeladas e FTE. Recorte por unidade/cargo exatos; busca/situação filtram a lista. Nenhuma posição foi inferida para empregados legados.

## Provas executadas

| Verificação | Resultado |
|---|---|
| Build de produção Next.js | Aprovado |
| PostgreSQL real descartável | 36 verificações aprovadas |
| Interface + HTTP | 28 verificações aprovadas |
| Regressão organização, contratação direta/readmissão/roster | 21 testes aprovados |
| Organização + Guia/contexto | 7 testes aprovados |
| Regressão offline da aplicação | 40 verificações aprovadas |
| Migration 159 | Aplicada e reaplicada duas vezes, preservando os campos legados |
| Schema estático/banco | 159 migrations e 18 contratos aprovados |
| Lint dos arquivos novos de implementação | Sem erros |
| Diff | Sem erros de whitespace |

A prova de banco cobre código único, FKs entre empresas, aprovação/versão, concorrência de ocupação, cargo/unidade consistentes, arquivamento de referências em uso, transferência, liberação, intervalos históricos, links ativos/retirados, revisão desatualizada, capacidade alterada, concorrência de contratação com rollback, idempotência, histórico e contratação legada sem posição.

A prova de navegador cria unidade tipada e posição, aprova/aloca/libera/vincula, confirma contratação por vínculo e por assessment, verifica rollback de excedentes, revogação de acesso e restrição de gestão de vagas, isolamento entre empresas e a posição preenchida na vaga. Capturas em 1365px e 390px, claro/escuro, inspecionadas em `/private/tmp/team30-headcount-qa/`; sem erros JavaScript nem overflow da página. Apenas dados fictícios, SMTP/integrações simulados e banco localhost DTOV.

O lint integral do legado continua sinalizando regras de React Compiler preexistentes; não foi declarado limpo. Os arquivos novos foram conferidos com a configuração Next do projeto.

## Modelagem, rollout e limites

Migration aditiva 159: três tabelas relacionais com tenant/FKs compostas e índices para relações atuais e históricas; domínio de unidade/status em CHECK e motivos em TEXT. Não se criou JSONB nem outro cadastro de pessoa. Ocupações identificáveis acompanham a exclusão autorizada da pessoa; a posição estrutural é preservada. Usuários removidos deixam o histórico de aprovação/data e referências de ator nulas.

Aplicar a migration antes do aplicativo e ativar o uso de posições após atualizar todas as instâncias. Rollback do aplicativo deve reter colunas/tabelas/triggers e interromper writers antigos que ignorem posições ativas/vagas estruturais; não apagar vínculos para viabilizar downgrade. O fluxo legado sem alocação estrutural permanece válido.

Este corte não inclui CNPJ/filiais, orçamento financeiro, posição gestora, vínculos simultâneos secundários ou organograma por posição. O organograma atual continua sendo por pessoa. Processo com várias posições preenche em ordem de cadastro; criar vaga a partir da posição e escolher explicitamente o assento na contratação seguem como expansões do B-ORG-010. Indicadores incluem posições/ocupações confirmadas com início futuro; não são snapshots por data. Limites: 5.000 posições por empresa, opções de unidades/cargos limitadas a 500, histórico de ocupações limitado aos 100 registros mais recentes.

## Polish do fluxo de headcount

Estados das posições exibidos em badges com rótulos no singular; formulários de movimentação mostram código, posição, unidade, cargo e ocupante na liberação. Botões indicam envio em andamento. A lista diferencia ausência de resultados filtrados de ausência de posições e não mostra estado vazio após falha de carregamento. O bloco de posições na vaga distingue carregamento, erro com nova tentativa e lista vazia, com identificação e estado de cada posição. Textos em português e inglês.

Verificação após o polish: build de produção aprovado; lint do componente sem erros; 28 verificações HTTP/navegador aprovadas. Capturas desktop (1365px), celular (390px) e modo escuro revistas, sem overflow da página. Sem alteração de schema ou das regras de negócio; sem deploy.
