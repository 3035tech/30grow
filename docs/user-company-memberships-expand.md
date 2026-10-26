# Employer multiempresa: fase expand

## Sessões mobile revogáveis

A migração `116_mobile_refresh_sessions.sql` adiciona refresh tokens opacos e rotativos. Apenas hashes SHA-256 são persistidos; replay de token rotacionado e logout revogam a família. Access tokens novos carregam o identificador da família e são revalidados no primário. Tokens do gate anterior, sem família, mantêm compatibilidade somente até a expiração de 15 minutos.

Os endpoints `POST /api/mobile/v1/session/refresh` e `POST /api/mobile/v1/session/logout` completam o ciclo. A troca de empresa exige o refresh token atual e o rotaciona junto com o contexto.

A migration `115_user_company_memberships.sql` adiciona a base reversível para uma identidade gestora atuar em mais de uma empresa.

## Escopo desta fase

- cria `user_company_memberships`;
- preserva role, active e deleted no backfill inicial;
- permite roles diferentes por empresa;
- adiciona índices para lookup por usuário e por empresa;
- não muda login, JWT, autorização, APIs ou dashboard;
- mantém `users.company_id` e `users.role` como fonte de verdade.

Super admins sem `company_id` não recebem membership no backfill. Isso preserva o comportamento global atual.

## Aplicação

```bash
npm run db:migrate
```

A migration é idempotente. O backfill usa `ON CONFLICT DO NOTHING` para que uma repetição futura não sobrescreva estado mais novo do membership.

## Verificação

```bash
npm run dtov:reset
node --test test/unit/user-company-memberships.unit.test.js
# Exporte exatamente as variáveis DTOV impressas pelo reset antes do teste SQL.
node test/dtov/user-company-memberships.dtov.test.js
npm run dtov:down
```

Nunca executar a prova SQL contra o banco de desenvolvimento ou produção.

O teste comprova paridade com usuários legados, ausência de duplicidade, segundo membership com role diferente, repetição segura do backfill e preservação das colunas atuais.

## Rollback

Enquanto nenhum writer novo usar a tabela, o rollback é:

```sql
DROP TABLE IF EXISTS user_company_memberships;
DELETE FROM schema_migrations
WHERE name = '115_user_company_memberships.sql';
```

Executar somente após confirmar que nenhum endpoint ou job passou a gravar memberships. Depois que dual-write começar, não remover a tabela; desativar os novos readers/writers e preservar os dados para reconciliação.

## Próxima fase, não incluída

O primeiro incremento de dual-write adicionou:

- serviço canônico `lib/identity/user-company-memberships.js`;
- helper transacional compartilhado em `lib/db.js`;
- sincronização atômica no CRUD administrativo de gestores;
- aposentadoria do membership legado anterior quando um admin reatribui a empresa;
- desativação de todos os memberships quando a identidade legada é desativada.

O segundo incremento também protege:

- criação atômica de empresa, usuário pendente e membership no signup self-service;
- ativação atômica do usuário e membership ao concluir a definição de senha;
- recriação idempotente do membership caso um usuário legado conclua um convite sem vínculo migrado.

O primeiro reader multiempresa é isolado na fachada `/api/mobile/v1`:

- `POST /auth/login`: somente gestores employer já cadastrados e ativos;
- `POST /auth/2fa/verify`: challenge separado e limitado ao canal mobile;
- `POST /session/company/select`: seleção inicial por `membershipId`;
- `GET /session`: revalidação live de identidade, session version, membership e empresa;
- `POST /session/company/switch`: troca sem nova senha, sempre validada no servidor.

O app não possui self-signup. O `/signup` web continua separado e existe apenas para o fluxo web já estabelecido.

Access tokens mobile duram 15 minutos, têm issuer, audience e purpose próprios e nunca aceitam `companyId` do cliente como autorização. A resposta lista no máximo 100 memberships ativos, em uma query indexada, e calcula capabilities no servidor. Todas as respostas de sessão usam `Cache-Control: no-store`.

Refresh rotativo e logout remoto ainda não estão habilitados; são o próximo gate. Até lá, o contrato não anuncia refresh token. Login e sessão web continuam exclusivamente em `users.company_id` e `users.role`.

## Rollback do dual-write administrativo

1. reverter os call sites em `lib/identity/users-admin.js`, `app/api/auth/signup/route.js` e `lib/identity/user-password-invite.js` para gravar somente `users`;
2. remover o roteamento `/api/mobile/v1` e `lib/mobile-manager-session.js` sem alterar a sessão web;
3. manter a tabela e os dados de membership para reconciliação;
4. não remover `lib/identity/user-company-memberships.js` enquanto houver outro consumidor;
5. confirmar que login e autorização web continuam baseados em `users.company_id` e `users.role`.
