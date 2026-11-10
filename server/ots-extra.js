// Dodatni podaci s OTS-a koji se mijenjaju rijetko: stanje servera, grupe, misije i R&B linije.
// Citaju se svakih EXTRA_EVERY_MS neovisno o brzom ciklusu polozaja; greska jednog izvora ne
// smije srusiti ostale.
import { num } from '../lib/validate.js';
import { otsGet } from './ots.js';
import { EXTRA_EVERY_MS } from './config.js';

let cache = { updated: null, status: null, groups: [], missions: [], rbLines: [], errors: {} };
let last = 0;
let inflight = null;

export const getExtra = () => cache;

// primitivna polja objekta za prikaz (bez ugnijezdenih struktura i dugih tekstova)
const primitives = (o, max = 12) =>
  Object.fromEntries(
    Object.entries(o || {})
      .filter(
        ([, v]) => v !== null && v !== '' && ['string', 'number', 'boolean'].includes(typeof v),
      )
      .map(([k, v]) => [k, typeof v === 'string' ? v.slice(0, 200) : v])
      .slice(0, max),
  );

const pointOf = (v) => {
  if (!v || typeof v !== 'object') return null;
  const lat = num(v.lat ?? v.latitude);
  const lon = num(v.lon ?? v.lng ?? v.longitude);
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180
    ? { lat, lon }
    : null;
};

// R&B linija (udaljenost i smjer izmedju dvije tocke); oblik zapisa nije dokumentiran pa se
// pokusava nekoliko uobicajenih imena, a linija bez dvije valjane tocke se preskace
export function rbLine(o) {
  if (!o || typeof o !== 'object') return null;
  const pairs = [
    [o.start, o.end],
    [o.from, o.to],
    [o.point_a, o.point_b],
    [o.anchor, o.target],
    [
      { lat: o.start_latitude ?? o.start_lat, lon: o.start_longitude ?? o.start_lon },
      { lat: o.end_latitude ?? o.end_lat, lon: o.end_longitude ?? o.end_lon },
    ],
  ];
  for (const [a, b] of pairs) {
    const from = pointOf(a);
    const to = pointOf(b);
    if (from && to) {
      return {
        id: String(o.uid ?? o.id ?? `${from.lat},${from.lon}>${to.lat},${to.lon}`),
        name: String(o.callsign ?? o.name ?? o.uid ?? 'R&B linija'),
        from,
        to,
      };
    }
  }
  return null;
}

export function mapStatus(j) {
  if (!j || typeof j !== 'object') return null;
  return {
    version: j.ots_version ?? null,
    uptimeSec: Number.isFinite(num(j.ots_uptime)) ? Math.round(num(j.ots_uptime)) : null,
    systemUptimeSec: Number.isFinite(num(j.system_uptime))
      ? Math.round(num(j.system_uptime))
      : null,
    cpu: j.cpu_percent ?? null,
    memory: j.memory?.percent ?? null,
    disk: j.disk_usage?.percent ?? null,
    load: Array.isArray(j.load_avg) ? j.load_avg.map((n) => Math.round(n * 100) / 100) : null,
    onlineEuds: j.online_euds ?? null,
  };
}

export const mapGroups = (j) =>
  (j?.results || []).map((g) => ({
    id: String(g.id ?? g.name),
    name: String(g.name ?? g.id),
    type: g.type ?? null,
    description: g.description ?? null,
    users: Array.isArray(g.users) ? g.users.length : null,
    missions: Array.isArray(g.missions) ? g.missions.length : null,
  }));

export const mapMissions = (j) =>
  (j?.results || []).map((m) => ({
    id: String(m.guid ?? m.uid ?? m.id ?? m.name),
    name: String(m.name ?? m.title ?? m.guid ?? m.id ?? 'misija'),
    description: m.description ?? null,
    created: m.create_time ?? m.createTime ?? m.created ?? null,
    fields: primitives(m),
  }));

async function load() {
  const get = async (path) => {
    const r = await otsGet(path);
    if (r.status >= 400) throw new Error(`HTTP ${r.status}`);
    return r.json;
  };
  const [status, groups, missions, mapState] = await Promise.allSettled([
    get('/api/status'),
    get('/api/groups?per_page=100'),
    get('/api/missions?per_page=100'),
    get('/api/map_state'),
  ]);
  const errors = {};
  const val = (res, name, fn, fallback) => {
    if (res.status === 'fulfilled') return fn(res.value);
    errors[name] = res.reason?.message || String(res.reason);
    return fallback;
  };
  cache = {
    updated: new Date().toISOString(),
    status: val(status, 'status', mapStatus, cache.status),
    groups: val(groups, 'groups', mapGroups, cache.groups),
    missions: val(missions, 'missions', mapMissions, cache.missions),
    rbLines: val(
      mapState,
      'map_state',
      (j) => (Array.isArray(j?.rb_lines) ? j.rb_lines.map(rbLine).filter(Boolean) : []),
      cache.rbLines,
    ),
    errors,
  };
}

export function refreshExtra() {
  if (inflight) return inflight;
  if (Date.now() - last < EXTRA_EVERY_MS) return Promise.resolve(cache);
  last = Date.now();
  inflight = load()
    .catch((e) => console.error('[ots-extra]', e.message))
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
