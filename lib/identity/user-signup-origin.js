/**
 * Origem do usuário gestor.
 *
 * Modelo de produto:
 * - **admin (Painel):** cadastro normal na aba Usuários — já está no sistema.
 * - **early_access / self_service:** veio do onboarding (/signup). Depois de
 *   ativar, também é usuário do sistema (aparece em Usuários), mas permanece
 *   no cohort de Leads para contato futuro.
 *
 * A aba Leads lista só origens self-service; Usuários lista todos + badge Origem.
 */

/**
 * @param {{
 *   signupSource?: string | null,
 *   signupPending?: boolean,
 *   signupMetadata?: object | null,
 *   companySignupAutoCreated?: boolean,
 *   isCompanySignupCreator?: boolean | null,
 * }} row
 * `isCompanySignupCreator`: true/false when the company knows its signup creator
 * (managers invited by the creator are panel users); null/undefined = legacy, unknown.
 * @returns {'early_access' | 'paid' | 'admin_invite' | 'self_service' | 'admin'}
 */
export function resolveUserOrigin(row = {}) {
  const src = row.signupSource != null ? String(row.signupSource).trim().toLowerCase() : '';
  if (src === 'early_access') return 'early_access';
  if (src === 'paid') return 'paid';
  if (src === 'admin_invite') return 'admin_invite';
  if (src) return 'self_service';
  if (
    row.signupPending ||
    (row.signupMetadata && typeof row.signupMetadata === 'object') ||
    (row.companySignupAutoCreated && row.isCompanySignupCreator !== false)
  ) {
    return 'self_service';
  }
  return 'admin';
}

/** Cohort de contato (Leads) — não é só cadastro no painel. */
export function isSelfServiceOrigin(origin) {
  return origin === 'early_access' || origin === 'paid' || origin === 'self_service';
}
