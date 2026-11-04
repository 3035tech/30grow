# Suporte e feedback do piloto

Fluxo operacional do primeiro cliente. O canal principal dentro do produto é **Pergunte à IA → Sugerir melhoria**. E-mail alternativo: `info@30grow.com`.

## Classificação e prazo

| Tipo | Exemplo | Primeira resposta | Destino |
|---|---|---:|---|
| Incidente P0 | login, avaliação ou dashboard indisponível | 15 min | operação + responsável técnico |
| Bug P1 | fluxo principal sem contorno | 1 h útil | produto, tipo `bug` |
| Bug P2 | erro isolado com contorno | 1 dia útil | produto, tipo `bug` |
| Dúvida de uso | como executar uma tarefa | 1 dia útil | Ajuda/guia; corrigir conteúdo se recorrente |
| UX | ação difícil de encontrar ou entender | 2 dias úteis | produto, tipo `ux` |
| Ideia comercial | capacidade ainda inexistente | 2 dias úteis | produto, tipo `idea`; backlog só após triagem |

## Triagem

1. O gestor envia pela ação **Sugerir melhoria** no assistente; a tela e seção atuais são registradas automaticamente.
2. O super admin abre **Sugestões**, classifica e muda `new → reviewing → done/dismissed`.
3. Registrar nas notas: reprodução sanitizada, impacto, frequência, responsável e próxima resposta.
4. Não copiar token, cookie, senha, documento, respostas de avaliação, remuneração ou texto de ouvidoria.
5. Só promover uma ideia ao `docs/BACKLOG.md` quando recorrente, contratada ou necessária para corrigir risco do piloto.

## Fechamento semanal

- Agrupar ocorrências repetidas por módulo e causa.
- Confirmar retorno ao solicitante quando `contactOk = true`.
- Revisar itens `reviewing` sem atualização há sete dias.
- Separar correção desta versão de melhoria futura.
- Levar incidentes de infraestrutura para `docs/pilot-operations-runbook.md`.

O inbox não substitui monitoramento: indisponibilidade, 5xx, PostgreSQL, S3, SMTP e cron seguem o runbook operacional.
