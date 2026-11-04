// Uredjaji (EUD): popis iz /api/eud, a polozaj iz zadnjih zapisa CoT povijesti (/api/cot).
import { num } from '../lib/validate.js';
import { otsGet } from './ots.js';
import { DEVICES_PATH, COT_PATH, COT_PAGES, COT_SORTED_PAGE } from './config.js';

export const validPos = (lat, lon) =>
  Number.isFinite(lat) &&
  Number.isFinite(lon) &&
  Math.abs(lat) <= 90 &&
  Math.abs(lon) <= 180 &&
  !(Math.abs(lat) < 0.001 && Math.abs(lon) < 0.001);

const finiteOrNull = (v) => (Number.isFinite(num(v)) ? num(v) : null);

// zadnji poznati polozaj po uredjaju: odspojeni uredjaji se trace jednom, ne u svakom ciklusu
const knownPos = new Map();
const searched = new Set();
let knownCotPages = 0; // zadnji poznati broj stranica CoT povijesti

export async function loadDevices() {
  const dev = await otsGet(`${DEVICES_PATH}?per_page=100`);
  if (dev.status >= 400) throw new Error(`${DEVICES_PATH}: HTTP ${dev.status}`);
  const list = dev.json?.results || dev.json?.euds || [];
  const byUid = new Map(list.filter((d) => d?.uid).map((d) => [String(d.uid), d]));
  const latest = new Map(); // uid -> najnoviji zapis CoT s ispravnim polozajem
  // treba svjez polozaj: spojeni uredjaji uvijek, ostali dok se jednom nisu potrazili
  const needFresh = () =>
    [...byUid].filter(([uid, d]) => d.last_status === 'Connected' || !searched.has(uid));
  const allFresh = () => needFresh().every(([uid]) => latest.has(uid));
  if (byUid.size) {
    const fetchPage = async (pg) => {
      const r = await otsGet(`${COT_PATH}?per_page=100&page=${pg}`);
      if (r.status >= 400) throw new Error(`${COT_PATH}: HTTP ${r.status}`);
      return r;
    };
    const fetchSorted = async (pg) => {
      const r = await otsGet(
        `${COT_PATH}?per_page=${COT_SORTED_PAGE}&page=${pg}&sort_by=start&sort_direction=desc`,
      );
      if (r.status >= 400) throw new Error(`${COT_PATH}: HTTP ${r.status}`);
      return r;
    };
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
    // OTS moze sortirati CoT od najnovijeg (sort_by=start&sort_direction=desc): dovoljna je mala
    // prva stranica (puno brze od stranice od 100 zapisa). Ako sortiranje nije podrzano
    // (zapisi nisu od najnovijeg prema starijem), vraca se na staro: zadnje stranice povijesti.
    const newestFirst = (res) => {
      const ts = (res.json?.results || []).map((r) =>
        Date.parse(r.start || r.point?.timestamp || ''),
      );
      return ts.length < 2 || !(ts[0] < ts[ts.length - 1]);
    };
    const sorted = await fetchSorted(1);
    if (newestFirst(sorted)) {
      let res = sorted;
      for (let n = 1; ; n++) {
        take(res);
        if (allFresh() || n >= COT_PAGES || n >= Number(res.json?.total_pages || 1)) break;
        res = await fetchSorted(n + 1);
      }
    } else {
      // najnoviji zapisi su na zadnjoj stranici; broj stranica se pamti pa je obicno dovoljan
      // jedan zahtjev, a ako OTS javi drugaciji broj stranica, ponavlja se od prave zadnje
      let total = knownCotPages || 1;
      let res = await fetchPage(total);
      const reported = Number(res.json?.total_pages || 1);
      if (reported !== total) {
        total = reported;
        res = await fetchPage(total);
      }
      knownCotPages = total;
      for (let n = 1, pg = total; ; n++) {
        take(res);
        if (allFresh() || n >= COT_PAGES || pg <= 1) break;
        res = await fetchPage(--pg);
      }
    }
  }
  for (const [uid, l] of latest) {
    const prev = knownPos.get(uid);
    if (!prev || l.t >= prev.t) knownPos.set(uid, l);
  }
  for (const uid of byUid.keys()) searched.add(uid);
  const items = [];
  for (const [uid, d] of byUid) {
    const l = latest.get(uid) || knownPos.get(uid);
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
