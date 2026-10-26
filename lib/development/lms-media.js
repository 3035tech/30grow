/**
 * LMS media helpers safe for client bundles (no pg / Node built-ins).
 * Server code may import from here or via re-exports in `lib/development/lms.js`.
 */

export const LMS_CONTENT_KINDS = Object.freeze(['link', 'youtube', 'vimeo', 'pdf']);

/** Infer content_kind from URL when caller omits it. */
export function inferLmsContentKind(url) {
  const s = String(url || '').trim().toLowerCase();
  if (!s) return 'link';
  if (/\.pdf(\?|#|$)/i.test(s) || s.includes('application/pdf')) return 'pdf';
  if (s.includes('youtube.com') || s.includes('youtu.be')) return 'youtube';
  if (s.includes('vimeo.com')) return 'vimeo';
  return 'link';
}

/** YouTube / Vimeo embed URL for in-app player (null = open externally). */
export function lmsYoutubeVideoId(contentUrl) {
  const raw = String(contentUrl || '').trim();
  if (!raw) return null;
  try {
    const u = new URL(raw.includes('://') ? raw : `https://${raw}`);
    let id = u.searchParams.get('v');
    if (!id && u.hostname.includes('youtu.be')) id = u.pathname.replace(/^\//, '').split('/')[0];
    if (!id && u.pathname.includes('/embed/')) id = u.pathname.split('/embed/')[1]?.split('/')[0];
    if (!id && u.pathname.includes('/shorts/')) id = u.pathname.split('/shorts/')[1]?.split('/')[0];
    return id || null;
  } catch {
    return null;
  }
}

export function lmsVimeoVideoId(contentUrl) {
  const raw = String(contentUrl || '').trim();
  const m = raw.match(/vimeo\.com\/(?:video\/)?(\d+)/i);
  return m?.[1] || null;
}

/** YouTube / Vimeo embed URL for in-app player (null = open externally). */
export function lmsEmbedUrl(contentUrl, contentKind) {
  const kind = contentKind || inferLmsContentKind(contentUrl);
  const raw = String(contentUrl || '').trim();
  if (!raw) return null;
  if (kind === 'youtube') {
    const id = lmsYoutubeVideoId(raw);
    if (id) {
      return `https://www.youtube.com/embed/${encodeURIComponent(id)}?enablejsapi=1&rel=0`;
    }
    return null;
  }
  if (kind === 'vimeo') {
    const id = lmsVimeoVideoId(raw);
    if (id) return `https://player.vimeo.com/video/${id}`;
  }
  if (kind === 'pdf') {
    // CSP frame-src allows 'self' only for PDFs — absolute same-origin or site-relative.
    if (raw.startsWith('/') && !raw.startsWith('//')) return raw;
    return raw.includes('://') ? raw : `https://${raw}`;
  }
  return null;
}

/**
 * Whether a PDF URL can be iframed under default CSP (frame-src 'self' …).
 * External hosts (e.g. example.com) must open in a new tab.
 * @param {string} contentUrl
 * @param {string} [pageOrigin] e.g. window.location.origin
 */
export function lmsPdfCanEmbed(contentUrl, pageOrigin = '') {
  const raw = String(contentUrl || '').trim();
  if (!raw) return false;
  if (raw.startsWith('/') && !raw.startsWith('//')) return true;
  const origin = String(pageOrigin || '').replace(/\/$/, '');
  if (!origin) return false;
  try {
    return new URL(raw, origin).origin === origin;
  } catch {
    return false;
  }
}
