# Técnico — Arquitetura & Performance (Categoria B)

Próxima categoria de melhorias após completar **UX/UI**. Foco em escala, performance e qualidade técnica.

---

## 📋 Itens Identificados

### **Crítico (Dívida Técnica Bloqueante)**

1. ❌ **Sem rate limiting no signup** → DoS fácil
2. ❌ **Cache HR Score in-memory volátil** → recalcula sempre após restart
3. ❌ **N+1 em compatibilidade** → carrega pares um por um
4. ❌ **Pool PG sem limite** → esgota conexões em pico
5. ❌ **Sem health check** → deploy blind, downtime invisível

### **Alto Impacto**

6. **Sem índices compostos** → full scans em filtros comuns
7. **Assessment score no cliente** → confiança zero
8. **Sem paginação em compat/groups** → OOM com empresa grande
9. **Logs não-estruturados** → debug impossível em produção
10. **Sem retry em emails** → falha silenciosa

### **Médio**

11. **Sem CDN para assets** → latência global alta
12. **Sem cache HTTP** → revalida tudo sempre
13. **Bundle JS grande** → FCP >3s
14. **Queries sem EXPLAIN** → performance por sorte
15. **Sem APM** → bottlenecks invisíveis

---

## 🎯 Plano de Implementação

### **Sprint 1: Performance Crítica (1-2 semanas)**

#### P-1001: Rate Limiting Signup
```js
// lib/identity/rate-limit.js (reusar existente)
export function checkSignupRateLimit(ip) {
  // 5 tentativas / 15min / IP
  const key = `signup:${ip}`;
  return checkRateLimit(key, 5, 900000);
}
```

**Files:**
- `app/api/signup/route.js` (add rate limit)
- `lib/identity/rate-limit.js` (extend)

---

#### P-1002: Cache HR Score Persistente
```js
// lib/assessment/hr-score-cache.js
import Redis from 'ioredis'; // ou in-memory com TTL
const redis = new Redis(process.env.REDIS_URL);

export async function getCachedHrScore(candidateId) {
  const cached = await redis.get(`hr_score:${candidateId}`);
  if (cached) return JSON.parse(cached);
  
  const score = await calculateHrScore(candidateId);
  await redis.setex(`hr_score:${candidateId}`, 3600, JSON.stringify(score)); // 1h TTL
  return score;
}
```

**Alternat**ivas sem Redis:
- PostgreSQL `hr_score_cache` table (com `updated_at`)
- In-memory LRU com persist em JSON (leve mas restart perde)

---

#### P-1003: Fix N+1 Compatibilidade
```sql
-- Antes (N+1):
-- SELECT * FROM candidates WHERE id = 1
-- SELECT * FROM candidates WHERE id = 2
-- ...repeat N times

-- Depois (1 query):
SELECT 
  c1.id as id1, c1.name as name1, c1.top_type as type1,
  c2.id as id2, c2.name as name2, c2.top_type as type2,
  compat_matrix.score
FROM candidates c1
CROSS JOIN candidates c2
WHERE c1.company_id = $1 AND c2.company_id = $1
  AND c1.id < c2.id
  AND c1.top_type IS NOT NULL
  AND c2.top_type IS NOT NULL
LIMIT 100;
```

**Files:**
- `lib/compat-bundles.js` (rewrite query)

---

#### P-1004: Pool PG com Limite
```js
// lib/db.js
const pool = new Pool({
  max: parseInt(process.env.PG_POOL_MAX || '20'), // enforce
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Monitorar
pool.on('error', (err) => {
  console.error('[pg-pool] Unexpected error', err);
});
```

**Env:**
```
PG_POOL_MAX=20  # prod
PG_POOL_MAX=5   # dev
```

---

#### P-1005: Health Check Endpoint
```js
// app/api/health/route.js
export async function GET() {
  const checks = {
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    db: await checkDb(),
    redis: await checkRedis(), // se houver
  };

  const healthy = checks.db.ok && (!checks.redis || checks.redis.ok);
  return NextResponse.json(checks, { status: healthy ? 200 : 503 });
}

async function checkDb() {
  try {
    const res = await query('SELECT 1');
    return { ok: true, latency: res.duration };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
```

**Deploy:**
- ALB health check: `GET /api/health` (200 OK)
- Monitoramento: UptimeRobot, Pingdom

---

### **Sprint 2: Índices & Observabilidade (1 semana)**

#### P-1006: Índices Compostos Críticos
```sql
-- migrations/NNN_performance_indexes_v2.sql

-- Filtros de vaga + área
CREATE INDEX CONCURRENTLY idx_assessments_vacancy_area_stage 
  ON assessments (vacancy_id, area_id, pipeline_stage) 
  WHERE deleted = FALSE;

-- Busca global
CREATE INDEX CONCURRENTLY idx_candidates_company_name_gin
  ON candidates USING gin (company_id, name gin_trgm_ops)
  WHERE deleted = FALSE;

-- HR Score join
CREATE INDEX CONCURRENTLY idx_hr_scores_candidate_updated
  ON hr_scores (candidate_id, updated_at DESC);

-- Notificações não-lidas
CREATE INDEX CONCURRENTLY idx_manager_notifications_user_unread
  ON manager_notifications (user_id, read_at)
  WHERE read_at IS NULL;
```

