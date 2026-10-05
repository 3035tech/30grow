# Privacidade e LGPD — notas internas (30Grow)

Documento operacional para equipe de produto e engenharia. **Não substitui parecer jurídico** nem política de privacidade voltada ao público.

## Superfície de dados

- **Landing e formulário público** (`/`, links `/t/[token]`, `/v/[token]`): coleta nome, email opcional, consentimento explícito (`consent === true` na API), respostas do assessment e metadados técnicos habituais (IP limitado por rate limit na API).
- **Dashboard e APIs admin**: dados de candidatos, assessments, empresas e usuários gestores ficam atrás de autenticação (Proxy do Next.js + papel).

## Retenção

- O job/script de retenção deve respeitar **`RETENTION_DAYS`** (ver `.env.example`): remoção de assessments antigos e candidatos órfãos (sem assessments / ae_attempts / 1:1) via `POST /api/admin/retention/purge`, em **lotes** (`RETENTION_BATCH_SIZE` / `RETENTION_MAX_BATCHES`).
- **Currículos (B-2706):** PDFs ficam em object storage (`candidates.cv_key`, prefixo `companies/{id}/candidates/…`). Remover CV pelo painel ou excluir o candidato limpa metadados no Postgres; a rota de delete do CV tenta apagar o objeto S3. Purge de candidatos órfãos não apaga S3 automaticamente — operação pode usar lifecycle do bucket ou script ops se necessário.
- Notificações in-app (gestor e colaborador): cron `POST /api/cron/notification-retention` (prazos `NOTIFICATION_RETENTION_READ_DAYS` / `NOTIFICATION_RETENTION_UNREAD_DAYS`).
- Ajustar o número conforme contrato com cliente e política corporativa; registrar mudanças em changelog interno.

## Bases legais (orientação típica — validar com jurídico)

| Contexto | Base frequentemente aplicável |
|----------|-------------------------------|
| Gestão de conta gestor / dashboard | Execução de contrato ou legítimo interesse (conforme caso) |
| Formulário público com consentimento marcado | Consentimento do titular |
| Obrigações fiscais/regulatórias | Obrigação legal |

## Direitos do titular

Garantir processo interno (canal definido com cliente/RH) para:

- **Confirmação e acesso** aos dados tratados  
- **Correção** de dados inexatos  
- **Anonimização, bloqueio ou eliminação** desnecessários ou excessivos  
- **Portabilidade** (quando aplicável)  
- **Revogação do consentimento** e informação sobre consequências  

Implementação técnica: exclusões em cascata onde houver `ON DELETE CASCADE`; auditoria quando existir `audit` em ações sensíveis.

## Cookies, analytics e consentimento

- Sessão do gestor: cookie HTTP-only da própria app (`team30_session`).
- Atribuição de vagas públicas: cookie first-party httpOnly `team30_job_attr` (UTM/`ref`, session opaca, TTL ~7 dias). **Sem IP** e sem PII nos eventos `job_funnel_events`; detalhe fino em `assessments.attr_*`.
- Códigos de indicação gerenciados em `referral_codes` (sem PII no código); analytics agrega por `referral_code` nos eventos do funil.
- Hoje o app não depende de cookies de **terceiros** na landing para funcionamento básico.
- **Se** forem adicionados analytics/marketing de terceiros na landing: avaliar banner de cookies, consentimento prévio onde exigido e atualização da política de privacidade pública.

## SEO / URLs sensíveis

- Rotas com token (`/t/…`, `/v/…`, `/r/…`) exportam **`robots: noindex`** para reduzir indexação acidental de URLs únicas.
- Checklist do epic de vagas públicas (sitemap, funil, referral, alerts): [`docs/job-seo-and-distribution.md`](./job-seo-and-distribution.md) § Segurança / LGPD.

## Tabela legada `results`

- Escrita em `results` é **desaconselhada** para o modelo multi-empresa (colisão global por nome). Preferir sempre `assessments` + `candidates`. Ver `LEGACY_RESULTS_WRITE` em `.env.example`.

## Headers de segurança (produção HTTPS)

- CSP em modo relatório e HSTS podem ser habilitados por variáveis de ambiente (ver `.env.example`). Ajustar CSP ao stack real antes de migrar para política aplicada (`Content-Security-Policy`).
