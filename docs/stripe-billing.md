# Stripe Billing no 30Grow

O checkout, os retornos, webhooks e o portal estão implementados. Ativar um ambiente exige a migração 166, as credenciais desse ambiente, o catálogo Stripe e a configuração do endpoint público. Nenhum desses passos faz cobrança retroativa.

## Condições comerciais

| Chave | Preço | Capacidade |
|---|---:|---:|
| `brl_small_monthly` | R$ 149/mês | 20 colaboradores ativos |
| `brl_growing_monthly` | R$ 249/mês | 50 |
| `brl_medium_monthly` | R$ 399/mês | 100 |
| `brl_small_annual` | R$ 1.490/ano, antecipado | 20 |
| `usd_company_monthly` | US$ 39/mês | oferta internacional atual, sem faixas |
| oferta `brl_launch_monthly` | R$ 99/mês por 12 meses; depois R$ 149 | 20 |

Novas empresas self-service têm 30 dias de teste sem cartão desde o cadastro. Contratar antes do vencimento preserva o prazo restante. Checkout exige pelo menos 48 horas de trial: uma contratação nas últimas 48 horas recebe até dois dias extras, sem antecipar a cobrança. O cliente vê data e valor no Stripe antes de confirmar.

A oferta de lançamento é exclusiva do mensal inicial. As 20 vagas são controladas transacionalmente e separadas por modo Stripe. Checkouts abertos reservam a vaga por até 24 horas. Antes de recuperar uma reserva expirada, o servidor verifica no Stripe se houve conclusão, protegendo pagamentos com webhook atrasado. Uma vaga já usada não volta para a campanha quando a empresa cancela.

A oferta usa um preço de R$ 99 e uma Subscription Schedule: a primeira fase termina 12 meses de calendário após o fim do trial (ou início pago); depois o preço passa para R$ 149 e a assinatura continua. Assim o trial não consome um dos 12 meses da oferta e a transição ocorre no próprio Stripe, mesmo com webhook atrasado.

## Modelagem e licença

- `company_licenses` continua sendo a identidade da licença: mesmo número e prazo original preservados. Não se grava status financeiro em texto livre ou JSON.
- `company_billing_terms`: uma política de acesso e fim do trial por empresa. A migration preserva todas as empresas existentes como legadas; novas empresas self-service são gerenciadas comercialmente.
- `company_billing_accounts`: cliente, assinatura, preço, situação e intenção durável de checkout por empresa e modo (`livemode`). Unicidade dos IDs impede a associação de um cliente ou assinatura a duas empresas.
- `billing_launch_redemptions`: relacionamento com a empresa, vaga única de 1 a 20 por modo, reserva e assinatura confirmada.
- `billing_webhook_events`: somente IDs, tipos e datas para deduplicação. Não guarda cartões, payloads completos ou dados de pagamento sensíveis.

`GET /api/me` e a tela de cobrança usam `licenseWithBilling`. A licença no perfil mostra a situação da assinatura e o período atual; o vencimento original permanece visível como histórico. Não se substitui nem estende destrutivamente `company_licenses.expires_at` a cada fatura. O resumo visual não autoriza acesso: o servidor usa `billingAccess`.

## Fluxos e endpoints

- `GET /api/admin/billing`: estado, planos elegíveis, licença e últimas 12 faturas.
- `GET /api/admin/billing/config`: prontidão e contadores para administrador da plataforma.
- `POST /api/admin/billing/checkout`: inicia ou retoma checkout. Preço vem do catálogo do servidor, nunca de valor enviado pelo navegador. Identidade do cliente e intenção têm idempotência persistida para tolerar timeout.
- `POST /api/admin/billing/confirm`: reconcilia o retorno do checkout. Verifica sessão, empresa, cliente e modo antes de consultar a assinatura no Stripe. Não confia em parâmetros de sucesso do navegador.
- `POST /api/admin/billing/portal`: cartões, faturas e gerenciamento. Trocas normais de plano passam por confirmação hospedada no Stripe, com rateio exibido e apenas o preço validado por capacidade e moeda. O portal geral não oferece preços arbitrários.
- `POST /api/admin/billing/cancel`: cancela no fim do período ou remove o cancelamento, após confirmação no Grow. Suporta a oferta programada, que o portal Stripe não consegue cancelar. O trial não gera cobrança ao cancelar antes do fim.
- `POST /api/webhooks/stripe`: público, assinado com `STRIPE_WEBHOOK_SECRET`, corpo bruto. Só responde sucesso após commit. Falha transitória responde 503 para nova entrega. Eventos duplicados não repetem o efeito; eventos antigos reconciliam o estado atual no Stripe sob lock da conta.
- `/dashboard/billing/return`: confirmação visível e retorno a Perfil → Assinatura.

