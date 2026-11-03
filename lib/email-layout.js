import brandTokens from './marketing/brand-tokens.cjs';
import { localeHtmlLang, normalizeLocale } from './i18n.js';

const { GROW } = brandTokens;
const MAIL_COPY = {
  'pt-BR': { open: 'Abrir no 30Grow', fallback: 'Se o botão não abrir, copie este endereço:', footer: 'Mensagem enviada pelo 30Grow.' },
  'pt-PT': { open: 'Abrir no 30Grow', fallback: 'Se o botão não abrir, copie este endereço:', footer: 'Mensagem enviada pelo 30Grow.' },
  en: { open: 'Open in 30Grow', fallback: 'If the button does not open, copy this address:', footer: 'Sent by 30Grow.' },
  'es-ES': { open: 'Abrir en 30Grow', fallback: 'Si el botón no funciona, copia esta dirección:', footer: 'Mensaje enviado por 30Grow.' },
  'es-419': { open: 'Abrir en 30Grow', fallback: 'Si el botón no funciona, copia esta dirección:', footer: 'Mensaje enviado por 30Grow.' },
  'fr-FR': { open: 'Ouvrir dans 30Grow', fallback: 'Si le bouton ne fonctionne pas, copiez cette adresse :', footer: 'Message envoyé par 30Grow.' },
  'de-DE': { open: 'In 30Grow öffnen', fallback: 'Falls die Schaltfläche nicht funktioniert, kopieren Sie diese Adresse:', footer: 'Von 30Grow gesendet.' },
};

export function escapeEmailHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeHttpUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
  } catch {
    return '';
  }
}

function textToBlocks(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const blocks = [];
  let list = [];
  let cta = null;

  const flushList = () => {
    if (!list.length) return;
    blocks.push(`<ul style="margin:0 0 18px;padding-left:22px;color:${GROW.textPrimary};">${list.map((item) => `<li style="margin:0 0 8px;line-height:1.6;">${escapeEmailHtml(item)}</li>`).join('')}</ul>`);
    list = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushList();
      continue;
    }
    const bullet = line.match(/^(?:[-*•])\s+(.+)$/);
    if (bullet) {
      list.push(bullet[1]);
      continue;
    }
    flushList();

    const urlMatch = line.match(/https?:\/\/[^\s<>]+/i);
    const url = urlMatch ? safeHttpUrl(urlMatch[0].replace(/[),.;]+$/, '')) : '';
    if (url && !cta) {
      const label = line.slice(0, line.indexOf(urlMatch[0])).replace(/[\s:–—-]+$/, '').trim();
      cta = { url, label: label || 'Abrir no 30Grow' };
      const before = line.slice(0, line.indexOf(urlMatch[0])).replace(/[:\s]+$/, '').trim();
      const after = line.slice(line.indexOf(urlMatch[0]) + urlMatch[0].length).trim();
      if (before && !label) blocks.push(`<p style="margin:0 0 12px;font-size:15px;line-height:1.65;color:${GROW.textPrimary};">${escapeEmailHtml(before)}</p>`);
      if (after) blocks.push(`<p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:${GROW.textSecondary};">${escapeEmailHtml(after)}</p>`);
      continue;
    }

    const linked = url
      ? escapeEmailHtml(line).replace(escapeEmailHtml(urlMatch[0]), `<a href="${escapeEmailHtml(url)}" style="color:${GROW.action};word-break:break-all;">${escapeEmailHtml(urlMatch[0])}</a>`)
      : escapeEmailHtml(line);
    blocks.push(`<p style="margin:0 0 14px;font-size:15px;line-height:1.65;color:${GROW.textPrimary};">${linked}</p>`);
  }
  flushList();
  return { html: blocks.join('\n'), cta };
}

export function renderEmailLayout({ subject, title = subject, subtitle = '', text = '', contentHtml = null, preheader = '', ctaUrl = '', ctaLabel = '', locale = 'pt-BR' }) {
  const loc = normalizeLocale(locale);
  const copy = MAIL_COPY[loc] || MAIL_COPY['pt-BR'];
  const content = contentHtml == null ? textToBlocks(text) : { html: contentHtml, cta: null };
  const actionUrl = safeHttpUrl(ctaUrl || content.cta?.url || '');
  const actionLabel = (ctaUrl && ctaLabel) || content.cta?.label || copy.open;
  const cta = actionUrl
    ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:24px 0 12px;"><tr><td bgcolor="${GROW.action}" style="border-radius:8px;"><a href="${escapeEmailHtml(actionUrl)}" style="display:inline-block;padding:13px 20px;border-radius:8px;color:#ffffff;font-family:Arial,sans-serif;font-size:15px;font-weight:700;text-decoration:none;">${escapeEmailHtml(actionLabel)}</a></td></tr></table><p style="margin:0 0 20px;font-size:12px;line-height:1.5;color:${GROW.textSecondary};word-break:break-all;">${escapeEmailHtml(copy.fallback)}<br><a href="${escapeEmailHtml(actionUrl)}" style="color:${GROW.action};">${escapeEmailHtml(actionUrl)}</a></p>`
    : '';

  return `<!doctype html>
<html lang="${escapeEmailHtml(localeHtmlLang(loc))}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeEmailHtml(title)}</title></head>
<body style="margin:0;padding:0;background:${GROW.background};font-family:Arial,Helvetica,sans-serif;color:${GROW.textPrimary};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeEmailHtml(preheader || String(text).trim().split(/\n+/)[0] || subject)}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="${GROW.background}" style="width:100%;background:${GROW.background};">
    <tr><td align="center" style="padding:28px 12px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;max-width:640px;border:1px solid ${GROW.border};border-radius:14px;overflow:hidden;background:${GROW.surface};">
        <tr><td bgcolor="${GROW.navy}" style="padding:18px 28px;background:${GROW.navy};"><span style="font-size:20px;font-weight:700;letter-spacing:-.4px;color:#ffffff;">30Grow</span></td></tr>
        <tr><td style="padding:28px 28px 18px;">
          <h1 style="margin:0 0 22px;font-size:23px;line-height:1.3;font-weight:700;color:${GROW.textPrimary};">${escapeEmailHtml(title)}</h1>
          ${subtitle ? `<p style="margin:-12px 0 22px;font-size:14px;line-height:1.5;color:${GROW.textSecondary};">${escapeEmailHtml(subtitle)}</p>` : ''}
          ${content.html}
          ${cta}
        </td></tr>
        <tr><td style="padding:16px 28px 20px;border-top:1px solid ${GROW.border};background:#F8FAFC;"><p style="margin:0;font-size:12px;line-height:1.55;color:${GROW.textSecondary};">${escapeEmailHtml(copy.footer)}</p></td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
