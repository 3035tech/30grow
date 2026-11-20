# Validador local de exportações REP-P

O utilitário `scripts/verify-rep-export.mjs` confere um AFD ou AEJ extraído do ZIP e sua assinatura destacada `.p7s`. Os contratos estão implementados diretamente no script e não importam os serializadores de `lib/rep/formats.js`.

```sh
node scripts/verify-rep-export.mjs \
  --format afd \
  --input /caminho/AFD.txt \
  --signature /caminho/AFD.txt.p7s
```

Para AEJ, substitua `afd` por `aej` e informe os caminhos do AEJ. O padrão de confiança usa `lib/rep/icp-brasil-roots.pem`; `--ca /caminho/raizes.pem` permite selecionar outro bundle. `--openssl /caminho/openssl` seleciona o binário, ou pode-se definir `REP_OPENSSL_PATH`.

O script verifica codificação compatível com Latin-1, CRLF, ausência de linhas vazias, versão, comprimentos, CRC e cadeia SHA-256/NSR no AFD, campos/sequência/referências/contadores no AEJ, e a assinatura CAdES destacada via `openssl cms -verify` com validação de cadeia contra as raízes escolhidas.

Ele não lê o A1 nem sua senha, não acessa AWS e não valida revogação em tempo real. A aprovação técnica do utilitário ainda requer execução com arquivos sintéticos, comparação dos bytes e campos contra os PDFs do MTE e validação da assinatura com certificado real. Um resultado positivo não declara conformidade legal nem substitui homologação.

Referências oficiais consultadas em 19/11/2026, ambas atualizadas pelo MTE em 31/07/2026:

- [Leiaute AFD, versão 004](https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/inspecao-do-trabalho/fiscalizacao-do-trabalho/leiaute-do-arquivo-fonte-de-dados-afd.pdf)
- [Leiaute AEJ, versão 002](https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/inspecao-do-trabalho/fiscalizacao-do-trabalho/leiaute-do-arquivo-eletronico-de-jornada-aej.pdf)
- [Perguntas e respostas REP do MTE, questões 49–51](https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/inspecao-do-trabalho/fiscalizacao-do-trabalho/Perguntas%20e%20Respostas%20REP)