Somente o dono da empresa (identidade canônica `companies.signup_creator_user_id`) pode consultar licença, cobrança, faturas e avisos de inadimplência ou gerenciar a assinatura. Ter papel admin, direção ou RH não concede esse acesso. O superadministrador da plataforma mantém acesso operacional global. Não-admin usa sempre a empresa da sessão, independentemente do `companyId` recebido. POSTs exigem `Origin` igual ao `APP_URL` configurado, inclusive atrás do proxy.

A troca de faixa de uma assinatura com oferta programada requer suporte comercial nesta versão. O próprio cliente pode cancelar, reativar, trocar cartão e consultar faturas. Reembolsos são operados pelo responsável no painel Stripe, não por um botão do cliente no Grow. Não há Pix/boleto recorrente neste primeiro fluxo: o checkout usa cartão. Impostos automáticos não são habilitados sem definição fiscal da conta.

## Configurar homologação

1. Confirmar o país da conta e o domínio de homologação. Usar a sandbox `30grow sandbox`, separada da conta live.
2. Configurar `APP_URL=https://DOMINIO-DE-HOMOLOGACAO` e `STRIPE_SECRET_KEY=sk_test_...` diretamente no segredo do ambiente ou `.env` local. Não enviar a chave em chat nem usar `NEXT_PUBLIC_*` para ela.
3. Executar a migração por `node --env-file=.env scripts/migrate.js`, usando exclusivamente o banco do ambiente correto. A migração é expansiva e reaplicável.
4. Inspecionar o plano de configuração, sem mutações:

   ```sh
   node scripts/configure-stripe.mjs
   ```

5. Aplicar o catálogo e portal na sandbox, reutilizando os objetos que já existirem:

   ```sh
   node --env-file=.env scripts/configure-stripe.mjs --apply --write-env
   ```

6. Publicar a aplicação em homologação. Depois registrar o webhook:

   ```sh
   node --env-file=.env scripts/configure-stripe.mjs --apply --write-env --webhook-url=https://DOMINIO-DE-HOMOLOGACAO/api/webhooks/stripe
   ```

   O script salva os IDs e o segredo de assinatura diretamente no `.env`, sem imprimir segredos. Se o endpoint já existe, preserva sua identidade e exige a mesma versão da API; seu segredo existente deve estar configurado. Replicar as variáveis no gerenciador de segredos do ambiente e reiniciar a aplicação. Docker Compose já usa `env_file: .env`; secrets são lidos no runtime, sem rebuild para alterar a chave.

7. Conferir em Perfil → Assinatura o modo de teste e a configuração. Validar trial, checkout, retorno, entrega real do webhook, renovação, falha de pagamento, cancelamento/reativação, troca de plano e histórico de faturas. Usar somente cartões oficiais de teste do Stripe. Verificar a mesma licença antes/depois.
8. Depois habilitar `STRIPE_BILLING_ENFORCE=true` e reiniciar as conexões do app. O guard de capacidade recebe o modo por opção da conexão PostgreSQL (`grow.billing_mode`). Testar expiração do trial: gestores mantêm perfil, cobrança e recuperação de conta, mas perdem módulos de gestão até regularização. Links públicos já emitidos e autoatendimento de colaboradores continuam disponíveis por decisão explícita de compatibilidade; essa flag não é um bloqueio global desses fluxos.

