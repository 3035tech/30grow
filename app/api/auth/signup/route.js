import { runtimeAppUrl } from '../../../../lib/app-url.js';
import { query } from '../../../../lib/db.js';
import {
  hashUnusablePassword,
  issuePasswordSetupInvite,
} from '../../../../lib/user-password-invite.js';
import { apiError, ERR, httpStatusForError } from '../../../../lib/api-error.js';
import { enqueueTransactionalMail, isMailConfigured } from '../../../../lib/mail.js';
import { generateUniqueCompanySlug } from '../../../../lib/slugify.js';
import { trackLandingEvent } from '../../../../lib/landing-analytics.js';
import { checkRateLimit, clientIpFromRequest } from '../../../../lib/rate-limit.js';
import { verifyTurnstileToken } from '../../../../lib/turnstile.js';
import {
  createSelfServiceSignupIdentity,
  SELF_SERVICE_COMPANY_ACTION,
} from '../../../../lib/self-service-signup.js';
import { normalizeSignupJobTitle } from '../../../../lib/signup-job-titles.js';
import { contentLocale, t as i18nT } from '../../../../lib/i18n.js';

/**
 * Self-service signup: cria user pendente + company (ou associa a existente).
 * POST /api/auth/signup
 *
 * Segurança:
 * - Rate limit por IP + Turnstile
 * - Conta já ativa → { ok: true } uniforme (anti-enum) + e-mail de lembrete
 * - SIGNUP_DOMAIN_MATCH=true: ao juntar company existente, role = hr (não direction)
 */
