// Zone: crtanje poligona/kruga, popis i brisanje. OTS nema pojam zone (geofencing), pa se
// zone cuvaju na nasem backendu, a ulaz/izlaz racuna backend (vidi README).
import { $, el, clear, icon, api, toast, emptyState } from './util.js';
import { askText, confirmDialog } from './dialog.js';
import { themeColor, toDeg } from './map.js';
import { formatDistance, circlePoints } from './geo.js';
import { KINDS } from './kinds.js';

const RULE_MODES = [
  ['both', 'Ulaz i izlaz'],
  ['enter', 'Samo ulaz'],
  ['exit', 'Samo izlaz'],
  ['off', 'Bez alarma'],
];
const RULE_KINDS = ['device', 'uav', 'aircraft', 'vessel']; // vrste za koje alarm ima smisla

function ruleSummary(z) {
  const mode = RULE_MODES.find(([k]) => k === (z.alert ?? 'both'))?.[1];
  const kinds = (z.kinds || []).map((k) => KINDS[k]?.plural.toLowerCase()).filter(Boolean);
  return [mode, kinds.length ? kinds.join(', ') : 'sve vrste'].join(' · ');
}

export function createZones(app) {
  const { Cesium, viewer, pickGround } = app.map;
  const draft = []; // entiteti nacrta
  let draftPts = [];
  let step = null; // 'choose' | 'polygon' | 'circle'
  const entities = new Map(); // id zone -> entitet
  let zones = [];
  let selectedZone = null;
  let signature = null; // null: prvo iscrtavanje uvijek, i za prazan popis

  function clearDraft() {
    for (const e of draft) viewer.entities.remove(e);
    draft.length = 0;
    draftPts = [];
  }

  function setStep(next) {
    clearDraft();
    step = next;
    const cancel = { label: 'Odustani', onClick: () => app.modes.set(null) };
    if (next === 'choose') {
      app.modes.hint('Odaberi oblik zone:', [
        { label: 'Poligon', onClick: () => setStep('polygon'), primary: true },
        { label: 'Krug', onClick: () => setStep('circle'), primary: true },
        cancel,
      ]);
    } else if (next === 'polygon') {
      app.modes.hint('Klikni vrhove zone (min. 3), zatim "Završi" ili dvoklik.', [
        { label: 'Završi', icon: 'check', onClick: finishPolygon, primary: true },
        cancel,
      ]);
      draft.push(
        viewer.entities.add({
          polyline: {
            positions: new Cesium.CallbackProperty(
              () => draftPts.map((c) => Cesium.Cartesian3.fromRadians(c.longitude, c.latitude)),
              false,
            ),
            width: 2,
            material: themeColor('--accent', '#5aa0ff'),
            clampToGround: true,
          },
        }),
      );
    } else if (next === 'circle') {
      app.modes.hint('Klikni centar zone, zatim klikni za radijus.', [cancel]);
    }
  }

  async function create(zone) {
    try {
      await api('POST', '/api/zones', zone);
      toast(`Zona "${zone.name}" je spremljena.`, 'ok');
      await sync();
    } catch (e) {
      toast(`Stvaranje zone nije uspjelo: ${e.message}`, 'bad');
    }
  }

  async function finishPolygon() {
    if (draftPts.length < 3) {
      toast('Potrebno je najmanje 3 točke za poligon.', 'warn');
      return;
    }
    const points = draftPts.map((c) => ({ lat: toDeg(c.latitude), lon: toDeg(c.longitude) }));
    app.modes.set(null);
    const name = await askText({ title: 'Nova zona', label: 'Naziv zone' });
    if (name) create({ name, type: 'polygon', points });
  }

  app.modes.register('zone', {
    button: $('toolZone'),
    enter: () => setStep('choose'),
    exit: clearDraft,
    async click(pos) {
      if (step !== 'polygon' && step !== 'circle') return;
      const cartesian = pickGround(pos);
      if (!cartesian) return;
      const carto = Cesium.Cartographic.fromCartesian(cartesian);
      const last = draftPts[draftPts.length - 1];
      const same =
        last &&
        Math.abs(last.latitude - carto.latitude) < 1e-9 &&
        Math.abs(last.longitude - carto.longitude) < 1e-9;
      if (same) return; // dvoklik ne smije dodati istu tocku dvaput
      draftPts.push(carto);
      draft.push(
        viewer.entities.add({
          position: cartesian,
          point: {
            pixelSize: 7,
            color: themeColor('--accent', '#5aa0ff'),
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        }),
      );
      if (step === 'circle' && draftPts.length === 2) {
        const [c, edge] = draftPts;
        const radiusM = Cesium.Cartesian3.distance(
          Cesium.Cartesian3.fromRadians(c.longitude, c.latitude),
          Cesium.Cartesian3.fromRadians(edge.longitude, edge.latitude),
        );
        const center = { lat: toDeg(c.latitude), lon: toDeg(c.longitude) };
        app.modes.set(null);
        const name = await askText({ title: 'Nova zona', label: 'Naziv zone' });
        if (name) create({ name, type: 'circle', center, radiusM });
      }
    },
    dblclick(_pos, ev) {
      if (step === 'polygon') {
        ev.preventDefault();
        finishPolygon();
      }
    },
  });

  function addEntity(z) {
    const accent = themeColor('--accent', '#5aa0ff');
    const label = {
      text: z.name,
      fillColor: Cesium.Color.WHITE,
      font: '600 12px system-ui, sans-serif',
      showBackground: true,
      backgroundColor: Cesium.Color.fromCssColorString('rgba(15,20,32,0.78)'),
      pixelOffset: new Cesium.Cartesian2(0, -14),
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    };
    // geometrija bez zadane visine automatski se priljubi uz teren; obrub (outline) na terenu
    // Cesium ne podrzava, pa se crta kao zasebna polilinija na tlu
    const fill = accent.withAlpha(0.18);
    const ring =
      z.type === 'circle' ? circlePoints(z.center, z.radiusM) : [...z.points, z.points[0]];
    const outline = viewer.entities.add({
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArray(ring.flatMap((p) => [p.lon, p.lat])),
        width: 2,
        material: accent,
        clampToGround: true,
      },
    });
    let e;
    if (z.type === 'circle') {
      e = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(z.center.lon, z.center.lat),
        ellipse: { semiMinorAxis: z.radiusM, semiMajorAxis: z.radiusM, material: fill },
        label,
      });
    } else {
      const avg = (key) => z.points.reduce((s, p) => s + p[key], 0) / z.points.length;
      e = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(avg('lon'), avg('lat')),
        polygon: {
          hierarchy: Cesium.Cartesian3.fromDegreesArray(z.points.flatMap((p) => [p.lon, p.lat])),
          material: fill,
        },
        label,
      });
    }
    e.zoneId = z.id;
    outline.zoneId = z.id;
    entities.set(z.id, [e, outline]);
  }

  function renderList() {
    const list = clear($('zoneList'));
    if (!zones.length) {
      list.appendChild(
        emptyState({
          tag: 'li',
          icon: 'zone',
          title: 'Još nema zona',
          text: 'Zona je krug ili poligon na karti. Kad objekt uđe u nju ili izađe, dobiješ alarm u odjeljku Alarmi.',
        }),
      );
      return;
    }
    for (const z of zones) {
      const sub =
        z.type === 'circle'
          ? `Krug · r ${formatDistance(z.radiusM)}`
          : `Poligon · ${z.points.length} točaka`;
      list.appendChild(
        el(
          'li',
          { id: `zone-${z.id}`, onclick: () => focus(z.id) },
          el('span', { class: 'dot', style: 'background:var(--accent)' }),
          el(
            'div',
            { class: 'grow' },
            el('div', { class: 'nm', text: z.name }),
            el('div', { class: 'sub', text: sub }),
            el('div', { class: 'sub', text: ruleSummary(z) }),
          ),
          el(
            'div',
            { class: 'li-actions' },
            el(
              'button',
              {
                type: 'button',
                class: 'icon-btn',
                title: 'Obriši zonu',
                onclick: (ev) => {
                  ev.stopPropagation();
                  remove(z);
                },
              },
              icon('trash'),
            ),
          ),
        ),
      );
      if (selectedZone === z.id) list.appendChild(rulesEditor(z));
    }
  }

  async function saveRules(z, patch) {
    try {
      await api('PUT', `/api/zones?id=${encodeURIComponent(z.id)}`, patch);
      await sync(true);
    } catch (e) {
      toast(`Spremanje pravila nije uspjelo: ${e.message}`, 'bad');
    }
  }

  // pravila alarma za odabranu zonu: smjer i vrste objekata (bez oznacene vrste = sve)
  function rulesEditor(z) {
    const select = el(
      'select',
      { class: 'vp-input', 'aria-label': 'Kada javiti alarm' },
      RULE_MODES.map(([value, label]) => el('option', { value, text: label })),
    );
    select.value = z.alert ?? 'both';
    select.addEventListener('change', () => saveRules(z, { alert: select.value }));
    const checks = RULE_KINDS.map((k) => {
      const input = el('input', { type: 'checkbox' });
      input.checked = (z.kinds || []).includes(k);
      input.addEventListener('change', () => {
        const kinds = RULE_KINDS.filter((x) =>
          x === k ? input.checked : (z.kinds || []).includes(x),
        );
        saveRules(z, { kinds });
      });
      return el('label', { class: 'zone-kind' }, input, KINDS[k].plural);
    });
    return el(
      'li',
      { class: 'zone-rules', onclick: (ev) => ev.stopPropagation() },
      el('label', { class: 'vp-field' }, el('span', { text: 'Alarm' }), select),
      el(
        'div',
        { class: 'vp-field' },
        el('span', { text: 'Za vrste objekata' }),
        el('div', { class: 'zone-kinds' }, checks),
      ),
      el('p', { class: 'vp-note', text: 'Ako nijedna vrsta nije označena, alarm vrijedi za sve.' }),
    );
  }

  function focus(id) {
    const e = entities.get(id)?.[0];
    if (e) viewer.flyTo(e, { duration: 1.2 });
    selectedZone = id;
    renderList();
    for (const li of $('zoneList').children) li.classList.toggle('sel', li.id === `zone-${id}`);
  }

  async function remove(z) {
    const ok = await confirmDialog({
      title: 'Obrisati zonu?',
      message: `Zona "${z.name}" bit će uklonjena za sve korisnike.`,
      okText: 'Obriši',
      danger: true,
    });
    if (!ok) return;
    try {
      await api('DELETE', `/api/zones?id=${encodeURIComponent(z.id)}`);
      await sync();
    } catch (e) {
      toast(`Brisanje zone nije uspjelo: ${e.message}`, 'bad');
    }
  }

  async function sync(force = false) {
    let next;
    try {
      next = (await api('GET', '/api/zones')).zones || [];
    } catch {
      return;
    }
    const sig = next.map((z) => `${z.id}:${z.alert}:${(z.kinds || []).join('|')}`).join();
    if (!force && sig === signature) return;
    signature = sig;
    zones = next;
    const seen = new Set(next.map((z) => z.id));
    for (const z of next) if (!entities.has(z.id)) addEntity(z);
    for (const [id, list] of entities) {
      if (!seen.has(id)) {
        for (const e of list) viewer.entities.remove(e);
        entities.delete(id);
      }
    }
    renderList();
  }

  $('zoneNew').addEventListener('click', () => app.modes.set('zone'));

  return {
    sync,
    list: () => zones,
    focus: (id) => {
      app.nav.open('zones');
      focus(id);
    },
    // klik na zonu na karti otvara popis zona
    onPick(entity) {
      if (!entity?.zoneId) return false;
      app.nav.open('zones');
      focus(entity.zoneId);
      return true;
    },
  };
}
