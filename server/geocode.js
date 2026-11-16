// Trazenje mjesta i adresa (OpenStreetMap Nominatim). Pravila usluge: najvise 1 zahtjev u
// sekundi, prepoznatljiv User-Agent i bez automatskog dovrsavanja, pa se poziva tek na Enter.
const API = 'https://nominatim.openstreetmap.org/search';
const UA = 'tak-karta/1.0 (+https://github.com/RokoPerusko)';
const GAP_MS = 1100;
const TTL_MS = 60 * 60_000;

export const mapPlaces = (j) =>
  (Array.isArray(j) ? j : [])
    .map((p) => ({
      name: String(p.display_name ?? '').slice(0, 200),
      lat: Number(p.lat),
      lon: Number(p.lon),
      type: p.type ?? p.class ?? null,
    }))
    .filter((p) => p.name && Number.isFinite(p.lat) && Number.isFinite(p.lon));

const cache = new Map();
let chain = Promise.resolve();
let lastAt = 0;

export function geocode(q, fetchFn = fetch) {
  const key = q.trim().toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return Promise.resolve(hit.data);
  // zahtjevi idu jedan po jedan s razmakom, da se ne prekrsi ogranicenje usluge
  const run = chain.then(async () => {
    const wait = lastAt + GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastAt = Date.now();
    const url = `${API}?${new URLSearchParams({ q, format: 'jsonv2', limit: '6', 'accept-language': 'hr' })}`;
    const res = await fetchFn(url, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`Nominatim: HTTP ${res.status}`);
    const data = mapPlaces(await res.json());
    if (cache.size > 300) cache.clear();
    cache.set(key, { at: Date.now(), data });
    return data;
  });
  chain = run.catch(() => {});
  return run;
}
