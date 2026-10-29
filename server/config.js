// Postavke iz okoline (.env). Sve sto se cita iz process.env je ovdje na jednom mjestu;
// ostali moduli samo uvoze gotove vrijednosti.
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isLoopbackHost } from '../lib/auth.js';
import { LIMITS } from '../lib/validate.js';

export const env = process.env;
export const OTS_URL = (env.OTS_URL || 'https://localhost').replace(/\/+$/, '');
export const USERNAME = env.OTS_USERNAME || '';
export const PASSWORD = env.OTS_PASSWORD || '';
export const ENDPOINTS = (env.OTS_ENDPOINTS || '/api/markers')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
export const PORT = Number(env.PORT || 3000);
export const HOST = env.HOST || '127.0.0.1'; // samo ovo racunalo; promijenite svjesno
// dodatna imena hosta koja preglednik smije koristiti (zastita od DNS rebindinga)
export const ALLOWED_HOSTS = new Set(
  ['localhost', '127.0.0.1', '[::1]', HOST.toLowerCase()].concat(
    (env.ALLOWED_HOSTS || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  ),
);
export const POLL_MS = Number(env.POLL_MS || 2000);

// ---------- prijava ----------
// Korisnici se provjeravaju prema OTS-u (isti racuni). Prijava je obavezna cim sucelje ne
// slusa samo na ovom racunalu; na loopback adresi je zadano iskljucena (AUTH_REQUIRED=1 je
// ukljucuje). Izlaganje bez prijave zahtijeva izricito AUTH_REQUIRED=0 i AUTH_ALLOW_OPEN=1.
export const AUTH_REQUIRED =
  env.AUTH_REQUIRED === '1' ? true : env.AUTH_REQUIRED === '0' ? false : !isLoopbackHost(HOST);
export const TRUST_PROXY = env.TRUST_PROXY === '1'; // iza vlastitog reverznog proxyja (X-Forwarded-*)
// Put kolacica sesije. Zadano "/"; kad je aplikacija iza proxyja pod podputanjom (npr. /karta/),
// postavi COOKIE_PATH=/karta/ da kolacic ne dobiva ostatak stranice na toj domeni.
export const COOKIE_PATH = /^\/[A-Za-z0-9/_-]*$/.test(env.COOKIE_PATH || '')
  ? env.COOKIE_PATH
  : '/';
export const SESSION_HOURS = Number(env.AUTH_SESSION_HOURS || 12);
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_MAX_PER_IP = Number(env.AUTH_MAX_ATTEMPTS_IP || 10);
export const LOGIN_MAX_PER_USER = Number(env.AUTH_MAX_ATTEMPTS_USER || 5);
// Uloge: ako je AUTH_EDIT_ROLES prazno, svaki prijavljeni korisnik smije mijenjati (zadano).
// Inace mijenjati smiju samo korisnici s barem jednom od navedenih OTS uloga, ostali samo gledaju.
export const EDIT_ROLES = new Set(
  (env.AUTH_EDIT_ROLES || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
);
export const LOGIN_FAIL_DELAY_MS = 400; // usporava pogadjanje lozinki
export const MAX_CRED_LEN = 256;
// uredjaji koji ne javljaju dulje od ovoga skrivaju se na karti (OTS ih ne brise sam) i
// za njih se vise ne javlja alarm "ne javlja polozaj"
export const OFFLINE_HIDE_HOURS = Number(env.OTS_OFFLINE_HIDE_HOURS || 24);
export const OFFLINE_HIDE_MS = OFFLINE_HIDE_HOURS * 3600 * 1000;
// OTS vraca samo 10 zapisa po stranici; trazimo velike stranice i citamo ih sve do ove granice
export const PAGE_SIZE = 100;
export const MAX_PAGES = Number(env.OTS_MAX_PAGES || 20);
export const ION_TOKEN = env.CESIUM_ION_TOKEN || '';
// Brisanje markera: putanja i nacin poziva (dokumentacija OTS-a ne navodi parametre)
export const MARKERS_PATH = env.OTS_MARKERS_PATH || '/api/markers';
export const DELETE_MODE = env.OTS_DELETE_MODE || 'query'; // query | json | path
export const DELETE_FIELD = env.OTS_DELETE_FIELD || 'uid';
// Uredjaji: /api/eud daje popis (bez polozaja), a polozaj se cita iz povijesti CoT poruka (/api/cot)
export const DEVICES_PATH = env.OTS_DEVICES_PATH || '/api/eud';
export const COT_PATH = env.OTS_COT_PATH || '/api/cot';
export const COT_PAGES = Number(env.OTS_COT_PAGES || 3); // koliko zadnjih stranica povijesti pregledati
export const HISTORY_MAX_PAGES = Number(env.OTS_HISTORY_MAX_PAGES || 60); // sigurnosna granica za /api/history
export const NO_REPORT_MIN = Number(env.OTS_NO_REPORT_MIN || 10); // alarm ako uredjaj ne javlja polozaj X min
// stvarni alarmi iz OTS-a (npr. 911 / "ring the bell" s TAK klijenta); prazno = iskljuceno
export const OTS_ALERTS_PATH = env.OTS_ALERTS_PATH ?? '/api/alerts';
export const OTS_ALERTS_EVERY_MS = Number(env.OTS_ALERTS_EVERY_MS || 10_000);
export const LOW_BATTERY_PCT = Number(env.OTS_LOW_BATTERY_PCT || 20); // alarm kad baterija padne ispod
export const ROOT_DIR = fileURLToPath(new URL('..', import.meta.url));
export const PUBLIC_DIR = join(ROOT_DIR, 'public');

// ogranicenja ulaza (korisnicki unos nikad se ne vjeruje)
export const MAX_NAME_LEN = LIMITS.nameLen;
export const MARKER_TYPE_RE = /^[A-Za-z0-9-]{1,40}$/;
export const BODY_LIMIT_SMALL = 10_000;
export const BODY_LIMIT_LARGE = 50_000;

export const OTS_INSECURE = env.OTS_INSECURE === '1';
if (OTS_INSECURE) {
  console.warn(
    '[upozorenje] OTS_INSECURE=1: provjera TLS certifikata prema OTS-u je iskljucena ' +
      '(samo za OTS klijent). Koristite samo na privatnoj mrezi; bolje postaviti NODE_EXTRA_CA_CERTS.',
  );
}
