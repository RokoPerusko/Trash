// Citanje: stanje karte, postavke za preglednik, povijest uredjaja, alarmi, dijagnostika.
import {
  ENDPOINTS,
  OTS_URL,
  ION_TOKEN,
  POLL_MS,
  MARKERS_PATH,
  OFFLINE_HIDE_HOURS,
} from '../config.js';
import { sendJson } from '../http.js';
import { ots, otsGet } from '../ots.js';
import { state } from '../state.js';
import { loadHistory } from '../history.js';
import { alerts, otsAlerts } from '../alerts.js';

export async function handleInfo({ req, res, url }) {
  if (url.pathname === '/api/state') return sendJson(res, state);
  if (url.pathname === '/config') {
    return sendJson(res, {
      ionToken: ION_TOKEN,
      pollMs: POLL_MS,
      markersPath: MARKERS_PATH,
      offlineHideHours: OFFLINE_HIDE_HOURS,
    });
  }
  if (url.pathname === '/api/history') {
    const uid = url.searchParams.get('uid');
    if (!uid) return sendJson(res, { error: 'uid je obavezan' }, 400);
    const fromParam = url.searchParams.get('from');
    const toParam = url.searchParams.get('to');
    const fromTime = fromParam ? Date.parse(fromParam) : null;
    const toTime = toParam ? Date.parse(toParam) : Date.now();
    if (fromParam && Number.isNaN(fromTime))
      return sendJson(res, { error: 'neispravan from' }, 400);
    if (Number.isNaN(toTime)) return sendJson(res, { error: 'neispravan to' }, 400);
    try {
      sendJson(res, await loadHistory(uid, fromTime, toTime));
    } catch (e) {
      sendJson(res, { error: e.message }, 502);
    }
    return true;
  }
  if (url.pathname === '/api/alerts' && req.method === 'GET') {
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 50));
    return sendJson(res, { alerts: alerts.slice(0, limit), ots: otsAlerts });
  }
  if (url.pathname === '/api/debug') {
    const raw = {};
    for (const path of ENDPOINTS) {
      try {
        const r = await otsGet(path);
        raw[path] = { status: r.status, body: r.json ?? r.text.slice(0, 500) };
      } catch (e) {
        raw[path] = { error: e.message };
      }
    }
    return sendJson(res, { login: ots.strategy, otsUrl: OTS_URL, raw });
  }
  return false;
}
