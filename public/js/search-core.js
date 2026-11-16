// Globalna pretraga (cista funkcija): objekti, zone i rute, poredani po tome koliko je podudaranje blisko.
const norm = (s) =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // č, ć, š, ž, đ se traze i bez kvacica
    .replace(/đ/g, 'd');

function score(text, q) {
  const t = norm(text);
  if (!t) return 0;
  if (t === q) return 4;
  if (t.startsWith(q)) return 3;
  if (t.split(/[\s_-]+/).some((w) => w.startsWith(q))) return 2;
  return t.includes(q) ? 1 : 0;
}

export function searchLocal(query, { items = [], zones = [], routes = [] }, limit = 6) {
  const q = norm(query).trim();
  if (!q) return [];
  const pick = (list, group, toRow) =>
    list
      .map((x) => ({ x, s: Math.max(score(x.name, q), score(x.id, q) && 1) }))
      .filter((r) => r.s > 0)
      .sort((a, b) => b.s - a.s || String(a.x.name).localeCompare(String(b.x.name), 'hr'))
      .slice(0, limit)
      .map(({ x }) => ({ group, ...toRow(x) }));
  return [
    ...pick(items, 'Objekti', (i) => ({ type: 'item', id: i.id, label: i.name, kind: i.kind })),
    ...pick(zones, 'Zone', (z) => ({ type: 'zone', id: z.id, label: z.name })),
    ...pick(routes, 'Rute', (r) => ({ type: 'route', id: r.id, label: r.name })),
  ];
}