## Produção

Produção já contém empresas e dados reais. Preservar suas licenças e condições anteriores; a ativação não faz cobrança retroativa nem escolhe um dono automaticamente para empresas legadas. Não migrar dados demonstrativos de homologação para produção. Repetir o provisionamento com chave live da conta correta, `APP_URL` de produção e `--live` explícito; IDs e signing secret são distintos. O script recusa mutação live sem `--live`. Checkout live exige também `STRIPE_BILLING_ENFORCE=true`.

Ativação da conta, dados bancários, exigências de verificação, e-mails de cobrança, regras de recuperação de pagamentos e tributação devem ser concluídos pelo titular no Stripe antes de receber pagamentos reais. O código não aceita termos ou altera dados bancários automaticamente.

## Testes e rollback

```sh
npm run test:billing
npm run test:security
npx playwright test --config test/ui-controls/playwright.config.js billing.spec.js
npm run db:validate-schema:static
npm run build
```

A integração de banco usa exclusivamente um servidor temporário local na porta 55447, usuário `grow_billing_test`, schema aleatório descartável e Stripe simulado. Nunca carregar `.env` nesse comando:

```sh
BILLING_TEST_PG_PORT=55447 node --experimental-vm-modules --test test/integration/stripe-billing.test.js
```

A suíte cobre reaplicação e preservação da migração, assinatura/bytes do webhook, replay, isolamento, timeout, concorrência das 20 vagas, capacidade em contratações concorrentes, preço desconhecido, cancelamento e restauração da oferta, além do vínculo da licença no perfil.

Rollback operacional: desligar `STRIPE_BILLING_ENFORCE` e reiniciar o app para remover a restrição de acesso; manter tabelas, licenças e histórico. Esse passo também desabilita novos checkouts live. Não desativar webhooks nem excluir assinaturas ativas ao reverter UI: cobranças existentes continuam no Stripe. Para voltar ao app anterior ao billing, manter o consumidor atual do webhook ativo em uma instância separada até reconciliar/cancelar os contratos; reverter código não cancela pagamentos. Não apagar a migration 166 nem restaurar o trigger antigo de 90 dias em uma base que já recebeu clientes novos.

