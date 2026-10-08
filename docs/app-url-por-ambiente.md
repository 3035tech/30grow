# URL do app por ambiente

Os links enviados pelo servidor usam `APP_URL`, lida em execução. Não usar a URL
da landing (`NEXT_PUBLIC_SITE_URL`) para convites ou recuperação de senha.

| Ambiente | APP_URL |
| --- | --- |
| Homologação — Dublin | `https://team.3035service.com` |
| Produção | `https://app.30grow.com` |

`NEXT_PUBLIC_APP_URL` permanece como fallback legado para permitir implantação
gradual. Essa variável é incorporada pelo Next.js no build; não é adequada para
selecionar o domínio dos e-mails de uma imagem compartilhada entre ambientes.

## Implantação

1. Definir `APP_URL` no ambiente antes de implantar a imagem corrigida. Em Dublin,
   a configuração está em `gitops/dublin/grow30/helm-values.yaml`; na AWS, usar a
   configuração de ambiente do serviço de produção.
2. Implantar o código corrigido e aguardar o rollout dos pods/containers.
3. Enviar um convite para uma conta de teste em cada ambiente e conferir o host
   do link, a abertura do desafio e a identidade do candidato. Validar também
   recuperação de senha e convites do colaborador.
4. Reenviar os convites de homologação que foram enviados com domínio de produção.
   O ajuste não modifica os e-mails já entregues nem move tokens entre bases.

Não alterar o TTL ou reativar links cancelados para corrigir um domínio errado.
A diferença entre validade do convite (30 dias) e link da vaga (7 dias) continua
uma questão separada.

## Rollback

Reimplantar a imagem anterior preservando as variáveis existentes. Ela ignora
`APP_URL` e mantém o comportamento legado; portanto, em homologação pode voltar
a gerar links para produção. Não remover dados, convites ou variáveis antigas
durante a transição.

## Validação local

`node --test test/unit/app-url.unit.test.js test/unit/lms-overdue-notifications.unit.test.js`

O teste troca a URL com os módulos já carregados, verifica o endereço nos e-mails
e preserva o fallback legado. Não envia e-mails reais nem consulta produção.
