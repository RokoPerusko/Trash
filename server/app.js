// HTTP poslužitelj: provjere svakog zahtjeva (host, prijava, pravo uredjivanja), pa rute po temama.
import http from 'node:http';
import { clientIp } from '../lib/auth.js';
import { ALLOWED_HOSTS, TRUST_PROXY } from './config.js';
import { sendJson, SECURITY_HEADERS } from './http.js';
import { getSession, handleSessionRoutes } from './api/session.js';
import { handleInfo } from './api/info.js';
import { handleMarkers } from './api/markers.js';
import { handleZones } from './api/zones.js';
import { handleRoutes } from './api/routes.js';
import { serveStatic } from './static.js';

// rute koje traze prijavu; svaka vraca true kad je zahtjev obradila
const API_HANDLERS = [handleInfo, handleMarkers, handleZones, handleRoutes];

export const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    // zastita od DNS rebindinga: zlonamjerna stranica ne smije citati API preko tudjeg imena hosta
    const hostName = String(req.headers.host || '')
      .toLowerCase()
      .replace(/:\d+$/, '');
    if (!ALLOWED_HOSTS.has(hostName)) return sendJson(res, { error: 'zabranjeno' }, 403);

    // prijava: sve osim stranice i njenih datoteka trazi valjanu sesiju
    const session = getSession(req);
    const ctx = {
      req,
      res,
      url,
      session,
      who: session?.username ?? null,
      ip: clientIp(req, TRUST_PROXY),
    };
    if (await handleSessionRoutes(ctx)) return;

    const isApi = url.pathname.startsWith('/api/') || url.pathname === '/config';
    if (isApi && !session) return sendJson(res, { error: 'potrebna prijava' }, 401);
    // promjene smiju samo korisnici s pravom uredjivanja (provjera je na serveru, ne u sucelju)
    if (isApi && req.method !== 'GET' && !session.canEdit) {
      return sendJson(res, { error: 'nemaš pravo mijenjati podatke (samo pregled)' }, 403);
    }
    for (const handler of API_HANDLERS) if (await handler(ctx)) return;

    if (req.method !== 'GET' && req.method !== 'HEAD')
      return sendJson(res, { error: 'metoda nije dopuštena' }, 405);
    await serveStatic(req, res, url);
  } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'EISDIR') {
      res.writeHead(404, SECURITY_HEADERS);
      return res.end('nije pronadeno');
    }
    console.error('[greška]', req.method, url.pathname, e);
    sendJson(res, { error: 'interna greška servera' }, 500); // detalji samo u logu, ne klijentu
  }
});
