# Runbook de release

Procedimento mínimo para homologação e produção. O schema canônico vive em `migrations/`; o bootstrap cria a base histórica e **não substitui** `npm run db:migrate`.

Operação, alertas, restore, SMTP e S3: `docs/pilot-operations-runbook.md`.

## Runtime e manutenção de dependências

O projeto usa Node 22.23.4, definido em `.nvmrc`, no CI e no argumento
`NODE_VERSION` do Dockerfile. Usar `nvm use` (ou configurar a mesma versão no
gerenciador local) antes de instalar dependências e executar os gates. Atualizar
essas referências em conjunto quando o patch do Node mudar.

`npm run lint` usa a configuração oficial Next/Core Web Vitals. O arquivo
`eslint-suppressions.json` registra a dívida preexistente por arquivo/regra:
302 erros em 167 arquivos na adoção inicial. Não é uma aprovação desses erros.
Erros acima da contagem por arquivo/regra e erros em arquivos novos bloqueiam
o CI; 89 avisos permanecem visíveis. O baseline compara contagens, não a
identidade de cada ocorrência; revisar mudanças nas áreas com dívida.
Consultar `npm run --silent lint:inventory` para obter o inventário JSON,
incluindo mensagens suprimidas. Ao corrigir o legado, executar
`npm run lint -- --prune-suppressions`. Não regenerar o baseline para aceitar
regressões novas.

Dependabot abre PRs semanais de npm, Docker e GitHub Actions. Next/React e os
SDKs AWS têm grupos próprios para versões compatíveis. Mudanças de major são
revisadas em entregas separadas; não há merge automático. Uma PR de Docker que
altere o Node precisa atualizar também `.nvmrc` e o requisito em `package.json`.

Pendências consolidadas e critérios de conclusão:
`docs/pendencias-consolidadas-2026-10-24.html`.

## Antes do deploy

1. Confirmar backup recente e restaurável do PostgreSQL.
2. Registrar a imagem/tag atualmente em produção para rollback.
3. Rodar build e provas focadas do PR.
4. Em banco novo: aplicar `scripts/rds-bootstrap-completo.sql`.
5. Aplicar todas as migrations com `npm run db:migrate`.
6. Executar `npm run db:validate-schema` contra o mesmo banco.
7. Executar `npm run ops:pilot-preflight -- --write-storage` em homologação.

O validador é somente leitura. Ele falha se alguma migration canônica não estiver registrada ou se faltar tabela/coluna essencial dos fluxos de empresa, usuário, pessoa, vaga, avaliação, funil ou LMS.

## Deploy

1. Aplicar migrations compatíveis antes de subir a nova imagem.
2. Subir a imagem de forma gradual, mantendo ao menos uma instância saudável.
3. Verificar `/api/health`, login e o smoke da jornada principal.
4. Observar erros 5xx, queries lentas e espera no pool PostgreSQL.

## Rollback

1. Reimplantar a tag anterior da aplicação.
2. Não remover colunas/tabelas automaticamente: migrations do 30Grow são expansivas e a versão anterior deve tolerar campos adicionais.
3. Restaurar backup apenas diante de corrupção/perda confirmada e com janela de manutenção aprovada.
4. Registrar causa, intervalo afetado e migrations aplicadas.

## pgAdmin

Quando o ambiente exigir execução manual, usar `scripts/scripts-banco-pendentes.sql`, conferir a transação e depois executar `npm run db:validate-schema` de um host autorizado. Scripts `rh2-*-pgadmin.sql` são cortes históricos e não substituem o bundle atual.

## Prova local segura

```bash
npm run dtov:reset
env POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=55432 POSTGRES_DB=enneagram_dtov \
  POSTGRES_USER=dtov POSTGRES_PASSWORD=dtov_local_only POSTGRES_SSL=false \
  npm run db:validate-schema
npm run dtov:down
```
## Seleção de etapas na inclusão do colaborador — 25/10/2026

O cadastro direto na Equipe e a confirmação de contratação permitem escolher
checklist de chegada, D30, D60 e D90. Marcar significa realizar; desmarcar dispensa
a etapa. Há ações Marcar todas e Desmarcar todas. Todas começam marcadas, mantendo
o comportamento anterior. Documentos e cursos permanecem gerenciados separadamente.

A migration 172 adiciona `employee_onboarding_stage_choices`: domínio fixo de
quatro etapas, decisão booleana, autor/data, chave por empresa/pessoa/etapa e FK
composta para impedir vínculos entre empresas. A decisão é persistida junto da
contratação, antes dos efeitos posteriores ao commit. As tarefas dispensadas usam
o estado existente `skipped`, sem serem contadas como pendências ou atrasos.
Novos itens de checklist também respeitam a escolha de dispensar a chegada.

