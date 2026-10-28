// Ulazna tocka: spaja module i pokrece osvjezavanje.
import { createMap } from './map.js';
import { createModes } from './modes.js';
import { createNav } from './nav.js';
import { createItems } from './items.js';
import { createHistory } from './history.js';
import { createMarkers } from './markers.js';
import { createMeasure } from './measure.js';
import { createZones } from './zones.js';
import { createRoutes } from './routes.js';
import { createAlerts } from './alerts.js';
import { $, api } from './util.js';
import { ensureSession } from './auth.js';

const SLOW_EVERY = 3; // zone i rute se osvjezavaju svaki 3. ciklus (dijele ih svi korisnici)

async function main() {
  window.addEventListener('tak-auth-expired', () => location.reload());
  const session = await ensureSession();
  // samo pregled: alati za promjene se skrivaju (server ionako odbija promjene)
  if (session.canEdit === false) {
    for (const id of ['toolMarker', 'toolZone', 'toolRoute']) $(id).hidden = true;
    document.body.classList.add('readonly');
  }

  let cfg = { ionToken: '', pollMs: 2000 };
  try {
    cfg = await api('GET', '/config');
  } catch {
    /* zadano */
  }

  const map = await createMap(cfg);
  const app = { map, cfg, markersPath: cfg.markersPath || '/api/markers' };

  app.modes = createModes(app);
  app.nav = createNav(app);
  app.items = createItems(app);
  app.history = createHistory(app);
  app.markers = createMarkers(app);
  app.measure = createMeasure(app);
  app.zones = createZones(app);
  app.routes = createRoutes(app);
  app.alerts = createAlerts(app);

  // klik na zonu ili rutu na karti (kad nijedan alat nije aktivan) otvara njezine detalje
  const { viewer, Cesium } = map;
  viewer.canvas.addEventListener('click', (ev) => {
    if (app.modes.current()) return;
    const rect = viewer.canvas.getBoundingClientRect();
    const picked = viewer.scene.pick(
      new Cesium.Cartesian2(ev.clientX - rect.left, ev.clientY - rect.top),
    );
    const entity = picked?.id;
    if (!entity || typeof entity !== 'object') return;
    app.routes.onPick(entity) || app.zones.onPick(entity);
  });

  let cycle = 0;
  async function tick() {
    await app.items.poll();
    app.alerts.sync();
    if (cycle++ % SLOW_EVERY === 0) {
      app.zones.sync();
      app.routes.sync();
    }
    setTimeout(tick, cfg.pollMs || 2000);
  }
  tick();
}

main().catch((e) => {
  console.error(e);
  const pill = document.getElementById('pill');
  if (pill) pill.className = 'pill bad';
  const text = document.getElementById('pillText');
  if (text) text.textContent = 'Greška pri pokretanju';
});
