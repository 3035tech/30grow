/**
 * Opções TLS para node-pg. RDS costuma exigir SSL (pg_hba "hostssl" / "no encryption").
 */
export function getPgSslOption() {
  const raw = String(process.env.POSTGRES_SSL ?? '').trim().toLowerCase();
  const host = String(process.env.POSTGRES_HOST || '');

  if (raw === 'false' || raw === '0' || raw === 'off') {
    return false;
  }
  if (raw === 'true' || raw === '1' || raw === 'require') {
    return sslObjectFromEnv();
  }

  // Sem override: RDS na AWS usa hostname típico — habilita TLS para evitar "no encryption"
  if (host.includes('.rds.amazonaws.com')) {
    return sslObjectFromEnv();
  }

  return false;
}

function getPgSchema() {
  const schema = String(process.env.POSTGRES_SCHEMA ?? '').trim();
  return schema || null;
}

function sslObjectFromEnv() {
  const strict = String(process.env.POSTGRES_SSL_REJECT_UNAUTHORIZED || '').toLowerCase() === 'true';
  return strict ? { rejectUnauthorized: true } : { rejectUnauthorized: false };
}

/** Campos comuns host/port/db/user para Pool e Client */
export function getPgBaseConfig() {
  const schema = getPgSchema();
  const options = [
    schema ? `-c search_path=${schema},public` : '',
    process.env.STRIPE_BILLING_ENFORCE === 'true'
      ? `-c grow.billing_mode=${/^(sk|rk)_live_/.test(process.env.STRIPE_SECRET_KEY || '') ? 'live' : 'test'}` : '',
  ].filter(Boolean).join(' ');
  return {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    database: process.env.POSTGRES_DB || 'enneagram',
    user: process.env.POSTGRES_USER || 'enneagram_user',
    password: process.env.POSTGRES_PASSWORD,
    ssl: getPgSslOption(),
    // Alguns provedores removem CREATE do schema public.
    // Permite definir um schema dedicado (que seu usuário possua) via env.
    ...(options ? { options } : {}),
  };
}

/**
 * Réplica só-leitura (RDS read replica, etc.). Quando null, use o pool primário.
 * Credenciais/db/schema iguais ao primário; só host (e opcionalmente porta) mudam.
 */
export function getPgReadBaseConfig() {
  const readHost = String(process.env.POSTGRES_READ_HOST ?? '').trim();
  if (!readHost) return null;
  const primary = getPgBaseConfig();
  const readPortRaw = process.env.POSTGRES_READ_PORT;
  const readPort = readPortRaw != null && String(readPortRaw).trim() !== ''
    ? parseInt(String(readPortRaw), 10)
    : primary.port;
  const readSslRaw = String(process.env.POSTGRES_READ_SSL ?? '').trim().toLowerCase();
  const ssl =
    readSslRaw === 'true' || readSslRaw === '1'
      ? sslObjectFromEnv()
      : readSslRaw === 'false' || readSslRaw === '0'
        ? false
        : readHost.includes('.rds.amazonaws.com')
          ? sslObjectFromEnv()
          : primary.ssl;

  return {
    ...primary,
    host: readHost,
    port: Number.isFinite(readPort) ? readPort : primary.port,
    ssl,
  };
}
