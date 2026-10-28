# Interações no mural da empresa

Migration 175 acrescenta `company_post_reactions` e `company_post_comments`; não altera avisos, anexos ou reações de kudos existentes. Aplicar a migration antes de publicar os novos escritores. Durante a transição, a leitura do mural aceita a ausência das tabelas novas e retorna contagens vazias.

- Uma reação atual por colaborador e publicação, identificada por `(company_id, post_id, candidate_id)`. O domínio de cinco emojis é fixo por `CHECK`.
- Comentários têm identidade e histórico próprios. O texto é limitado a 1–1000 caracteres; o autor pode excluir o próprio comentário por soft delete. Leituras e índices ignoram excluídos.
- Chaves estrangeiras compostas mantêm publicação, autor e interação na mesma empresa. A API exige sessão de colaborador e módulo Mural habilitado para escrever.
- A listagem do mural consulta contagens e reações em lote. Comentários são buscados apenas quando a pessoa abre a conversa, com páginas de 20.

Reaplicar a migration deve manter as tabelas e dados. Rollback da aplicação: voltar ao leitor anterior e deixar as tabelas aditivas sem escritores. Não excluir as tabelas no rollback, pois isso apagaria comentários e reações já publicados.

## Validação local

Em 28/10/2026, a migration 175 foi aplicada no PostgreSQL DTOV local e reaplicada duas vezes com uma publicação, um comentário e reações sintéticas presentes. O teste confirmou preservação do corpo e das interações, unicidade da reação por pessoa, rejeição de associação entre empresas pela FK, isolamento nas consultas e exclusão lógica do comentário pelo próprio autor. Nenhuma migration foi aplicada em Dublin ou produção nesta entrega.
