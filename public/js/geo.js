// Cista geometrija bez ovisnosti o pregledniku ili Cesiumu: koriste je i backend (zone,
// alarmi) i sucelje (rute), a testira se s `npm test`.

const EARTH_RADIUS_M = 6371000;
const RAD = Math.PI / 180;

export function haversineM(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * RAD;
  const dLon = (lon2 - lon1) * RAD;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

// pocetni azimut od prve do druge tocke, 0-360 stupnjeva (0 = sjever)
export function bearingDeg(lat1, lon1, lat2, lon2) {
  const dLon = (lon2 - lon1) * RAD;
  const y = Math.sin(dLon) * Math.cos(lat2 * RAD);
  const x =
    Math.cos(lat1 * RAD) * Math.sin(lat2 * RAD) -
    Math.sin(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.cos(dLon);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}

export function pointInPolygon(lat, lon, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i].lon;
    const yi = points[i].lat;
    const xj = points[j].lon;
    const yj = points[j].lat;
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function zoneContains(zone, lat, lon) {
  if (zone.type === 'circle') {
    return haversineM(lat, lon, zone.center.lat, zone.center.lon) <= zone.radiusM;
  }
  return pointInPolygon(lat, lon, zone.points);
}

// obrub kruga kao niz tocaka (sferna aproksimacija), za crtanje zone na terenu
export function circlePoints(center, radiusM, n = 64) {
  const lat1 = center.lat * RAD;
  const lon1 = center.lon * RAD;
  const ang = radiusM / EARTH_RADIUS_M;
  const out = [];
  for (let i = 0; i <= n; i++) {
    const brg = (2 * Math.PI * i) / n;
    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(ang) + Math.cos(lat1) * Math.sin(ang) * Math.cos(brg),
    );
    const lon2 =
      lon1 +
      Math.atan2(
        Math.sin(brg) * Math.sin(ang) * Math.cos(lat1),
        Math.cos(ang) - Math.sin(lat1) * Math.sin(lat2),
      );
    out.push({ lat: lat2 / RAD, lon: lon2 / RAD });
  }
  return out;
}

// dionice rute: udaljenost, azimut i kumulativna udaljenost na kraju svake dionice
export function routeLegs(points) {
  const legs = [];
  let cum = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const dist = haversineM(a.lat, a.lon, b.lat, b.lon);
    cum += dist;
    legs.push({ from: i - 1, to: i, dist, bearing: bearingDeg(a.lat, a.lon, b.lat, b.lon), cum });
  }
  return legs;
}

export function routeLength(points) {
  const legs = routeLegs(points);
  return legs.length ? legs[legs.length - 1].cum : 0;
}

// n+1 jednoliko razmaknutih uzoraka duz rute (po udaljenosti), za visinski profil
export function sampleRoute(points, n) {
  const legs = routeLegs(points);
  const total = legs.length ? legs[legs.length - 1].cum : 0;
  if (!total || n < 1) return points.map((p) => ({ dist: 0, lat: p.lat, lon: p.lon }));
  const out = [];
  let leg = 0;
  for (let i = 0; i <= n; i++) {
    const d = (total * i) / n;
    while (leg < legs.length - 1 && legs[leg].cum < d) leg++;
    const l = legs[leg];
    const start = l.cum - l.dist;
    const f = l.dist ? Math.min(1, Math.max(0, (d - start) / l.dist)) : 0;
    const a = points[l.from];
    const b = points[l.to];
    out.push({ dist: d, lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f });
  }
  return out;
}

// ukupni uspon/spust i raspon visina iz niza visina uzoraka
export function elevationStats(heights) {
  let ascent = 0;
  let descent = 0;
  for (let i = 1; i < heights.length; i++) {
    const d = heights[i] - heights[i - 1];
    if (d > 0) ascent += d;
    else descent -= d;
  }
  return {
    ascent,
    descent,
    min: heights.length ? Math.min(...heights) : 0,
    max: heights.length ? Math.max(...heights) : 0,
  };
}

export function formatDistance(m) {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`;
}

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  if (seconds < 30) return '< 1 min';
  const totalMin = Math.round(seconds / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`;
}

// vrijeme putovanja u sekundama za zadanu brzinu u km/h
export function travelSeconds(meters, speedKmh) {
  return speedKmh > 0 ? (meters / 1000 / speedKmh) * 3600 : Infinity;
}
