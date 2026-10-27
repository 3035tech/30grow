# Proposta — carga de colaboradores por CSV

Proposta de 26/10/2026. A primeira versão para colaboradores atuais foi implementada nos commits `dfc23739` e `5c3fe65a`, com prévia, validação por linha e importação. A inclusão de novas admissões com onboarding continua fora desse fluxo.

## Modelo mínimo

| Coluna | Obrigatória | Regra |
| --- | --- | --- |
| nome_completo | Sim | Não vazio; mesmos limites do cadastro direto |
| email_corporativo | Sim | E-mail válido, normalizado; nunca usar pessoal como substituto |
| data_admissao | Sim | Data real, válida e não futura; modelo em AAAA-MM-DD |
| email_pessoal | Não | Contato opcional; não inferir a partir do corporativo |

Empresa vem do contexto autenticado, não do CSV. CPF, salário e documentos não integram o modelo mínimo. Unidade/cargo/cadastro de vínculos exigem modelagem e resolução de referências próprias antes de entrarem numa versão posterior; não criar texto livre para substituir entidades existentes.

## Fluxo proposto

1. Em Equipe, ação Importar CSV e download de modelo.
2. Selecionar arquivo e conferir prévia: quantidade, dados normalizados e erros por linha/coluna.
3. Corrigir problemas antes da confirmação. Duplicatas no arquivo e identidades já existentes na empresa são destacadas; não sobrescrever, fundir pessoas nem ativar candidatos silenciosamente.
4. Confirmar explicitamente a carga na empresa ativa; revalidar no servidor, inclusive permissões, datas, duplicatas e capacidade do plano.
5. Apresentar resultado de cada linha e totais. Uma tentativa repetida não pode criar outra pessoa com a mesma identidade. Informar claramente qualquer falha parcial; não prometer atomicidade antes de defini-la e comprová-la.

Para carga de colaboradores atuais, proposta: entryMode existing_employee, etapas de onboarding dispensadas e nenhum envio automático de convite. Convidar depois por ação explícita, preservando controle sobre envios externos.

## Implementação e limites a fechar

- Não foi encontrado importador CSV de colaboradores pronto. Reutilizar o domínio de inclusão direta, isolamento, unicidade e auditoria; não duplicar SQL de contratação no parser.
- Aceitar CSV UTF-8 com BOM e delimitador do modelo; suporte adicional a ponto e vírgula/Excel deve ser testado com aspas, quebras de linha e cabeçalhos, sem parser baseado apenas em split.
- Definir limite de linhas/tamanho após prova de desempenho. Começar com lote limitado, sem filas ou nova infraestrutura por antecipação.
- CSV e prévia são transitórios; não guardar arquivo/dados pessoais em logs. Se histórico durável de importações for necessário, modelar sua identidade, relação com empresa/ator, cardinalidade e retenção antes de criar tabela/migration.
- Mesmas permissões do cadastro direto ou capacidade explícita de importação, conforme revisão de autorização. Nenhuma permissão ampliada por receber um arquivo.
- Provas mínimas: arquivo válido, ausência de corporativo mesmo com pessoal, data futura/inválida, duplicata interna/existente, outra empresa, limite/capacidade, concorrência e repetição, além de nenhum e-mail não solicitado.

## Fora da primeira entrega proposta

Atualizar pessoas existentes, importar remuneração/CPF/documentos, criar cargos ou unidades automaticamente, deduzir dados ausentes, importar por outras entidades ou disparar convites em massa.
