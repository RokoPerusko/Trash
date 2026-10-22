// Lazni OpenTAKServer samo za testiranje aplikacije bez pravog servera.
// Pokretanje: node mock-ots.js   (slusa na http://127.0.0.1:8099)
import http from 'node:http';

const CSRF = 'CSRF-' + Math.random().toString(36).slice(2);
const SESSION = 'sess123';
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const send = (obj, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
  };
  if (url.pathname === '/api/login' && req.method === 'GET') {
    res.setHeader('Set-Cookie', `session=${SESSION}; Path=/`);
    return send({ meta: { code: 200 }, response: { csrf_token: CSRF } });
  }
  if (url.pathname === '/api/login' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (req.headers['x-xsrf-token'] !== CSRF) return send({ meta: { code: 400 }, response: { errors: ['The CSRF token is missing.'] } }, 400);
      const ok = /tak_roko/.test(body) && /tajna/.test(body);
      if (!ok) return send({ meta: { code: 400 }, response: { errors: ['bad'] } }, 400);
      send({ meta: { code: 200 }, response: { user: { authentication_token: 'MOCK-AUTH-TOKEN' }, csrf_token: CSRF } });
    });
    return;
  }
  if (url.pathname === '/oauth/token') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const ok = /tak_roko/.test(body + req.url) && /tajna/.test(body + req.url);
      ok ? send({ access_token: 'MOCK.JWT.TOKEN', token_type: 'Bearer' }) : send({ error: 'bad' }, 401);
    });
    return;
  }
  const authed = req.headers.authorization === 'Bearer MOCK.JWT.TOKEN' ||
    req.headers['authentication-token'] === 'MOCK-AUTH-TOKEN';
  if (!authed) return send({ error: 'unauthorized' }, 401);
  // kao Flask-Security: JWT/Bearer prolazi, ali DELETE bez CSRF-a pada ako je prijava preko sesije
  if (req.method !== 'GET' && req.headers['x-xsrf-token'] !== CSRF)
    return send({ meta: { code: 400 }, response: { errors: ['The CSRF token is missing.'] } }, 400);
  const t = Date.now() / 1000;
  if (url.pathname === '/api/map_state') {
    return send({
      euds: [
        { uid: 'ANDROID-aaa', callsign: 'ALPHA-1', lat: 45.8150 + Math.sin(t / 5) * 0.0005, lon: 15.9819, hae: 120,
          type: 'a-f-G-U-C' },
        { uid: 'ios-bbb', callsign: 'iPhone', latitude: '45.8000', longitude: '15.9700', type: 'a-f-G-U-C' },
        { uid: 'nogps', callsign: 'NoGPS', lat: 0, lon: 0 },
      ],
    });
  }
  if (url.pathname === '/api/eud') {
    return send({ results: [{ uid: 'ios-bbb', callsign: 'iPhone', last_status: 'x' }], total_pages: 1 });
  }
  if (url.pathname === '/api/markers' && req.method === 'DELETE') {
    // lazni OTS: brise samo ako je zadan uid (query ili JSON tijelo)
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      let uid = url.searchParams.get('uid');
      try { uid = uid || JSON.parse(b || '{}').uid; } catch { /* ignore */ }
      console.log(`DELETE ${req.url} tijelo=${b || '-'} -> uid=${uid || 'NEMA'}`);
      uid ? send({ success: true, deleted: uid }) : send({ error: 'uid required' }, 400);
    });
    return;
  }
  if (url.pathname === '/api/markers') {
    return send({ results: [
      { uid: 'mk-1', callsign: 'Tocka 1', type: 'a-u-G', point: { lat: 45.8100, lon: 15.9900, hae: 0 } },
      { uid: 'drone-1', callsign: 'Dron', type: 'a-f-A-M-F-Q', point: { lat: 45.8120, lon: 15.9750, hae: 180 } },
    ] });
  }
  send({ error: 'not found' }, 404);
});
server.listen(8099, '127.0.0.1', () => console.log('mock OTS na http://127.0.0.1:8099'));
