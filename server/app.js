// HTTP poslužitelj: provjera hosta, pa rute po temama. Nema prijave: svi koji dosegnu sucelje smiju sve.
import http from 'node:http';
import { clientIp } from '../lib/auth.js';
import { ALLOWED_HOSTS, TRUST_PROXY } from './config.js';
import { sendJson, SECURITY_HEADERS } from './http.js';
import { handleInfo } from './api/info.js';
import { handleMarkers } from './api/markers.js';
import { handleZones } from './api/zones.js';
import { handleRoutes } from './api/routes.js';
import { serveStatic } from './static.js';

// svaka ruta vraca true kad je zahtjev obradila
const API_HANDLERS = [handleInfo, handleMarkers, handleZones, handleRoutes];

export const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    // zastita od DNS rebindinga: zlonamjerna stranica ne smije citati API preko tudjeg imena hosta
    const hostName = String(req.headers.host || '')
      .toLowerCase()
      .replace(/:\d+$/, '');
    if (!ALLOWED_HOSTS.has(hostName)) return sendJson(res, { error: 'zabranjeno' }, 403);

    const ctx = { req, res, url, who: null, ip: clientIp(req, TRUST_PROXY) };
    if (url.pathname === '/api/health') return sendJson(res, { ok: true });

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
