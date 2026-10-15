# Validação — UX transversal e importação de perfil

Entrega de 15/10/2026, em ambiente local descartável. Nenhuma migration, dado ou publicação em produção.

## Comportamento entregue

- Importação em perfil existente e card expandido da vaga: PDF de currículo/LinkedIn, IA, revisão editável por campo, seleção explícita, resumo profissional persistido e auditado. Dados existentes começam desmarcados.
- Leitura de texto local e fallback de arquivo PDF para modelo com visão. Correção do leitor legado para buffers do Node com offset; falha da extração local não impede o caminho por IA.
- Escopo por empresa/ator, cota e kill switch existentes, saída estruturada validada, limite de tempo da chamada e revisão assinada de 30 minutos. Troca do documento/alteração de campo selecionado invalida a revisão; outros campos concorrentes são preservados.
- Padrão compartilhado de tabelas com indicação/controles de rolagem, teclado e coluna inicial fixa. Filtros responsivos e estado na URL em listagens antes locais; limpeza desse contexto na troca de empresa. Retorno da ficha ao Banco de talentos filtrado. Alternativa acessível ao arrastar etapas no pipeline. Avisos abaixo dos diálogos, sem cobrir rodapés.

## Evidência

- Build de produção Next.js aprovado.
- 40 verificações offline aprovadas.
- 23 testes unitários de importação/estado de listas/consumo de IA aprovados; 4 testes do Guia aprovados.
- 23 verificações de importação em PostgreSQL real: isolamento, ator, adulteração, conflito de campo/arquivo, preservação dos não selecionados, resumo e data, ciclo de colaborador, kill switch, cota e atribuição de consumo. Migration 158 reaplicada duas vezes.
- Regressão das tags: 23 verificações no PostgreSQL e 20 no navegador aprovadas.
- Matriz browser: fluxo de upload/revisão/aplicação, retorno à lista e teclado; 18 destinos de RH, 5 destinos com administrador e 5 superfícies públicas em 1365px e 390px. Sem erros JavaScript nem overflow horizontal da página. Modo escuro ativado pelo controle da aplicação.
- Schema estático e banco: 158 migrations, 14 contratos; diff sem erro de whitespace. Arquivos novos de implementação sem erros de lint. O lint integral ainda sinaliza regras novas de React Compiler em arquivos legados (refs/set-state-in-effect/immutability); não foi declarado limpo.
- Capturas inspecionadas em `/private/tmp/team30-profile-ux-qa/`: revisão desktop/celular, lista celular, lista escura e Auditoria administrativa.

## Limites e continuidade

A IA foi simulada nos testes; o contrato HTTP de PDF/Structured Outputs foi verificado com fetch interceptado, sem enviar dados reais. A qualidade da extração com o fornecedor configurado, documentos reais e PDFs digitalizados precisa de homologação operacional. O caminho exige chave/modelo configurados e suporte a PDF/visão no fornecedor. O armazenamento do teste usa um S3 local simulado.

Cadastro começando pelo arquivo, antes de existir pessoa, permanece no item `B-RH-CV-LINKEDIN-CREATE`. A padronização transversal não encerra os ajustes específicos de conteúdo/hierarquia por tela registrados na auditoria UI. Rollback do aplicativo pode manter as colunas aditivas e o domínio de IA ampliado, preservando dados.
