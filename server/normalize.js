// Pretvara proizvoljni JSON iz OTS-a u objekte s polozajem (id, ime, lat, lon, vrijeme...).
import { num } from '../lib/validate.js';
import { fixServerTime } from './ots.js';

// ---------- normalizacija ----------
const pick = (o, keys) => {
  for (const k of keys) if (o[k] !== undefined && o[k] !== null) return o[k];
  return undefined;
};

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
    lat,
    lon,
    alt: Number.isFinite(alt) && Math.abs(alt) < 1e6 ? alt : null, // 9999999 = OTS "nepoznato"
    time: fixServerTime(
      pick(o, ['timestamp', 'last_status_time', 'start', 'time', 'updated']) ?? null,
    ),
    stale: fixServerTime(o.stale ?? null),
    raw: o, // originalni objekt iz API-ja (za prikaz svih polja)
  };
}

export function collect(node, out, depth = 0) {
  if (depth > 7 || node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const n of node) collect(n, out, depth + 1);
    return;
  }
  const item = asItem(node);
  if (item) out.set(item.id, { ...(out.get(item.id) || {}), ...item });
  // ako je polozaj procitan iz ugnijezdenog "point", ne tretiraj ga ponovno kao zaseban objekt
  const usedPoint = item && node.point && typeof node.point === 'object';
  for (const [k, v] of Object.entries(node)) {
    if (usedPoint && k === 'point') continue;
    collect(v, out, depth + 1);
  }
}
