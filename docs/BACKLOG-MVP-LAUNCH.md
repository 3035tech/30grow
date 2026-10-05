# Backlog de lançamento do MVP

Plano curto para levar o 30Grow do estado de demonstração ao primeiro cliente pagante. Este documento prioriza confiança, fluxo completo e capacidade de suporte. Não é um plano de escala para milhões de usuários nem uma lista de paridade com concorrentes.

## Regra de prioridade

| Nível | Significado | Regra |
|------|-------------|-------|
| **P0 · Agora** | Bloqueia piloto ou pode causar perda/exposição de dados | Concluir antes do primeiro cliente real |
| **P1 · Próximo** | Reduz atrito de implantação, venda e uso recorrente | Concluir durante os primeiros pilotos |
| **P2 · Depois** | Depende de evidência de uso, volume ou pedido comercial | Medir antes de construir |

Cada item só está concluído quando há prova do fluxo, estado de erro compreensível e documentação operacional quando aplicável.

---

## P0 · Agora: pronto para o primeiro cliente

### MVP-02 — Segurança multi-tenant e permissões ✅ ENTREGUE

**Evidência de aceite (19/09/2026):** `npm run release:pilot-check -- --full` passou com 76 provas SQL/lib, 182 HTTP, 16 Playwright e 21 verificações de hardening. A matriz cobre RH/direção ocultando vaga, dossiê, remuneração e DP de outro tenant; o super admin cruza esses recursos explicitamente. Alterações de módulos, usuários, remuneração, DP, vagas, contratação e exclusões lógicas geram auditoria com `company_id`. Empresas, usuários e vagas preservam soft delete.

**Objetivo:** garantir que RH/direção nunca acessem dados de outra empresa.

1. Cobrir APIs administrativas críticas com testes de tenant A × tenant B.
2. Revisar capabilities de módulos, inclusive ativação/desativação pela empresa e pelo super admin.
3. Confirmar soft delete em empresas, usuários e vagas.
4. Auditar ações sensíveis: módulos, usuários, remuneração, DP, contratação e exclusões lógicas.

**Aceite:** matriz automatizada de acesso passa para `admin`, `direction` e `hr`; tentativas cross-tenant retornam erro canônico sem vazar existência ou dados.

### MVP-03 — Jornada principal ponta a ponta ✅ ENTREGUE

**Evidência de aceite (29/09/2026):** build de produção local passou e o runner `test/e2e/pilot-primary-journey.spec.js` concluiu a jornada no DTOV: **1 passed (42,5 s), Chromium**. Empresa/gestor novos, módulos, cargo/vaga, inscrição pública, convite simulado, 54 respostas, resultado, notas persistidas, aprovação, cancelamento/confirmação da contratação e a mesma pessoa na Equipe após recarregar. A execução sem Fast Refresh eliminou o recarregamento que interrompia a avaliação no servidor de desenvolvimento. SMTP real e integrações externas continuam no MVP-04. Ver [evidências e limites](validation/MVP-03-2026-09-29.md).

**Objetivo:** provar o job central sem intervenção técnica.

Fluxo mínimo:

1. Criar empresa e gestor.
2. Selecionar módulos no onboarding ou em Configurações.
3. Criar cargo e vaga.
4. Publicar vaga e abrir página pública.
5. Convidar candidato e concluir avaliação.
6. Visualizar resultado, movimentar no funil e registrar decisão.
7. Contratar e localizar a pessoa na Equipe.

**Aceite:** Playwright cobre o caminho feliz e os principais estados vazios/erros; nenhum passo exige banco, terminal ou ajuste manual.

### MVP-04 — Arquivos, e-mail e integrações essenciais

**Evidência atual:** `npm run ops:pilot-preflight` verifica SMTP e, com flags explícitas, put/delete nos prefixos reais e envio. Executá-lo com credenciais de homologação é gate externo.

**Objetivo:** eliminar dependências que funcionam localmente, mas falham no piloto.

1. Validar política S3 para logo, PDFs de aula e documentos realmente usados no MVP.
2. Aplicar limites de MIME/tamanho e mensagens de erro úteis.
3. Validar SMTP, remetente, resposta, bounce básico e links absolutos.
4. Confirmar que falha de S3/e-mail não deixa registro inconsistente ou tela presa em loading.

**Aceite:** upload/download e convite por e-mail passam em homologação com as mesmas credenciais e políticas previstas para produção.

### MVP-05 — Operação, backup e observabilidade mínima

**Objetivo:** detectar e recuperar falhas antes que o cliente precise reportá-las.

1. Usar logs estruturados e alertas do ambiente. Sentry foi adiado por decisão desta versão.
2. Criar alertas básicos para erro 5xx, indisponibilidade, pool PostgreSQL e falha de cron.
3. Confirmar backup automático e executar um restore de prova.
4. Criar runbook curto para deploy, rollback, migration, S3, SMTP e reset seguro de acesso.

**Aceite:** erro de prova aparece no monitoramento; backup de prova é restaurável; responsável sabe como reverter o último deploy.

