// Zahtjevi gledatelja za visu kvalitetu streama. MediaMTX ne zna za njih, pa ih ova aplikacija
// pamti u memoriji, a posiljatelj (stranica koja emitira) ih povremeno pita. Zahtjev vrijedi
// kratko i mora se obnavljati, pa nestaje cim gledatelj ode.
const TTL_MS = 15_000;
const MAX_PATHS = 200;
const MAX_VIEWERS = 50;

export function createQualityBook(now = Date.now) {
  const paths = new Map(); // path -> Map(viewerId -> istek)

  function prune(path) {
    const viewers = paths.get(path);
    if (!viewers) return null;
    for (const [id, until] of viewers) if (until <= now()) viewers.delete(id);
    if (!viewers.size) paths.delete(path);
    return viewers.size ? viewers : null;
  }

  return {
    request(path, viewerId, hd) {
      if (!hd) {
        paths.get(path)?.delete(viewerId);
        prune(path);
        return;
      }
      if (!paths.has(path) && paths.size >= MAX_PATHS) {
        for (const p of [...paths.keys()]) prune(p);
        if (paths.size >= MAX_PATHS) return;
      }
      const viewers = paths.get(path) ?? new Map();
      if (viewers.size < MAX_VIEWERS || viewers.has(viewerId)) {
        viewers.set(viewerId, now() + TTL_MS);
      }
      paths.set(path, viewers);
    },
    status(path) {
      const viewers = prune(path);
      return { hd: !!viewers, viewers: viewers?.size ?? 0 };
    },
  };
}

export const qualityBook = createQualityBook();
