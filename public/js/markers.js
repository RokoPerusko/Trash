// Markeri: stvaranje, premjestanje (povlacenjem), preimenovanje i brisanje. OTS nema PUT
// za marker - ponovni POST s istim uid-om azurira postojeci (vidi README), a to radi backend.
import { $, api, toast } from './util.js';
import { askText, confirmDialog } from './dialog.js';
import { KINDS } from './kinds.js';
import { toDeg } from './map.js';

export function createMarkers(app) {
  const { Cesium, viewer, pickGround } = app.map;
  const msg = $('dMsg');
  const isMarker = (it) => !!it && !!KINDS[app.items.kind(it)]?.editable;

  async function upsertMarker({ uid, lat, lon, name, type }) {
    return api('POST', '/api/upsert-marker', { uid, lat, lon, name, type });
  }

  app.modes.register('marker', {
    button: $('toolMarker'),
    enter() {
      app.modes.hint('Klikni na kartu gdje treba postaviti novi marker.', [
        { label: 'Odustani', onClick: () => app.modes.set(null) },
      ]);
    },
    async click(pos) {
      if (viewer.scene.pick(pos)) return; // klik na postojeci entitet - ne stvaraj marker ovdje
      const cartesian = pickGround(pos);
      app.modes.set(null);
      if (!cartesian) {
        toast('Nije moguće odrediti poziciju na karti ovdje.', 'warn');
        return;
      }
      const carto = Cesium.Cartographic.fromCartesian(cartesian);
      const name = await askText({ title: 'Novi marker', label: 'Naziv markera' });
      if (!name) return;
      try {
        await upsertMarker({ lat: toDeg(carto.latitude), lon: toDeg(carto.longitude), name });
        toast(`Marker "${name}" je stvoren.`, 'ok');
        app.items.poll();
      } catch (e) {
        toast(`Stvaranje markera nije uspjelo: ${e.message}`, 'bad');
      }
    },
  });

  $('dRename').addEventListener('click', async () => {
    const it = app.items.selected();
    if (!isMarker(it)) return;
    const name = await askText({ title: 'Preimenuj marker', label: 'Novi naziv', value: it.name });
    if (!name || name === it.name) return;
    msg.className = '';
    msg.textContent = 'Šaljem…';
    try {
      await upsertMarker({ uid: it.id, lat: it.lat, lon: it.lon, name, type: it.type });
      msg.className = 'ok';
      msg.textContent = 'Preimenovano.';
      app.items.poll();
    } catch (e) {
      msg.className = 'err';
      msg.textContent = `Preimenovanje nije uspjelo: ${e.message}`;
    }
  });

  $('dDelete').addEventListener('click', async () => {
    const it = app.items.selected();
    if (!isMarker(it)) return;
    const ok = await confirmDialog({
      title: 'Obrisati marker?',
      message: `"${it.name}" će se ukloniti na serveru, a time i svima.`,
      okText: 'Obriši',
      danger: true,
    });
    if (!ok) return;
    $('dDelete').disabled = true;
    msg.className = '';
    msg.textContent = 'Šaljem…';
    try {
      const j = await fetch('/api/delete-marker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-TAK-App': '1' },
        body: JSON.stringify({ id: it.id }),
      }).then((r) => r.json());
      if (j.ok) {
        app.items.deselect();
        app.items.poll();
      } else {
        const sent = j.sent ? `${j.sent.method} ${j.sent.path}` : '';
        msg.className = 'err';
        msg.textContent =
          `Brisanje nije uspjelo (${j.error || `HTTP ${j.status}`}). ` +
          (sent ? `Poslano: ${sent}. ` : '') +
          (j.response ? `Odgovor: ${JSON.stringify(j.response)}` : '');
      }
    } catch (e) {
      msg.className = 'err';
      msg.textContent = `Greška: ${e.message}`;
    }
    $('dDelete').disabled = false;
  });

  // povlacenje markera po karti za premjestanje
  let dragId = null;
  let dragMoved = false;
  const camera = viewer.scene.screenSpaceCameraController;
  const handler = viewer.screenSpaceEventHandler;
  const setCamera = (on) => {
    camera.enableRotate = on;
    camera.enableTranslate = on;
  };

  handler.setInputAction((e) => {
    if (app.modes.current()) return;
    const picked = viewer.scene.pick(e.position);
    const id = picked?.id && String(picked.id.id ?? picked.id);
    if (!id || !isMarker(app.items.get(id))) return;
    dragId = id;
    dragMoved = false;
    setCamera(false);
  }, Cesium.ScreenSpaceEventType.LEFT_DOWN);

  handler.setInputAction((e) => {
    if (!dragId) return;
    const cartesian = pickGround(e.endPosition);
    if (!cartesian) return;
    dragMoved = true;
    const entity = app.items.entities.get(dragId);
    if (entity) entity.position = cartesian;
  }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

  handler.setInputAction(async (e) => {
    setCamera(true);
    const id = dragId;
    const moved = dragMoved;
    dragId = null;
    dragMoved = false;
    if (!id || !moved) return;
    const cartesian = pickGround(e.position);
    const it = app.items.get(id);
    if (!cartesian || !it) return;
    const carto = Cesium.Cartographic.fromCartesian(cartesian);
    try {
      await upsertMarker({
        uid: id,
        lat: toDeg(carto.latitude),
        lon: toDeg(carto.longitude),
        name: it.name,
        type: it.type,
      });
      app.items.poll();
    } catch (err) {
      msg.className = 'err';
      msg.textContent = `Premještanje nije uspjelo: ${err.message}`;
    }
  }, Cesium.ScreenSpaceEventType.LEFT_UP);

  return { upsertMarker };
}
