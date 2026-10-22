// Minimalni backend: prijavljuje se na OpenTAKServer, cita API i vraca normalizirane
// polozaje pregledniku. Token/lozinka nikad ne idu u preglednik.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createOtsClient } from './ots-client.js';

const env = process.env;
const OTS_URL = (env.OTS_URL || 'https://localhost').replace(/\/+$/, '');
const USERNAME = env.OTS_USERNAME || '';
const PASSWORD = env.OTS_PASSWORD || '';
const ENDPOINTS = (env.OTS_ENDPOINTS || '/api/markers')
  .split(',').map((s) => s.trim()).filter(Boolean);
const PORT = Number(env.PORT || 3000);
const HOST = env.HOST || '127.0.0.1'; // samo ovo racunalo; promijenite svjesno
const POLL_MS = Number(env.POLL_MS || 2000);
const ION_TOKEN = env.CESIUM_ION_TOKEN || '';
// Brisanje markera: putanja i nacin poziva (dokumentacija OTS-a ne navodi parametre)
const MARKERS_PATH = env.OTS_MARKERS_PATH || '/api/markers';
const DELETE_MODE = env.OTS_DELETE_MODE || 'query';   // query | json | path
const DELETE_FIELD = env.OTS_DELETE_FIELD || 'uid';
// Uredjaji: /api/eud daje popis (bez polozaja), a polozaj se cita iz povijesti CoT poruka (/api/cot)
const DEVICES_PATH = env.OTS_DEVICES_PATH || '/api/eud';
const COT_PATH = env.OTS_COT_PATH || '/api/cot';
const COT_PAGES = Number(env.OTS_COT_PAGES || 3);   // koliko zadnjih stranica povijesti pregledati
const PUBLIC_DIR = join(fileURLToPath(new URL('.', import.meta.url)), 'public');

if (env.OTS_INSECURE === '1') {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  console.warn('[upozorenje] OTS_INSECURE=1: provjera TLS certifikata je iskljucena. ' +
    'Koristite samo na privatnoj mrezi; bolje postaviti NODE_EXTRA_CA_CERTS.');
}

// ---------- prijava (vidi ots-client.js) ----------
const ots = createOtsClient({ url: OTS_URL, username: USERNAME, password: PASSWORD, log: console.log });
const otsSend = (method, path, opts) => ots.request(method, path, opts);
const otsGet = (path) => otsSend('GET', path);

// ---------- normalizacija ----------
const num = (v) => (v === null || v === undefined || v === '' ? NaN : Number(v));
const pick = (o, keys) => { for (const k of keys) if (o[k] !== undefined && o[k] !== null) return o[k]; return undefined; };

function asItem(o) {
  const p = o.point && typeof o.point === 'object' ? o.point : o;
  const lat = num(pick(p, ['lat', 'latitude']));
  const lon = num(pick(p, ['lon', 'lng', 'longitude']));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  if (lat === 0 && lon === 0) return null; // "NO GPS"
  const alt = num(pick(p, ['hae', 'altitude', 'alt', 'height']));
  const uid = pick(o, ['uid', 'device_uid', 'id', 'cot_id']);
  const name = pick(o, ['callsign', 'name', 'title', 'sender_callsign', 'username']) ?? uid;
  return {
    id: String(uid ?? `${name}@${lat.toFixed(5)},${lon.toFixed(5)}`),
    name: name === undefined ? 'bez imena' : String(name),
    type: pick(o, ['type', 'cot_type', 'how']) ?? null,
    lat, lon, alt: Number.isFinite(alt) ? alt : null,
    time: pick(o, ['timestamp', 'last_status_time', 'start', 'time', 'updated']) ?? null,
    stale: o.stale ?? null,
    raw: o, // originalni objekt iz API-ja (za prikaz svih polja)
  };
}