Documentação de referência: [Checkout](https://docs.stripe.com/payments/checkout/build-subscriptions), [webhooks](https://docs.stripe.com/webhooks), [Subscription Schedules](https://docs.stripe.com/billing/subscriptions/subscription-schedules), [portal e limitações](https://docs.stripe.com/customer-management).

## Política comercial e aceite (2026-10-23)

As regras públicas ficam em `/terms#cancelamento-e-reembolso`, com versão própria dos Termos e sem alterar a vigência da Política de Privacidade. O direito de arrependimento segue o prazo legal quando aplicável, sem garantia adicional após a primeira cobrança ou renovação. O plano anual permite encerramento antecipado sem multa, com devolução proporcional do valor efetivamente pago pelo tempo não utilizado, a partir do pedido comprovado, descontadas devoluções anteriores. Cancelar renovação mantém o acesso ao fim do período; encerrar antecipadamente termina o acesso. Direitos por falhas e cobranças indevidas permanecem preservados.

Novos checkouts exigem `consent_collection.terms_of_service=required`, com links para os Termos e a política. O Stripe é a fonte do registro de aceite (`Checkout Session.consent.terms_of_service`); a sessão e a assinatura levam a versão, URLs, empresa e usuário que iniciou o checkout em metadata. Esse usuário iniciador não é apresentado como prova de identidade de quem marcou o aceite. O ID da sessão já é persistido na conta de cobrança. Não se cria uma tabela de consentimento duplicada nem se afirma aceite de sessões antigas. O histórico do Git preserva o texto de cada versão; futuras revisões devem receber nova versão.

Na conta Stripe, configurar os URLs públicos de Terms of service e Privacy policy antes de publicar a exigência. O checkout não inicia assinatura sem a confirmação exigida pelo Stripe. O aceite não implica renúncia ao CDC e não é consentimento de marketing. Cancelamento de renovação já é self-service; estornos e encerramento antecipado são processados pelo atendimento em `contact@3035tech.com`. A área operacional de assinantes e reembolsos do superadmin ainda não está implementada.

## Gestão global de assinaturas (superadmin)

A aba Administração → Assinaturas é exclusiva de `isSuperAdminPayload`: administradores vinculados a empresas e donos de conta não acessam a listagem global nem os endpoints de operações. A consulta lista empresas com LEFT JOIN, incluindo licenças legadas e empresas arquivadas com vínculo financeiro, sem criar clientes Stripe, contas de cobrança ou licenças. Os indicadores contam situações contratuais, não receita recebida; BRL e USD não são somados. A ficha mostra o período contratado separado do acesso comercial e da licença original.

- `GET /api/admin/billing/companies`: filtros e paginação; `companyId` abre detalhes; `refresh=true` reconcilia o provedor, sem cobrar ou estornar.
- `GET /api/admin/billing/operations`: prévia de um pagamento da empresa, saldo reembolsável e cálculo proporcional quando elegível.
- `POST /api/admin/billing/operations`: confirmação explícita, UUID de solicitação estável, classificação interna e observação opcional. Suporta cancelar renovação, desfazer cancelamento agendado, encerrar imediatamente e reembolsar. As ações não apagam dados nem quitam faturas passadas. Uma assinatura já encerrada exige nova contratação para voltar a cobrar.

A migration 169 adiciona `billing_admin_operations` (intenção durável por UUID, empresa/modo e ator com FKs; ação, motivo, base e status com CHECKs; valores inteiros em centavos; IDs Stripe únicos) e `billing_admin_operation_events` (histórico relacionado de estados). Notas livres usam TEXT limitado; não há payload financeiro ou cadastro gerenciável em JSONB. O reembolso anual proporcional não é repetido na mesma fatura após uma solicitação válida; uma devolução excepcional adicional exige outra decisão explícita, limitada ao saldo.

A prévia valida empresa, cliente, modo, fatura paga, PaymentIntent e cobrança. Reembolsos concluídos ou pendentes e intenções locais ainda sem confirmação reduzem o saldo disponível. A primeira versão aceita um pagamento exclusivo por fatura; pagamentos compartilhados, múltiplos ou não vinculados a cobrança são tratados no Stripe, com mensagem explícita na interface. O proporcional usa o valor efetivamente pago, o período anual e a data comprovada de recebimento do pedido. A aplicação não decide automaticamente a elegibilidade jurídica ao arrependimento.

A intenção é registrada antes da chamada externa. A execução serializa operações por conta, recupera o reembolso pela metadata e reutiliza a mesma chave de idempotência. Resposta perdida mantém operação pendente. Após 23 horas sem confirmação localizada no Stripe, a aplicação exige revisão em vez de repetir automaticamente um possível estorno. Webhooks `refund.created`, `refund.updated` e `refund.failed` reconciliam o estado atual, verificando cobrança, moeda e valor. O histórico diferencia solicitação, processamento, conclusão e falha; “concluída no Stripe” não promete a data de crédito no banco do cliente.

Antes de publicar: aplicar 169 em homologação e produção, preservando checksums das licenças; depois atualizar a aplicação e registrar os três eventos adicionais no webhook existente. Na interface atual do Stripe, a chave restrita precisa de Charges and Refunds → Write e Payment Intents → Read; preservar as permissões existentes. Não executar estorno real como teste. Testes financeiros usam o Postgres temporário 55447 e Stripe simulado; os testes de interface usam dados sintéticos. Homologação real do provedor exige chave sandbox própria, nunca a chave live de produção.

Rollback: retornar ao código anterior preservando tabelas e histórico financeiro; desabilitar ações na interface e manter reconciliação de reembolsos já solicitados. Nunca excluir intenções pendentes nem recriar uma solicitação para contornar uma resposta desconhecida.

Produção usa `grow30_app` sem DDL. A migration 169 foi aplicada pela conexão administrativa no pgAdmin; `scripts/grant-billing-admin-runtime.sql` concede somente SELECT/INSERT/UPDATE nas operações e SELECT/INSERT no histórico, com USAGE da sequência. DELETE/TRUNCATE das novas tabelas e UPDATE do histórico não são concedidos ao runtime. A aplicação não recebeu CREATE nem REFERENCES nas tabelas existentes. A migration foi aplicada também no banco `team` de homologação, com checksum de licenças preservado em ambos.

O valor confirmado na interface é obrigatório em todos os tipos de reembolso e precisa coincidir com o saldo/cálculo atual do servidor; uma prévia desatualizada é recusada. Cancelamentos com resposta desconhecida são apenas reconciliados, sem reaplicar uma ordem antiga sobre uma decisão posterior do dono. Se o resultado não puder ser comprovado, o histórico exige conferência no Stripe.

## Sandbox permanente de desenvolvimento

O secret `/homolog/30grow/stripe`, em `us-west-2`, guarda exclusivamente a configuração da conta `30grow sandbox`. Produção mantém `/prod/30grow/stripe`. O catálogo de seis preços, portal e a assinatura do webhook existente foram reunidos no secret de homologação, sem rotacionar a assinatura nem alterar a chave live.

`npm run dev` carrega esse secret usando a sessão do AWS CLI (`aws login`), recusa chave live e remove variáveis Stripe herdadas antes de aplicar a configuração de teste. Usa Webpack como o build. O script recusa `NODE_ENV=production` e bancos remotos; aceita localhost e aliases locais de Docker. O endereço de retorno é local e acompanha `-p/--port`. Não escreve credenciais no `.env` nem no repositório. Isso configura o processo local; o deploy de Dublin precisa receber separadamente os valores de homologação no seu gerenciador de ambiente.

`npm run test:stripe:sandbox` é uma prova externa explícita, fora do CI automático. Usa apenas clientes fictícios sem e-mail e relógio de teste Stripe, sem o banco da aplicação. A execução de 23/10/2026 passou em dez contratos: preço, parâmetros reais de Checkout com termos obrigatórios, primeiro pagamento, portal, cancelamento/retomada, renovação recusada, recuperação com outro cartão, reembolso parcial idempotente, saldo restante e encerramento. Os clientes fictícios e o relógio foram removidos ao final. Essa prova não certifica o formulário de Checkout no navegador nem a entrega ponta a ponta do webhook em Dublin.

A prova externa identificou que a API `2026-09-30.endive` recusa `payment_method_types` ao criar Checkout. O contrato passou com `allowed_payment_method_types: ['card']`, também descrito no SDK instalado; mantém a seleção restrita a cartões entre os meios dinamicamente elegíveis. Há asserção no teste de integração offline para impedir a reintrodução do parâmetro antigo.

## Recuperação de cartão e fatura

O dono da conta continua acessando Perfil → Billing quando os demais módulos estão restritos por pagamento. Em `past_due`, `unpaid` e `incomplete`, o CTA é “Atualizar cartão ou pagar fatura”, direcionando ao portal Stripe existente, que habilita atualização de meio de pagamento e histórico. Fatura em aberto mostra “Pagar fatura”. Alterar o cartão não significa que uma fatura já foi quitada: acesso e situação só acompanham o estado confirmado pelo provedor. Outras contas da empresa não recebem acesso ao billing do dono.

## Gates de entrega

AWS e GitHub executam integração financeira e ciclo de empresa em PostgreSQL isolado, build e contratos HTTP de tenants antes de publicar imagens. GitHub também exige UI de billing/assinaturas e ajustes de RH. Capturas de teste usam `testInfo.outputPath`, compatível com Linux; a primeira execução do gate revelou os antigos caminhos locais `/private/tmp`, que foram corrigidos. Nenhuma chave Stripe é exigida no CI offline.
