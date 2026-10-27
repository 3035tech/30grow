# Indexação — revisão de 26/10/2026

## Evidência e decisão

Search Console: 57 URLs indexadas e 36 excluídas. Das excluídas, dez são favicons/manifesto; três são acessos bloqueados; oito redirecionam; uma é privacidade alternativa. Sete soluções regionais tiveram canonical diferente da declarada e sete páginas estavam descobertas sem rastreamento.

A inspeção confirmou que Google escolheu `/es/solutions/reclutamiento` para a URL `/es-es/solutions/reclutamiento` e `/solucoes/departamento-pessoal` para `/pt-pt/solucoes/departamento-pessoal`. O acesso e a indexação estavam permitidos. `lib/marketing/public-solutions.js` compartilha títulos e conteúdo por idioma, sem diferenciação regional nessas soluções.

As seis soluções pt-PT consolidam em pt-BR; as seis es-ES consolidam em es-419. Metadata, Open Graph e JSON-LD usam a URL preferida; o sitemap deixa de listar as doze duplicatas como URLs principais. As rotas regionais e seus alternates hreflang permanecem disponíveis. Home e preços continuam com canonical regional próprio.

Se as soluções ganharem conteúdo específico de país no futuro, revisar a consolidação e os testes antes de voltar a listar essas versões como canônicas. Reverter os cinco arquivos de código/teste desta mudança restaura a política anterior, sem migration ou alteração de URLs.

## Validação

- Testes `public-marketing-seo.unit.test.js` e `product-landing-seo.unit.test.js`: 10 aprovados.
- ESLint dos cinco arquivos alterados: aprovado.
- Nenhuma mudança em robots de login, arquivos técnicos ou autenticação.

## Publicação e acompanhamento

Código publicado na `main` no commit `3a7b5396`; a validação no ambiente publicado ainda está pendente. Conferir canonical/JSON-LD das duas URLs inspecionadas, sitemap sem as duplicatas como loc e alternates recíprocos. Pedir nova leitura das URLs canônicas prioritárias e acompanhar o Search Console. A contagem pode continuar incluindo duplicatas excluídas; isso é esperado. Indexação e prazo dependem do Google.
