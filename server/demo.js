// Simulirani dron za proof of concept dok nema pravih dronova: kruzi iznad Zagreba, javlja
// brzinu, smjer, visinu i bateriju koja pada, pa se vidi kao pravi dron (ikona, kartica, alarm
// baterije). Iskljucuje se s DEMO_DRONE=0 u .env-u ili postavljanjem DEMO_DRONE na false u config.js.
const CENTER = { lat: 45.813, lon: 15.977 }; // Zagreb
const RADIUS_M = 1200;
const SPEED_MS = 12; // ~43 km/h
const ALT_M = 180;
const M_PER_DEG_LAT = 111_320;

export const DEMO_DRONE_ID = 'demo-dron-1';

export function demoDrone(now = Date.now(), startedAt = now) {
  const t = (now - startedAt) / 1000;
  const angle = (SPEED_MS / RADIUS_M) * t; // rad, smjer kazaljke na satu
  const dLat = (RADIUS_M * Math.cos(angle)) / M_PER_DEG_LAT;
  const dLon =
    (RADIUS_M * Math.sin(angle)) / (M_PER_DEG_LAT * Math.cos((CENTER.lat * Math.PI) / 180));
  const course = ((((angle * 180) / Math.PI + 90) % 360) + 360) % 360; // tangenta kruga
  const battery = Math.round(100 - ((t / 60) % 90)); // pada 1 %/min do 11 %, pa se "napuni"
  const iso = new Date(now).toISOString();
  return {
    id: DEMO_DRONE_ID,
    name: 'Demo dron',
    type: 'a-f-A-M-F-Q',
    lat: CENTER.lat + dLat,
    lon: CENTER.lon + dLon,
    alt: ALT_M,
    time: iso,
    posTime: iso,
    stale: null,
    telemetry: { speed: SPEED_MS, course, battery },
    info: { Izvor: 'simulacija', Baterija: `${battery}%` },
    from: ['demo'],
    raws: {},
  };
}
