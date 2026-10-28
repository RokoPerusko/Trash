// Planirane rute: OTS nema API za njih, pa se cuvaju lokalno (data/routes.json) kao zone.
import { LIMITS, parseRoute, applyRoutePatch } from '../../lib/validate.js';
import { BODY_LIMIT_LARGE } from '../config.js';
import { sendJson, hasAppHeader, readJson } from '../http.js';
import { routes, saveRoutes, removeById, audit } from '../data.js';

export async function handleRoutes({ req, res, url, who, ip }) {
  if (url.pathname !== '/api/routes') return false;
  if (req.method === 'GET') {
    return sendJson(res, { routes });
  }
  if (req.method === 'POST') {
    if (!hasAppHeader(req)) return sendJson(res, { error: 'zabranjeno' }, 403);
    const parsed = await readJson(req, BODY_LIMIT_LARGE);
    if (parsed.error) return sendJson(res, { error: parsed.error }, parsed.status);
    if (routes.length >= LIMITS.routes)
      return sendJson(res, { error: `najviše ${LIMITS.routes} ruta` }, 400);
    const route = parseRoute(parsed.body);
    if (route.error) return sendJson(res, { error: route.error }, 400);
    routes.push(route.value);
    await saveRoutes();
    audit.record(who, ip, 'ruta.dodana', { id: route.value.id, name: route.value.name });
    return sendJson(res, { ok: true, route: route.value });
  }
  if (req.method === 'PUT') {
    if (!hasAppHeader(req)) return sendJson(res, { error: 'zabranjeno' }, 403);
    const idx = routes.findIndex((r) => r.id === url.searchParams.get('id'));
    if (idx < 0) return sendJson(res, { error: 'ruta nije pronađena' }, 404);
    const parsed = await readJson(req, BODY_LIMIT_LARGE);
    if (parsed.error) return sendJson(res, { error: parsed.error }, parsed.status);
    const next = applyRoutePatch(routes[idx], parsed.body);
    if (next.error) return sendJson(res, { error: next.error }, 400);
    routes[idx] = next.value;
    await saveRoutes();
    audit.record(who, ip, 'ruta.izmijenjena', { id: next.value.id, name: next.value.name });
    return sendJson(res, { ok: true, route: next.value });
  }
  if (req.method === 'DELETE') {
    if (!hasAppHeader(req)) return sendJson(res, { error: 'zabranjeno' }, 403);
    const id = url.searchParams.get('id');
    if (!removeById(routes, id)) return sendJson(res, { error: 'ruta nije pronađena' }, 404);
    await saveRoutes();
    audit.record(who, ip, 'ruta.obrisana', { id });
    return sendJson(res, { ok: true });
  }
  return false;
}
