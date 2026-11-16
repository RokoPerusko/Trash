// GET /api/geocode?q=...: trazenje mjesta i adresa.
import { sendJson } from '../http.js';
import { geocode } from '../geocode.js';

export async function handleGeocode({ res, url }) {
  if (url.pathname !== '/api/geocode') return false;
  const q = (url.searchParams.get('q') || '').trim();
  if (q.length < 2 || q.length > 120) return sendJson(res, { error: 'neispravan upit' }, 400);
  try {
    return sendJson(res, { places: await geocode(q) });
  } catch (e) {
    return sendJson(res, { error: e.message }, 502);
  }
}
