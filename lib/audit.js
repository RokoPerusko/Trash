// Zapisnik promjena: jedna JSON linija po dogadjaju (tko, sto, kada, s koje adrese).
// Datoteka se rotira kad naraste, pa ne puni disk. Greska pri pisanju nikad ne smije srusiti zahtjev.
import { appendFile, mkdir, rename, stat } from 'node:fs/promises';
import { dirname } from 'node:path';

const clip = (v, n = 200) => (typeof v === 'string' ? v.slice(0, n) : v);

export function createAudit({ file, maxBytes = 5 * 1024 * 1024, log = console.log }) {
  let chain = Promise.resolve(); // upisi idu jedan za drugim, redoslijed ostaje
  async function write(line) {
    try {
      await mkdir(dirname(file), { recursive: true });
      const size = await stat(file).then(
        (s) => s.size,
        () => 0,
      );
      if (size + line.length > maxBytes) await rename(file, `${file}.1`); // jedna stara kopija
      await appendFile(file, line, { mode: 0o600 });
    } catch (e) {
      console.error('[zapisnik] upis nije uspio:', e.message);
    }
  }
  return {
    record(user, ip, action, detail = {}) {
      const safe = {};
      for (const [k, v] of Object.entries(detail)) safe[k] = clip(v);
      const entry = {
        t: new Date().toISOString(),
        user: clip(user),
        ip: clip(ip),
        action,
        ...safe,
      };
      const line = JSON.stringify(entry) + '\n'; // JSON escapea nove retke: nema krivotvorenja linija
      log(`[zapisnik] ${line.trimEnd()}`);
      chain = chain.then(() => write(line));
      return chain;
    },
  };
}
