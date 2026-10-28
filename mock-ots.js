// Lazni OpenTAKServer samo za testiranje aplikacije bez pravog servera.
// Pokretanje: node mock-ots.js   (slusa na http://127.0.0.1:8099)
import http from 'node:http';

const CSRF = 'CSRF-' + Math.random().toString(36).slice(2);
const SESSION = 'sess123';
const markers = new Map([
  [
    'mk-1',
    {
      uid: 'mk-1',
      callsign: 'Tocka 1',
      type: 'a-u-G',
      stale: '2099-01-01T00:00:00Z',
      point: { lat: 45.81, lon: 15.99, hae: 0 },
    },
  ],
  [
    'drone-1',
    {
      uid: 'drone-1',
      callsign: 'Stara tocka',
      stale: '2020-01-01T00:00:00Z',
      type: 'b-m-p-s-p-i',
      point: { lat: 45.7, lon: 15.9, hae: 0 },
    },
  ],
  [
    'drone-2',
    {
      uid: 'drone-2',
      callsign: 'Dron',
      type: 'a-f-A-M-F-Q',
      point: { lat: 45.812, lon: 15.975, hae: 180 },
    },
  ],
]);
for (let i = 1; i <= 14; i++) {
  markers.set(`bulk-${i}`, {
    uid: `bulk-${i}`,
    callsign: `Masovni ${i}`,
    type: 'a-u-G',
    stale: '2099-01-01T00:00:00Z',
    point: { lat: 45.7 + i * 0.002, lon: 15.9, hae: 0 },
  });
}
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
      if (req.headers['x-xsrf-token'] !== CSRF)
        return send(
          { meta: { code: 400 }, response: { errors: ['The CSRF token is missing.'] } },
          400,
        );
      const ok = /tak_roko/.test(body) && /tajna/.test(body);
      if (!ok) return send({ meta: { code: 400 }, response: { errors: ['bad'] } }, 400);
      send({
        meta: { code: 200 },
        response: { user: { authentication_token: 'MOCK-AUTH-TOKEN' }, csrf_token: CSRF },
      });
    });
    return;
  }
  if (url.pathname === '/oauth/token') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const ok = /tak_roko/.test(body + req.url) && /tajna/.test(body + req.url);
      ok
        ? send({ access_token: 'MOCK.JWT.TOKEN', token_type: 'Bearer' })
        : send({ error: 'bad' }, 401);
    });
    return;
  }
  const authed =
    req.headers.authorization === 'Bearer MOCK.JWT.TOKEN' ||
    req.headers['authentication-token'] === 'MOCK-AUTH-TOKEN';
  if (!authed) return send({ error: 'unauthorized' }, 401);
  // kao Flask-Security: JWT/Bearer prolazi, ali DELETE bez CSRF-a pada ako je prijava preko sesije
  if (req.method !== 'GET' && req.headers['x-xsrf-token'] !== CSRF)
    return send({ meta: { code: 400 }, response: { errors: ['The CSRF token is missing.'] } }, 400);
  const t = Date.now() / 1000;
  const OLD_EUD = {
    callsign: 'iPhone',
    uid: 'DEV-OLD',
    last_status: 'Disconnected',
    team: 'Cyan',
    team_role: 'Team Member',
    platform: 'iTAK',
    device: 'iPhone',
    os: '26.5',
    last_event_time: new Date(Date.now() - 3 * 86400000).toISOString(),
    last_point: null,
  };
  const EUD = {
    callsign: 'iPhone',
    uid: 'DEV-1',
    last_status: 'Connected',
    team: 'Cyan',
    team_role: 'Team Member',
    platform: 'iTAK',
    device: 'iPhone',
    os: '26.6',
    last_event_time: new Date().toISOString(),
    last_point: null,
  };
  if (url.pathname === '/api/me') {
    return send({ username: 'tak_roko', roles: [{ name: 'user' }], email: 'tak@example.local' });
  }
  if (url.pathname === '/api/map_state')
    return send({ euds: [EUD], markers: [], casevacs: [], rb_lines: [] });
  if (url.pathname === '/api/eud')
    return send({ results: [EUD, OLD_EUD], total: 2, total_pages: 1, per_page: 10 });
  if (url.pathname === '/api/cot') {
    // povijest od najstarijeg: prvo bez GPS-a (0,0), zatim polozaji, usput SPI marker
    // stari zapis istog telefona pod drugim uid-om: OTS ga ne brise kad se uredjaj ponovno prijavi
    const all = [
      {
        uid: 'DEV-OLD',
        type: 'a-f-G-U-C',
        point: {
          device_uid: 'DEV-OLD',
          callsign: 'iPhone',
          latitude: 45.79,
          longitude: 15.95,
          timestamp: new Date(Date.now() - 3 * 86400000).toISOString(),
        },
      },
    ];
    for (let i = 0; i < 250; i++) {
      const ok = i > 40;
      all.push({
        uid: 'DEV-1',
        type: i % 50 === 49 ? 'b-m-p-s-p-i' : 'a-f-G-U-C',
        point: {
          device_uid: 'DEV-1',
          callsign: 'iPhone',
          battery: 40,
          hae: 44,
          latitude: ok ? 45.8 + i * 0.00002 : 0,
          longitude: ok ? 15.97 : -0.00001,
          timestamp: new Date(Date.UTC(2026, 9, 21, 13, 0, i)).toISOString(),
        },
        xml: '<x/>',
      });
    }
    const per = Number(url.searchParams.get('per_page') || 10),
      page = Number(url.searchParams.get('page') || 1);
    return send({
      results: all.slice((page - 1) * per, page * per),
      per_page: per,
      current_page: page,
      total: all.length,
      total_pages: Math.ceil(all.length / per),
    });
  }
  if (url.pathname === '/api/markers' && req.method === 'DELETE') {
    // lazni OTS: brise samo ako je zadan uid (query ili JSON tijelo)
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      let uid = url.searchParams.get('uid');
      try {
        uid = uid || JSON.parse(b || '{}').uid;
      } catch {
        /* ignore */
      }
      console.log(`DELETE ${req.url} tijelo=${b || '-'} -> uid=${uid || 'NEMA'}`);
      if (!uid) return send({ success: false, error: 'uid required' }, 400);
      if (!markers.has(uid)) return send({ success: false, error: 'Unknown UID' }, 404);
      markers.delete(uid);
      send({ success: true });
    });
    return;
  }
  // stvaranje i premjestanje/preimenovanje markera: ponovni POST s istim uid azurira
  // isti marker (OTS nema zaseban PUT - vidi opentakserver/blueprints/ots_api/marker_api.py)
  if (url.pathname === '/api/markers' && req.method === 'POST') {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      let body;
      try {
        body = JSON.parse(b || '{}');
      } catch {
        return send({ success: false, error: 'bad json' }, 400);
      }
      if (body.latitude === undefined || body.longitude === undefined)
        return send({ success: false, error: 'Please provide a latitude and longitude' }, 400);
      const lat = Number(body.latitude),
        lon = Number(body.longitude);
      if (!(lat >= -90 && lat <= 90))
        return send({ success: false, error: `Invalid latitude: ${body.latitude}` }, 400);
      if (!(lon >= -180 && lon <= 180))
        return send({ success: false, error: `Invalid longitude: ${body.longitude}` }, 400);
      if (!body.uid) return send({ success: false, error: 'Please provide a UID' }, 400);
      if (!body.name) return send({ success: false, error: 'Please provide a name' }, 400);
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.uid))
        return send({ success: false, error: 'Invalid UID. UIDs need to be in UUID4 format' }, 400);
      // kao pravi OTS: "type" se NE pamti izmedju pozivA - izostavljen type na azuriranju resetira ga na a-u-G
      const type = body.type || 'a-u-G';
      markers.set(body.uid, {
        uid: body.uid,
        callsign: String(body.name),
        type,
        stale: new Date(Date.now() + 86400000).toISOString(),
        point: {
          latitude: lat,
          longitude: lon,
          hae: body.hae != null ? Number(body.hae) : 9999999,
          battery: body.battery != null ? Number(body.battery) : null,
          course: body.course != null ? Number(body.course) : 0,
          timestamp: new Date().toISOString(),
        },
      });
      console.log(`POST /api/markers uid=${body.uid} (${lat},${lon}) "${body.name}" type=${type}`);
      send({ success: true });
    });
    return;
  }
  if (url.pathname === '/api/alerts') {
    // kao OTS: alarmi koje su poslali TAK klijenti (ovdje jedan aktivan i jedan ponisten)
    const iso = (offsetMs) => new Date(Date.now() - offsetMs).toISOString();
    return send({
      results: [
        {
          uid: 'alert-1',
          sender_uid: 'DEV-1',
          callsign: 'iPhone',
          alert_type: 'b-a-o-tbl',
          start_time: iso(120000),
          cancel_time: null,
          point: { latitude: 45.8, longitude: 15.97 },
        },
        {
          uid: 'alert-0',
          sender_uid: 'DEV-1',
          callsign: 'iPhone',
          alert_type: 'b-a-o-pan',
          start_time: iso(3600000),
          cancel_time: iso(3500000),
          point: { latitude: 45.8, longitude: 15.97 },
        },
      ],
      total_pages: 1,
      current_page: 1,
      per_page: 50,
    });
  }
  if (url.pathname === '/api/markers') {
    // kao pravi OTS: bez per_page vraca samo 10 zapisa po stranici
    const per = Number(url.searchParams.get('per_page') || 10);
    const page = Number(url.searchParams.get('page') || 1);
    const list = [...markers.values()];
    return send({
      results: list.slice((page - 1) * per, page * per),
      per_page: per,
      current_page: page,
      total: list.length,
      total_pages: Math.ceil(list.length / per),
    });
  }
  send({ error: 'not found' }, 404);
});
server.listen(8099, '127.0.0.1', () => console.log('mock OTS na http://127.0.0.1:8099'));
