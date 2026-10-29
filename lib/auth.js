// Prijava: sesije u memoriji, ogranicenje pokusaja i pomocne funkcije za kolacice.
// Korisnici se provjeravaju prema OTS-u (server.js), ovdje nema lozinki ni hashiranja.
import { randomBytes, createHash } from 'node:crypto';

export const SESSION_COOKIE = 'tak_session';

const hashToken = (token) => createHash('sha256').update(token).digest('hex');

// Sesije se cuvaju pod hashom tokena, pa ispis memorije ne otkriva valjane kolacice.
// Gase se apsolutno nakon ttlMs; restart servera odjavljuje sve (namjerno, bez datoteke).
export function createSessionStore({ ttlMs, max = 500, now = Date.now }) {
  const sessions = new Map();
  const prune = () => {
    for (const [key, s] of sessions) if (s.expiresAt <= now()) sessions.delete(key);
  };
  return {
    create(data) {
      prune();
      if (sessions.size >= max) sessions.delete(sessions.keys().next().value); // najstarija
      const token = randomBytes(32).toString('hex');
      sessions.set(hashToken(token), { ...data, expiresAt: now() + ttlMs });
      return token;
    },
    get(token) {
      if (!token) return null;
      const key = hashToken(token);
      const s = sessions.get(key);
      if (!s) return null;
      if (s.expiresAt <= now()) {
        sessions.delete(key);
        return null;
      }
      return s;
    },
    destroy(token) {
      if (token) sessions.delete(hashToken(token));
    },
    size: () => sessions.size,
  };
}

// Ogranicenje neuspjelih pokusaja po kljucu (IP, korisnicko ime): nakon `max` neuspjeha u
// prozoru kljuc je blokiran do isteka prozora. Uspjesna prijava brise brojac.
export function createAttemptLimiter({ windowMs, max, now = Date.now }) {
  const entries = new Map();
  const live = (key) => {
    const e = entries.get(key);
    if (e && e.resetAt <= now()) {
      entries.delete(key);
      return null;
    }
    return e || null;
  };
  return {
    retryAfterMs(key) {
      const e = live(key);
      return e && e.count >= max ? e.resetAt - now() : 0;
    },
    fail(key) {
      const e = live(key) || { count: 0, resetAt: now() + windowMs };
      e.count++;
      entries.set(key, e);
      if (entries.size > 10_000) entries.delete(entries.keys().next().value);
    },
    clear: (key) => entries.delete(key),
  };
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

// path: dio adrese za koji kolacic vrijedi; "/karta/" kad je aplikacija iza proxyja pod podputanjom
export function sessionCookie(value, { maxAgeSec, secure, path = '/' }) {
  return [
    `${SESSION_COOKIE}=${value}`,
    `Path=${path}`,
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${maxAgeSec}`,
    secure ? 'Secure' : null,
  ]
    .filter(Boolean)
    .join('; ');
}

// IP klijenta; iza vlastitog reverznog proxyja (TRUST_PROXY=1) vrijedi zadnji unos
// X-Forwarded-For, tj. onaj koji je dodao nas proxy, a ne onaj koji je klijent mogao podmetnuti.
export function clientIp(req, trustProxy) {
  if (trustProxy) {
    const parts = String(req.headers['x-forwarded-for'] || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  return req.socket.remoteAddress || 'nepoznato';
}

export const isLoopbackHost = (host) => ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host);
