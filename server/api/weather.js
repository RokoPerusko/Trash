// GET /api/weather?lat=..&lon=.. : trenutno vrijeme i prognoza za tocku na karti.
import { sendJson } from '../http.js';
import { num, validLat, validLon } from '../../lib/validate.js';
import { getWeather } from '../weather.js';

export async function handleWeather({ res, url }) {
  if (url.pathname !== '/api/weather') return false;
  const lat = num(url.searchParams.get('lat'));
  const lon = num(url.searchParams.get('lon'));
  if (!validLat(lat) || !validLon(lon))
    return sendJson(res, { error: 'neispravne koordinate' }, 400);
  try {
    return sendJson(res, await getWeather(lat, lon));
  } catch (e) {
    return sendJson(res, { error: e.message }, 502);
  }
}