function collect(node, out, depth = 0) {
  if (depth > 7 || node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const n of node) collect(n, out, depth + 1); return; }
  const item = asItem(node);
  if (item) out.set(item.id, { ...(out.get(item.id) || {}), ...item });
  // ako je polozaj procitan iz ugnijezdenog "point", ne tretiraj ga ponovno kao zaseban objekt
  const usedPoint = item && node.point && typeof node.point === 'object';
  for (const [k, v] of Object.entries(node)) {
    if (usedPoint && k === 'point') continue;
    collect(v, out, depth + 1);
  }
}

// ---------- uredjaji (EUD) s polozajem iz /api/cot ----------
const validPos = (lat, lon) => Number.isFinite(lat) && Number.isFinite(lon) &&
  Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(Math.abs(lat) < 0.001 && Math.abs(lon) < 0.001);

async function loadDevices() {
  const dev = await otsGet(`${DEVICES_PATH}?per_page=100`);
  if (dev.status >= 400) throw new Error(`${DEVICES_PATH}: HTTP ${dev.status}`);
  const list = dev.json?.results || dev.json?.euds || [];
  const byUid = new Map(list.filter((d) => d?.uid).map((d) => [String(d.uid), d]));
  const latest = new Map();                     // uid -> najnoviji zapis CoT s ispravnim polozajem
  if (byUid.size) {
    const first = await otsGet(`${COT_PATH}?per_page=100&page=1`);
    if (first.status >= 400) throw new Error(`${COT_PATH}: HTTP ${first.status}`);
    const total = Number(first.json?.total_pages || 1);
    const take = (res) => {
      for (const r of res.json?.results || []) {
        const p = r.point || {};
        const uid = String(p.device_uid || r.sender_uid || r.uid || '');
        if (!byUid.has(uid) || !String(r.type || '').startsWith('a-')) continue;   // samo polozaj uredjaja, ne markeri
        const lat = num(p.latitude), lon = num(p.longitude);
        if (!validPos(lat, lon)) continue;
        const t = Date.parse(p.timestamp || r.start || '') || 0;
        const prev = latest.get(uid);
        if (!prev || t >= prev.t) latest.set(uid, { t, r, lat, lon, p });
      }
    };
    if (total === 1) take(first);
    else {
      for (let pg = total; pg > Math.max(0, total - COT_PAGES); pg--) {
        take(pg === 1 ? first : await otsGet(`${COT_PATH}?per_page=100&page=${pg}`));
        if (latest.size === byUid.size) break;      // svi uredjaji imaju polozaj
      }
    }
  }
  const items = [];
  for (const [uid, d] of byUid) {
    const l = latest.get(uid);
    if (!l) continue;
    const { xml, ...cot } = l.r;
    const alt = num(l.p.hae);
    items.push({
      id: uid, name: String(d.callsign || d.username || uid), type: l.r.type || 'a-f-G-U-C',
      lat: l.lat, lon: l.lon, alt: Number.isFinite(alt) && alt < 1e6 ? alt : null,
      time: d.last_event_time || l.p.timestamp || null, posTime: l.p.timestamp || null, stale: null,
      info: { Status: d.last_status || null, Tim: d.team || null, Uloga: d.team_role || null,
        Baterija: l.p.battery != null ? `${l.p.battery}%` : null,
        Uređaj: [d.platform, d.device, d.os].filter(Boolean).join(' ') || null },
      from: [DEVICES_PATH], raws: { [DEVICES_PATH]: d, [COT_PATH]: cot },
    });
  }
  return { items, devices: byUid.size };
}

let state = { updated: null, items: [], sources: {}, error: null };

