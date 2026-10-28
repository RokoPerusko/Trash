// Rute: planiranje klikom po karti, popis, detalji (duljina, vrijeme, uspon/spust, visinski
// profil, dionice), izmjena, obrtanje smjera i izvoz u GPX. OTS nema API za planirane rute,
// pa se rute cuvaju na nasem backendu (data/routes.json) i dijele medu korisnicima.
import { $, el, clear, icon, api, toast } from './util.js';
import { askText, confirmDialog } from './dialog.js';
import { themeColor, toDeg } from './map.js';
import {
  routeLegs,
  routeLength,
  sampleRoute,
  elevationStats,
  formatDistance,
  formatDuration,
  travelSeconds,
} from './geo.js';
import { routeToGpx, gpxFileName } from './gpx.js';
import { buildProfileSvg } from './profile.js';

const PROFILE_SAMPLES = 80;
const SPEED_PRESETS = [
  ['Pješice', 5],
  ['Bicikl', 15],
  ['Vozilo', 50],
  ['Dron', 40],
];
const ROUTE_COLOR = '#f59e0b';
const ROUTE_COLOR_SELECTED = '#fbbf24';

export function createRoutes(app) {
  const { Cesium, viewer, pickGround } = app.map;
  let routes = [];
  let selectedId = null;
  let signature = '';
  let renderToken = 0;
  const drawn = new Map(); // id rute -> entiteti na karti
  const draft = [];
  let draftPts = [];

  const find = (id) => routes.find((r) => r.id === id);
  const cartesian = (p) => Cesium.Cartesian3.fromDegrees(p.lon, p.lat);

  // ---------- crtanje na karti ----------
  function eraseRoute(id) {
    for (const e of drawn.get(id) || []) viewer.entities.remove(e);
    drawn.delete(id);
  }

  function drawRoute(r) {
    eraseRoute(r.id);
    const selected = r.id === selectedId;
    const list = [];
    const line = viewer.entities.add({
      polyline: {
        positions: r.points.map(cartesian),
        width: selected ? 6 : 4,
        material: Cesium.Color.fromCssColorString(selected ? ROUTE_COLOR_SELECTED : ROUTE_COLOR),
        clampToGround: true,
      },
    });
    line.routeId = r.id;
    list.push(line);

    const start = r.points[0];
    const label = viewer.entities.add({
      position: cartesian(start),
      label: {
        text: r.name,
        font: '600 12px system-ui, sans-serif',
        fillColor: Cesium.Color.WHITE,
        showBackground: true,
        backgroundColor: Cesium.Color.fromCssColorString('rgba(15,20,32,0.78)'),
        pixelOffset: new Cesium.Cartesian2(0, -16),
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 80000),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
    label.routeId = r.id;
    list.push(label);

    if (selected) {
      r.points.forEach((p, i) => {
        const first = i === 0;
        const last = i === r.points.length - 1;
        const wp = viewer.entities.add({
          position: cartesian(p),
          point: {
            pixelSize: first || last ? 12 : 9,
            color: Cesium.Color.fromCssColorString(
              first ? '#3fcf8e' : last ? '#e5484d' : ROUTE_COLOR_SELECTED,
            ),
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 2,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
          label: {
            text: String(i + 1),
            font: '700 11px system-ui, sans-serif',
            fillColor: Cesium.Color.WHITE,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 3,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cesium.Cartesian2(0, 16),
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
        wp.routeId = r.id;
        list.push(wp);
      });
    }
    drawn.set(r.id, list);
  }

  function flyToRoute(r) {
    const lats = r.points.map((p) => p.lat);
    const lons = r.points.map((p) => p.lon);
    const padLat = Math.max(0.002, (Math.max(...lats) - Math.min(...lats)) * 0.25);
    const padLon = Math.max(0.002, (Math.max(...lons) - Math.min(...lons)) * 0.25);
    viewer.camera.flyTo({
      destination: Cesium.Rectangle.fromDegrees(
        Math.min(...lons) - padLon,
        Math.min(...lats) - padLat,
        Math.max(...lons) + padLon,
        Math.max(...lats) + padLat,
      ),
      duration: 1.2,
    });
  }

  // ---------- popis ----------
  const summary = (r) => {
    const len = routeLength(r.points);
    return `${formatDistance(len)} · ${formatDuration(travelSeconds(len, r.speedKmh))} @ ${r.speedKmh} km/h`;
  };

  function renderList() {
    const list = clear($('routeList'));
    if (!routes.length) {
      list.appendChild(el('li', { class: 'empty', text: 'Nema ruta. Dodaj prvu gumbom iznad.' }));
      return;
    }
    for (const r of routes) {
      list.appendChild(
        el(
          'li',
          { onclick: () => select(r.id, true) },
          el('span', { class: 'dot', style: `background:${ROUTE_COLOR}` }),
          el(
            'div',
            { class: 'grow' },
            el('div', { class: 'nm', text: r.name }),
            el('div', { class: 'sub', text: summary(r) }),
          ),
        ),
      );
    }
  }

  // ---------- detalji ----------
  const stat = (value, label) =>
    el('div', { class: 'stat' }, el('b', { text: value }), el('span', { text: label }));

  async function patch(r, body, okMessage) {
    try {
      await api('PUT', `/api/routes?id=${encodeURIComponent(r.id)}`, body);
      if (okMessage) toast(okMessage, 'ok');
      await sync(true);
    } catch (e) {
      toast(`Izmjena rute nije uspjela: ${e.message}`, 'bad');
    }
  }

  function download(r) {
    const blob = new Blob([routeToGpx(r)], { type: 'application/gpx+xml' });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: gpxFileName(r.name) });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function renderDetail() {
    const r = find(selectedId);
    $('routeListView').hidden = !!r;
    $('routeDetail').hidden = !r;
    if (!r) return;
    const token = ++renderToken;
    const legs = routeLegs(r.points);
    const length = routeLength(r.points);
    const box = clear($('routeDetail'));

    const speedInput = el('input', {
      type: 'number',
      min: '0.1',
      max: '2000',
      step: '0.5',
      value: String(r.speedKmh),
      'aria-label': 'Brzina u km/h',
    });
    const setSpeed = (v) => {
      const speed = Number(v);
      if (Number.isFinite(speed) && speed > 0 && speed !== r.speedKmh) {
        patch(r, { speedKmh: speed });
      }
    };
    speedInput.addEventListener('change', () => setSpeed(speedInput.value));
    const presets = SPEED_PRESETS.map(([label, v]) =>
      el('button', {
        type: 'button',
        class: `btn${r.speedKmh === v ? ' on' : ''}`,
        text: label,
        onclick: () => setSpeed(v),
      }),
    );

    const profileBox = el('div', { class: 'muted', text: 'Računam visinski profil…' });
    const elevStats = el('div', { class: 'stats' });
    elevStats.hidden = true;

    box.append(
      el(
        'button',
        { type: 'button', class: 'back', onclick: () => select(null) },
        icon('chevron-left'),
        'Sve rute',
      ),
      el('div', { class: 'route-title', text: r.name }),
      el(
        'div',
        { class: 'stats' },
        stat(formatDistance(length), 'Duljina'),
        stat(formatDuration(travelSeconds(length, r.speedKmh)), `Vrijeme pri ${r.speedKmh} km/h`),
        stat(String(r.points.length), 'Točaka'),
        stat(String(legs.length), 'Dionica'),
      ),
      el('div', { class: 'h3', text: 'Brzina kretanja' }),
      el(
        'div',
        { class: 'speed-row' },
        speedInput,
        el('span', { class: 'muted', text: 'km/h' }),
        ...presets,
      ),
      el('div', { class: 'h3', text: 'Visinski profil' }),
      elevStats,
      profileBox,
      el('div', { class: 'h3', text: 'Dionice' }),
      el(
        'table',
        { class: 'legs' },
        el(
          'thead',
          {},
          el(
            'tr',
            {},
            ...['Dionica', 'Duljina', 'Azimut', 'Ukupno'].map((t) => el('th', { text: t })),
          ),
        ),
        el(
          'tbody',
          {},
          ...legs.map((l) =>
            el(
              'tr',
              {},
              el('td', { text: `${l.from + 1} → ${l.to + 1}` }),
              el('td', { text: formatDistance(l.dist) }),
              el('td', { text: `${Math.round(l.bearing)}°` }),
              el('td', { text: formatDistance(l.cum) }),
            ),
          ),
        ),
      ),
      el(
        'div',
        { class: 'row wrap' },
        el(
          'button',
          { type: 'button', class: 'btn', onclick: () => flyToRoute(r) },
          icon('target'),
          'Približi',
        ),
        el(
          'button',
          {
            type: 'button',
            class: 'btn',
            onclick: async () => {
              const name = await askText({
                title: 'Preimenuj rutu',
                label: 'Novi naziv',
                value: r.name,
              });
              if (name && name !== r.name) patch(r, { name }, 'Ruta je preimenovana.');
            },
          },
          icon('edit'),
          'Preimenuj',
        ),
        el(
          'button',
          {
            type: 'button',
            class: 'btn',
            onclick: () => patch(r, { points: [...r.points].reverse() }, 'Smjer rute je obrnut.'),
          },
          icon('swap'),
          'Obrni',
        ),
        el(
          'button',
          { type: 'button', class: 'btn', onclick: () => download(r) },
          icon('download'),
          'GPX',
        ),
        el(
          'button',
          {
            type: 'button',
            class: 'btn danger',
            onclick: async () => {
              const ok = await confirmDialog({
                title: 'Obrisati rutu?',
                message: `Ruta "${r.name}" bit će uklonjena za sve korisnike.`,
                okText: 'Obriši',
                danger: true,
              });
              if (!ok) return;
              try {
                await api('DELETE', `/api/routes?id=${encodeURIComponent(r.id)}`);
                selectedId = null;
                await sync(true);
              } catch (e) {
                toast(`Brisanje rute nije uspjelo: ${e.message}`, 'bad');
              }
            },
          },
          icon('trash'),
          'Obriši',
        ),
      ),
    );

    // visinski profil se dohvaca asinkrono (teren najvece razlucivosti)
    const samples = sampleRoute(r.points, PROFILE_SAMPLES);
    const cartos = samples.map(
      (s) => new Cesium.Cartographic(Cesium.Math.toRadians(s.lon), Cesium.Math.toRadians(s.lat)),
    );
    const heights = await app.map.sampleTerrain(cartos);
    if (token !== renderToken) return; // u medjuvremenu je odabrana druga ruta
    if (!heights) {
      profileBox.textContent = app.map.hasToken
        ? 'Visinski profil trenutno nije dostupan (teren se nije učitao).'
        : 'Visinski profil traži teren: postavi CESIUM_ION_TOKEN u .env.';
      return;
    }
    const profile = samples.map((s, i) => ({ dist: s.dist, h: heights[i] }));
    const st = elevationStats(heights);
    profileBox.replaceWith(
      buildProfileSvg(profile),
      el('div', { class: 'cap', text: 'Visina terena duž rute (iznad razine mora).' }),
    );
    elevStats.hidden = false;
    elevStats.append(
      stat(`+${Math.round(st.ascent)} m`, 'Ukupni uspon'),
      stat(`−${Math.round(st.descent)} m`, 'Ukupni spust'),
      stat(`${Math.round(st.min)} m`, 'Najniža točka'),
      stat(`${Math.round(st.max)} m`, 'Najviša točka'),
    );
  }

  function select(id, fly = false) {
    const previous = selectedId;
    selectedId = id && find(id) ? id : null;
    if (previous && find(previous)) drawRoute(find(previous));
    if (selectedId) {
      drawRoute(find(selectedId));
      if (fly) flyToRoute(find(selectedId));
    }
    renderDetail();
  }

  // ---------- planiranje ----------
  function updateHint() {
    const len = routeLength(draftPts);
    const text = draftPts.length
      ? `Točaka: ${draftPts.length} · duljina: ${formatDistance(len)}. Klikni sljedeću točku.`
      : 'Klikni točke rute po karti (najmanje 2).';
    app.modes.hint(text, [
      { label: 'Poništi zadnju', icon: 'undo', onClick: undo, disabled: !draftPts.length },
      {
        label: 'Završi',
        icon: 'check',
        onClick: finish,
        primary: true,
        disabled: draftPts.length < 2,
      },
      { label: 'Odustani', onClick: () => app.modes.set(null) },
    ]);
  }

  function clearDraft() {
    for (const e of draft) viewer.entities.remove(e);
    draft.length = 0;
    draftPts = [];
  }

  function undo() {
    if (!draftPts.length) return;
    draftPts.pop();
    viewer.entities.remove(draft.pop());
    updateHint();
  }

  async function finish() {
    if (draftPts.length < 2) {
      toast('Ruta treba najmanje 2 točke.', 'warn');
      return;
    }
    const points = draftPts.map((p) => ({ ...p }));
    app.modes.set(null);
    const name = await askText({
      title: 'Nova ruta',
      label: 'Naziv rute',
      value: `Ruta ${routes.length + 1}`,
    });
    if (!name) return;
    try {
      const { route } = await api('POST', '/api/routes', { name, points });
      toast(`Ruta "${name}" je spremljena.`, 'ok');
      await sync(true);
      app.nav.open('routes');
      select(route.id, false);
    } catch (e) {
      toast(`Spremanje rute nije uspjelo: ${e.message}`, 'bad');
    }
  }

  app.modes.register('route', {
    button: $('toolRoute'),
    enter() {
      app.nav.open('routes');
      clearDraft();
      draft.push(
        viewer.entities.add({
          polyline: {
            positions: new Cesium.CallbackProperty(
              () => draftPts.map((p) => Cesium.Cartesian3.fromDegrees(p.lon, p.lat)),
              false,
            ),
            width: 4,
            material: themeColor('--route', ROUTE_COLOR),
            clampToGround: true,
          },
        }),
      );
      updateHint();
    },
    exit: clearDraft,
    click(pos) {
      const c = pickGround(pos);
      if (!c) return;
      const carto = Cesium.Cartographic.fromCartesian(c);
      const p = { lat: toDeg(carto.latitude), lon: toDeg(carto.longitude) };
      const last = draftPts[draftPts.length - 1];
      if (last && Math.abs(last.lat - p.lat) < 1e-7 && Math.abs(last.lon - p.lon) < 1e-7) return;
      draftPts.push(p);
      draft.push(
        viewer.entities.add({
          position: c,
          point: {
            pixelSize: 8,
            color: Cesium.Color.fromCssColorString(ROUTE_COLOR_SELECTED),
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 2,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        }),
      );
      updateHint();
    },
    dblclick(_pos, ev) {
      ev.preventDefault();
      finish();
    },
  });

  // ---------- sinkronizacija ----------
  async function sync(force = false) {
    let next;
    try {
      next = (await api('GET', '/api/routes')).routes || [];
    } catch {
      return;
    }
    const sig = next.map((r) => `${r.id}@${r.updatedAt}`).join();
    if (!force && sig === signature) return;
    signature = sig;
    routes = next;
    if (selectedId && !find(selectedId)) selectedId = null;
    const seen = new Set(next.map((r) => r.id));
    for (const id of [...drawn.keys()]) if (!seen.has(id)) eraseRoute(id);
    for (const r of next) drawRoute(r);
    renderList();
    renderDetail();
  }

  $('routeNew').addEventListener('click', () => app.modes.set('route'));

  return {
    sync,
    select,
    // klik na rutu na karti otvara njezine detalje
    onPick(entity) {
      if (!entity?.routeId) return false;
      app.nav.open('routes');
      select(entity.routeId, false);
      return true;
    },
  };
}
