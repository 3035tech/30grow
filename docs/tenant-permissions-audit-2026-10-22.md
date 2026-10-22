# Isolamento e permissões — prova do beta

Data: 22/10/2026. Versão de referência anterior: `5e7741c6`.

## Resultado e correções

A validação HTTP com PostgreSQL e Redis reais, locais e descartáveis, encontrou duas falhas reproduzíveis. Não foram usadas contas, dados ou tentativas de acesso ofensivo em produção; esta prova não afirma que houve exploração anterior.

1. **Isolamento da fila de ausências do DP:** `GET /api/admin/dp/leave?companyId=<outra empresa>` retornava a outra empresa mesmo para RH/direção. A expansão de `...q` sobrescrevia o `companyId` autorizado pelo wrapper. O ID resolvido da sessão agora é aplicado por último.
2. **Administrador vinculado tratado como global:** `role=admin` com `company_id` preenchido conseguia consultar e alterar candidatos, vagas e cargos de outra empresa, além de substituir a empresa em listagens e exportações de DP. O escopo global agora exige `isSuperAdminPayload`: administrador **sem empresa de origem**. A correção cobre o helper compartilhado, as verificações legadas de dados, a renderização do painel, o endpoint legado de resultados e operações globais de retenção. Administradores vinculados mantêm a gestão dos usuários da própria empresa, mas perdem gestão global de empresas e catálogo global de perguntas. A classificação de papel `isAdminRole` permanece disponível; não equivale a autorização global.

Também foi fechado o caso de administrador vinculado a empresa excluída: sessão existente e novo login passam a ser recusados. Não houve alteração de schema, senha, papel ou vínculo de usuários reais.

## Matriz executada

| Perfil | Própria empresa | Outra empresa | Plataforma |
|---|---|---|---|
| RH e direção | Leitura, criação e exportação autorizadas | IDs, filtros e alterações bloqueados ou limitados à empresa da sessão | Usuários globais, empresas e suporte interno negados |
| Proprietário | Gestão dos usuários da própria empresa | Alteração/exclusão de usuário externo e promoção a admin negadas | Gestão global negada |
| Admin vinculado | Dados e gestão de usuários locais | Acesso e alteração negados; filtros externos ignorados | Empresas, catálogo global e resultados legados negados |
| Gestor restrito ao perfil | Perfil preservado | Dados e exportações negados | Negado |
| Superadministrador sem empresa | Permitido | Permitido, explicitamente | Mantido; exportação global inclui as duas empresas |
| Colaborador | Portal próprio disponível | Ausência de outro colaborador oculta | Cookie do colaborador não abre APIs administrativas |
| Sem sessão | Nenhum dado administrativo | Negado | 400 combinações de rota/método recusadas com 401/403 |

Cobertura positiva e negativa: candidatos e dossiê, DP, remuneração, vagas, cargos, benefícios, avaliações (alteração), usuários, lista de ausências, painel renderizado no servidor e exportações. A matriz usa identificadores existentes e compara o banco antes/depois das tentativas de alteração, em vez de depender somente de códigos de resposta. A criação com empresa forjada é conferida no banco: registro criado apenas na empresa autorizada.

As duas empresas têm registros de pessoa com o **mesmo e-mail pessoal**, IDs e relações independentes. As leituras autenticadas continuam trazendo somente os dados do próprio vínculo; a prova não assume identidade global compartilhada.

Exportações verificadas:

- CSV de avaliações: `company=all` e ID externo não ampliam o escopo do gestor; superadmin pode exportar as duas empresas.
- CSV de ausências do DP: filtro externo não retorna pessoas da outra empresa.
- Analytics JSON e CSV: empresa forjada não muda a resposta da empresa autorizada; comparação do conteúdo JSON com o filtro legítimo.
- Exportação fiscal REP: estabelecimento existente de outra empresa é recusado antes de produzir arquivo. Não é certificação da geração e assinatura fiscal legítima.

Revogação: logout seguido de reutilização do cookie, novo login, desativação do usuário, remoção de capability, troca da empresa no cadastro com JWT antigo, empresa excluída e desligamento do colaborador. O módulo desativado é recusado imediatamente; núcleo/Equipe e o autoatendimento do colaborador seguem seu contrato, e o superadmin não recebe a restrição comercial da empresa.

## Evidências e reprodução

