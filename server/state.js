// Trenutno stanje karte: periodicno cita OTS i sastavlja popis objekata.
import { kindOf } from '../public/js/kinds.js';
import { ots, otsGetAllPages } from './ots.js';
import { collect } from './normalize.js';
import { loadDevices } from './devices.js';
import { checkZonesAndAlerts, loadOtsAlerts } from './alerts.js';
import { ENDPOINTS, DEVICES_PATH, OTS_ALERTS_PATH, MARKERS_PATH, POLL_MS } from './config.js';

export let state = { updated: null, items: [], sources: {}, error: null };

export async function refresh() {
  const found = new Map();
  const sources = {};
  let error = null;
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
  try {
    const { items, devices } = await loadDevices();
    for (const it of items) found.set(it.id, it);
    sources[DEVICES_PATH] = { status: 200, added: items.length, devices };
  } catch (e) {
    sources[DEVICES_PATH] = { error: e.message };
    error = error || e.message;
  }
  if (OTS_ALERTS_PATH) {
    try {
      const count = await loadOtsAlerts();
      if (count !== null) sources[OTS_ALERTS_PATH] = { status: 200, added: count };
    } catch (e) {
      sources[OTS_ALERTS_PATH] = { error: e.message };
    }
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

export async function loop() {
  await refresh();
  setTimeout(loop, POLL_MS);
}
