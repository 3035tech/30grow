# Correção do parser de seletores — 24/10/2026

O alerta GHSA-rj75-hqrm-r3gf afeta o parser transitivo usado por Tailwind 3 e
postcss-nested. O override fixa `postcss-selector-parser` em 7.1.6, versão
corrigida, preservando Tailwind 3.4.19 e sua configuração atual.

Esta é uma exceção controlada à recomendação de evitar mudanças de major em
dependências transitivas. A versão 7 muda o comportamento de inserções durante
iterações; a compatibilidade foi conferida nos usos efetivos deste projeto.
Não se trata de afirmar compatibilidade universal entre as versões 6 e 7.

## Evidência antes e depois

- CSS completo gerado com a configuração e os arquivos do projeto: idêntico,
  130.700 caracteres, SHA-256
  `2913d3a467427bc411b40d6ecd3b602fbd7fb4af59080ddbbab63181329d732d`.
- 1.844 seletores do CSS gerado e dos arquivos CSS da aplicação: saída idêntica
  entre os parsers 6.1.4 e 7.1.6.
- 12 cenários de nesting comparados entre os mesmos plugins usando cada parser:
  saída idêntica, incluindo listas, combinadores, pseudo-elementos, media,
  supports, atributos, escapes e múltiplos níveis de `&`.
- `npm audit`: zero vulnerabilidades, incluindo dependências de desenvolvimento.
- Build de produção concluído com o parser corrigido.

Os artefatos temporários dessa comparação ficaram em
`/private/tmp/30grow-css-compat-proof.json` e
`/private/tmp/30grow-tailwind-{before,after}.css` durante a execução.
O hash registra esta fotografia; não é uma restrição para alterações futuras.

## Retorno de versão e manutenção

Reverter o override e o lockfile restaura o parser anterior, mas também restaura
o alerta de segurança. Não há mudança de dados nem migration. A migração para
Tailwind 4 continua sendo um trabalho separado, com revisão visual própria.
Dependabot e os gates de build/interface devem acompanhar mudanças na cadeia.

Fontes: [advisory](https://github.com/advisories/GHSA-rj75-hqrm-r3gf) e
[mudança de major](https://github.com/postcss/postcss-selector-parser/releases/tag/v7.0.0).
