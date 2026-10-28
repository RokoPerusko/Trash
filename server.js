// Ulazna tocka: provjere postavki, ucitavanje podataka, pokretanje poslužitelja i petlje koja
// periodicno cita OTS. Sva logika je u server/ (vidi README, odjeljak "Struktura").
import { isLoopbackHost } from './lib/auth.js';
import {
  env,
  HOST,
  PORT,
  OTS_URL,
  USERNAME,
  AUTH_REQUIRED,
  SESSION_HOURS,
} from './server/config.js';
import { loadData } from './server/data.js';
import { loop } from './server/state.js';
import { server } from './server/app.js';

if (!AUTH_REQUIRED && !isLoopbackHost(HOST) && env.AUTH_ALLOW_OPEN !== '1') {
  console.error(
    `[greška] HOST=${HOST} je dostupan s mreže, a prijava je isključena (AUTH_REQUIRED=0). ` +
      'Uključi prijavu ili postavi AUTH_ALLOW_OPEN=1 ako je to doista namjerno.',
  );
  process.exit(1);
}

await loadData();
server.listen(PORT, HOST, () => {
  console.log(`Aplikacija: http://${HOST}:${PORT}   (OTS: ${OTS_URL})`);
  if (!USERNAME) console.warn('[upozorenje] OTS_USERNAME nije postavljen');
  if (AUTH_REQUIRED) {
    console.log(`Prijava je ukljucena (korisnici iz OTS-a, sesija ${SESSION_HOURS} h).`);
  } else if (!isLoopbackHost(HOST)) {
    console.warn(
      `[upozorenje] HOST=${HOST} bez prijave: svi na mrezi mogu citati, brisati i mijenjati markere.`,
    );
  }
  loop();
});
