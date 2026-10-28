// Zajednicki dijelovi HTTP odgovora: sigurnosna zaglavlja, JSON odgovor, citanje tijela.
// CSP je namjerno ogranicen na direktive koje ne diraju Cesium. Stroziji script-src/connect-src
// isprobani su u pregledniku i ruse satelitsku podlogu: Cesium ion je ucitava preko Bing Mapsa
// JSONP-om (dev.virtualearth.net) i dohvaca pločice preko http://, pa bi trebalo dopustiti i http:.
const CSP = "frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'self'";
export const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Content-Security-Policy': CSP,
};

export function sendJson(res, obj, status = 200, headers = {}) {
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(JSON.stringify(obj));
  return true; // rukovatelji vracaju ovo kao "zahtjev je obraden"
}

// zastita od poziva s drugih stranica: trazi se zaglavlje koje preglednik ne dopusta cross-origin
export const hasAppHeader = (req) => req.headers['x-tak-app'] === '1';

// cita JSON tijelo uz ogranicenje velicine; vraca { body } ili { error, status }
export async function readJson(req, limit) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > limit) return { error: 'prevelik zahtjev', status: 413 };
  }
  try {
    const body = JSON.parse(raw);
    if (body === null || typeof body !== 'object' || Array.isArray(body))
      throw new Error('nije objekt');
    return { body };
  } catch {
    return { error: 'neispravan JSON', status: 400 };
  }
}
