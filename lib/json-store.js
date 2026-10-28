// Mala trajna pohrana jednog JSON polja u datoteku (zone, rute). Pisanje je atomarno
// (privremena datoteka + rename), pa prekid usred pisanja ne kvari postojecu datoteku.
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname } from 'node:path';

export function createJsonStore(file) {
  return {
    async load() {
      try {
        const parsed = JSON.parse(await readFile(file, 'utf8'));
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    },
    async save(list) {
      await mkdir(dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify(list, null, 2));
      await rename(tmp, file);
    },
  };
}
