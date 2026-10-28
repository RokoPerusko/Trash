// Izvoz rute u GPX 1.1 (cista funkcija, bez DOM-a).

const xmlEscape = (s) =>
  String(s).replace(
    /[<>&'"]/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c],
  );

export function routeToGpx(route) {
  const pts = route.points
    .map((p) => `    <rtept lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}"></rtept>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="tak-cesium" xmlns="http://www.topografix.com/GPX/1/1">
  <rte>
    <name>${xmlEscape(route.name)}</name>
${pts}
  </rte>
</gpx>
`;
}

export function gpxFileName(name) {
  const safe = String(name)
    .replace(/[^\p{L}\p{N}_-]+/gu, '_')
    .replace(/^_+|_+$/g, '');
  return `${safe || 'ruta'}.gpx`;
}
