import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { COOKIE_NAME, sessionCookieOptions } from './lib/session-cookie';
import { shouldSlideSession, MANAGER_SESSION_MAX_AGE_SEC } from './lib/session-ttl';
import {
  signEmployeeTokenEdge,
  signManagerTokenEdge,
  verifyTokenEdge,
  verifyEmployeeTokenEdge,
} from './lib/auth-edge';
import { isManagerRole } from './lib/permissions';
import { ERR } from './lib/api-error-codes';
import {
  EMPLOYEE_COOKIE_NAME,
  EMPLOYEE_SESSION_MAX_AGE,
} from './lib/employee-auth-constants';
import {
  EMPLOYEE_PATH,
  isEmployeeAppPath,
  isPublicEmployeeAuthPath,
} from './lib/employee-paths';
import {
  JOB_ATTR_COOKIE,
  attributionCookieOptions,
  decodeAttributionCookie,
  encodeAttributionCookie,
  mergeAttribution,
  parseAttributionFromSearchParams,
  searchHasAttribution,
} from './lib/job-attribution';
import {
  applyContentSecurityPolicyHeaders,
  resolveContentSecurityPolicy,
} from './lib/security-csp';
import { isCrawlerNoIndexPath } from './lib/crawler-guard';
import {
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE_SEC,
  localeFromAcceptLanguage,
} from './lib/locale-negotiation';

const detectedLocaleByRequest = new WeakMap();
const nonceByRequest = new WeakMap();

/** First visit without NEXT_LOCALE: picks the browser language (unsupported -> en). */
function detectMissingLocale(request) {
  if (request.nextUrl.pathname.startsWith('/api/')) return;
  if (request.cookies.get(LOCALE_COOKIE)?.value) return;
  const locale = localeFromAcceptLanguage(request.headers.get('accept-language'));
  request.cookies.set(LOCALE_COOKIE, locale);
  detectedLocaleByRequest.set(request, locale);
}

/** Forwards request headers so server components see cookies set in `proxy`. */
function nextResponse(request) {
  return NextResponse.next({ request: { headers: request.headers } });
}

function withDetectedLocaleCookie(request, response) {
  const locale = detectedLocaleByRequest.get(request);
  if (!locale) return response;
  response.cookies.set(LOCALE_COOKIE, locale, {
    path: '/',
    maxAge: LOCALE_COOKIE_MAX_AGE_SEC,
    sameSite: 'lax',
  });
  return response;
}

/**
 * Sliding: reemite cookie se JWT ainda válido e perto do fim (falha nunca bloqueia o request).
 * @param {'manager'|'employee'} kind
 */
async function applySessionSlide(response, kind, payload) {
  try {
    if (!shouldSlideSession(payload?.exp)) return;
    if (kind === 'manager') {
      const token = await signManagerTokenEdge(payload);
      if (!token) return;
      response.cookies.set(
        COOKIE_NAME,
        token,
        sessionCookieOptions({ maxAge: MANAGER_SESSION_MAX_AGE_SEC })
      );
      return;
    }
    const token = await signEmployeeTokenEdge(payload);
    if (!token) return;
    response.cookies.set(
      EMPLOYEE_COOKIE_NAME,
      token,
      sessionCookieOptions({ maxAge: EMPLOYEE_SESSION_MAX_AGE })
    );
  } catch {
    /* ignore slide failures */
  }
}

/** Cabeçalhos de segurança (baseline + HSTS/CSP opcionais via env). */
function withSecurityHeaders(response, { noindex = false, geolocation = false, nonce } = {}) {
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'SAMEORIGIN');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', `camera=(), microphone=(), geolocation=${geolocation ? '(self)' : '()'}`);

  if (noindex) {
    response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  }

  applyContentSecurityPolicyHeaders(response, nonce);

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || '').trim();
  const hstsOn =
    process.env.ENABLE_HSTS === 'true' ||
    (process.env.NODE_ENV === 'production' && appUrl.startsWith('https://'));
  if (hstsOn) {
    const maxAge = process.env.HSTS_MAX_AGE?.trim() || '31536000';
    const preload = process.env.HSTS_PRELOAD === 'true' ? '; preload' : '';
    response.headers.set(
      'Strict-Transport-Security',
      `max-age=${maxAge}; includeSubDomains${preload}`
    );
  }
  return response;
}

