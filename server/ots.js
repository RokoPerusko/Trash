// Veza prema OpenTAKServeru: prijavljeni klijent i pomocne funkcije za citanje.
import { createOtsClient } from '../ots-client.js';
import { OTS_URL, USERNAME, PASSWORD, OTS_INSECURE, PAGE_SIZE, MAX_PAGES } from './config.js';

// ---------- prijava (vidi ots-client.js) ----------
export const ots = createOtsClient({
  url: OTS_URL,
  username: USERNAME,
  password: PASSWORD,
  insecure: OTS_INSECURE,
  log: console.log,
});
export const otsSend = (method, path, opts) => ots.request(method, path, opts);
export const otsGet = (path) => otsSend('GET', path);

// ispravlja vremena koja je generirao sam OTS server (npr. stale/postavljeno za markere)
// za razliku izmedju sata OTS servera i ovog racunala - vidi ots-client.js absorb()
export function fixServerTime(v) {
  if (!v) return v;
  const t = Date.parse(v);
  if (!Number.isFinite(t)) return v;
  return new Date(t + (ots.clockSkewMs || 0)).toISOString();
}

// cita sve stranice popisa; odgovori bez total_pages (npr. /api/map_state) su jedna stranica
export async function otsGetAllPages(path) {
  const sep = path.includes('?') ? '&' : '?';
  const url = (page) => `${path}${sep}per_page=${PAGE_SIZE}&page=${page}`;
  const first = await otsGet(url(1));
  const pages = [first.json];
  const total = Number(first.json?.total_pages || 1);
  for (let pg = 2; pg <= Math.min(total, MAX_PAGES); pg++) {
    const r = await otsGet(url(pg));
    if (r.status >= 400) break;
    pages.push(r.json);
  }
  return { status: first.status, pages, truncated: total > MAX_PAGES };
}
