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
  const EUD = { callsign: 'iPhone', uid: 'DEV-1', last_status: 'Connected', team: 'Cyan', team_role: 'Team Member',
    platform: 'iTAK', device: 'iPhone', os: '26.6', last_event_time: new Date().toISOString(), last_point: null };
  if (url.pathname === '/api/map_state') return send({ euds: [EUD], markers: [], casevacs: [], rb_lines: [] });
  if (url.pathname === '/api/eud') return send({ results: [EUD], total: 1, total_pages: 1, per_page: 10 });
  if (url.pathname === '/api/cot') {
    // povijest od najstarijeg: prvo bez GPS-a (0,0), zatim polozaji, usput SPI marker
    const all = [];
    for (let i = 0; i < 250; i++) {
      const ok = i > 40;
      all.push({ uid: 'DEV-1', type: i % 50 === 49 ? 'b-m-p-s-p-i' : 'a-f-G-U-C',
        point: { device_uid: 'DEV-1', callsign: 'iPhone', battery: 40, hae: 44,
          latitude: ok ? 45.8 + i * 0.00002 : 0, longitude: ok ? 15.97 : -0.00001,
          timestamp: new Date(Date.UTC(2026, 9, 21, 13, 0, i)).toISOString() }, xml: '<x/>' });
    }
    const per = Number(url.searchParams.get('per_page') || 10), page = Number(url.searchParams.get('page') || 1);
    return send({ results: all.slice((page - 1) * per, page * per), per_page: per, current_page: page,
      total: all.length, total_pages: Math.ceil(all.length / per) });
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
      { uid: 'mk-1', callsign: 'Tocka 1', type: 'a-u-G', stale: '2099-01-01T00:00:00Z', point: { lat: 45.8100, lon: 15.9900, hae: 0 } },
      { uid: 'drone-1', callsign: 'Stara tocka', stale: '2020-01-01T00:00:00Z', type: 'b-m-p-s-p-i', point: { lat: 45.7, lon: 15.9, hae: 0 } },
      { uid: 'drone-2', callsign: 'Dron', type: 'a-f-A-M-F-Q', point: { lat: 45.8120, lon: 15.9750, hae: 180 } },
    ] });
  }
  send({ error: 'not found' }, 404);
});
server.listen(8099, '127.0.0.1', () => console.log('mock OTS na http://127.0.0.1:8099'));