function secureResponse(request, response) {
  const { pathname } = request.nextUrl;
  const noindex = isCrawlerNoIndexPath(pathname);
  const geolocation = pathname === '/employee' || pathname.startsWith('/employee/');
  return withDetectedLocaleCookie(
    request,
    withJobAttributionCookie(
      request,
      withSecurityHeaders(response, {
        noindex,
        geolocation,
        nonce: nonceByRequest.get(request),
      })
    )
  );
}

function withJobAttributionCookie(request, response) {
  try {
    if (!searchHasAttribution(request.nextUrl.searchParams)) return response;
    const existing = decodeAttributionCookie(request.cookies.get(JOB_ATTR_COOKIE)?.value);
    const incoming = parseAttributionFromSearchParams(
      request.nextUrl.searchParams,
      request.nextUrl.pathname,
      { sessionId: existing?.sessionId }
    );
    const merged = mergeAttribution(existing, incoming);
    const encoded = encodeAttributionCookie(merged);
    if (encoded) {
      response.cookies.set(JOB_ATTR_COOKIE, encoded, attributionCookieOptions());
    }
  } catch {
    /* ignore attribution failures */
  }
  return response;
}

function isPublicEmployeeSurface(pathname) {
  return (
    isPublicEmployeeAuthPath(pathname) ||
    pathname === '/api/auth/employee/magic-link' ||
    pathname === '/api/auth/employee/session' ||
    pathname === '/api/auth/employee/session-edge' ||
    pathname === '/api/auth/employee/login' ||
    pathname === '/api/auth/employee/set-password' ||
    pathname === '/api/auth/employee/forgot-password' ||
    pathname === '/api/auth/employee/2fa/verify'
  );
}

const SESSION_EDGE_PATH = '/api/auth/session-edge';
const EMPLOYEE_SESSION_EDGE_PATH = '/api/auth/employee/session-edge';

