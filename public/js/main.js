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

const ALERTS_EVERY_MS = 2000; // alarmi, zone i rute ne trebaju brzi takt od objekata
const SLOW_EVERY_MS = 6000; // zone i rute dijele svi korisnici

async function main() {
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

  const uiMs = cfg.uiPollMs || cfg.pollMs || 2000;
  let lastAlerts = 0;
  let lastSlow = 0;
  async function tick() {
    await app.items.poll();
    const now = Date.now();
    if (now - lastAlerts >= ALERTS_EVERY_MS) {
      lastAlerts = now;
      app.alerts.sync();
    }
    if (now - lastSlow >= SLOW_EVERY_MS) {
      lastSlow = now;
      app.zones.sync();
      app.routes.sync();
    }
    setTimeout(tick, uiMs);
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
