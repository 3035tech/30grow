# Analytics API — Documentação (B-1106)

API REST para expor métricas de analytics do 30Grow para integrações externas.

As respostas JSON de métricas e tendências incluem `meta.generatedAt`, o período efetivo e, em métricas, `meta.sampleSize`. O header `x-request-id` permite correlacionar a chamada com os logs estruturados sem registrar filtros, tokens ou dados pessoais.

## Autenticação

Todas as rotas requerem **JWT de gestor** via cookie `team30_session`.

- **Roles permitidas:** `admin`, `direction`, `hr`
- **Escopo:** Multi-tenant isolado por `company_id` (exceto `admin` que é cross-tenant)

## Rate Limiting

- **Limite:** 100 requisições por minuto por usuário
- **Janela:** Fixa de 60 segundos
- **Headers de resposta:**
  - `X-RateLimit-Limit`: limite máximo
  - `X-RateLimit-Remaining`: requisições restantes na janela
  - `X-RateLimit-Reset`: timestamp (epoch) de reset da janela

**429 Too Many Requests:**
```json
{
  "ok": false,
  "error": "RATE_LIMIT",
  "retryAfter": 42
}
```

## Endpoints

### 1. Métricas de Efetividade

**GET** `/api/admin/analytics/metrics`

Retorna métricas de impacto do processo seletivo.

Fontes canônicas: contratação em `candidates.hired_at` / `hired_vacancy_id`, desligamentos em `exit_records`, HR Score em `hr_scores.score` / `calculated_at` e fit calculado no servidor com `assessments.scores` + rubrica T1–T9. A amostra de fit é limitada às 5.000 avaliações mais recentes e informa `fitComparison.truncated` quando atinge o teto.

**Query Parameters:**
| Parâmetro | Tipo | Obrigatório | Descrição |
|-----------|------|-------------|-----------|
| `startDate` | string (YYYY-MM-DD) | Não | Data inicial do período |
| `endDate` | string (YYYY-MM-DD) | Não | Data final do período |
| `vacancyId` | number | Não | Filtrar por vaga específica |

**Resposta 200:**
```json
{
  "ok": true,
  "metrics": {
    "timeToHire": {
      "avgDays": 45.2,
      "median": 42,
      "min": 15,
      "max": 120,
      "count": 28
    },
    "timeToProductivity": {
      "avgDays": 62.5,
      "count": 22
    },
    "retentionRate": {
      "at6Months": 0.89,
      "at12Months": 0.76,
      "at24Months": 0.65
    },
    "fitComparison": {
      "hiredAvgFit": 78.3,
      "poolAvgFit": 62.1,
      "delta": 16.2
    },
    "rubricAdherence": {
      "avgScore": 8.2,
      "targetScore": 9.0,
      "count": 28
    }
  },
  "filters": {
    "startDate": "2025-01-01",
    "endDate": "2026-08-27",
    "vacancyId": null
  }
}
```

**Erros:**
- `401 UNAUTHORIZED`: Sem autenticação ou role insuficiente
- `429 RATE_LIMIT`: Limite excedido
- `500 SERVER_ERROR`: Erro interno

---

### 2. Tendências Temporais

**GET** `/api/admin/analytics/trends`

Retorna séries temporais de métricas-chave (HR Score, turnover, clima, PDI, hires vs exits).

**Query Parameters:**
| Parâmetro | Tipo | Obrigatório | Descrição |
|-----------|------|-------------|-----------|
| `months` | number | Não | Quantidade de meses (1-24, padrão: 12) |

**Resposta 200:**
```json
{
  "ok": true,
  "trends": {
    "hrScore": [
      { "month": "2025-09", "avgScore": 72.3, "count": 45 },
      { "month": "2025-10", "avgScore": 74.1, "count": 48 }
    ],
    "turnoverRisk": [
      { "month": "2025-09", "highRiskPct": 0.12, "count": 45 }
    ],
    "climate": [
      { "month": "2025-09", "avgScore": 4.2, "responseCount": 38 }
    ],
    "pdiCompletion": [
      { "month": "2025-09", "completionRate": 0.68, "totalPlans": 32 }
    ],
    "hiresVsExits": [
      { "month": "2025-09", "hires": 5, "exits": 2 }
    ]
  },
  "filters": {
    "months": 12
  }
}
```

