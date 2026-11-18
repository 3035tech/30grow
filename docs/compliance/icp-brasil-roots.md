# Raízes ICP-Brasil usadas pelo REP-P

`lib/rep/icp-brasil-roots.pem` contém somente certificados raiz autoassinados
v4, v5, v6, v7, v12 e v13 da ICP-Brasil. As versões v8 e v9 foram revogadas;
v10 é destinada a SSL e v11 a assinatura de código, por isso não entram no
conjunto de confiança usado para assinar documentos do REP-P.

Fontes oficiais do ITI:

- [Repositório AC-Raiz](https://www.gov.br/iti/pt-br/assuntos/repositorio/repositorio-ac-raiz)
- [Arquivo único da cadeia ICP-Brasil e hash SHA-512](https://www.gov.br/iti/pt-br/assuntos/repositorio/certificados-das-acs-da-icp-brasil-arquivo-unico-compactado)

O arquivo único baixado em 18/11/2026 teve o SHA-512 conferido com o publicado
pelo ITI: `49c27502474199cff376f180356b45263e69dd29a1c905b53bf0cd34f6aae18944d3d32925eb76d761f0a4d4897e7ff7983966f213dc90e3c2f19fd33ae73040`.
As raízes v4 e v13 foram obtidas diretamente dos links oficiais do repositório
AC-Raiz. O bundle local contém apenas raízes autoassinadas, não certificados
intermediários; o A1 deve fornecer a cadeia intermediária correspondente.

O container executa OpenSSL 3 e a imagem copia `lib/` para o runtime. Em
produção, configure `REP_SIGNING_CA_PATH=/app/lib/rep/icp-brasil-roots.pem`.
Atualize o bundle a partir das fontes oficiais do ITI e confira o SHA-512 antes
de substituir os arquivos quando houver novas raízes ou revogações.
