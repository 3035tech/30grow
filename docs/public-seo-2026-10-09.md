# SEO público do 30Grow — 9 de outubro de 2026

O Search Console confirmou que a raiz `https://30grow.com/` estava excluída como “Alternate page with proper canonical tag”: o HTML apontava para `https://app.30grow.com/`, escolhido também pelo Google. O sitemap era lido com sucesso, mas publicava URLs do domínio do aplicativo.

## Estrutura entregue

- Canonical público, robots, sitemap e dados estruturados usam `https://30grow.com`. Aliases de marketing em `app.30grow.com` e `www.30grow.com` redirecionam para esse endereço.
- Sete variantes regionais em cinco idiomas, com 56 URLs de marketing: home, preços e seis soluções por variante. Português brasileiro na raiz; demais prefixos `/pt-pt`, `/en`, `/es`, `/es-es`, `/fr`, `/de`.
- As 42 páginas de soluções têm títulos, descrições, H1, texto visível, funcionalidades reais, links relacionados e breadcrumb. Cobrem recrutamento/ATS, Eneagrama/Motivadores, desempenho/clima, onboarding/LMS, Departamento Pessoal e organograma.
- Idioma público determinado pela URL, sem alterar o conteúdo conforme cookies ou Accept-Language. Links de idioma levam à tradução da mesma solução. `?lang=` legado redireciona preservando parâmetros de campanha.
- Hreflang recíproco e `x-default` brasileiro. Espanhol latino usa `es`, pois o Google não aceita a região numérica `419` em hreflang. O idioma interno/documental pode continuar `es-419`.
- Sitemap inclui todas as traduções reais e usa data estável de revisão para conteúdo de código. Blog permanece em português, sem anunciar traduções inexistentes.
- Páginas privadas e URLs com tokens recebem proteção de indexação. Prefixos de idioma não criam aliases de APIs ou dashboards.

## Compatibilidade e configuração

Somente `NEXT_PUBLIC_SITE_URL=https://30grow.com` define a origem pública. `APP_URL` e `NEXT_PUBLIC_APP_URL` permanecem `https://app.30grow.com`, preservando links de e-mail, ativação, recuperação e acesso. O fallback público reconhece o antigo domínio de produção sem alterar ambientes locais ou de staging. Não há migrations ou alterações de preços nesta entrega.

O Dockerfile e o workflow de imagem fixam ambas as origens separadamente. `GOOGLE_SITE_VERIFICATION` opcional acrescenta a meta tag de verificação; a propriedade de domínio existente no Search Console já está verificada.

## Validação

- Build de produção local concluído.
- Segurança: 68 testes aprovados.
- Grupo final de SEO, URLs, negociação de idioma, preços e páginas legais: 31 testes aprovados.
- `node scripts/validate-public-seo.mjs http://127.0.0.1:3032`: 56 páginas com idioma, canonical, hreflang, H1 e JSON-LD; sitemap, robots, redirects legados e proteção privada aprovados.
- Navegador: página de solução e troca para inglês/francês aprovadas, sem erros de console. Página brasileira de recrutamento conferida no domínio publicado.
- Primeira publicação `30grow-web:91` estabilizada; as 56 URLs passaram também em `https://30grow.com`.
- Revisão final 92: servidor standalone da imagem e domínio público passaram na validação das 56 URLs, sitemap, hreflang, redirects e proteção privada. Raízes `app.30grow.com` e `www.30grow.com` retornam 308 para `https://30grow.com/`; login e ativação/recuperação em `app.30grow.com` continuam 200 sem redirecionamento, com noindex.
- Teste adicional com `Host` e `x-forwarded-host`: redirecionamentos de marketing aprovados; ativação/recuperação preservadas. O ALB/Next standalone expõe o host do container em `nextUrl`, exigindo usar o cabeçalho público na allowlist.
- `git diff --check` aprovado.

## Publicação

Versão anterior do serviço: `30grow-web:90`, imagem `grow30-app:07987177a81d-95`. Imagem preparada: `grow30-app:seo-20261009-07987177`. Serviço ECS: `30grow-prod/30grow-web`, região `us-west-2`.

A revisão 91 foi publicada e estabilizou com uma tarefa saudável. Ajuste final dos aliases publicado como revisão 92, imagem `grow30-app:seo-20261009-host-fix`, digest `sha256:82b4394734ef441c0d9fb2f067ffc2005b23fffc3df4529e80854c3ef46bef95`. Estabilidade confirmada pelo waiter AWS `ecs wait services-stable` com saída 0. Rollback técnico: `aws ecs update-service --region us-west-2 --cluster 30grow-prod --service 30grow-web --task-definition 30grow-web:90` e aguardar `services-stable` (restaura a configuração anterior com o problema de canonical).

Search Console, 9 de outubro: teste ao vivo confirmou “URL is available to Google” e “Page can be indexed”. Pedido de indexação da raiz aceito, com inclusão na fila prioritária de rastreamento. Sitemap `https://30grow.com/sitemap.xml` reenviado e confirmado como “Sitemap submitted successfully”. O contador anterior de 17 páginas ainda aguardava nova leitura; não representa o sitemap atual. Evidências: [indexação solicitada](seo-proof-2026-10-09/30grow-indexing-requested.jpg), [sitemap enviado](seo-proof-2026-10-09/30grow-sitemap-submitted.jpg).

## Limites de resultado

Solicitar indexação e enviar sitemap permite ao Google descobrir e reavaliar as páginas; não garante prazo, posição ou sitelinks. A estrutura remove a causa técnica comprovada e disponibiliza conteúdo localizado pesquisável. Acompanhar indexação e consultas brasileiras na propriedade `30grow.com`.

Referências: [versões localizadas](https://developers.google.com/search/docs/specialty/international/localized-versions), [sites multirregionais](https://developers.google.com/search/docs/specialty/international/managing-multi-regional-sites), [sitelinks](https://developers.google.com/search/docs/appearance/sitelinks).