async function refresh() {
  const found = new Map();
  const sources = {};
  let error = null;
  for (const path of ENDPOINTS) {
    try {
      const { status, json } = await otsGet(path);
      const before = found.size;
      const local = new Map();
      if (json) collect(json, local);
      for (const [id, it] of local) {
        const prev = found.get(id);
        const { raw, ...rest } = it;
        found.set(id, {
          ...(prev || {}), ...rest,
          from: [...(prev?.from || []), path],
          raws: { ...(prev?.raws || {}), [path]: raw },   // sirovi zapis po izvoru
        });
      }
      sources[path] = { status, added: found.size - before };
    } catch (e) {
      sources[path] = { error: e.message };
      error = e.message;
    }
  }
  try {
    const { items, devices } = await loadDevices();
    for (const it of items) found.set(it.id, it);
    sources[DEVICES_PATH] = { status: 200, added: items.length, devices };
  } catch (e) {
    sources[DEVICES_PATH] = { error: e.message };
    error = error || e.message;
  }
  state = { updated: new Date().toISOString(), items: [...found.values()], sources, error };
}

async function loop() {
  await refresh();
  setTimeout(loop, POLL_MS);
}

// ---------- HTTP ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml' };

function sendJson(res, obj, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/api/state') return sendJson(res, state);
    if (url.pathname === '/config') {
      return sendJson(res, { ionToken: ION_TOKEN, pollMs: POLL_MS, markersPath: MARKERS_PATH });
    }
    if (url.pathname === '/api/delete-marker' && req.method === 'POST') {
      // zastita od poziva s drugih stranica: trazi se zaglavlje koje preglednik ne dopusta cross-origin
      if (req.headers['x-tak-app'] !== '1') return sendJson(res, { error: 'zabranjeno' }, 403);
      let raw = '';
      for await (const chunk of req) { raw += chunk; if (raw.length > 10_000) return sendJson(res, { error: 'prevelik zahtjev' }, 413); }
      let id;
      try { id = String(JSON.parse(raw).id ?? ''); } catch { return sendJson(res, { error: 'neispravan JSON' }, 400); }
      const item = state.items.find((i) => i.id === id);
      if (!id || !item) return sendJson(res, { error: 'objekt nije pronaden u trenutnom stanju' }, 404);
      if (!item.from?.includes(MARKERS_PATH)) {
        return sendJson(res, { error: `objekt ne dolazi iz ${MARKERS_PATH}, brisanje nije podrzano` }, 400);
      }
      let path = MARKERS_PATH, payload;
      if (DELETE_MODE === 'json') payload = { [DELETE_FIELD]: id };
      else if (DELETE_MODE === 'path') path += '/' + encodeURIComponent(id);
      else path += '?' + new URLSearchParams({ [DELETE_FIELD]: id });
      console.log(`[brisanje] DELETE ${path}${payload ? ' ' + JSON.stringify(payload) : ''}`);
      const r = await otsSend('DELETE', path, { json: payload });
      console.log(`[brisanje] odgovor HTTP ${r.status}`);
      const ok = r.status >= 200 && r.status < 300;
      if (ok) refresh().catch(() => {});
      return sendJson(res, { ok, status: r.status, response: r.json ?? r.text.slice(0, 500), sent: { method: 'DELETE', path, body: payload ?? null } }, ok ? 200 : 502);
    }
    if (url.pathname === '/api/debug') {
      const raw = {};
      for (const path of ENDPOINTS) {
        try { const r = await otsGet(path); raw[path] = { status: r.status, body: r.json ?? r.text.slice(0, 500) }; }
        catch (e) { raw[path] = { error: e.message }; }
      }
      return sendJson(res, { login: ots.strategy, otsUrl: OTS_URL, raw });
    }
    const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const file = normalize(join(PUBLIC_DIR, rel));
    if (!file.startsWith(PUBLIC_DIR + sep)) { res.writeHead(403); return res.end('zabranjeno'); }
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  } catch (e) {
    if (e.code === 'ENOENT') { res.writeHead(404); return res.end('nije pronadeno'); }
    sendJson(res, { error: e.message }, 500);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Aplikacija: http://${HOST}:${PORT}   (OTS: ${OTS_URL})`);
  if (!USERNAME) console.warn('[upozorenje] OTS_USERNAME nije postavljen');
  loop();
});
