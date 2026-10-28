// Markeri: stvaranje, premjestanje, preimenovanje i brisanje preko OTS-a (/api/markers).
import { randomUUID } from 'node:crypto';
import { num, validLat, validLon } from '../../lib/validate.js';
import {
  MARKERS_PATH,
  DELETE_MODE,
  DELETE_FIELD,
  MAX_NAME_LEN,
  MARKER_TYPE_RE,
  BODY_LIMIT_SMALL,
} from '../config.js';
import { sendJson, hasAppHeader, readJson } from '../http.js';
import { otsSend } from '../ots.js';
import { state, refresh } from '../state.js';
import { audit } from '../data.js';

async function deleteMarker({ req, res, who, ip }) {
  if (!hasAppHeader(req)) return sendJson(res, { error: 'zabranjeno' }, 403);
  const parsed = await readJson(req, BODY_LIMIT_SMALL);
  if (parsed.error) return sendJson(res, { error: parsed.error }, parsed.status);
  const id = String(parsed.body.id ?? '');
  const item = state.items.find((i) => i.id === id);
  if (!id || !item) return sendJson(res, { error: 'objekt nije pronaden u trenutnom stanju' }, 404);
  if (!item.from?.includes(MARKERS_PATH)) {
    return sendJson(
      res,
      { error: `objekt ne dolazi iz ${MARKERS_PATH}, brisanje nije podrzano` },
      400,
    );
  }
  let path = MARKERS_PATH,
    payload;
  if (DELETE_MODE === 'json') payload = { [DELETE_FIELD]: id };
  else if (DELETE_MODE === 'path') path += '/' + encodeURIComponent(id);
  else path += '?' + new URLSearchParams({ [DELETE_FIELD]: id });
  console.log(`[brisanje] DELETE ${path}${payload ? ' ' + JSON.stringify(payload) : ''}`);
  const r = await otsSend('DELETE', path, { json: payload });
  console.log(`[brisanje] odgovor HTTP ${r.status}`);
  const ok = r.status >= 200 && r.status < 300;
  if (ok) refresh().catch(() => {});
  audit.record(who, ip, 'marker.obrisan', { id, name: item.name, ok });
  return sendJson(
    res,
    {
      ok,
      status: r.status,
      response: r.json ?? r.text.slice(0, 500),
      sent: { method: 'DELETE', path, body: payload ?? null },
    },
    ok ? 200 : 502,
  );
}

// stvaranje (bez uid) i premjestanje/preimenovanje (s uid) markera - OTS nema
// zaseban PUT, ponovni POST s istim uid azurira postojeci marker (vidi README)
async function upsertMarker({ req, res, who, ip }) {
  if (!hasAppHeader(req)) return sendJson(res, { error: 'zabranjeno' }, 403);
  const parsed = await readJson(req, BODY_LIMIT_SMALL);
  if (parsed.error) return sendJson(res, { error: parsed.error }, parsed.status);
  const body = parsed.body;
  const lat = num(body.lat),
    lon = num(body.lon);
  if (!validLat(lat)) return sendJson(res, { error: 'neispravna širina' }, 400);
  if (!validLon(lon)) return sendJson(res, { error: 'neispravna dužina' }, 400);
  const name = String(body.name || '').trim();
  if (!name) return sendJson(res, { error: 'ime je obavezno' }, 400);
  if (name.length > MAX_NAME_LEN) return sendJson(res, { error: 'ime je predugo' }, 400);
  let uid = body.uid ? String(body.uid) : null;
  let type = body.type ? String(body.type) : null;
  if (type && !MARKER_TYPE_RE.test(type)) return sendJson(res, { error: 'neispravan tip' }, 400);
  if (uid) {
    const existing = state.items.find((i) => i.id === uid);
    if (!existing || !existing.from?.includes(MARKERS_PATH)) {
      return sendJson(
        res,
        { error: `marker ${uid} ne postoji ili ne dolazi iz ${MARKERS_PATH}` },
        404,
      );
    }
    if (!type) type = existing.type || 'a-u-G'; // OTS resetira tip na a-u-G ako nije poslan
  } else {
    uid = randomUUID();
    type = type || 'a-u-G';
  }
  const payload = { uid, latitude: lat, longitude: lon, name, type };
  console.log(`[marker] POST ${MARKERS_PATH} ${JSON.stringify(payload)}`);
  const r = await otsSend('POST', MARKERS_PATH, { json: payload });
  console.log(`[marker] odgovor HTTP ${r.status}`);
  const ok = r.status >= 200 && r.status < 300 && r.json?.success !== false;
  if (ok) refresh().catch(() => {});
  audit.record(who, ip, body.uid ? 'marker.izmijenjen' : 'marker.dodan', { id: uid, name, ok });
  return sendJson(
    res,
    { ok, uid, status: r.status, response: r.json ?? r.text.slice(0, 500) },
    ok ? 200 : 502,
  );
}

export async function handleMarkers(ctx) {
  const { req, url } = ctx;
  if (url.pathname === '/api/delete-marker' && req.method === 'POST') {
    return deleteMarker(ctx);
  }
  if (url.pathname === '/api/upsert-marker' && req.method === 'POST') {
    return upsertMarker(ctx);
  }
  return false;
}
