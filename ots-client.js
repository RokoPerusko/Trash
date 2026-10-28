// Zajednicki klijent za OpenTAKServer API (koriste ga server.js i ots-call.mjs).
//
// Prijava prema dokumentaciji OTS-a (Authentication):
//   1) GET  /api/login                       -> csrf_token (+ kolacic sesije)
//   2) POST /api/login?include_auth_token    -> authentication_token (+ kolacic), uz zaglavlja
//                                               X-XSRF-TOKEN i Referer
// Nakon toga se salju kolacic, "Authentication-Token" i (za ne-GET zahtjeve) X-XSRF-TOKEN.
// Ako to ne uspije, probaju se stariji nacini (/oauth/token -> JWT kao Bearer).
//
// Sigurnost: koristi node:http(s) umjesto fetch-a da (a) provjera TLS certifikata moze
// biti iskljucena samo za ovaj klijent (`insecure`), ne za cijeli proces, (b) se
// preusmjeravanja ne prate (kolacici i tokeni ne smiju otici na drugi host), (c) postoji
// vremensko ogranicenje i najveca velicina odgovora. Lozinka se nikad ne salje u URL-u.
import http from 'node:http';
import https from 'node:https';

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 20_000_000;

function httpRequest(urlString, { method = 'GET', headers = {}, body, insecure = false } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(urlString);
    const isHttps = target.protocol === 'https:';
    const options = { method, headers: { ...headers }, timeout: REQUEST_TIMEOUT_MS };
    if (body !== undefined) options.headers['Content-Length'] = Buffer.byteLength(body);
    if (insecure && isHttps) options.rejectUnauthorized = false;
    const req = (isHttps ? https : http).request(target, options, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_RESPONSE_BYTES) return req.destroy(new Error('odgovor je prevelik'));
        chunks.push(chunk);
      });
      res.on('error', reject);
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({
          status: res.statusCode,
          ok: res.statusCode >= 200 && res.statusCode < 300,
          headers: {
            get: (name) => {
              const v = res.headers[name.toLowerCase()];
              return Array.isArray(v) ? v.join(', ') : (v ?? null);
            },
            getSetCookie: () => res.headers['set-cookie'] || [],
          },
          text: async () => text,
        });
      });
    });
    req.on('timeout', () => req.destroy(new Error('isteklo vrijeme zahtjeva')));
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

export function createOtsClient({ url, username, password, insecure = false, log = () => {} }) {
  const base = String(url || '').replace(/\/+$/, '');
  const send = (target, opts) => httpRequest(target, { ...opts, insecure });
  const jar = new Map(); // kolacici: ime -> vrijednost
  const st = { token: null, bearer: null, csrf: null, strategy: null, clockSkewMs: 0 };

  const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  function absorb(res) {
    const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    for (const c of list) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
    // razlika izmedju sata ovog racunala i OTS servera (vidjeno: samostalni OTS VM-ovi
    // znaju imati pogresan/neusklaren sat sto cini svaki novostvoreni marker "istekao"
    // odmah jer OTS racuna stale = (vlastito pogresno "sada") + 24h)
    const serverDate = Date.parse(res.headers.get('date') || '');
    if (Number.isFinite(serverDate)) st.clockSkewMs = Date.now() - serverDate;
  }
  const parse = (text) => {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  };
  const findCsrf = (j) => j?.response?.csrf_token || j?.csrf_token || null;
  const findToken = (j) =>
    j?.response?.user?.authentication_token ||
    j?.authentication_token ||
    j?.access_token ||
    j?.token ||
    j?.jwt ||
    null;

  function authHeaders(method) {
    const h = {};
    const ck = cookieHeader();
    if (ck) h.Cookie = ck;
    if (st.token) h['Authentication-Token'] = st.token;
    if (st.bearer) h.Authorization = `Bearer ${st.bearer}`;
    if (method !== 'GET' && method !== 'HEAD') {
      if (st.csrf) {
        h['X-XSRF-TOKEN'] = st.csrf;
        h['X-CSRF-Token'] = st.csrf;
      }
      h.Referer = base + '/';
    }
    return h;
  }

  async function loginDocumented() {
    const g = await send(`${base}/api/login`, {
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    });
    absorb(g);
    const gj = parse(await g.text());
    const csrf = findCsrf(gj);
    const headers = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Referer: base + '/',
    };
    if (csrf) {
      headers['X-XSRF-TOKEN'] = csrf;
      headers['X-CSRF-Token'] = csrf;
    }
    const ck = cookieHeader();
    if (ck) headers.Cookie = ck;
    const p = await send(`${base}/api/login?include_auth_token`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ username, password }),
    });
    absorb(p);
    const text = await p.text();
    const pj = parse(text);
    if (!p.ok) throw new Error(`HTTP ${p.status}${text ? ' ' + text.slice(0, 160) : ''}`);
    const token = findToken(pj);
    if (!token && !jar.size) throw new Error('odgovor bez tokena i kolacica');
    st.token = token;
    st.bearer = null;
    st.csrf = findCsrf(pj) || csrf;
    return 'GET+POST /api/login (token + CSRF)';
  }

  async function loginOauth(kind) {
    const body = { username, password };
    let res;
    if (kind === 'json') {
      res = await send(`${base}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } else {
      res = await send(`${base}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(body).toString(),
      });
    }
    absorb(res);
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const token = findToken(parse(text));
    if (!token) throw new Error('odgovor bez tokena');
    st.bearer = token;
    st.token = null;
    st.csrf = null;
    return `/oauth/token (${kind})`;
  }

  async function login() {
    jar.clear();
    st.token = st.bearer = st.csrf = st.strategy = null;
    const tries = [() => loginDocumented(), () => loginOauth('json'), () => loginOauth('form')];
    const names = ['/api/login (dokumentirano)', '/oauth/token JSON', '/oauth/token form'];
    const errors = [];
    for (let i = 0; i < tries.length; i++) {
      try {
        st.strategy = await tries[i]();
        log(`[prijava] uspjelo: ${st.strategy}`);
        return;
      } catch (e) {
        errors.push(`${names[i]}: ${e.cause?.code || e.code || e.message}`);
        jar.clear();
        st.token = st.bearer = st.csrf = null;
      }
    }
    st.strategy = null;
    throw new Error('Prijava nije uspjela. ' + errors.join(' | '));
  }

  async function request(method, path, { json: payload, retry = true } = {}) {
    method = method.toUpperCase();
    if (!st.strategy) await login();
    const headers = { Accept: 'application/json', ...authHeaders(method) };
    const init = { method, headers };
    if (payload !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(payload);
    }
    const res = await send(`${base}${path}`, init);
    absorb(res);
    const text = await res.text();
    const needRelogin =
      res.status === 401 || res.status === 403 || (res.status === 400 && /csrf/i.test(text)); // istekao ili nedostaje CSRF token
    if (needRelogin && retry) {
      st.strategy = null;
      return request(method, path, { json: payload, retry: false });
    }
    return { status: res.status, json: parse(text), text };
  }

  return {
    login,
    request,
    get strategy() {
      return st.strategy;
    },
    get csrf() {
      return st.csrf;
    },
    get clockSkewMs() {
      return st.clockSkewMs;
    },
  };
}
