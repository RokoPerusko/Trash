// Uredjaji (EUD): popis iz /api/eud, a polozaj iz zadnjih zapisa CoT povijesti (/api/cot).
import { num } from '../lib/validate.js';
import { otsGet } from './ots.js';
import { DEVICES_PATH, COT_PATH, COT_PAGES } from './config.js';

export const validPos = (lat, lon) =>
  Number.isFinite(lat) &&
  Number.isFinite(lon) &&
  Math.abs(lat) <= 90 &&
  Math.abs(lon) <= 180 &&
  !(Math.abs(lat) < 0.001 && Math.abs(lon) < 0.001);

const finiteOrNull = (v) => (Number.isFinite(num(v)) ? num(v) : null);

export async function loadDevices() {
  const dev = await otsGet(`${DEVICES_PATH}?per_page=100`);
  if (dev.status >= 400) throw new Error(`${DEVICES_PATH}: HTTP ${dev.status}`);
  const list = dev.json?.results || dev.json?.euds || [];
  const byUid = new Map(list.filter((d) => d?.uid).map((d) => [String(d.uid), d]));
  const latest = new Map(); // uid -> najnoviji zapis CoT s ispravnim polozajem
  if (byUid.size) {
    const first = await otsGet(`${COT_PATH}?per_page=100&page=1`);
    if (first.status >= 400) throw new Error(`${COT_PATH}: HTTP ${first.status}`);
    const total = Number(first.json?.total_pages || 1);
    const take = (res) => {
      for (const r of res.json?.results || []) {
        const p = r.point || {};
        const uid = String(p.device_uid || r.sender_uid || r.uid || '');
        if (!byUid.has(uid) || !String(r.type || '').startsWith('a-')) continue; // samo polozaj uredjaja, ne markeri
        const lat = num(p.latitude),
          lon = num(p.longitude);
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
        if (latest.size === byUid.size) break; // svi uredjaji imaju polozaj
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
      id: uid,
      name: String(d.callsign || d.username || uid),
      type: l.r.type || 'a-f-G-U-C',
      lat: l.lat,
      lon: l.lon,
      alt: Number.isFinite(alt) && alt < 1e6 ? alt : null,
      time: d.last_event_time || l.p.timestamp || null,
      posTime: l.p.timestamp || null,
      stale: null,
      // zajednicka telemetrija za sve vrste objekata (uredjaj, dron...); null = nepoznato
      telemetry: {
        speed: finiteOrNull(l.p.speed), // m/s
        course: finiteOrNull(l.p.course), // stupnjevi
        battery: finiteOrNull(l.p.battery), // %
      },
      info: {
        Status: d.last_status || null,
        Tim: d.team || null,
        Uloga: d.team_role || null,
        Baterija: l.p.battery != null ? `${l.p.battery}%` : null,
        Uređaj: [d.platform, d.device, d.os].filter(Boolean).join(' ') || null,
      },
      from: [DEVICES_PATH],
      raws: { [DEVICES_PATH]: d, [COT_PATH]: cot },
    });
  }
  return { items, devices: byUid.size };
}
