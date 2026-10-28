// Zone: crtanje poligona/kruga, popis i brisanje. OTS nema pojam zone (geofencing), pa se
// zone cuvaju na nasem backendu, a ulaz/izlaz racuna backend (vidi README).
import { $, el, clear, icon, api, toast } from './util.js';
import { askText, confirmDialog } from './dialog.js';
import { themeColor, toDeg } from './map.js';
import { formatDistance, circlePoints } from './geo.js';

export function createZones(app) {
  const { Cesium, viewer, pickGround } = app.map;
  const draft = []; // entiteti nacrta
  let draftPts = [];
  let step = null; // 'choose' | 'polygon' | 'circle'
  const entities = new Map(); // id zone -> entitet
  let zones = [];
  let signature = '';

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
      list.appendChild(el('li', { class: 'empty', text: 'Nema zona. Dodaj prvu gumbom iznad.' }));
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
    }
  }

  function focus(id) {
    const e = entities.get(id)?.[0];
    if (e) viewer.flyTo(e, { duration: 1.2 });
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

  async function sync() {
    let next;
    try {
      next = (await api('GET', '/api/zones')).zones || [];
    } catch {
      return;
    }
    const sig = next.map((z) => z.id).join();
    if (sig === signature) return;
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
    // klik na zonu na karti otvara popis zona
    onPick(entity) {
      if (!entity?.zoneId) return false;
      app.nav.open('zones');
      focus(entity.zoneId);
      return true;
    },
  };
}