**EXPLAIN antes/depois:**
```bash
EXPLAIN ANALYZE 
SELECT * FROM assessments 
WHERE vacancy_id = 123 AND area_id = 5 AND pipeline_stage = 'screening';
```

---

#### P-1007: Logs Estruturados (JSON)
```js
// lib/logger.js
export function log(level, message, context = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...context,
    pid: process.pid,
    hostname: os.hostname(),
  };
  console.log(JSON.stringify(entry));
}

// Uso:
log('info', 'User logged in', { userId: 123, ip: '1.2.3.4' });
log('error', 'DB query failed', { query: 'SELECT...', error: err.message });
```

**Parse com jq:**
```bash
cat logs.json | jq 'select(.level == "error")'
```

---

#### P-1008: Paginação Obrigatória
```js
// lib/compat-bundles.js
const COMPAT_PEOPLE_CAP = 100; // já existe, enforce everywhere

// lib/team-groups.js
export async function listGroupMembers(groupId, { page = 1, pageSize = 50 }) {
  const offset = (page - 1) * pageSize;
  const res = await query(
    `SELECT * FROM team_group_members WHERE group_id = $1 LIMIT $2 OFFSET $3`,
    [groupId, pageSize, offset]
  );
  return { items: res.rows, page, pageSize, hasMore: res.rows.length === pageSize };
}
```

---

#### P-1009: Retry em Emails
```js
// lib/mail.js (extend)
import pRetry from 'p-retry';

export async function sendTransactionalMailWithRetry(opts) {
  return pRetry(
    () => sendTransactionalMail(opts),
    {
      retries: 3,
      minTimeout: 1000,
      onFailedAttempt: (err) => {
        console.warn(`[mail] Retry ${err.attemptNumber}/3:`, err.message);
      },
    }
  );
}
```

---

### **Sprint 3: Bundle & Cache (1 semana)**

#### P-1010: Code Splitting
```js
// next.config.js
module.exports = {
  experimental: {
    optimizePackageImports: ['react-icons', 'date-fns'],
  },
};

// Dynamic imports
const RichTextEditor = dynamic(() => import('./RichTextEditor'), {
  loading: () => <Skeleton className="h-64" />,
});
```

**Analyze:**
```bash
npm run build
# Check .next/analyze/ (se plugin instalado)
```

---

#### P-1011: Cache HTTP
```js
// app/api/*/route.js
export async function GET() {
  const data = await fetchData();
  return new Response(JSON.stringify(data), {
    headers: {
      'Cache-Control': 's-maxage=60, stale-while-revalidate=300',
      'Content-Type': 'application/json',
    },
  });
}
```

---

#### P-1012: CDN Assets
```js
// next.config.js
module.exports = {
  assetPrefix: process.env.CDN_URL || '',
  images: {
    domains: ['cdn.30team.com'],
  },
};
```

**Deploy:**
- Cloudflare Pages / Vercel Edge
- S3 + CloudFront

---

## 📊 Métricas Esperadas

| Antes | Depois | Melhoria |
|-------|--------|----------|
| Signup DoS fácil | Rate limit 5/15min | +∞ segurança |
| HR Score 200ms | 5ms (cached) | **-98%** |
| Compat N queries | 1 query | **-90% latency** |
| Pool esgota pico | Max 20 | **Sem crash** |
| Downtime invisível | Health check 200 OK | **Detect 100%** |
| Full scan filtros | Index scan | **-95% query time** |
| Logs caóticos | JSON structured | **Debug 10x** |
| Email fail silent | 3 retries | **-80% falhas** |
| Bundle 500KB | 200KB initial | **-60% FCP** |
| Cache miss sempre | s-maxage=60 | **-50% server load** |

---

## 🚀 Ordem de Implementação

**Semana 1:**
1. P-1005 (Health check) — deploy safety ASAP
2. P-1001 (Rate limit signup) — security
3. P-1004 (Pool limit) — stability

**Semana 2:**
4. P-1003 (Fix N+1) — perf imediata
5. P-1006 (Índices) — foundation
6. P-1007 (Logs) — observability

**Semana 3:**
7. P-1008 (Paginação) — scale
8. P-1009 (Retry email) — reliability
9. P-1002 (Cache HR Score) — se tráfego justificar

**Semana 4:**
10. P-1010 (Code split) — UX
11. P-1011 (Cache HTTP) — infra
12. P-1012 (CDN) — global perf

---

## ✅ Checklist por Item

Cada P-xxxx deve ter:
- [ ] Código implementado
- [ ] Testes (unit ou E2E)
- [ ] README atualizado (se setup novo)
- [ ] `.env.example` com vars novas
- [ ] Migration SQL (se schema)
- [ ] EXPLAIN antes/depois (se query)
- [ ] Benchmark local (se perf)
- [ ] Deploy em staging
- [ ] Monitoramento configurado

---

## 🔗 Referências

- Health checks: [Kubernetes liveness](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/)
- Rate limiting: `lib/identity/rate-limit.js` existente
- Pool PG: [node-postgres best practices](https://node-postgres.com/features/pooling)
- Índices: `migrations/006_performance_indexes.sql`
- Logs: [12-factor app logging](https://12factor.net/logs)
