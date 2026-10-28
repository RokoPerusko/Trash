// Rute koje ne traze prijavu: zdravlje, stanje sesije, prijava i odjava.
import { clientIp, SESSION_COOKIE, parseCookies, sessionCookie } from '../../lib/auth.js';
import { AUTH_REQUIRED, TRUST_PROXY } from '../config.js';
import { sendJson, hasAppHeader } from '../http.js';
import { audit } from '../data.js';
import { sessions, handleLogin, cookieOptions } from '../login.js';

// sesija iz kolacica; kad je prijava iskljucena, svatko je "korisnik" s pravom uredjivanja
export function getSession(req) {
  if (!AUTH_REQUIRED) return { username: null, roles: [], canEdit: true };
  return sessions.get(parseCookies(req.headers.cookie)[SESSION_COOKIE]);
}

export async function handleSessionRoutes({ req, res, url, session }) {
  if (url.pathname === '/api/health') return sendJson(res, { ok: true });
  if (url.pathname === '/api/session') {
    return sendJson(res, {
      authRequired: AUTH_REQUIRED,
      user: session?.username ?? null,
      roles: session?.roles ?? [],
      canEdit: session?.canEdit ?? false,
      authenticated: !!session,
    });
  }
  if (url.pathname === '/api/login' && req.method === 'POST') {
    return handleLogin(req, res);
  }
  if (url.pathname === '/api/logout' && req.method === 'POST') {
    if (!hasAppHeader(req)) return sendJson(res, { error: 'zabranjeno' }, 403);
    if (session) audit.record(session.username, clientIp(req, TRUST_PROXY), 'odjava');
    sessions.destroy(parseCookies(req.headers.cookie)[SESSION_COOKIE]);
    return sendJson(res, { ok: true }, 200, {
      'Set-Cookie': sessionCookie('', { ...cookieOptions(req), maxAgeSec: 0 }),
    });
  }
  return false;
}
