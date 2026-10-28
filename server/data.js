// Trajni podaci koje cuva ova aplikacija (OTS za njih nema API): zone, rute i zapisnik promjena.
// Popisi se mijenjaju na mjestu (splice), pa svi moduli uvijek vide isti niz.
import { join } from 'node:path';
import { createJsonStore } from '../lib/json-store.js';
import { createAudit } from '../lib/audit.js';
import { ROOT_DIR } from './config.js';

const zonesStore = createJsonStore(join(ROOT_DIR, 'data', 'zones.json'));
const routesStore = createJsonStore(join(ROOT_DIR, 'data', 'routes.json'));

export const zones = [];
export const routes = [];
export const audit = createAudit({ file: join(ROOT_DIR, 'data', 'audit.log') });

export async function loadData() {
  zones.splice(0, zones.length, ...(await zonesStore.load()));
  routes.splice(0, routes.length, ...(await routesStore.load()));
}
export const saveZones = () => zonesStore.save(zones);
export const saveRoutes = () => routesStore.save(routes);

// brise element s danim id-jem; vraca false ako ga nema
export function removeById(list, id) {
  const idx = list.findIndex((x) => x.id === id);
  if (idx < 0) return false;
  list.splice(idx, 1);
  return true;
}