**Evidência atual:** `docs/pilot-operations-runbook.md` define alertas, restore, deploy, rollback e reset. Alertas e restore devem ser provados no provedor antes do go-live.

### MVP-06 — Privacidade e dados sensíveis

**Evidência atual:** inventário, política operacional e runbook estão em `docs/pilot-privacy-checklist.md`, `docs/privacy-retention-policy.md` e `docs/data-subject-request-runbook.md`. Minutas públicas versionadas estão em `/privacy` e `/terms`, vinculadas na landpage, preços e cadastro. Aprovação jurídica, prazos definitivos, subprocessadores e lifecycle do provedor permanecem gates humanos.

**Revisão técnica (29/09/2026):** corrigidos descarte por homônimo, logs sensíveis e purge sem empresa/remoção indevida de pessoas. Ensaio DTOV com rollback e 56 testes passaram. Aprovação jurídica, prova integral por classe e validações do provedor continuam abertas. Ver [evidências](validation/MVP-06-2026-09-29.md) e [decisões para aprovação](privacy-approval-matrix.md).

**Objetivo:** lançar com tratamento mínimo responsável de dados pessoais e de RH.

1. Inventariar dados pessoais, remuneração, DP, avaliações e relatos anônimos.
2. Revisar logs para não registrar token, senha, documento, resposta sensível ou parâmetro SQL.
3. Definir política mínima de retenção, exportação e exclusão lógica.
4. Disponibilizar Termos e Política de Privacidade coerentes com os fluxos habilitados.

**Aceite:** inventário e política aprovados; logs de homologação não expõem conteúdo sensível; pedidos básicos de acesso/correção/exclusão têm procedimento documentado.

---

## P1 · Próximo: primeiros pilotos

### MVP-07 — Configurações e módulos compreensíveis

**Evidência (05/10/2026):** Meu perfil separa as tabs `Minha conta`, `Segurança`, `Módulos da empresa` (só dono da conta ou super admin) e `Plano` (admin/RH). Remover módulo mostra aviso inline com os nomes antes de salvar e confirmação destrutiva listando o que sai do menu; alterações seguem auditadas. O resumo de licença permanece acima das tabs por decisão anterior (visível em qualquer tab). Papéis aparecem traduzidos (`common.roles`) no perfil e em Usuários.

**Objetivo:** deixar claro o que pertence ao usuário e o que altera a empresa.

1. Usar `Configurações` com tabs `Minha conta`, `Módulos da empresa` e `Segurança`.
2. Dar mais largura à tab de módulos e agrupá-los pelas mesmas famílias do menu.
3. Mostrar quantidade ativa, impacto no menu e confirmação ao remover.
4. Preservar acesso integral do super admin e registrar alterações.

**Aceite:** um gestor entende o escopo da mudança sem ajuda; salvar atualiza o menu; cancelar não persiste; mobile e teclado funcionam.

### MVP-08 — Onboarding orientado ao primeiro valor

**Evidência (05/10/2026):** o wizard registra `viewed` / `completed` / `skipped` por etapa em `onboarding_events` (migration 145: domínio fixo via `CHECK`, uma linha por usuário/etapa/evento, sem conteúdo sensível). Super admin vê em Empresas → Onboarding o funil por etapa (quantos pararam em cada uma), o objetivo escolhido e, por empresa, o tempo até a primeira vaga ou primeira pessoa analisada criada depois do início do wizard (dados de seed ou migrados não contam; 30/90 dias, até 50 empresas). Provas: `test/dtov/onboarding-funnel.dtov.test.js` e HTTP (evento inválido 400, anônimo 401, RH sem acesso ao funil 403).

**Objetivo:** levar o novo cliente à primeira vaga ou à primeira pessoa analisada rapidamente.

1. Perguntar objetivo inicial e módulos desejados sem apresentar toda a suíte.
2. Criar checklist curto e contextual.
3. Oferecer dados de exemplo claramente identificados ou caminho vazio acionável.
4. Medir conclusão e abandono por etapa, sem conteúdo sensível.

**Aceite:** usuário novo chega ao primeiro resultado útil sem treinamento ao vivo; abandono por etapa pode ser observado.

### MVP-09 — Consistência das telas mais usadas

**Evidência (05/10/2026):** Visão geral, Vagas, Banco de talentos, Equipe e Configurações conferidas em 1440 px e 390 px no DTOV; tabelas rolam dentro do próprio contêiner. Corrigido erro de hidratação na caixa de Suporte (célula de ações fora de `<td>`). `test/e2e/web-polish-surfaces.spec.js`: 4 passed.

**Objetivo:** polir apenas superfícies que participam da demonstração e da rotina inicial.

Prioridade:

1. Visão geral.
2. Vagas e pipeline.
3. Banco de talentos.
4. Equipe/dossiê.
5. Configurações.

Aplicar lista antes de formulário, ação principal clara, loading/erro/empty state canônicos, responsividade e navegação por teclado.

**Aceite:** roteiro de demonstração passa em desktop e mobile sem layout quebrado, ação ambígua ou loading infinito.