export async function POST(request) {
  try {
    const ip = clientIpFromRequest(request);
    const rl = await checkRateLimit(`signup:${ip}`, 8, 15 * 60 * 1000);
    if (!rl.ok) {
      return apiError(
        request,
        ERR.RATE_LIMIT,
        429,
        {},
        { headers: { 'Retry-After': String(rl.retryAfterSec) } }
      );
    }

    const body = await request.json().catch(() => ({}));

    const turnstile = await verifyTurnstileToken({
      token: body.turnstileToken,
      remoteIp: ip,
    });
    if (!turnstile.ok) {
      return apiError(
        request,
        ERR.TURNSTILE_FAILED,
        httpStatusForError(ERR.TURNSTILE_FAILED)
      );
    }

    const {
      email,
      companyName,
      fullName,
      jobTitle = '',
      jobTitleOther = '',
      teamSize = '',
      painPoints = '',
      locale = 'pt-BR',
      sessionId = null,
      utmSource = null,
      utmMedium = null,
      utmCampaign = null,
    } = body;

    // Validações
    const emailClean = String(email || '')
      .trim()
      .toLowerCase();
    if (!emailClean || !emailClean.includes('@') || emailClean.length > 254) {
      return apiError(request, ERR.EMAIL_REQUIRED, 400);
    }
    if (!companyName || !fullName) {
      return apiError(request, ERR.REQUIRED_FIELDS_MISSING, 400);
    }
    if (!isMailConfigured()) {
      return apiError(request, ERR.SMTP_NOT_CONFIGURED, 503);
    }

    const appUrl = String(runtimeAppUrl() || '')
      .trim()
      .replace(/\/+$/, '');
    if (!appUrl) {
      return apiError(request, ERR.APP_URL_NOT_CONFIGURED, httpStatusForError(ERR.APP_URL_NOT_CONFIGURED));
    }

    // Check se email já existe
    const existing = await query(
      `SELECT id, active, deleted, signup_pending, role, company_id
       FROM users
       WHERE LOWER(TRIM(email)) = $1
       LIMIT 1`,
      [emailClean]
    );

    if (existing.rowCount > 0) {
      const user = existing.rows[0];

      if (!user.deleted && user.active && !user.signup_pending) {
        // Anti-enum: mesma forma de sucesso; e-mail de lembrete (já tem conta).
        if (isMailConfigured()) {
          const loc = contentLocale(locale);
          const loginUrl = `${appUrl}/login`;
          const subject =
            i18nT(loc, 'ui.signupRoute.youAlreadyHaveA30grow');
          const text =
            i18nT(loc, 'ui.signupRoute.someoneTriedToSignUp', { loginUrl });
          enqueueTransactionalMail({
            to: emailClean,
            subject,
            text,
            html: `<p>${text.replace(/\n/g, '<br/>')}</p>`,
          });
        }
        await trackLandingEvent({
          eventType: 'signup_existing',
          sessionId,
          utmSource,
          utmMedium,
          utmCampaign,
          metadata: { email: emailClean },
        });
        return Response.json({ ok: true });
      }

      if (user.signup_pending) {
        // Signup pendente → reenviar email de confirmação
        const issued = await issuePasswordSetupInvite(user.id, {
          appUrl,
          locale: locale || 'pt-BR',
          purpose: 'invite',
        });
        if (!issued.ok) {
          return apiError(request, issued.code, httpStatusForError(issued.code));
        }

        await trackLandingEvent({
          eventType: 'signup_resent',
          sessionId,
          utmSource,
          utmMedium,
          utmCampaign,
          metadata: { email: emailClean, userId: user.id },
        });

        // Mesma forma de sucesso do create (sem IDs) — reduz distinção pending vs novo.
        return Response.json({ ok: true });
      }
    }

    // Criar company ou associar a existente por domain match
    const domain = emailClean.split('@')[1];
    let companyId;
    let companyAction = SELF_SERVICE_COMPANY_ACTION.CREATE;

    // Opção: buscar company existente por domain (opt-in via env — manter false em prod salvo intenção explícita)
    if (process.env.SIGNUP_DOMAIN_MATCH === 'true') {
      const domainMatch = await query(
        `SELECT c.id
         FROM companies c
         JOIN users u ON u.company_id = c.id
         WHERE LOWER(TRIM(u.email)) LIKE $1
           AND c.deleted = FALSE
           AND u.deleted = FALSE
           AND u.active = TRUE
         LIMIT 1`,
        [`%@${domain}`]
      );

      if (domainMatch.rowCount > 0) {
        companyId = domainMatch.rows[0].id;
        companyAction = SELF_SERVICE_COMPANY_ACTION.JOIN;
      }
    }

    // Criar company + user + membership no mesmo commit.
    // Company nova → direction (dona do trial). Domain-match join → hr (menos privilégio).
    const companySlug = companyId ? null : await generateUniqueCompanySlug(companyName);
    const passwordHash = await hashUnusablePassword();
    const normalizedJobTitle = normalizeSignupJobTitle(jobTitle, jobTitleOther);
    const signupMetadata = {
      companyName: String(companyName).trim(),
      fullName: String(fullName).trim(),
      jobTitle: normalizedJobTitle.jobTitle,
      jobTitleOther: normalizedJobTitle.jobTitleOther,
      teamSize: String(teamSize).trim(),
      painPoints: String(painPoints).trim(),
    };

    const created = await createSelfServiceSignupIdentity({
      companyId,
      companyAction,
      companyName,
      companySlug,
      email: emailClean,
      passwordHash,
      locale,
      signupMetadata,
    });
    const { userId } = created;
    companyId = created.companyId;
    const { role } = created;

    const issued = await issuePasswordSetupInvite(userId, {
      appUrl,
      locale: locale || 'pt-BR',
      purpose: 'invite',
    });
    if (!issued.ok) {
      return apiError(request, issued.code, httpStatusForError(issued.code));
    }

    // Analytics
    const userAgent = request.headers.get('user-agent') || null;

    await trackLandingEvent({
      eventType: 'signup_complete',
      sessionId,
      utmSource,
      utmMedium,
      utmCampaign,
      userAgent,
      ipAddress: ip === 'unknown' ? null : ip,
      metadata: {
        userId,
        companyId,
        companyAction,
        role,
        jobTitle: signupMetadata.jobTitle,
        teamSize: signupMetadata.teamSize,
      },
    });

    // Sem userId/companyId na resposta pública (menos vazamento + forma alinhada ao resent).
    return Response.json({ ok: true });
  } catch (err) {
    console.error('[signup] Error:', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
