# Correções de autenticação — 2026-10-06

## Comportamento

- `PATCH /api/admin/users/:id`: alterar o próprio e-mail exige `currentPassword` e, com 2FA ativo, `totpCode`. O limite de reautenticação é de 10 tentativas por conta em 15 minutos. Administradores continuam podendo editar outras contas; gestores de empresa continuam impedidos de trocar o e-mail de outras pessoas. O perfil já oferece o fluxo de reautenticação.
- Desativar 2FA exige senha e TOTP e tem limite de 10 tentativas por conta em 15 minutos. O limite fica no domínio, compartilhado entre web e mobile, sem usar IP na chave. Respostas bloqueadas retornam HTTP 429 e `Retry-After`. O backend de rate limit existente permanece Redis, com fallback em memória por processo.
- Desafios de 2FA para gestores, colaboradores e mobile são registrados no banco, expiram em cinco minutos e são vinculados à versão da sessão. O consumo ocorre somente após TOTP válido, em transação com bloqueio da conta; apenas uma requisição pode consumir cada desafio. A sessão emitida mantém a versão do desafio, evitando aceitar uma revogação ocorrida durante a conclusão do login. Login por link, definição de senha e troca de empresa usam o mesmo contrato.

## Modelagem e implantação

Aplicar `migrations/150_second_factor_challenges.sql` **antes** de iniciar a aplicação atualizada. Os bundles de bootstrap e pgAdmin e o gate de schema incluem a nova tabela.

`second_factor_challenges` representa uma entidade temporária de autenticação com identidade UUID, domínio fechado de finalidade (`CHECK`), versão positiva, validade e chaves estrangeiras. O vínculo composto candidato/empresa garante isolamento no banco. A chave primária garante unicidade; o índice de validade permite limpeza. Não há JSONB, segredos TOTP ou senhas nesta tabela. Desafios consumidos são removidos e expirados são limpos ao emitir novos desafios; o registro não é um histórico de auditoria.

A migration é aditiva e reaplicável, sem modificar contas existentes. O índice composto reaproveita o índice criado pela migration 133. Desafios antigos, sem registro e versão, são rejeitados: o usuário precisa reiniciar o login. Durante um rollout misto, instâncias antigas ainda mantêm o comportamento vulnerável; todas devem ser substituídas. Para rollback operacional, reverter a aplicação e manter a tabela aditiva; voltar ao código antigo reintroduz as falhas. Em ambiente isolado, a remoção da tabela e sua recriação preservaram as contas; não remover o índice compartilhado.

## Verificação

- `npm run test:security`: 61 testes passaram, incluindo 10 novos testes comportamentais de reautenticação, bloqueio, revogação, expiração, consumo único e emissão com versão vinculada.
- `node --test test/unit/mobile-employee-session.unit.test.js`: 3 testes passaram.
- `npm run build`: passou.
- `npm run db:validate-schema:static`: passou com a migration 150 registrada nos artefatos.
- PostgreSQL embarcado PGlite, instalado apenas em diretório temporário: migration aplicada duas vezes; domínio, FKs, preservação das contas, expiração, isolamento, revogação, consumo concorrente único e recriação da tabela verificados. Não houve conexão ou migration no banco da aplicação. O Docker/DTOV local estava indisponível.

## Cloudflare — proteção de borda aplicada em 2026-10-06

Regras publicadas e confirmadas como `Active` no painel da zona `30grow.com`, sem alterar o plano Free:

| Regra | Configuração | Cota utilizada |
| --- | --- | --- |
| `30Grow API - normalize visitor IP headers` | Para `30grow.com` e `www.30grow.com`, caminhos `/api/`: remover `x-forwarded-for` e `x-real-ip` recebidos. O proxy do Cloudflare recria `X-Forwarded-For` com o IP do visitante antes de enviar à origem. | Transform Rules: 1/10 |
| `30Grow - authentication burst protection` | Endpoints específicos de login, recuperação/definição de senha e 2FA (web/mobile): acima de 30 requisições por IP em 10 segundos, bloquear por 10 segundos. Não inclui polling de notificações nem self-fetch de `session-edge`. | Rate limiting: 1/1 |
| `30Grow - block secret files and CMS probes` | Para os dois hosts: bloquear `/.env`, `/.env.*`, `/.git`, `/.git/*`, `/wp-login.php`, `/xmlrpc.php`, `/wp-admin` e `/wp-admin/*`, comparando caminho em minúsculas. | Custom rules: 1/5 |

