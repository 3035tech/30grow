const DEV_FALLBACK = 'dev-secret-troque-em-producao';

/** @see next/constants — inlined so webpack never pulls `node:module` via client graph */
const PHASE_PRODUCTION_BUILD = 'phase-production-build';
const PHASE_EXPORT = 'phase-export';

/** Nunca usar em produção (alinhar com docs / .env.example). */
const PLACEHOLDER_SECRETS = new Set([
  DEV_FALLBACK,
  'troque_por_um_segredo_longo_e_aleatorio',
]);

let cachedSecret = null;

/**
 * Durante `next build` / export estático não exigir segredo (CI pode não injetar JWT).
 * Em `next start` e em runtime (middleware, rotas), exige-se segredo forte.
 */
function shouldEnforceStrongSecretInProduction() {
  if (process.env.NODE_ENV !== 'production') return false;
  const phase = process.env.NEXT_PHASE;
  if (phase === PHASE_PRODUCTION_BUILD || phase === PHASE_EXPORT) return false;
  return true;
}

function validateProductionSecret(secret) {
  if (!secret || secret.length < 32) {
    throw new Error(
      'JWT_SECRET: em produção defina um segredo com pelo menos 32 caracteres (ex.: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))").'
    );
  }
  if (PLACEHOLDER_SECRETS.has(secret)) {
    throw new Error('JWT_SECRET: em produção não use valores de exemplo; gere um segredo novo.');
  }
}

/**
 * Segredo HS256 comum ao Node (`jsonwebtoken`) e ao Edge (`jose`).
 */
export function getJwtSecret() {
  if (cachedSecret !== null) return cachedSecret;

  const trimmed = process.env.JWT_SECRET?.trim() ?? '';

  if (shouldEnforceStrongSecretInProduction()) {
    validateProductionSecret(trimmed);
    cachedSecret = trimmed;
    return cachedSecret;
  }

  cachedSecret = trimmed || DEV_FALLBACK;
  return cachedSecret;
}
