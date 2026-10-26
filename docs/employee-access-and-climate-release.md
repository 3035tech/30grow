# Colaboradores e pesquisa de clima — 26/10/2026

## Comportamento entregue

O convite do colaborador apresenta o 30 Grow e a empresa, mostra o e-mail de acesso, o botão de criação de senha (72 horas) e o endereço permanente `/employee/login`. Texto e HTML usam o idioma solicitado, escapam os dados e reutilizam o emissor transacional. A recuperação de senha e os convites de gestores mantêm seu conteúdo. A prévia autenticada não gera token, altera cadastro ou envia mensagem; o convite real continua sendo gerado somente após confirmação. Cancelar a prévia mantém o formulário preenchido.

A ficha distingue acesso ativo, convite pendente, expirado e não enviado. O reenvio tem rótulo próprio, prévia e aviso de substituição do link. O endpoint limita solicitações a 120 por gestor/empresa em 15 minutos, permitindo a carga de até 100 convites. Convites expirados orientam para a recuperação existente, com proteção contra enumeração de contas. O primeiro acesso já tinha `EmployeeWelcomeCard`, com atalhos filtrados pelos módulos disponíveis, e foi preservado.

A importação CSV inclui colaboradores atuais, com etapas de onboarding dispensadas. Obrigatórios: `nome_completo`, `email_corporativo`, `data_admissao` (ISO, não futura); opcional: `email_pessoal`. Aceita BOM, vírgula/ponto e vírgula, aspas e quebras dentro de campos; limites de 100 registros/256 KB. Modelo disponível na tela. A prévia e a confirmação revalidam os contatos na empresa da sessão. Linhas inválidas ou com contatos existentes são exibidas e ignoradas, sem fundir, sobrescrever, ativar candidatos existentes ou recontratar ex-colaboradores.

Cada linha válida usa transação própria: lock da empresa, nova consulta de contatos e INSERT com `ON CONFLICT DO NOTHING`; só uma inserção nova segue para `persistCandidateHire`, reutilizando a admissão, integridade e limites do banco. Resultado parcial explícito por linha, sem duplicar o cadastro ao repetir o arquivo. CSV fica apenas na memória da requisição/tela; auditoria registra contagens, sem conteúdo nem dados pessoais. Não há nova tabela, JSONB ou histórico persistente de importação: o cadastro existente é a entidade definitiva. E-mails são uma segunda etapa: RH seleciona explicitamente os novos cadastros, confere a prévia e confirma destinatários. Não houve carga nem envio reais nesta validação.

Pesquisa de clima pede confirmação antes de abrir respostas, com título e quantidade de perguntas; Cancelar recebe foco e não faz PATCH nem altera o rascunho. Título e descrição podem ser editados em rascunho, com sanitização já existente, preservação do questionário e bloqueio no servidor após publicação (inclusive conflito entre edição e publicação). Falhas ao adicionar pergunta permanecem no formulário, com texto/tipo preservados e erro da API.

## eNPS / migration 174

Causa reproduzida: migration 080 adicionou `enps`, mas a CHECK de 042 ainda exigia `scale_min>=1`; o domínio envia corretamente 0–10. A migration 174 amplia a CHECK para permitir mínimo zero apenas quando `question_kind='enps'`, preservando todo o domínio anterior. Não reescreve perguntas nem respostas. A CHECK é validada e a migration é reaplicável.

Aplicada via sessões owner já autorizadas, antes do código:

| Ambiente | Banco/role | Perguntas preservadas | Hash antes/depois | CHECK/ledger |
| --- | --- | --- | --- | --- |
| Dublin | team / 3035tech | 62 | 5c3caa329b1c4d73c640391b118f967f | válidos |
| Produção | grow30 / admin3035tech | 86 | 66e6d6c4188a81637fb49a3554ca77b8 | válidos |

Execução protegida por guards de banco/role, lock timeout 5s, statement timeout 30s, lock curto da tabela e comparação de contagem/hash dentro da transação. Nenhuma pergunta/resposta real foi criada para teste.

Rollback: reverter o código mantendo a CHECK ampliada, que é compatível com versões anteriores. Não restaurar a CHECK restrita enquanto houver eNPS com mínimo zero: isso invalidaria dados corretos. A restrição antiga só pode voltar após uma decisão de produto/dados separada; nenhuma exclusão ou conversão faz parte desta entrega.

## Provas

- 582 testes unitários passaram antes do último ajuste de quebra de URL e numeração física do CSV; os 6 testes focados desses ajustes passaram depois.
- Build Next/webpack passou; lint dos arquivos alterados sem erros (avisos preexistentes de imagem/hook e eslint-disable).
- PostgreSQL local: reproduziu CHECK violation, aplicou/reaplicou 174, aceitou eNPS 0–10, rejeitou mínimo zero em Likert e limites inválidos, preservou linhas anteriores; só tabela temporária.
- Componentes reais em rota local temporária com respostas simuladas: cancelar publicação não escreve; editar título/descrição mantém questão; erro eNPS preserva texto/tipo e nova tentativa salva; prévia sobreposta recebe foco/Cancelar e mantém campo; CSV mostra uma linha válida e uma inválida, confirma só a válida e apresenta seleção de convites desmarcada.
- Rota temporária removida e servidor de validação encerrado. Sem envio de e-mail real; entrega SMTP/destino real permanece aceite operacional.

## Acabamento da importação

Modelo CSV disponível também ao lado da ação de importar. Tela apresenta preparar/conferir/resultado, campos obrigatórios e opcional, nome do arquivo, contagem de linhas válidas e com erro, erros em lista por linha, estados com texto e seleção de convites identificada por colaborador. Layout desktop e celular conferidos no Chrome; sem transbordamento horizontal no estado inicial. Os 12 testes focados de CSV/importação/catálogos passaram; rota temporária removida.