Validação HTTP após publicação: homepage `200`, `/api/auth/captcha-config` `200`, `/.git/config` `403`. O limiar foi posteriormente verificado com requisições GET anônimas, conforme avaliação externa abaixo. O limite é agregado por IP: escritórios com NAT compartilham a cota. Monitorar eventos antes de reduzi-lo.

A normalização cobre tráfego que passa pelo Cloudflare. Não foi verificado se o firewall/ingress da origem impede acesso direto nem se proxies posteriores preservam o IP recriado; portanto, a proteção completa contra bypass da origem continua dependente dessa configuração.

Referência: [Request Header Transform Rules](https://developers.cloudflare.com/rules/transform/request-header-modification/).


## Avaliação externa controlada — 2026-10-06

Escopo executado: `30grow.com`, sem login, sem credenciais reais, sem alterações de dados, sem varredura de IPs ou força bruta. Este trabalho é uma avaliação limitada de perímetro, não um pentest completo.

| Verificação | Evidência | Resultado |
| --- | --- | --- |
| Transporte | HTTP `/` → 301 para HTTPS; negociação TLS 1.2 → 200; HSTS de 31536000 segundos com includeSubDomains | Proteções observadas |
| APIs administrativas | GET `/api/admin/users`, `/api/admin/employees`, `/api/admin/export` → 401 | Acesso anônimo rejeitado |
| APIs privadas | GET `/api/employee/dp`, `/api/mobile/v1/employee/profile`, `/api/me`, `/api/health/metrics` → 401 | Acesso anônimo rejeitado |
| Cookie inválido | GET `/api/admin/users` com cookies de gestor/colaborador inválidos → 401 | Cookie inválido rejeitado |
| Dashboard | GET `/dashboard` → 307 para `/login?redirect=%2Fdashboard&reason=expired` | Redirecionamento de autenticação |
| Arquivos internos | `/.env`, `/.git/config` → 403; `/sentry.client.config.js.map` → 404 | Nenhuma exposição nas URLs testadas |
| CORS | HEAD `/api/me` com Origin de domínio externo → 401 sem Access-Control-Allow-Origin | Sem reflexão do Origin nessa resposta; fluxos autenticados não avaliados |
| Rate limiting | Primeira rajada de 32 GETs anônimos, em cerca de 5 segundos, com X-Forwarded-For variável → 401. Segunda rajada, limitada a 48 e encerrada em 40 requisições, em cerca de 2 segundos → 32 respostas 401 e 8 respostas 429 | Bloqueio de borda confirmado; não é um limiar de precisão exata |
| Tentativa de contornar o bloqueio | Novo GET com X-Forwarded-For diferente, imediatamente após o bloqueio → 429, Retry-After: 10, Server: cloudflare | A variação do cabeçalho não contornou o bloqueio observado |

### Observação de segurança

A produção envia `Content-Security-Policy-Report-Only`, sem `Content-Security-Policy` de enforcement. Assim, essa camada registra violações mas não bloqueia scripts; a política também permite unsafe-inline e unsafe-eval. Trata-se de oportunidade de endurecimento, sem XSS demonstrado. Ativar enforcement exige validar a compatibilidade do frontend antes da mudança.

### Limites da conclusão

Não foi demonstrado acesso não autorizado nem vazamento nas rotas testadas. Isso não comprova ausência de vulnerabilidades. Isolamento entre empresas, IDOR, permissões por perfil, arquivos privados, recuperação de conta e consumo de desafios 2FA precisam de contas de teste e validação autenticada. Os testes não comprovam que as correções locais e a migration 150 estão implantadas em produção. Bloqueio de acesso direto à origem não foi verificado. TLS 1.3 não foi concluído porque o curl local não oferece suporte à opção; não se inferiu falha no servidor.

Não foram alteradas regras do Cloudflare nesta avaliação. Cabeçalhos e respostas anônimas foram preservados em arquivos temporários `/private/tmp/30grow-pentest-*`.


## Endurecimento complementar — 2026-10-06

### Origem AWS verificada

O DNS proxied de `30grow.com`, `www`, `app` e `api` aponta para `30grow-alb-435691467.us-west-2.elb.amazonaws.com`. A consulta autenticada à AWS confirmou:

- `grow30-alb-sg` (`sg-03e0b41da43189176`): somente TCP/443, com os 15 CIDRs IPv4 e 7 IPv6 da [lista oficial do Cloudflare](https://www.cloudflare.com/ips/), sem entrada mundial ou outros grupos.
- Target group `30grow-web-tg`: destino privado `172.31.44.66:3000`, healthy.
- `grow30-app-sg` (`sg-0d3379388f93d5163`): somente TCP/3000 a partir do security group do ALB, sem CIDRs públicos. A tarefa possui IP público, mas esse grupo não permite acesso direto à aplicação.
- Uma requisição HTTPS direta ao ALB, preservando Host/SNI `30grow.com`, expirou em 15 segundos, compatível com as regras verificadas.

Nenhuma regra AWS de rede precisou ser modificada. Isso verifica a restrição por rede; não é autenticação exclusiva desta zona Cloudflare por certificado cliente.

### CSP com nonce

O proxy gera 128 bits aleatórios por requisição e substitui qualquer `x-nonce` recebido do cliente. Encaminha CSP e nonce ao renderer em todas as respostas Next, incluindo as autenticadas. Scripts do Next, inicialização do tema e JSON-LD usam o nonce. A política padrão remove `unsafe-inline` de script-src e permite `unsafe-eval` somente em desenvolvimento. Mantém estilos inline para compatibilidade e fontes externas específicas de Turnstile, Analytics, YouTube/Vimeo e Sentry; o DSN contribui apenas sua origem HTTPS, sem credenciais. Media/worker suportam os usos existentes.

Validação local com `ENABLE_CSP=true`: login respondeu com CSP de enforcement; seus 19 scripts tinham nonce igual ao cabeçalho; o formulário de recuperação abriu após hidratação. Essa validação não substitui testar LMS e fluxos privados autenticados.

A revisão ECS observada foi `30grow-web:70`, uma tarefa ativa, log group `/ecs/30grow`, e `CSP_REPORT_ONLY=true`. **Enforcement ainda não foi ativado em produção**: primeiro implantar a imagem contendo essas mudanças; depois definir `ENABLE_CSP=true`, remover `CSP_REPORT_ONLY` e deixar `CSP_POLICY` vazio para usar nonce automático. Preservar todas as outras variáveis e secrets. Não habilitar a política antiga antes do novo código, pois ela não permite os SDKs do LMS.

### Limites por conta e monitoramento

- Login gestor: 12 tentativas/15 minutos, além do limite por IP e Turnstile.
- Login colaborador web/mobile: mesma chave normalizada de e-mail, 12 tentativas/15 minutos; alternar IP ou cliente não cria uma nova chave. As novas chaves armazenam SHA-256 em vez do e-mail.
- Login TOTP: 10 tentativas/5 minutos por gestor ou candidato/empresa, no domínio; protege os consumidores web/mobile/troca de empresa. Bloqueios respondem 429 com Retry-After antes de consultar/verificar o segredo.
- INCR e PEXPIRE Redis agora são atômicos. O fallback em memória continua por processo; em múltiplas réplicas, configurar Redis compartilhado é necessário para um limite global.
- Todos os bloqueios geram evento JSON `security.rate_limit_blocked`, com hash da chave, backend e retryAfterSec; a métrica agregada `security.rate_limit_blocked` aparece no endpoint admin `/api/health/metrics`.
- Consulta CloudWatch salva e confirmada: `30Grow-Security-Rate-Limit`, ID `c568be29-70e9-4a93-ad15-6021bb8fbe80`, grupo `/ecs/30grow`. Conta bloqueios em janelas de cinco minutos por backend. Não foi executada nem foram criados alarmes ou métricas pagas. Ela passa a receber os novos eventos após implantar a aplicação.

```text
fields @timestamp, event, backend, retryAfterSec
| filter event = "security.rate_limit_blocked"
| stats count(*) as blockedRequests by bin(5m), backend
```

### Isolamento e limites da validação

A suíte executa handlers reais com fixtures de duas empresas para tentar ler, enviar e remover documentos estrangeiros; também cobre storage estrangeiro, identidades forjadas, sessões revogadas e candidato/empresa incorretos no TOTP. SQL e sessões são substituídos nesses testes unitários: isso não equivale a um pentest autenticado da produção. Contas autorizadas de teste de duas empresas ainda não foram disponibilizadas, portanto essa etapa em produção permanece pendente.


Verificação final desta etapa: `npm run test:security` — 68 aprovados; sessões mobile e troca de empresa — 7 aprovados; `npm run build` — aprovado; `git diff --check` — aprovado. Página de preços com enforcement carregou e expandiu as faixas, sem mensagens de violação CSP nos logs capturados. Requisição contendo x-nonce forjado foi sobrescrita; todos os scripts da resposta tiveram o nonce do cabeçalho. Nenhuma publicação da nova imagem ou mudança de ambiente ECS foi feita nesta etapa.


Polish: políticas CSP organizadas por fonte, nonce lido antes do JSX, respostas de bloqueio e imports padronizados, e script Redis documentado em formato legível. Preservados os limites, as permissões e o comportamento de implantação.
