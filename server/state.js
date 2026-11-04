// Trenutno stanje karte: periodicno cita OTS i sastavlja popis objekata.
import { kindOf } from '../public/js/kinds.js';
import { ots, otsGetAllPages } from './ots.js';
import { collect } from './normalize.js';
import { loadDevices } from './devices.js';
import { demoDrone } from './demo.js';
import { checkZonesAndAlerts, loadOtsAlerts } from './alerts.js';
import {
  DEMO_DRONE,
  ENDPOINTS,
  DEVICES_PATH,
  OTS_ALERTS_PATH,
  MARKERS_PATH,
  POLL_MS,
} from './config.js';

export let state = { updated: null, items: [], sources: {}, error: null };

const startedAt = Date.now();
const DEMO_TICK_MS = 250; // demo dron javlja polozaj cesce nego sto se cita OTS

export async function refresh() {
  const found = new Map();
  const sources = {};
  let error = null;
  // uredjaji (sporiji /api/cot) se citaju istodobno s ostalim izvorima
  const devicesResult = loadDevices().then(
    (value) => ({ value }),
    (err) => ({ err }),
  );
  for (const path of ENDPOINTS) {
    try {
      const { status, pages, truncated } = await otsGetAllPages(path);
      const before = found.size;
      const local = new Map();
      for (const json of pages) if (json) collect(json, local);
      for (const [id, it] of local) {
        const prev = found.get(id);
        const { raw, ...rest } = it;
        found.set(id, {
          ...(prev || {}),
          ...rest,
          from: [...(prev?.from || []), path],
          raws: { ...(prev?.raws || {}), [path]: raw }, // sirovi zapis po izvoru
        });
      }
      sources[path] = { status, added: found.size - before, pages: pages.length, truncated };
    } catch (e) {
      sources[path] = { error: e.message };
      error = e.message;
    }
  }
  const dev = await devicesResult;
  if (dev.err) {
    sources[DEVICES_PATH] = { error: dev.err.message };
    error = error || dev.err.message;
  } else {
    for (const it of dev.value.items) found.set(it.id, it);
    sources[DEVICES_PATH] = {
      status: 200,
      added: dev.value.items.length,
      devices: dev.value.devices,
    };
  }
  if (OTS_ALERTS_PATH) {
    try {
      const count = await loadOtsAlerts();
      if (count !== null) sources[OTS_ALERTS_PATH] = { status: 200, added: count };
    } catch (e) {
      sources[OTS_ALERTS_PATH] = { error: e.message };
    }
  }
  if (DEMO_DRONE) {
    const d = demoDrone(Date.now(), startedAt);
    found.set(d.id, d);
  }
  const items = [...found.values()].map((it) => ({
    ...it,
    kind: kindOf(it, { markersPath: MARKERS_PATH }),
  }));
  state = {
    updated: new Date().toISOString(),
    items,
    sources,
    error,
    clockSkewMs: ots.clockSkewMs || 0,
  };
  checkZonesAndAlerts(state.items);
}

// osvjezava samo demo dron u postojecem stanju (bez citanja OTS-a)
function moveDemoDrone() {
  if (!state.updated) return;
  const d = demoDrone(Date.now(), startedAt);
  const item = { ...d, kind: kindOf(d, { markersPath: MARKERS_PATH }) };
  state = { ...state, items: [...state.items.filter((i) => i.id !== d.id), item] };
}

export async function loop() {
  if (DEMO_DRONE) setInterval(moveDemoDrone, DEMO_TICK_MS).unref();
  for (;;) {
    const started = Date.now();
    await refresh().catch((e) => console.error('[osvjezavanje]', e.message));
    // ciklus je fiksan: ako je citanje trajalo, ceka se samo ostatak do POLL_MS
    await new Promise((r) => setTimeout(r, Math.max(50, POLL_MS - (Date.now() - started))));
  }
}
