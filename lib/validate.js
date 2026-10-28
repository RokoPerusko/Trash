// Validacija korisnickog unosa za zone i rute. Funkcije vracaju { value } ili { error }.
import { randomUUID } from 'node:crypto';

export const LIMITS = {
  nameLen: 100,
  zones: 200,
  zonePoints: 500,
  radiusM: 1e7,
  routes: 200,
  routePoints: 200,
  speedKmh: 2000,
};

export const num = (v) => (v === null || v === undefined || v === '' ? NaN : Number(v));
export const validLat = (v) => Number.isFinite(v) && Math.abs(v) <= 90;
export const validLon = (v) => Number.isFinite(v) && Math.abs(v) <= 180;

function parseName(raw, what) {
  const name = String(raw ?? '').trim();
  if (!name) return { error: `ime ${what} je obavezno` };
  if (name.length > LIMITS.nameLen) return { error: `ime ${what} je predugo` };
  return { value: name };
}

function parsePoints(raw, min, max) {
  const pts = Array.isArray(raw)
    ? raw.slice(0, max + 1).map((p) => ({ lat: num(p?.lat), lon: num(p?.lon) }))
    : [];
  if (pts.length > max) return { error: `najviše ${max} točaka` };
  if (pts.length < min || pts.some((p) => !validLat(p.lat) || !validLon(p.lon))) {
    return { error: `potrebno je najmanje ${min} ispravne točke` };
  }
  return { value: pts };
}

export function parseZone(body) {
  const name = parseName(body.name, 'zone');
  if (name.error) return name;
  if (body.type === 'circle') {
    const lat = num(body.center?.lat);
    const lon = num(body.center?.lon);
    const r = num(body.radiusM);
    if (!validLat(lat)) return { error: 'neispravna širina centra' };
    if (!validLon(lon)) return { error: 'neispravna dužina centra' };
    if (!Number.isFinite(r) || r <= 0 || r > LIMITS.radiusM) return { error: 'neispravan radijus' };
    return {
      value: {
        id: randomUUID(),
        name: name.value,
        type: 'circle',
        center: { lat, lon },
        radiusM: r,
      },
    };
  }
  if (body.type === 'polygon') {
    const pts = parsePoints(body.points, 3, LIMITS.zonePoints);
    if (pts.error) return { error: `poligon: ${pts.error}` };
    return { value: { id: randomUUID(), name: name.value, type: 'polygon', points: pts.value } };
  }
  return { error: "type mora biti 'circle' ili 'polygon'" };
}

function parseSpeed(raw) {
  if (raw === undefined || raw === null || raw === '') return { value: 5 };
  const v = num(raw);
  if (!Number.isFinite(v) || v <= 0 || v > LIMITS.speedKmh) return { error: 'neispravna brzina' };
  return { value: v };
}

// nova ruta (sva polja obavezna osim brzine)
export function parseRoute(body) {
  const name = parseName(body.name, 'rute');
  if (name.error) return name;
  const pts = parsePoints(body.points, 2, LIMITS.routePoints);
  if (pts.error) return { error: `ruta: ${pts.error}` };
  const speed = parseSpeed(body.speedKmh);
  if (speed.error) return speed;
  const now = new Date().toISOString();
  return {
    value: {
      id: randomUUID(),
      name: name.value,
      points: pts.value,
      speedKmh: speed.value,
      createdAt: now,
      updatedAt: now,
    },
  };
}

// izmjena rute: smiju se poslati samo polja koja se mijenjaju
export function applyRoutePatch(route, body) {
  const next = { ...route };
  if ('name' in body) {
    const name = parseName(body.name, 'rute');
    if (name.error) return name;
    next.name = name.value;
  }
  if ('points' in body) {
    const pts = parsePoints(body.points, 2, LIMITS.routePoints);
    if (pts.error) return { error: `ruta: ${pts.error}` };
    next.points = pts.value;
  }
  if ('speedKmh' in body) {
    const speed = parseSpeed(body.speedKmh);
    if (speed.error) return speed;
    next.speedKmh = speed.value;
  }
  next.updatedAt = new Date().toISOString();
  return { value: next };
}
