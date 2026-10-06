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

Validação HTTP após publicação: homepage `200`, `/api/auth/captcha-config` `200`, `/.git/config` `403`. Não foi provocado excesso de logins em produção para testar o limiar. O limite é agregado por IP: escritórios com NAT compartilham a cota. Monitorar eventos antes de reduzi-lo.

A normalização cobre tráfego que passa pelo Cloudflare. Não foi verificado se o firewall/ingress da origem impede acesso direto nem se proxies posteriores preservam o IP recriado; portanto, a proteção completa contra bypass da origem continua dependente dessa configuração.

Referência: [Request Header Transform Rules](https://developers.cloudflare.com/rules/transform/request-header-modification/).
