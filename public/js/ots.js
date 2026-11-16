// OTS: stanje servera, grupe, misije i R&B linije (udaljenost i smjer izmedju dvije tocke).
// Podaci se citaju iz /api/ots (kesirano na serveru, osvjezava se svakih 10 s).
import { $, el, clear, api, icon, emptyState } from './util.js';
import { formatDistance, haversineM } from './geo.js';

const REFRESH_MS = 10000;

// 1227177 s -> "14 d 4 h", 5400 s -> "1 h 30 min"
function uptime(sec) {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d) return `${d} d ${h} h`;
  return h ? `${h} h ${m} min` : `${m} min`;
}

const meter = (value, label) =>
  el(
    'div',
    { class: 'meter-row' },
    el('span', { text: label }),
    el(
      'div',
      { class: 'meter', title: `${value}%` },
      el('i', {
        class: value >= 90 ? 'bad' : value >= 75 ? 'warn' : '',
        style: `width:${Math.max(0, Math.min(100, value))}%`,
      }),
    ),
    el('b', { text: `${Math.round(value)}%` }),
  );

export function createOts(app) {
  const { Cesium, viewer } = app.map;
  let data = null;
  let error = null;
  const lines = new Map(); // id -> entity

  // ---------- R&B linije na karti ----------
  function syncLines(list) {
    const seen = new Set();
    for (const l of list) {
      seen.add(l.id);
      const positions = Cesium.Cartesian3.fromDegreesArray([
        l.from.lon,
        l.from.lat,
        l.to.lon,
        l.to.lat,
      ]);
      const meters = haversineM(l.from.lat, l.from.lon, l.to.lat, l.to.lon);
      const mid = Cesium.Cartesian3.fromDegrees(
        (l.from.lon + l.to.lon) / 2,
        (l.from.lat + l.to.lat) / 2,
      );
      let e = lines.get(l.id);
      if (!e) {
        e = viewer.entities.add({
          id: `rb-${l.id}`,
          polyline: {
            positions,
            width: 2.5,
            clampToGround: true,
            material: new Cesium.PolylineDashMaterialProperty({
              color: Cesium.Color.fromCssColorString('#5dd3f0'),
              dashLength: 14,
            }),
          },
          position: mid,
          label: {
            text: `${l.name}: ${formatDistance(meters)}`,
            font: '600 12px system-ui, sans-serif',
            showBackground: true,
            backgroundColor: Cesium.Color.fromCssColorString('rgba(15,20,32,0.78)'),
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 80000),
          },
        });
        lines.set(l.id, e);
      } else {
        e.polyline.positions = positions;
        e.position = mid;
        e.label.text = `${l.name}: ${formatDistance(meters)}`;
      }
    }
    for (const [id, e] of lines) {
      if (!seen.has(id)) {
        viewer.entities.remove(e);
        lines.delete(id);
      }
    }
  }

  // ---------- sazetak u izborniku ----------
  function renderSummary() {
    const box = $('otsSummary');
    if (!box) return;
    const s = data?.status;
    box.hidden = !s;
    if (!s) return;
    box.textContent = [
      `OTS ${s.version ?? '?'}`,
      s.cpu !== null ? `CPU ${Math.round(s.cpu)}%` : null,
      s.disk !== null ? `disk ${Math.round(s.disk)}%` : null,
      s.onlineEuds !== null ? `${s.onlineEuds} online` : null,
    ]
      .filter(Boolean)
      .join(' · ');
  }

  // ---------- panel ----------
  function renderPanel() {
    const box = clear($('otsBody'));
    if (error && !data) {
      box.append(el('p', { class: 'empty-note', text: `OTS podaci nisu dostupni: ${error}` }));
      return;
    }
    if (!data) {
      box.append(el('p', { class: 'empty-note', text: 'Učitavanje…' }));
      return;
    }
    const s = data.status;
    const worst = s ? Math.max(s.cpu ?? 0, s.memory ?? 0, s.disk ?? 0) : null;
    const health = worst === null ? null : worst >= 90 ? 'bad' : worst >= 75 ? 'warn' : 'ok';
    const open = (path) => `${(data.url || '').replace(/\/+$/, '')}${path}`;
    const link = (label, path) =>
      data.url
        ? el(
            'a',
            { class: 'btn small', href: open(path), target: '_blank', rel: 'noopener' },
            label,
          )
        : null;

    box.append(
      el(
        'div',
        { class: 'ots-head' },
        el(
          'div',
          { class: 'grow' },
          el('b', { text: s ? `OpenTAKServer ${s.version ?? ''}`.trim() : 'OpenTAKServer' }),
          health &&
            el('span', {
              class: `vp-badge ${health === 'ok' ? 'idle' : health === 'warn' ? 'warn' : 'bad'}`,
              text: { ok: 'radi uredno', warn: 'opterećen', bad: 'preopterećen' }[health],
            }),
        ),
        link('Otvori OTS', '/'),
      ),
    );
    if (s) {
      box.append(
        el(
          'dl',
          { class: 'ots-dl' },
          ...[
            ['OTS radi', s.uptimeSec !== null ? uptime(s.uptimeSec) : null],
            ['Sustav radi', s.systemUptimeSec !== null ? uptime(s.systemUptimeSec) : null],
            ['Opterećenje', s.load?.join(' / ')],
          ]
            .filter(([, v]) => v !== null && v !== undefined && v !== '')
            .flatMap(([k, v]) => [el('dt', { text: k }), el('dd', { text: String(v) })]),
        ),
        s.cpu !== null && meter(s.cpu, 'CPU'),
        s.memory !== null && meter(s.memory, 'Memorija'),
        s.disk !== null && meter(s.disk, 'Disk'),
        s.onlineEuds !== null &&
          el(
            'button',
            {
              type: 'button',
              class: 'btn wide ots-online',
              onclick: () => app.nav.open('objects'),
            },
            icon('list'),
            `${s.onlineEuds} ${s.onlineEuds === 1 ? 'uređaj online' : 'uređaja online'}, prikaži na karti`,
          ),
      );
    } else {
      box.append(el('p', { class: 'empty-note', text: data.errors?.status || 'Nema podataka.' }));
    }

    box.append(
      el('h3', { class: 'sub-h', text: `Grupe (${data.groups.length})` }),
      data.groups.length
        ? el(
            'div',
            { class: 'ots-groups' },
            data.groups.map((g) =>
              el('span', {
                class: 'tag group',
                title: g.description || '',
                text: g.users ? `${g.name} · ${g.users}` : g.name,
              }),
            ),
          )
        : el('p', { class: 'empty-note', text: 'Nema grupa.' }),
    );

    box.append(el('h3', { class: 'sub-h', text: `Misije (${data.missions.length})` }));
    if (!data.missions.length) {
      box.append(
        emptyState({
          icon: 'layers',
          title: 'Nema misija',
          text: 'Misija je zajednički prostor ekipe: skup markera, ruta i datoteka koje svi članovi vide i uređuju. Stvara se u OTS-u ili iz ATAK-a.',
        }),
        el('div', { class: 'row' }, link('Misije u OTS-u', '/missions')),
      );
    } else {
      const missions = el('ul', { class: 'list plain' });
      for (const m of data.missions) {
        const onMap = m.uids.filter((id) => app.items.get(id));
        const counts = [
          `${m.uids.length} objekata (${onMap.length} na karti)`,
          `${m.files} datoteka`,
          m.changes ? `${m.changes} promjena` : null,
        ].filter(Boolean);
        const flags = [
          m.locked ? 'lozinka' : null,
          m.inviteOnly ? 'samo uz poziv' : null,
          ...m.groups,
        ].filter(Boolean);
        const empty = !m.uids.length && !m.files;
        const rows = Object.entries(m.fields).map(([k, v]) =>
          el('div', { class: 'sub', text: `${k}: ${v}` }),
        );
        missions.append(
          el(
            'li',
            { class: 'col mission' },
            el('div', { class: 'nm', text: m.name }),
            m.description && el('div', { class: 'sub', text: m.description }),
            m.owner && el('div', { class: 'sub', text: `Vlasnik: ${m.owner}` }),
            flags.length &&
              el(
                'div',
                { class: 'ots-groups' },
                flags.map((f) => el('span', { class: 'tag group', text: f })),
              ),
            el('div', { class: 'sub', text: counts.join(' · ') }),
            empty &&
              el('div', {
                class: 'sub',
                text: 'Misija je prazna. U iTAK-u se pretplati na nju i dodaj marker ili datoteku.',
              }),
            onMap.length > 0 &&
              el(
                'button',
                {
                  type: 'button',
                  class: 'btn small',
                  onclick: () => {
                    const entities = onMap.map((id) => app.items.entities.get(id)).filter(Boolean);
                    if (entities.length) viewer.flyTo(entities, { duration: 1.4 });
                  },
                },
                icon('target'),
                'Prikaži na karti',
              ),
            rows.length > 0 && el('details', {}, el('summary', { text: 'Detalji' }), rows),
          ),
        );
      }
      box.append(missions, el('div', { class: 'row' }, link('Otvori misije u OTS-u', '/missions')));
    }

    box.append(
      el('h3', { class: 'sub-h', text: `R&B linije (${data.rbLines.length})` }),
      el('p', {
        class: 'empty-note',
        text: data.rbLines.length
          ? 'Prikazane su na karti isprekidanom linijom s udaljenošću.'
          : 'Nema linija udaljenosti i smjera.',
      }),
    );
  }

  async function sync() {
    try {
      data = await api('GET', '/api/ots');
      error = null;
      syncLines(data.rbLines || []);
    } catch (e) {
      error = e.message;
    }
    renderSummary();
    if (app.nav?.current() === 'ots') renderPanel();
  }

  sync();
  setInterval(sync, REFRESH_MS);
  return { sync, render: renderPanel };
}
