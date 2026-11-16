// Vrijeme (Open-Meteo, besplatno i bez kljuca) i procjena je li prikladno za let dronom.
const API = 'https://api.open-meteo.com/v1/forecast';
const CURRENT = [
  'temperature_2m',
  'apparent_temperature',
  'relative_humidity_2m',
  'precipitation',
  'cloud_cover',
  'pressure_msl',
  'wind_speed_10m',
  'wind_direction_10m',
  'wind_gusts_10m',
  'weather_code',
  'is_day',
].join(',');
const HOURLY = 'temperature_2m,wind_speed_10m,wind_gusts_10m,precipitation_probability,visibility';

// WMO kodovi vremena
const CODES = [
  [[0], 'Vedro'],
  [[1, 2], 'Djelomično oblačno'],
  [[3], 'Oblačno'],
  [[45, 48], 'Magla'],
  [[51, 53, 55, 56, 57], 'Rosulja'],
  [[61, 63, 65, 66, 67, 80, 81, 82], 'Kiša'],
  [[71, 73, 75, 77, 85, 86], 'Snijeg'],
  [[95, 96, 99], 'Grmljavina'],
];
export const describeCode = (code) =>
  CODES.find(([list]) => list.includes(code))?.[1] ?? 'Nepoznato';

const round = (n, d = 1) => (Number.isFinite(n) ? Math.round(n * 10 ** d) / 10 ** d : null);

// Okvirne granice za manje dronove (vjetar iznad ~10 m/s i kisa su tipicna ogranicenja)
export function droneVerdict({ windMs, gustMs, precipMm, visibilityM, tempC }) {
  const bad = [];
  const warn = [];
  if (gustMs >= 14 || windMs >= 10)
    bad.push(`jak vjetar (${round(Math.max(windMs, gustMs), 0)} m/s)`);
  else if (gustMs >= 10 || windMs >= 7)
    warn.push(`vjetrovito (${round(Math.max(windMs, gustMs), 0)} m/s)`);
  if (precipMm >= 0.5) bad.push('kiša');
  else if (precipMm > 0) warn.push('slaba oborina');
  if (visibilityM !== null && visibilityM < 1000) bad.push('slaba vidljivost');
  else if (visibilityM !== null && visibilityM < 3000) warn.push('smanjena vidljivost');
  if (tempC <= -10 || tempC >= 40) bad.push('ekstremna temperatura');
  else if (tempC <= 0 || tempC >= 35) warn.push('hladno ili vruće za bateriju');
  const level = bad.length ? 'bad' : warn.length ? 'warn' : 'ok';
  const text = { ok: 'Pogodno za let', warn: 'Oprezno', bad: 'Ne preporučuje se let' }[level];
  return { level, text, reasons: [...bad, ...warn] };
}

export function mapWeather(j) {
  const c = j?.current;
  if (!c || !Number.isFinite(c.temperature_2m)) return null;
  const h = j.hourly || {};
  // prvi sat u buducnosti u odnosu na trenutno vrijeme izmjereno na toj lokaciji
  const from = Math.max(
    0,
    (h.time || []).findIndex((t) => t > c.time),
  );
  const hourly = (h.time || []).slice(from, from + 6).map((t, i) => ({
    time: t,
    tempC: round(h.temperature_2m?.[from + i]),
    windMs: round(h.wind_speed_10m?.[from + i]),
    precipProb: h.precipitation_probability?.[from + i] ?? null,
  }));
  const visibilityM = Number.isFinite(h.visibility?.[Math.max(0, from - 1)])
    ? Math.round(h.visibility[Math.max(0, from - 1)])
    : null;
  const now = {
    tempC: round(c.temperature_2m),
    feelsC: round(c.apparent_temperature),
    humidity: c.relative_humidity_2m ?? null,
    precipMm: round(c.precipitation, 1) ?? 0,
    cloudPct: c.cloud_cover ?? null,
    pressureHpa: round(c.pressure_msl, 0),
    windMs: round(c.wind_speed_10m),
    windDir: round(c.wind_direction_10m, 0),
    gustMs: round(c.wind_gusts_10m),
    visibilityM,
    isDay: c.is_day === 1,
    code: c.weather_code,
    text: describeCode(c.weather_code),
    time: c.time,
  };
  return { ...now, hourly, drone: droneVerdict(now) };
}

const cache = new Map(); // zaokruzena tocka -> { at, data }
const TTL_MS = 10 * 60_000;

export async function getWeather(lat, lon, fetchFn = fetch) {
  const key = `${lat.toFixed(1)},${lon.toFixed(1)}`; // ~11 km: vrijeme se tamo ne mijenja
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;
  const q = new URLSearchParams({
    latitude: lat.toFixed(2),
    longitude: lon.toFixed(2),
    current: CURRENT,
    hourly: HOURLY,
    wind_speed_unit: 'ms',
    timezone: 'auto',
    forecast_hours: '8',
  });
  const res = await fetchFn(`${API}?${q}`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Open-Meteo: HTTP ${res.status}`);
  const data = mapWeather(await res.json());
  if (!data) throw new Error('Open-Meteo: neočekivan odgovor');
  if (cache.size > 200) cache.clear();
  cache.set(key, { at: Date.now(), data });
  return data;
}
