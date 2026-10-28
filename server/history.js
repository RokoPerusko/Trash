// Povijest polozaja jednog uredjaja (/api/history).
import { num } from '../lib/validate.js';
import { otsGet } from './ots.js';
import { validPos } from './devices.js';
import { COT_PATH, HISTORY_MAX_PAGES } from './config.js';

// ---------- povijest (/api/history): stranicenje /api/cot s kesiranjem ----------
// Povijest se dodaje na kraj (append-only), pa su sve stranice osim zadnje trajno
// nepromjenjive - mogu se kesirati bez isteka. Zadnja stranica (trenutni total_pages)
// se jos moze mijenjati pa se uvijek dohvaca iznova.
const cotPageCache = new Map(); // broj stranice -> { results, total_pages }

async function fetchCotPage(page) {
  if (cotPageCache.has(page)) return cotPageCache.get(page);
  const r = await otsGet(`${COT_PATH}?per_page=100&page=${page}`);
  if (r.status >= 400) throw new Error(`${COT_PATH}: HTTP ${r.status}`);
  const data = { results: r.json?.results || [], total_pages: Number(r.json?.total_pages || 1) };
  if (page < data.total_pages) cotPageCache.set(page, data);
  return data;
}

const recTime = (r) => Date.parse(r?.point?.timestamp || r?.start || '');
function pageFirstTime(data) {
  return data.results[0] ? recTime(data.results[0]) || null : null;
}
function pageLastTime(data) {
  const r = data.results[data.results.length - 1];
  return r ? recTime(r) || null : null;
}

// binarna pretraga: posljednja stranica cije je prvo vrijeme < fromTime (ako ga nema, stranica 1)
async function findStartPage(total_pages, fromTime) {
  if (fromTime === null) return 1;
  let lo = 1,
    hi = total_pages,
    ans = 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const t = pageFirstTime(await fetchCotPage(mid));
    if (t === null || t < fromTime) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

export async function loadHistory(uid, fromTime, toTime) {
  const first = await fetchCotPage(1);
  const total_pages = first.total_pages;
  const startPage = await findStartPage(total_pages, fromTime);
  const points = [];
  let scanned = 0,
    truncated = false;
  for (let pg = startPage; pg <= total_pages; pg++) {
    if (scanned >= HISTORY_MAX_PAGES) {
      truncated = true;
      break;
    }
    const data = pg === 1 ? first : await fetchCotPage(pg);
    scanned++;
    for (const r of data.results) {
      const p = r.point || {};
      const recUid = String(p.device_uid || r.sender_uid || r.uid || '');
      if (recUid !== uid || !String(r.type || '').startsWith('a-')) continue;
      const t = recTime(r);
      if (!Number.isFinite(t) || (fromTime !== null && t < fromTime) || t > toTime) continue;
      const lat = num(p.latitude),
        lon = num(p.longitude);
      points.push({
        t,
        lat,
        lon,
        alt: Number.isFinite(num(p.hae)) ? num(p.hae) : null,
        speed: Number.isFinite(num(p.speed)) ? num(p.speed) : null,
        course: Number.isFinite(num(p.course)) ? num(p.course) : null,
        battery: p.battery != null && Number.isFinite(num(p.battery)) ? num(p.battery) : null,
        valid: validPos(lat, lon),
      });
    }
    const lastT = pageLastTime(data);
    if (lastT !== null && lastT > toTime) break; // sljedece stranice su jos kasnije - gotovo
  }
  points.sort((a, b) => a.t - b.t);
  const dedup = [];
  for (const p of points) {
    const prev = dedup[dedup.length - 1];
    if (prev && prev.t === p.t && prev.lat === p.lat && prev.lon === p.lon) continue;
    dedup.push(p);
  }
  return {
    uid,
    from: fromTime,
    to: toTime,
    points: dedup,
    scannedPages: scanned,
    totalPages: total_pages,
    truncated,
  };
}
