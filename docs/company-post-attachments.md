# Anexos de avisos

## Escopo

O painel de Mural e reconhecimento permite adicionar e remover anexos dos avisos.
O portal web do colaborador exibe fotos e links de download. A API mobile inclui
metadados e uma rota autenticada de download; a interface nativa ainda não os renderiza.

São permitidos até cinco arquivos ativos por aviso, de até 10 MB cada: JPEG,
PNG, WebP, PDF, texto UTF-8, DOCX, XLSX e PPTX. O servidor verifica o conteúdo,
além da extensão. HTML, SVG e documentos com macros não são permitidos.

## Modelagem e isolamento

A migration 170 cria uma tabela relacional, pois cada anexo tem identidade,
autor, tamanho, tipo, data e ciclo de remoção próprios. A chave estrangeira
composta `(company_id, post_id)` impede associar arquivos ao aviso de outra
empresa. A unicidade de `(company_id, post_id, upload_id)` torna repetições do
mesmo upload idempotentes. Um índice parcial atende os anexos ativos por aviso.

Os objetos são privados no S3. As respostas públicas da API não contêm chaves
de armazenamento. Cada leitura valida sessão, empresa, módulo e aviso ativo.
A prévia inline é limitada às imagens raster aceitas; os demais tipos usam
download, com `nosniff` e cache privado desabilitado.

## Falhas e remoção

O aviso é salvo antes dos uploads. Se algum arquivo falhar, o aviso já estará
publicado; o editor informa essa condição e mantém os arquivos pendentes para
nova tentativa, sem recriar o aviso. Uploads concluídos permanecem associados.
O limite é conferido sob bloqueio do aviso, incluindo uploads concorrentes.

Remover um anexo marca seus metadados como excluídos e interrompe o acesso.
O objeto original é retido; esta entrega não cria política de expurgo físico.
Objetos novos sem vínculo são removidos quando a falha pode ser confirmada.
Se o resultado do commit for desconhecido e o banco estiver indisponível,
o objeto é preservado para não apagar um arquivo possivelmente vinculado.

## Publicação e retorno de versão

Aplicar a migration 170 antes de publicar o código. Ela é aditiva e não altera
o texto dos avisos existentes. O roteiro operacional preparado confere a
preservação dos avisos antes e depois e registra `schema_migrations`.
Foi verificada a reaplicação da migration no PostgreSQL local.

Para retornar à versão anterior, manter a tabela e os objetos: o código antigo
continua lendo os avisos, ignorando os anexos. Não remover a tabela como parte
do rollback, pois isso destruiria os vínculos dos arquivos já publicados.

## Evidência local

- Build de produção concluído.
- 560 testes unitários e seis casos de integração dos anexos passaram.
- Dois testes de interface passaram, incluindo falha parcial e nova tentativa.
- 668 verificações HTTP de permissões passaram, incluindo acessos cruzados.

As migrations 170 e 171 foram conferidas e registradas em Dublin (`team`) e
produção (`grow30`) em 24/10/2026. Em Dublin, a aplicação transacional conferiu
a preservação integral dos cinco avisos e 18 kudos existentes. Em produção,
o operador executou o SQL e a conferência posterior validou tabelas, restrições
e permissões de `grow30_app`; o registro foi completado em `schema_migrations`.

## Identidade gerenciada e armazenamento real

Em 24/10/2026, o preflight de produção identificou que o backend exigia chaves
permanentes mesmo com uma task role ECS válida. O adaptador passa a aceitar o
provedor renovável do SDK quando o ambiente fornece identidade ECS ou EKS.
Endpoints S3 compatíveis continuam exigindo credenciais explícitas completas;
um bucket isolado ou um perfil AWS local não habilita o armazenamento.

A política `30grow-s3-object-storage` da role `30grow-ecs-task` recebeu acesso
Get/Put/Delete em `companies/*/company-posts/*`, preservando os recursos anteriores.
O gerador `scripts/render-s3-iam-policy.mjs` contém a mesma regra.

Um task de preflight executou o adaptador corrigido com a role real: gravou e
leu os mesmos bytes de um arquivo fictício, confirmou HTTP 403 sem autenticação
e removeu o objeto ao final. Não foram criados avisos nem enviados comunicados.
Esse teste comprova a conexão privada com S3; upload, visualização e remoção pela
interface publicada permanecem como aceitação separada após a publicação.

## Cliente nativo — 25/10/2026

No repositório `30-team-app`, branch `feat/community-files-reactions`, o mural passa a exibir anexos, visualizar fotos sob demanda e compartilhar arquivos pelo mecanismo nativo existente. Downloads usam a fachada bearer e cache privado; URLs recebidas no payload não são utilizadas. Lint, TypeScript e 328 testes passaram. Validação em aparelhos e distribuição permanecem pendentes; consulte `docs/community-files-reactions.md` no app. Sem migration ou dependência nova.