**Erros:**
- `400 INVALID_PARAMS`: `months` fora do intervalo 1-24
- `401 UNAUTHORIZED`
- `429 RATE_LIMIT`
- `500 SERVER_ERROR`

---

### 3. Comparativos

**GET** `/api/admin/analytics/compare`

Compara métricas entre segmentos (áreas, períodos, rubricas).

**Query Parameters (depende do `type`):**

**type=list-areas** (listar áreas disponíveis):
```
GET /api/admin/analytics/compare?type=list-areas
```

**type=list-rubrics** (listar rubricas disponíveis):
```
GET /api/admin/analytics/compare?type=list-rubrics
```

**type=areas** (comparar duas áreas):
| Parâmetro | Tipo | Obrigatório | Descrição |
|-----------|------|-------------|-----------|
| `areaA` | string | Sim | Nome da área A |
| `areaB` | string | Nome da área B |

**type=periods** (comparar dois períodos):
| Parâmetro | Tipo | Obrigatório | Descrição |
|-----------|------|-------------|-----------|
| `periodAStart` | string (YYYY-MM-DD) | Sim | Início período A |
| `periodAEnd` | string (YYYY-MM-DD) | Sim | Fim período A |
| `periodBStart` | string (YYYY-MM-DD) | Sim | Início período B |
| `periodBEnd` | string (YYYY-MM-DD) | Sim | Fim período B |

**type=rubrics** (comparar duas rubricas):
| Parâmetro | Tipo | Obrigatório | Descrição |
|-----------|------|-------------|-----------|
| `rubricAId` | number | Sim | ID da rubrica A (job_role_id) |
| `rubricBId` | number | Sim | ID da rubrica B |

**Resposta 200 (areas):**
```json
{
  "ok": true,
  "comparison": {
    "segmentA": {
      "label": "Engineering",
      "hrScore": 76.2,
      "turnoverRiskHigh": 0.08,
      "climate": 4.3,
      "count": 25
    },
    "segmentB": {
      "label": "Sales",
      "hrScore": 68.5,
      "turnoverRiskHigh": 0.18,
      "climate": 3.9,
      "count": 18
    },
    "delta": {
      "hrScore": 7.7,
      "turnoverRiskHigh": -0.10,
      "climate": 0.4
    }
  }
}
```

**Erros:**
- `400 MISSING_PARAMS`: Parâmetros obrigatórios ausentes
- `400 INVALID_TYPE`: `type` inválido
- `401 UNAUTHORIZED`
- `429 RATE_LIMIT`
- `500 SERVER_ERROR`

---

### 4. Alertas e Anomalias

**GET** `/api/admin/analytics/alerts`

Retorna alertas detectados automaticamente (clima caindo, turnover subindo, vagas lentas, HR Score baixo).

**Query Parameters:** Nenhum

**Resposta 200:**
```json
{
  "ok": true,
  "alerts": [
    {
      "type": "climate_drop",
      "severity": "high",
      "message": "Clima caiu 18% na área Engineering no último mês",
      "context": {
        "area": "Engineering",
        "previousScore": 4.5,
        "currentScore": 3.7,
        "dropPct": 0.18
      },
      "detectedAt": "2026-08-27T08:00:00Z",
      "actionSuggestion": "Agendar 1:1 com o time e revisar pulsos recentes"
    }
  ],
  "count": 1
}
```

**Tipos de alerta:**
| Tipo | Threshold | Severidade |
|------|-----------|------------|
| `climate_drop` | -15% em 1 mês | high |
| `turnover_risk_increase` | +20% em 1 trimestre | high |
| `slow_vacancies` | >90 dias aberta | medium |
| `low_hr_score` | média <50 | high |
| `low_pdi_completion` | <30% da empresa | medium |

**Erros:**
- `401 UNAUTHORIZED`
- `429 RATE_LIMIT`
- `500 SERVER_ERROR`

---

### 5. Export Estruturado

**GET** `/api/admin/analytics/export`

