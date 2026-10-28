// Zone: OTS nema API za njih, pa se cuvaju lokalno (data/zones.json).
import { LIMITS, parseZone } from '../../lib/validate.js';
import { BODY_LIMIT_LARGE } from '../config.js';
import { sendJson, hasAppHeader, readJson } from '../http.js';
import { zones, saveZones, removeById, audit } from '../data.js';

export async function handleZones({ req, res, url, who, ip }) {
  if (url.pathname !== '/api/zones') return false;
  if (req.method === 'GET') {
    return sendJson(res, { zones });
  }
  if (req.method === 'POST') {
    if (!hasAppHeader(req)) return sendJson(res, { error: 'zabranjeno' }, 403);
    const parsed = await readJson(req, BODY_LIMIT_LARGE);
    if (parsed.error) return sendJson(res, { error: parsed.error }, parsed.status);
    if (zones.length >= LIMITS.zones)
      return sendJson(res, { error: `najviše ${LIMITS.zones} zona` }, 400);
    const zone = parseZone(parsed.body);
    if (zone.error) return sendJson(res, { error: zone.error }, 400);
    zones.push(zone.value);
    await saveZones();
    audit.record(who, ip, 'zona.dodana', { id: zone.value.id, name: zone.value.name });
    return sendJson(res, { ok: true, zone: zone.value });
  }
  if (req.method === 'DELETE') {
    if (!hasAppHeader(req)) return sendJson(res, { error: 'zabranjeno' }, 403);
    const id = url.searchParams.get('id');
    if (!removeById(zones, id)) return sendJson(res, { error: 'zona nije pronađena' }, 404);
    await saveZones();
    audit.record(who, ip, 'zona.obrisana', { id });
    return sendJson(res, { ok: true });
  }
  return false;
}
