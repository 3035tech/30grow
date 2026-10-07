# Paridade do portal do colaborador com a API mobile

## Contratos adicionados

Todos os caminhos abaixo têm prefixo `/api/mobile/v1`.

| Método e caminho | Entrada / resposta |
| --- | --- |
| `PATCH /employee/profile` | Aceita também `preferredLocale`: `pt-BR`, `pt-PT`, `en`, `es-419`, `es-ES`, `fr-FR` ou `de-DE`. Outros campos já existentes continuam disponíveis. |
| `GET /employee/home` | Acrescenta `locale`, `showWelcome` e `companyModules`. `?locale=` sobrescreve o idioma somente nesta leitura; sem parâmetro, usa a preferência persistida. |
| `POST /employee/home` | `{ "action": "dismissWelcome" }`; retorna `{ "ok": true, "showWelcome": false }`. Idempotente, com identidade e empresa do bearer. |
| `POST /auth/magic-link` | `{ "email": "...", "locale": "en", "turnstileToken": "..." }`; `companySlug` opcional. Resposta uniforme `{ "ok": true }`, inclusive sem vínculo ou sem envio. |
| `POST /auth/magic-link/exchange` | `{ "token": "..." }`; retorna o contrato existente de autenticação mobile ou `requires_second_factor` com `challengeToken`. |

`companyModules: null` mantém a semântica do portal: todos os módulos disponíveis para empresas sem configuração explícita. Uma lista representa os módulos configurados. Esse campo orienta a navegação; não substitui autorização no servidor.

A sessão devolvida no login, refresh e troca de empresa agora utiliza o idioma persistido do colaborador, com fallback `pt-BR`. Não é necessário novo login para a home ler a preferência alterada.

## Login por link e integração do aplicativo

O envio reutiliza os e-mails existentes, com URL HTTPS `/employee/enter?token=...`. O token é de uso único e expira segundo a política existente. A troca mobile deve ocorrer antes de consumir o mesmo token no portal web. O aplicativo deve capturar o link pelo mecanismo de universal/app links ou receber o token de seu fluxo de abertura e chamar `/auth/magic-link/exchange`; estes endpoints não modificam a associação de links nem as telas do aplicativo nativo.

Se Turnstile estiver configurado, a solicitação exige token válido obtido pelo widget, usando a configuração pública existente em `/api/auth/captcha-config`. Não há bypass de CAPTCHA. A troca do token de e-mail é protegida por limite de tentativas, uso único e 2FA quando habilitado. Um link concede somente o vínculo empresa/colaborador autenticado por ele, sem ampliar contextos por coincidência de e-mail.

As respostas novas de sucesso e erro não permitem cache (`Cache-Control: no-store`). Respostas de limite de tentativas informam `Retry-After`. A home preserva o código de erro de domínio, distinguindo falta de autorização de falhas operacionais.

## Validação

Regressões em `test/unit/mobile-parity-gaps.unit.test.js` cobrem idioma na edição/login/refresh, validação de entradas, empresa autenticada, boas-vindas, CAPTCHA, limites e a exigência de 2FA antes de emitir sessão por link. `test/unit/mobile-home-company.unit.test.js` cobre módulos e idioma na home.

Sem alteração de schema, migration ou dados de produção. Integração visual no app e entrega de e-mail real exigem validação posterior no aplicativo e ambiente configurado.
