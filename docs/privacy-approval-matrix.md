# MVP-06 — decisões para aprovação

Status em 29/09/2026: proposta técnica; nenhuma aprovação jurídica inferida. Preencher responsável nominal, decisão, data e referência do contrato/parecer no sign-off. Não inserir dados de titulares.

## Responsabilidade e tratamento

| Decisão | Proposta para revisão | Confirmação necessária |
|---|---|---|
| Canal | info@30grow.com, assunto Privacidade 30Grow | Responsável nominal e substituto; monitoramento e prazo de triagem |
| Recrutamento/gestão | Cliente define finalidade; plataforma opera conforme contrato | Controlador por fluxo, instruções e bases legais |
| Site/conta/segurança | 3035Tech administra esses fluxos | Identificação jurídica completa e bases por finalidade |
| Avaliações e IA | Apoio a decisão humana; revisar contexto e critérios | Uso permitido, dados enviados, revisão e informação ao titular |
| Crianças/adolescentes e dados sensíveis | Escalar para responsável antes do tratamento | Necessidade, base, controles e informação adequados |
| Textos públicos | Minutas PT/EN existentes, versão 2026.09 | Aprovação jurídica; a indicação pública de vigência não é evidência de aprovação |

## Prazos a definir

Para cada classe, aprovar duração, evento inicial, exceções de preservação, responsável e mecanismo de descarte: candidaturas/avaliações; currículos/anexos; conta/sessões; colaboradores/DP/ponto; remuneração; clima/pulso; ouvidoria; auditoria/logs; backups. Nenhum prazo foi escolhido pela engenharia nesta revisão. `RETENTION_DAYS` não substitui essa aprovação.

## Fornecedores e transferências

O código indica capacidades, não os contratos ou provedores efetivamente usados em produção.

| Serviço | Evidência técnica | Confirmar antes do aceite |
|---|---|---|
| Hospedagem, PostgreSQL, Redis | Configuração por ambiente | Fornecedor, região, acesso, contrato, backup e retenção |
| Arquivos | Cliente S3 compatível (`lib/s3-object-storage.js`) | Provedor/bucket, região, lifecycle, versões e exclusão |
| E-mail | SMTP (`lib/mail.js`) | Fornecedor, região, destinatários/logs e retenção |
| IA | OpenAI quando configurado (`lib/openai-chat.js`) | Ativação real, conteúdo enviado por recurso, termos, região e retenção |
| Monitoramento | Integração Sentry presente no código | DSN ativo ou desabilitado, dados enviados, região e retenção |
| Proxy/CDN | Externo à aplicação | Mascaramento de caminhos com tokens, query strings e política de logs |

Não declarar que todos os dados ficam no Brasil nem que fornecedores não retêm dados sem evidência contratual. Revisar a seção de compartilhamento das minutas para representar IA e monitoramento efetivamente habilitados.

## Referências oficiais consultadas

- [ANPD: direitos dos titulares](https://www.gov.br/anpd/pt-br/assuntos/titular-de-dados-1/direito-dos-titulares).
- [LGPD, texto compilado](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm).

Essas referências orientam a revisão; a matriz não determina base legal, prazo de conservação ou aprovação em nome do controlador.
