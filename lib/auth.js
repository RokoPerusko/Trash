// Pomocne funkcije za zahtjeve.
// IP klijenta; iza vlastitog reverznog proxyja (TRUST_PROXY=1) vrijedi zadnji unos
// X-Forwarded-For, tj. onaj koji je dodao nas proxy, a ne onaj koji je klijent mogao podmetnuti.
export function clientIp(req, trustProxy) {
  if (trustProxy) {
    const parts = String(req.headers['x-forwarded-for'] || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  return req.socket.remoteAddress || 'nepoznato';
}

export const isLoopbackHost = (host) => ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host);