Aplicar 172 antes de publicar a interface. Em 25/10/2026 foi aplicada e registrada
em Dublin (`team`) pelo pgAdmin web e em produção (`grow30`) pelo pgAdmin nativo.
Ambos retornaram zero decisões preexistentes, acesso do runtime válido e um
registro em `schema_migrations`. Não foram alteradas tarefas de colaboradores
existentes. A reaplicação local preservou as escolhas e a FK recusou outra empresa.

Provas: 567 testes unitários; cinco integrações com PostgreSQL real, incluindo
dispensa total, seleção parcial, reaplicação, isolamento e rollback; 34 testes
de interface, incluindo seleção nas larguras 390/1440 e os checklists anteriores; build.
A passagem do mesmo candidato para colaborador também foi validada com preservação
do histórico, convite SMTP simulado, definição de senha e login corporativo.

Para rollback, preservar tabela e tarefas dispensadas. A versão anterior ignora
as escolhas ao criar tarefas futuras; suspender novas inclusões que precisem
dessas dispensas até retornar à versão que suporta a seleção. Não remover dados
para retornar o código. As escolhas desta entrega são feitas na inclusão; os
controles individuais de Pular/Reabrir já existentes continuam disponíveis.

## Auditoria da passagem candidato → colaborador — 25/10/2026

O fluxo explícito de contratação preservou o ID e as notas, separou pessoal e
corporativo, emitiu convite SMTP simulado e permitiu definir senha e autenticar
no corporativo; login pelo pessoal e por outra empresa foram recusados. A troca
de e-mail na ficha não altera `employment_status`.

A diferença de contatos da inclusão direta foi corrigida no lote atual: quando
um candidato conhecido é incluído com seu pessoal e um novo corporativo, o mesmo
ID e histórico são preservados, sem duplicar o cadastro. Colaboradores atuais
podem ser incluídos somente com corporativo, sem inferir um contato pessoal.

A ação explícita “Ativar como colaborador” está disponível na ficha, banco de
talentos e modal do pipeline para perfis com acesso à Equipe. Ela confirma o início
efetivo do trabalho, data de admissão, contatos, etapas e convite. A API exige a
confirmação do início e rejeita datas futuras. “Contratado” no funil grava somente
a contratação em andamento e a previsão opcional: não altera contato, vínculo,
acesso, tarefas nem fecha a vaga como preenchida. A pessoa ainda pode desistir.
O vínculo e o acesso ao portal têm estados separados; reenvio de convite fica na ficha.

Este lote usa a migration 172 já aplicada nos dois ambientes; não exige nova
migration nem altera em massa os vínculos existentes.

## Regra de contatos na inclusão direta — 25/10/2026

Colaboradores atuais podem ser incluídos em Equipe somente com o e-mail corporativo.
O pessoal é opcional e nunca é inferido a partir do corporativo. Se informado,
é preservado para contato após a saída. Pelo menos um contato válido é necessário.
A opção “Já trabalha nesta empresa” usa a data original de admissão e inicia sem
etapas de integração selecionadas; RH/admin pode selecionar as necessárias.

A etapa Contratado do recrutamento registra somente a contratação em andamento.
A ativação do vínculo é uma ação explícita quando o trabalho efetivamente começou;
não é consequência da troca do e-mail nem de uma previsão de início.

Sem pessoal no desligamento, o vínculo pode ser encerrado normalmente, o acesso
é revogado e o contato corporativo deixa de ser usado. Não há destinatário para
novas comunicações até o cadastro de um contato pessoal válido.

Prova local com PostgreSQL descartável: cadastro só com corporativo, convite SMTP
simulado nesse endereço, pessoal nulo, quatro etapas dispensadas e desligamento
com revogação do convite/acesso e contato nulo. Nenhum e-mail real foi enviado.

### Prova do lote de ativação explícita

Jornada completa em aplicação local com build de produção e PostgreSQL descartável:
empresa e RH criados pela interface, cargo/vaga, candidatura pública, 54 respostas,
arrastar para Contratado sem ativação, ativação explícita e mesma pessoa na Equipe
após recarregar. Inclusão adicional de colaborador atual só com corporativo,
pessoal nulo, admissão histórica e zero etapas selecionadas.
A API recusou confirmação ausente (400), outra empresa (404) e sessão ausente (401).

Seis contratos com PostgreSQL real cobrem os dois endpoints do funil, desistência,
ativação idempotente, identidade/histórico, login corporativo, inclusão direta,
kit de chegada sem duplicação e desligamento sem pessoal. Cinco contratos anteriores
de seleção de etapas também passaram. SMTP simulado; esta prova não certifica
entrega externa, nem aceitação de todos os perfis/módulos em produção.
