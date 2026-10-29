// Prijava: korisnici se provjeravaju prema OTS-u, sesija je u kolacicu (lib/auth.js).
import { createOtsClient } from '../ots-client.js';
import { createSessionStore, createAttemptLimiter, sessionCookie, clientIp } from '../lib/auth.js';
import { sendJson, hasAppHeader, readJson } from './http.js';
import { audit } from './data.js';
import {
  env,
  OTS_URL,
  OTS_INSECURE,
  AUTH_REQUIRED,
  TRUST_PROXY,
  SESSION_HOURS,
  COOKIE_PATH,
  LOGIN_WINDOW_MS,
  LOGIN_MAX_PER_IP,
  LOGIN_MAX_PER_USER,
  EDIT_ROLES,
  LOGIN_FAIL_DELAY_MS,
  MAX_CRED_LEN,
  BODY_LIMIT_SMALL,
} from './config.js';

export const sessions = createSessionStore({ ttlMs: SESSION_HOURS * 3600 * 1000 });
const ipLimiter = createAttemptLimiter({ windowMs: LOGIN_WINDOW_MS, max: LOGIN_MAX_PER_IP });
const userLimiter = createAttemptLimiter({ windowMs: LOGIN_WINDOW_MS, max: LOGIN_MAX_PER_USER });
export const canEditWith = (roles) =>
  EDIT_ROLES.size === 0 || roles.some((r) => EDIT_ROLES.has(String(r).toLowerCase()));

// ---------- prijava: provjera prema OTS-u ----------
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const NETWORK_ERROR = /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EHOSTUNREACH|ECONNRESET|isteklo vrijeme/;
const secureCookie = (req) =>
  env.COOKIE_SECURE === '1' || (TRUST_PROXY && req.headers['x-forwarded-proto'] === 'https');
export const cookieOptions = (req) => ({
  maxAgeSec: SESSION_HOURS * 3600,
  secure: secureCookie(req),
  path: COOKIE_PATH,
});

// korisnik je valjan ako ga OTS pusti unutra i vrati njegov profil (/api/me)
async function verifyWithOts(username, password) {
  const client = createOtsClient({ url: OTS_URL, username, password, insecure: OTS_INSECURE });
  await client.login();
  const me = await client.request('GET', '/api/me');
  if (me.status !== 200 || !me.json?.username) throw new Error('OTS nije vratio profil korisnika');
  const roles = (me.json.roles || [])
    .map((r) => (typeof r === 'string' ? r : r?.name))
    .filter(Boolean);
  return { username: String(me.json.username), roles };
}

function tooManyAttempts(res, waitMs) {
  const seconds = Math.ceil(waitMs / 1000);
  return sendJson(
    res,
    { error: `previše pokušaja, pokušaj ponovno za ${Math.ceil(seconds / 60)} min` },
    429,
    { 'Retry-After': String(seconds) },
  );
}

export async function handleLogin(req, res) {
  if (!AUTH_REQUIRED) return sendJson(res, { error: 'prijava nije uključena' }, 404);
  if (!hasAppHeader(req)) return sendJson(res, { error: 'zabranjeno' }, 403);
  const ip = clientIp(req, TRUST_PROXY);
  const ipWait = ipLimiter.retryAfterMs(ip);
  if (ipWait > 0) return tooManyAttempts(res, ipWait);
  const parsed = await readJson(req, BODY_LIMIT_SMALL);
  if (parsed.error) return sendJson(res, { error: parsed.error }, parsed.status);
  const username = typeof parsed.body.username === 'string' ? parsed.body.username.trim() : '';
  const password = typeof parsed.body.password === 'string' ? parsed.body.password : '';
  if (!username || !password || username.length > MAX_CRED_LEN || password.length > MAX_CRED_LEN) {
    return sendJson(res, { error: 'unesi korisničko ime i lozinku' }, 400);
  }
  const userKey = username.toLowerCase();
  const userWait = userLimiter.retryAfterMs(userKey);
  if (userWait > 0) return tooManyAttempts(res, userWait);

  let user;
  try {
    user = await verifyWithOts(username, password);
  } catch (e) {
    if (NETWORK_ERROR.test(e.message)) {
      console.error(`[prijava] OTS nedostupan: ${e.message.slice(0, 200)}`);
      return sendJson(res, { error: 'OTS nije dostupan, pokušaj kasnije' }, 503);
    }
    ipLimiter.fail(ip);
    userLimiter.fail(userKey);
    console.warn(`[prijava] neuspjela prijava korisnika "${username.slice(0, 40)}" s ${ip}`);
    audit.record(username, ip, 'prijava.neuspjela');
    await sleep(LOGIN_FAIL_DELAY_MS);
    return sendJson(res, { error: 'neispravno korisničko ime ili lozinka' }, 401);
  }
  userLimiter.clear(userKey);
  const canEdit = canEditWith(user.roles);
  const token = sessions.create({ ...user, canEdit });
  audit.record(user.username, ip, 'prijava', { canEdit });
  return sendJson(res, { ok: true, user: user.username, roles: user.roles, canEdit }, 200, {
    'Set-Cookie': sessionCookie(token, cookieOptions(req)),
  });
}
