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

Foi reproduzida uma diferença no cadastro direto: informar o mesmo e-mail de
um candidato reaproveita o ID e o torna colaborador, mas não preenche
`personal_email`. Não tratar esse caminho genérico como a conversão recomendada
sem esclarecer os dois contatos. Recomenda-se ação explícita na ficha do candidato,
por ID/empresa, reunindo vínculo, admissão, contatos, etapas e convite. Essa ação
ainda é proposta de produto, não foi implementada nesta entrega.
