import nodemailer from 'nodemailer';
import { renderEmailLayout } from './email-layout.js';

/** Lê env em runtime (evita valores “congelados” no build standalone) e tira aspas do env_file do Docker. */
function envTrim(key) {
  const raw = process.env[key];
  if (raw == null || raw === '') return '';
  let s = String(raw).trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1);
  }
  return s.trim();
}

function hasRealSmtpConfig() {
  return Boolean(envTrim('SMTP_HOST') && envTrim('MAIL_FROM'));
}

/**
 * Mock in-process (sem SMTP real).
 * - SMTP_MOCK=1 → sempre mock
 * - DTOV=1 sem SMTP_HOST+MAIL_FROM → mock automático (prova offline)
 * Com DTOV + SMTP real (ex. Mailhog local): usa o transporte real.
 */
export function isSmtpMock() {
  if (String(process.env.SMTP_MOCK || '').trim() === '1') return true;
  if (String(process.env.DTOV || '').trim() === '1' && !hasRealSmtpConfig()) return true;
  return false;
}

export function isMailConfigured() {
  if (isSmtpMock()) return true;
  return hasRealSmtpConfig();
}

/** @type {{ to: string, subject: string, text?: string, html?: string, from: string, at: string }[]} */
const mockLog = [];

export function __resetMailMockLog() {
  mockLog.length = 0;
}

export function __getMailMockLog() {
  return mockLog.slice();
}

let cachedTransport = null;

function getTransport() {
  if (isSmtpMock()) return null;
  if (!hasRealSmtpConfig()) return null;
  if (cachedTransport) return cachedTransport;
  const host = envTrim('SMTP_HOST');
  const port = parseInt(envTrim('SMTP_PORT') || '587', 10);
  const secure = envTrim('SMTP_SECURE') === 'true' || port === 465;
  const user = envTrim('SMTP_USER');
  const pass = envTrim('SMTP_PASS');
  cachedTransport = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: user ? { user, pass } : undefined,
  });
  return cachedTransport;
}

function mockFromAddress() {
  return envTrim('MAIL_FROM') || '30Grow Mock <noreply@localhost>';
}

/**
 * @param {{ to: string, subject: string, text?: string, html?: string, locale?: string, ctaLabel?: string, attachments?: Array<{ filename: string, content: Buffer|string, contentType?: string }> }} opts
 */
export async function sendTransactionalMail(opts) {
  const text =
    opts?.text != null
      ? String(opts.text)
      : opts?.html
        ? String(opts.html).replace(/<[^>]+>/g, ' ')
        : '';
  const html = opts?.html != null ? String(opts.html) : renderEmailLayout({
    subject: opts?.subject,
    text,
    locale: opts?.locale,
    ctaLabel: opts?.ctaLabel,
  });

  if (isSmtpMock()) {
    mockLog.push({
      to: String(opts?.to || ''),
      subject: String(opts?.subject || ''),
      text,
      html,
      attachments: Array.isArray(opts?.attachments)
        ? opts.attachments.map((a) => ({
            filename: a?.filename,
            contentType: a?.contentType,
            bytes: a?.content != null ? Buffer.byteLength(a.content) : 0,
          }))
        : undefined,
      from: mockFromAddress(),
      at: new Date().toISOString(),
    });
    return { mocked: true };
  }

  const transport = getTransport();
  if (!transport) {
    const err = new Error('Mail not configured on the server (set SMTP_HOST and MAIL_FROM).');
    err.code = 'MAIL_NOT_CONFIGURED';
    throw err;
  }
  const from = envTrim('MAIL_FROM');
  const mailOpts = {
    from,
    to: opts.to,
    subject: opts.subject,
    text,
    html,
    attachments: Array.isArray(opts.attachments) ? opts.attachments : undefined,
  };
  const maxAttempts = Math.min(3, Math.max(1, Number(process.env.MAIL_RETRY_ATTEMPTS) || 3));
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await transport.sendMail(mailOpts);
      return { ok: true, attempts: attempt };
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts) {
        const delayMs = 200 * attempt;
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }
  throw lastErr;
}

/**
 * Fail-fast if SMTP is missing, then send without blocking the HTTP response.
 * Use on invite/remind routes so the panel can return OK immediately.
 * @param {{ to: string, subject: string, text: string, html?: string }} opts
 */
export function enqueueTransactionalMail(opts) {
  if (!isMailConfigured()) {
    const err = new Error('Mail not configured on the server (set SMTP_HOST and MAIL_FROM).');
    err.code = 'MAIL_NOT_CONFIGURED';
    throw err;
  }
  void sendTransactionalMail(opts).catch((e) => {
    console.error('[mail] background send failed', {
      code: e?.code,
    });
  });
}

/**
 * Health: valida SMTP sem enviar e-mail (nodemailer verify).
 * @returns {Promise<{ ok: boolean, latencyMs: number, error?: string, mocked?: boolean }>}
 */
export async function verifySmtpConnection(timeoutMs = 5000) {
  const started = Date.now();
  if (isSmtpMock()) {
    return { ok: true, latencyMs: Date.now() - started, mocked: true };
  }
  if (!isMailConfigured()) {
    return { ok: false, latencyMs: 0, error: 'not_configured' };
  }
  const transport = getTransport();
  try {
    await Promise.race([
      transport.verify(),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('SMTP verify timeout')), timeoutMs);
      }),
    ]);
    return { ok: true, latencyMs: Date.now() - started };
  } catch (e) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      error: e?.message ? String(e.message).slice(0, 200) : 'smtp_verify_failed',
    };
  }
}