async function sessionEdgeSaysLive(request) {
  try {
    const checkUrl = new URL(SESSION_EDGE_PATH, request.url);
    const res = await fetch(checkUrl, {
      headers: { cookie: request.headers.get('cookie') || '' },
      cache: 'no-store',
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Route handlers under /api re-hydrate the session (session_version) on their own. */
function claimHasSessionVersion(payload) {
  const sv = Number(payload?.sv);
  return Number.isFinite(sv) && sv >= 1;
}

async function isManagerSessionLive(request, payload) {
  if (request.nextUrl.pathname.startsWith('/api/')) return claimHasSessionVersion(payload);
  try {
    const checkUrl = new URL(SESSION_EDGE_PATH, request.url);
    const res = await fetch(checkUrl, {
      headers: { cookie: request.headers.get('cookie') || '' },
      cache: 'no-store',
    });
    if (res.ok) return true;
    // Resposta chegou mas negou (401) ou falhou (5xx/etc.) — não caímos no
    // fallback permissivo; só o `throw` do fetch (rede indisponível) libera.
    return false;
  } catch {
    /* Self-fetch do middleware falha em alguns deploys (ingress/edge) — ver fallback abaixo. */
  }
  return claimHasSessionVersion(payload);
}

async function isEmployeeSessionLive(request, payload) {
  if (request.nextUrl.pathname.startsWith('/api/')) return claimHasSessionVersion(payload);
  try {
    const checkUrl = new URL(EMPLOYEE_SESSION_EDGE_PATH, request.url);
    const res = await fetch(checkUrl, {
      headers: { cookie: request.headers.get('cookie') || '' },
      cache: 'no-store',
    });
    if (res.ok) return true;
    return false;
  } catch {
    /* Self-fetch falha em alguns deploys — fallback: claim sv presente. */
  }
  return claimHasSessionVersion(payload);
}

export async function proxy(request) {
  // Overwrite client-supplied values; Next extracts this nonce for its own scripts.
  const nonce = randomBytes(16).toString('base64');
  nonceByRequest.set(request, nonce);
  request.headers.set('x-nonce', nonce);
  request.headers.set('Content-Security-Policy', resolveContentSecurityPolicy(nonce));
  const { pathname } = request.nextUrl;
  detectMissingLocale(request);

  if (pathname === SESSION_EDGE_PATH || pathname === EMPLOYEE_SESSION_EDGE_PATH) {
    return secureResponse(request, nextResponse(request));
  }

  if (pathname.startsWith('/dashboard') || pathname.startsWith('/api/admin')) {
    const token = request.cookies.get(COOKIE_NAME)?.value;
    const payload = token ? await verifyTokenEdge(token) : null;

    if (!isManagerRole(payload)) {
      if (token && (await sessionEdgeSaysLive(request))) {
        return secureResponse(request, nextResponse(request));
      }
      if (pathname.startsWith('/api/')) {
        return secureResponse(
          request,
          NextResponse.json({ error: 'UNAUTHORIZED', errorCode: ERR.UNAUTHORIZED }, { status: 401 })
        );
      }
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('redirect', pathname);
      loginUrl.searchParams.set('reason', 'expired');
      return secureResponse(request, NextResponse.redirect(loginUrl));
    }

    const live = await isManagerSessionLive(request, payload);
    if (!live) {
      if (pathname.startsWith('/api/')) {
        return secureResponse(
          request,
          NextResponse.json({ error: 'UNAUTHORIZED', errorCode: ERR.UNAUTHORIZED }, { status: 401 })
        );
      }
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('redirect', pathname);
      loginUrl.searchParams.set('reason', 'expired');
      return secureResponse(request, NextResponse.redirect(loginUrl));
    }

    const response = nextResponse(request);
    await applySessionSlide(response, 'manager', payload);
    return secureResponse(request, response);
  }

  // Collaborator hub — employee JWT only (never manager cookie alone).
  if (
    (isEmployeeAppPath(pathname) || pathname.startsWith('/api/employee')) &&
    !isPublicEmployeeSurface(pathname)
  ) {
    const empToken = request.cookies.get(EMPLOYEE_COOKIE_NAME)?.value;
    const emp = empToken ? await verifyEmployeeTokenEdge(empToken) : null;
    if (!emp) {
      if (pathname.startsWith('/api/')) {
        return secureResponse(
          request,
          NextResponse.json({ error: 'UNAUTHORIZED', errorCode: ERR.UNAUTHORIZED }, { status: 401 })
        );
      }
      const loginUrl = new URL(EMPLOYEE_PATH.LOGIN, request.url);
      loginUrl.searchParams.set('reason', 'expired');
      return secureResponse(request, NextResponse.redirect(loginUrl));
    }
    const live = await isEmployeeSessionLive(request, emp);
    if (!live) {
      if (pathname.startsWith('/api/')) {
        return secureResponse(
          request,
          NextResponse.json({ error: 'UNAUTHORIZED', errorCode: ERR.UNAUTHORIZED }, { status: 401 })
        );
      }
      const loginUrl = new URL(EMPLOYEE_PATH.LOGIN, request.url);
      loginUrl.searchParams.set('reason', 'expired');
      return secureResponse(request, NextResponse.redirect(loginUrl));
    }

    const response = nextResponse(request);
    await applySessionSlide(response, 'employee', emp);
    return secureResponse(request, response);
  }

  // Polling /api/me (notif, locale): também conta como atividade para sliding do gestor.
  if (pathname.startsWith('/api/me')) {
    const token = request.cookies.get(COOKIE_NAME)?.value;
    const payload = token ? await verifyTokenEdge(token) : null;
    if (isManagerRole(payload) && (await isManagerSessionLive(request, payload))) {
      const response = nextResponse(request);
      await applySessionSlide(response, 'manager', payload);
      return secureResponse(request, response);
    }
  }

  return secureResponse(request, nextResponse(request));
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|brand/|illustrations/|site.webmanifest).*)',
  ],
};