Exporta dados de analytics em formato estruturado (JSON ou CSV).

**Query Parameters:**
| Parâmetro | Tipo | Obrigatório | Descrição |
|-----------|------|-------------|-----------|
| `format` | string | Não | `json` ou `csv` (padrão: json) |
| `type` | string | Não | `metrics` ou `trends` (padrão: metrics) |
| *(outros)* | — | — | Mesmos filtros de `/metrics` ou `/trends` |

**Resposta 200 (format=json):**
- **Content-Type:** `application/json`
- **Content-Disposition:** `attachment; filename="metrics-2026-08-27.json"`

```json
{
  "exportedAt": "2026-08-27T08:00:00Z",
  "type": "metrics",
  "filters": { "startDate": "2025-01-01", "endDate": "2026-08-27" },
  "data": { /* métricas completas */ }
}
```

**Resposta 200 (format=csv):**
- **Content-Type:** `text/csv`
- **Content-Disposition:** `attachment; filename="metrics-2026-08-27.csv"`

```csv
metric,value,unit,count
timeToHire_avg,45.2,days,28
retentionRate_6m,0.89,pct,28
...
```

**Erros:**
- `400 INVALID_FORMAT`: Formato não suportado
- `401 UNAUTHORIZED`
- `429 RATE_LIMIT`
- `500 SERVER_ERROR`

---

## Exemplos de Integração

### cURL

```bash
# Listar métricas dos últimos 6 meses
curl -X GET \
  'https://30team.app/api/admin/analytics/metrics?startDate=2026-02-01&endDate=2026-08-27' \
  -H 'Cookie: team30_session=<seu-jwt>' \
  -H 'Accept: application/json'

# Comparar duas áreas
curl -X GET \
  'https://30team.app/api/admin/analytics/compare?type=areas&areaA=Engineering&areaB=Sales' \
  -H 'Cookie: team30_session=<seu-jwt>'

# Export CSV de métricas
curl -X GET \
  'https://30team.app/api/admin/analytics/export?format=csv&type=metrics' \
  -H 'Cookie: team30_session=<seu-jwt>' \
  -o metrics.csv
```

### JavaScript (fetch)

```javascript
// Buscar alertas ativos
const response = await fetch('/api/admin/analytics/alerts', {
  credentials: 'include', // Inclui cookies
});

const { ok, alerts } = await response.json();
if (ok) {
  console.log(`${alerts.length} alertas detectados`);
}
```

### Python (requests)

```python
import requests

session = requests.Session()
session.cookies.set('team30_session', 'seu-jwt-aqui')

# Tendências dos últimos 12 meses
r = session.get('https://30team.app/api/admin/analytics/trends?months=12')
data = r.json()

for point in data['trends']['hrScore']:
    print(f"{point['month']}: {point['avgScore']}")
```

---

## Notas de Implementação

- **Multi-tenant:** Todas as queries são isoladas por `company_id` (exceto `admin` cross-tenant)
- **Performance:** Queries otimizadas com índices (`migrations/061_performance_indexes.sql`)
- **Cache:** HR Score usa cache em memória (TTL 5min) via `lib/assessment/hr-score-cache.js`
- **Monitoramento:** Métricas de uso em `/api/health/metrics` (admin-only)
- **Logs estruturados:** JSON logs via `lib/monitoring.js`

## Segurança

- ✅ Autenticação JWT obrigatória
- ✅ Rate limiting (100 req/min por usuário)
- ✅ SQL parametrizado (sem injeção)
- ✅ Scope por `company_id` (isolamento multi-tenant)
- ✅ Sem CORS habilitado (só same-origin)
- ✅ Logs de auditoria via `lib/audit.js` (ações sensíveis)

## Roadmap

- [ ] Webhooks de alertas (B-1108)
- [ ] Relatórios agendados (B-1107)
- [ ] OpenAPI/Swagger spec
- [ ] Rate limiting por Redis (multi-instância)
- [ ] GraphQL endpoint (opcional)

---

**Versão:** 1.0 (ago/2026)  
**Epic:** B-1100 — Analytics avançado  
**Feature:** B-1106 — API de métricas para integrações externas