### MVP-10 — Conteúdo comercial fiel ao produto

**Objetivo:** vender apenas o que já existe e pode ser demonstrado.

**Evidência atual (out/2026):** `/pricing` em es-419/es-ES sem texto caindo para o inglês (teste em `test/unit/pricing-currency.unit.test.js`); preço público até 200 colaboradores, acima disso contato comercial. Landing es-419/es-ES agora traduz pilares, como funciona, confiança, comparativo, quem constrói e FAQ (teste de fallback para inglês em `test/unit/product-landing-seo.unit.test.js` cobrindo es, fr, de e pt-PT). Passo 1 do "como funciona" alinhado ao cadastro self-serve em todos os idiomas. Revisão técnica fr/de feita; **pendente revisão por falante nativo** (B-I18N-01).

1. Revisar landpage, preços, FAQ, `llms.txt`, metadados e JSON-LD.
2. Alinhar nomes dos módulos entre site, onboarding, menu e proposta comercial.
3. Remover promessa não entregue e destacar diferenciais comprováveis.
4. Definir CTA único para teste, demonstração ou cadastro.

**Aceite:** toda afirmação pública aponta para uma funcionalidade demonstrável; Google/Meta/IA recebem título, descrição, canonical e dados estruturados coerentes.

### MVP-11 — Suporte e feedback do piloto

**Evidência (05/10/2026):** canal = formulário **Suporte** no painel + e-mail contact@3035tech.com; prazo de primeira resposta = **até 1 dia útil** (fins de semana ignorados; feriados ainda não). Cada registro tem tipo (bug, dúvida, comercial, ideia, UX), severidade, módulo derivado da aba, responsável, primeira resposta, prazo e vínculo de duplicata para agrupar recorrência; a caixa do super admin filtra por esses campos e destaca atrasados. Provas: `test/dtov/product-feedback.dtov.test.js` + HTTP de triagem.

**Objetivo:** transformar problemas dos primeiros clientes em decisões rastreáveis.

1. Definir canal e prazo de resposta.
2. Registrar feedback com contexto, severidade, frequência e módulo.
3. Separar bug, dúvida de uso, pedido comercial e ideia futura.
4. Revisar semanalmente; só promover item para P0/P1 com evidência.

**Aceite:** cada ocorrência tem responsável e retorno; feedback recorrente pode ser agrupado sem depender de memória ou conversa dispersa.

---

## P2 · Depois: somente com evidência

### MVP-12 — Baseline de performance

Executar teste de carga curto quando houver tráfego real ou antes de campanha pública relevante. Medir p50/p95/p99, erros, pool PostgreSQL e queries lentas nos fluxos de vaga, candidatura, avaliação e dashboard.

**Gatilho:** p95 recorrente acima de 700–1.000 ms, espera no pool, timeout, CPU sustentada ou campanha com tráfego previsto.

### MVP-13 — Cache público seletivo

Cachear somente agregações e páginas quentes, com TTL curto e orçamento de memória. Preferir CDN para HTML de vagas; não armazenar todas as vagas no Redis.

**Gatilho:** consultas públicas repetidas aparecem entre os principais custos ou o tráfego começa a afetar o dashboard.

### MVP-14 — Busca e paginação para grande volume

Adicionar trigram/full-text e migrar `OFFSET` público para cursor quando o volume exigir. OpenSearch fica fora até PostgreSQL deixar de atender os requisitos medidos.

**Gatilho:** busca ou páginas profundas ultrapassam o SLO mesmo após índice e revisão da query.

### MVP-15 — Fila e workers

Mover e-mail em massa, relatórios, PDFs, importações e recálculos para jobs idempotentes somente quando essas tarefas afetarem as requisições ou a operação.

**Gatilho:** timeout, retries manuais, cron acumulado ou necessidade de processar lote relevante.

### MVP-16 — Capacidade e infraestrutura avançada

CDN dedicado, autoscaling, PgBouncer/RDS Proxy, réplicas, Redis separado, particionamento e mecanismo externo de busca entram após baseline e projeção comercial.

**Gatilho:** capacidade medida insuficiente para cliente/campanha contratada, não uma hipótese de crescimento.

---

## Explicitamente fora do MVP agora

- Arquitetura para 30 milhões de usuários.
- Microsserviços por módulo.
- Kafka ou event streaming complexo.
- OpenSearch sem evidência de limite no PostgreSQL.
- Redis grande ou dedicado apenas por precaução.
- Particionamento antecipado de tabelas.
- Paridade funcional completa com Sólides ou outra suíte.
- Novo módulo sem problema validado por cliente.

## Ordem executiva sugerida

1. **Semana 1:** inventário e aceite humano de MVP-06; MVP-02 concluído.
2. **Semana 2:** MVP-03 e correções encontradas no fluxo.
3. **Semana 3:** MVP-04 e MVP-05.
4. **Piloto:** MVP-07, MVP-08, MVP-09 e MVP-10 conforme atrito observado.
5. **Após uso real:** MVP-11; avaliar gatilhos de MVP-12–MVP-16.
