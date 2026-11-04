// Ulazna tocka: provjere postavki, ucitavanje podataka, pokretanje poslužitelja i petlje koja
// periodicno cita OTS. Sva logika je u server/ (vidi README, odjeljak "Struktura").
import { isLoopbackHost } from './lib/auth.js';
import { env, HOST, PORT, OTS_URL, USERNAME } from './server/config.js';
import { loadData } from './server/data.js';
import { loop } from './server/state.js';
import { server } from './server/app.js';

await loadData();
server.listen(PORT, HOST, () => {
  console.log(`Aplikacija: http://${HOST}:${PORT}   (OTS: ${OTS_URL})`);
  if (!USERNAME) console.warn('[upozorenje] OTS_USERNAME nije postavljen');
  if (!isLoopbackHost(HOST)) {
    console.warn(
      `[upozorenje] HOST=${HOST} (sucelje nema prijavu): svi na mrezi mogu citati, brisati i mijenjati markere.`,
    );
  }
  loop();
});