- `test/dtov/tenant-permissions.http.test.js`: 636 verificações HTTP aprovadas, zero falhas. Inventário sem sessão: 161 GET, 123 POST, 63 PATCH, 10 PUT e 43 DELETE, total 400 métodos declarados nas 251 rotas administrativas.
- `test/unit/tenant-scope.unit.test.js`: seis contratos do escopo, permissões de plataforma e gestor restrito.
- Gate de segurança ampliado: 78 testes aprovados, incluindo os seis novos contratos de escopo. Testes focados de proprietário, funil e diálogo: 38 aprovados.
- Regressão offline: 40 verificações aprovadas. Build de produção aprovado.
- Resultado detalhado local: `test-results/tenant-audit/results.json`; log do servidor local no mesmo diretório (artefatos ignorados pelo Git).

```sh
node test/dtov/harness.js up
node test/dtov/harness.js migrate
node test/dtov/harness.js seed
npm run build
TENANT_AUDIT=1 node test/dtov/tenant-permissions.http.test.js
node --experimental-vm-modules --test test/unit/tenant-scope.unit.test.js
```

O teste fixa localhost, porta 3012, banco `enneagram_dtov` na porta 55432 e usuário `dtov`. Cria somente fixtures novas; usa namespace próprio no Redis, SMTP e IA em mock. Encerra o servidor Next ao finalizar; as fixtures ficam no banco descartável para inspeção. Não executar reset/down desse banco enquanto outra validação o estiver usando.

## Pendências separadas e limites

A execução ampliada de `test/unit/*.unit.test.js` teve 528 aprovações e **oito falhas já existentes**. As mesmas oito foram reproduzidas em checkout isolado de `5e7741c6`, antes destas correções:

- Duas falhas de mock desatualizado em `contextual-notifications.unit.test.js` (`getEmployeeProfile`).
- Contrato antigo de botão desabilitado em `employee-company-switch.unit.test.js`; o formulário agora valida no envio.
- Metadados de ajuda ausentes para `digital-certificate`.
- Paridade de chaves de preço entre catálogos e duas expectativas regionais de textos antigos.
- Uso de status HTTP literal na rota móvel de recibos.

Não foram ocultadas, desativadas nem corrigidas como parte desta entrega. Devem ser tratadas antes de declarar a suíte geral totalmente verde.

Há 107 rotas que ainda usam guards legados. Todas as operações administrativas declaradas foram testadas sem sessão; isso não transforma cada combinação de módulo, relação, filtro e papel em uma prova exaustiva. A matriz autenticada acima cobre as superfícies e os cenários descritos. Não equivale a pentest externo, auditoria integral de todos os módulos, RLS no PostgreSQL nem validação de arquivos privados por conteúdo. Primeiro acesso assistido, e-mails, backup/restore, leitor de tela e aparelhos físicos continuam nos demais critérios do beta.

Rollback da imagem não exige reversão de dados/migration, mas reintroduziria os dois defeitos de autorização; preferir correção para frente. As sessões são hidratadas com a linha atual do usuário, sem criar tokens globais ou elevar privilégios para realizar esta validação.

## Atualização — resolução das oito falhas anteriores

Os oito itens da seção anterior foram corrigidos na sequência desta auditoria. A suíte geral agora executa **539 testes com zero falhas**, incluindo três novas provas de locale das notificações, ajuda de certificado e marcadores de preço. O gate de segurança mantém 78 aprovações e a regressão offline, 40.

- Notificações: mocks do perfil/locale atualizados; consultas de perfil e notificações continuam vinculadas ao colaborador autenticado, e entradas inválidas não consultam os dados.
- Troca de empresa: o teste de credenciais verifica obrigatórios no envio, em conformidade com o formulário atual; não exige mais a implementação antiga de botão desabilitado.
- Certificado digital: ajuda contextual, artigo próprio no Guia e fonte do assistente, com título, propósito e três passos nos quatro catálogos completos.
- Idiomas: preços completados em inglês/francês/alemão; completadas também as 251 chaves ausentes em cada catálogo francês/alemão. Valores de cobrança não foram alterados. As traduções incrementais preservam os marcadores e os textos já existentes; os novos textos comerciais e termos de posicionamento foram conferidos.
- Expectativas regionais: alinhadas ao plano e aos textos públicos atuais, preservando as diferenças entre Portugal, Espanha e América Latina.
- Recibos móveis: status interno usa `HTTP_STATUS.INTERNAL_SERVER_ERROR`.

Não foram removidos ou desativados testes para obter este resultado. `npm run test:unit` foi incluído no CI e no build Docker, para que a suíte geral também bloqueie futuras publicações. A paridade de chaves continua exigida e ganhou verificação dos marcadores dos textos comerciais. Esta atualização encerra as oito pendências registradas acima; os demais limites de cobertura da auditoria de isolamento continuam válidos.
