# Backlog — Controle de custo de IA (B-2700)

Registro da análise de out/2026. **B-2701–B-2706 entregues** (ver abaixo); só resta a ação de ops no painel do fornecedor. Ao entregar um sub-item, remover daqui e do resumo em `docs/BACKLOG.md`.

## Estado atual (out/2026)

- **Cliente único:** `lib/openai-chat.js` → `openAiChatCompletion({ messages, temperature, maxTokens, responseFormat })`, POST fixo em `https://api.openai.com/v1/chat/completions`.
- **Modelo:** `OPENAI_RUBRIC_MODEL` (default `gpt-4o-mini`). Mock com `OPENAI_MOCK=1` ou `DTOV=1`.
- **Funcionalidades que chamam LLM** (todas por clique de gestor, nada roda sozinho/cron):

| Funcionalidade | Arquivo | `maxTokens` | Rota / rate limit por usuário |
|---|---|---|---|
| Sugestão de rubrica (vaga e cargo) | `lib/rubric-ai.js` | 900 | `admin/vacancies/[id]/rubric-ai`, `admin/job-roles/rubric-ai` · 20/15 min |
| Assistentes da vaga (5 prompts: rascunho, descrição, shortlist, campos de fit etc.) | `lib/vacancy-assist-ai.js` | 500–1400 | `admin/vacancies/[id]/assist-ai` 30/15 min · `admin/vacancies/assist-ai` 20/15 min |
| Interpretação de sinais da pessoa | `lib/people/interpret-ai.js` | 700 | `admin/people/interpret-ai` |
| Assistente de Ajuda | `lib/help-assistant.js` | 360 | `admin/help-chat` · 40/h |
| Tradução de catálogo (offline, dev) | `scripts/i18n-translate-catalog.mjs` | — | script local |

- **Sem LLM (custo zero):** leitura de currículo (`candidate-cv`), temas de clima (`climate-themes`). `lib/health-status.js` só faz ping em `/v1/models`.
- **Lacunas (antes de B-2701–B-2703):** sem teto por empresa, sem registro de tokens/custo, sem kill switch, URL do fornecedor fixa. Cache e modelo por funcionalidade entraram depois (B-2704, B-2705).

## Ordem de grandeza de custo (estimativa; validar preços atuais)

- Chamada típica ≈ 3k tokens de entrada + 700 de saída. No `gpt-4o-mini` ≈ **< US$ 0,001 por chamada** (~US$ 1 por mil chamadas).
- Empresa média usando bastante: centavos a poucos reais/mês. Margem folgada frente a `PUBLIC_PRICING_TIERS`.
- **Risco real:** abuso/loop (usuário ou script martelando o assistente) sem teto por empresa, não o uso normal.

## Fornecedor e modelo (recomendação)

Todo uso é geração de texto/JSON em português (sem imagem, áudio ou embeddings) → qualquer fornecedor grande cobre 100% do sistema.

1. **Ficar na OpenAI** com o modelo mais barato da linha mini/nano vigente (código já pronto, JSON mode estável, bom pt-BR). Conferir modelos e preços no painel antes de trocar.
2. **Alternativa mais barata:** Google Gemini Flash / Flash-Lite (endpoint compatível com o formato OpenAI).
3. **Sem lock-in:** OpenRouter (gateway compatível com OpenAI; troca de modelo só por URL + chave + nome do modelo).

## Ação imediata (sem código)

- [ ] No painel da OpenAI: projeto dedicado ao 30Grow com **limite mensal de gasto** e **alertas** (ex.: US$ 20, aviso em 50% e 80%).

## Itens de implementação

### Entregue (out/2026): B-2701 a B-2706

- **Cache de respostas repetidas (B-2705):** `lib/ai-response-cache.js`, ligado por chamada com a opção `cache` de `openAiChatCompletion`. Chave = hash de feature + modelo + parâmetros + mensagens normalizadas (espaços colapsados), TTL 24h. Redis quando há `REDIS_URL` (`getSharedRedisClient`); sem Redis, LRU em memória do processo (500 entradas). Escopo: Ajuda é global (prompt sem dado da empresa); rubrica só com `companyId` (prompt tem texto da vaga/cargo). Acerto não consome cota nem grava `ai_usage_events`. JSON mode só entra no cache quando a resposta é JSON válido. Assistentes da vaga e interpretação de pessoas **não** usam cache (dados individuais, resposta pouco repetível). `AI_RESPONSE_CACHE=0` desliga. Métrica em memória `aiCache.hit/miss`.

- **Modelo por funcionalidade (B-2704):** env `AI_MODEL_<FEATURE>` (ex.: `AI_MODEL_HELP_ASSISTANT=gpt-4.1-nano`); vazio = `OPENAI_RUBRIC_MODEL`. O evento grava o modelo usado, então a tela de consumo mostra o efeito da troca.
- **Tela de consumo (B-2706):** Empresas → Consumo de IA (só admin; `GET /api/admin/ai-usage`). Filtros mês (12 últimos) / empresa / funcionalidade; totais de chamadas, tokens e custo estimado; chips por funcionalidade; tabela paginada por empresa com chamadas / teto (vermelho quando atingido).

- **Consumo:** `ai_usage_events` (migration 144) com `company_id`, `user_id`, `feature` (CHECK = `AI_FEATURE` em `lib/ai-usage.js`), modelo, tokens e `cost_micros` estimado. Gravado por `openAiChatCompletion` quando a rota passa `usage`; falha de log não quebra a feature. Scripts offline (tradução) não passam `usage` e não tocam no banco.
- **Teto por empresa:** `companies.ai_monthly_call_limit` (NULL = `AI_COMPANY_MONTHLY_CALL_LIMIT`, default 500; 0 = bloqueada). Checado antes da chamada; acima → 429 `AI_MONTHLY_LIMIT` (i18n 4 idiomas). Assistente de Ajuda cai para a resposta do Guia. Admin ajusta em Empresas → Editar (mostra uso do mês).
- **Kill switch / fornecedor:** `AI_ENABLED=0` → "IA indisponível" (503 `RUBRIC_AI_NOT_CONFIGURED`); `AI_GLOBAL_MONTHLY_CALL_LIMIT` opcional; `OPENAI_BASE_URL` (só https). Health marca `skipped/disabled`.
- **Limites conhecidos:** mês fechado em `date_trunc('month', NOW())` do Postgres (UTC: no Brasil vira às 21h do último dia); checagem e gravação não são atômicas, então chamadas simultâneas podem passar o teto em poucas unidades (o rate limit por usuário segura); preços em `PRICE_PER_MTOK` precisam de revisão ao trocar de modelo.
- **Ação de ops ainda recomendada:** limite mensal + alertas no painel da OpenAI (rede de segurança fora do código).
