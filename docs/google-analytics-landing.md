# Google Analytics da landing page

Fluxo Web `30grow`, URL `https://30grow.com`, código `16062115611`,
propriedade `548058559`, ID público `G-3NCBE66VM9`.

O componente da landing page carrega `gtag.js` após aceitar métricas.
Registra `page_view` e `landing_cta_click` (`signup`, `pricing`, `contact`).
Cliques são intenção, não cadastros ou leads concluídos.
O botão Cookies no rodapé permite recusar depois; a tag é desabilitada e seus
cookies `_ga` são removidos. A tag também é desabilitada ao sair da landing page.
Não existe integração Google nas áreas de RH, admin ou colaborador.

O fluxo está com medição otimizada desativada no Google, para evitar coleta
automática de formulários, pesquisas, links e mudanças do histórico.
Manter essa configuração ao ajustar o fluxo. URLs enviadas não têm query/hash;
referrer não é enviado. Publicidade e Google Signals ficam desativados no código.
Isso limita a atribuição de campanhas e referências; não há tracking de UTM no GA.

`GOOGLE_ANALYTICS_MEASUREMENT_ID` é lida no servidor em runtime. Quando ausente,
usa o ID acima; definir explicitamente vazio desliga a integração Google.
A CSP padrão permite `www.googletagmanager.com`, `www.google-analytics.com` e
`region1.google-analytics.com`; ambientes com `CSP_POLICY` customizada precisam
preservar essas permissões e o nonce.

A política de privacidade informa o uso do Google e a escolha de métricas.
O analytics interno existente em `/api/analytics/landing` é independente da tag
Google; seus pageviews continuam e não recebem mais a query inteira da URL.

Validação local: `npx playwright test test/e2e/landing-google-analytics.spec.js`
com `ENABLE_CSP=true` e servidor em `127.0.0.1:3010`.
Os testes substituem o script Google e não geram tráfego na propriedade.
Depois do deploy, aceitar métricas em `30grow.com` e conferir Tempo real no GA.
