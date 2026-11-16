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

// razdvaja trag na dionice gdje je signal bio prekinut (razmak izmedju tocaka veci od gapMs)
export function splitTrack(points, gapMs = 5 * 60 * 1000) {
  const segs = [];
  let cur = [];
  for (const p of points) {
    if (cur.length && p.t - cur[cur.length - 1].t > gapMs) {
      segs.push(cur);
      cur = [];
    }
    cur.push(p);
  }
  if (cur.length) segs.push(cur);
  return segs;
}

const iso = (t) => new Date(t).toISOString();

// trag kretanja uredjaja kao GPX 1.1 (trk/trkseg, s visinom i vremenom)
export function trackToGpx(name, points) {
  const segs = splitTrack(points)
    .map((seg) => {
      const pts = seg
        .map(
          (p) =>
            `      <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}">` +
            (Number.isFinite(p.alt) ? `<ele>${Math.round(p.alt)}</ele>` : '') +
            `<time>${iso(p.t)}</time></trkpt>`,
        )
        .join('\n');
      return `    <trkseg>\n${pts}\n    </trkseg>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="tak-cesium" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${xmlEscape(name)}</name>
${segs}
  </trk>
</gpx>
`;
}

// isti trag kao KML (Google Earth, ATAK): po jedna linija za svaku dionicu
export function trackToKml(name, points) {
  const lines = splitTrack(points)
    .filter((seg) => seg.length > 1)
    .map((seg) => {
      const coords = seg.map(
        (p) => `${p.lon.toFixed(6)},${p.lat.toFixed(6)},${Math.round(p.alt || 0)}`,
      );
      return `    <Placemark>
      <name>${xmlEscape(name)}</name>
      <LineString><tessellate>1</tessellate><coordinates>${coords.join(' ')}</coordinates></LineString>
    </Placemark>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${xmlEscape(name)}</name>
${lines}
  </Document>
</kml>
`;
}

export function gpxFileName(name, ext = 'gpx') {
  const safe = String(name)
    .replace(/[^\p{L}\p{N}_-]+/gu, '_')
    .replace(/^_+|_+$/g, '');
  return `${safe || 'ruta'}.${ext}`;
}
