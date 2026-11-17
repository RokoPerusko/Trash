// Kvaliteta slanja videa (cista logika, bez DOM-a i WebRTC-a): koju razinu poslati ovisno o tome
// traži li gledatelj HD, je li ukljucena stednja i kako stoji mreza.

// dvije jasno razlicite razine: niska (240p) za stednju i HD (720p)
export const LEVELS = ['low', 'high'];
export const HEIGHT = { low: 240, high: 720 };
// niska razina ne smije biti presiromasna: uz ~250 kbps Chrome sam spusti sliku na 320x180, a H.264
// s tom visinom (nije visekratnik od 16) neki prijemnici ne prikazu
export const BITRATE = { low: 450_000, high: 2_500_000 };
export const LABEL = { low: 'Niska (240p)', high: 'HD (720p)' };

const BAD_LOSS = 0.08; // 8 % izgubljenih paketa u jednom uzorku
const BAD_TICKS = 2; // toliko losih uzoraka zaredom prije snizenja
const CALM_TICKS = 7; // toliko dobrih uzoraka zaredom prije povratka (~20 s uz uzorak svake 3 s)

const idx = (l) => LEVELS.indexOf(l);
export const minLevel = (a, b) => LEVELS[Math.min(idx(a), idx(b))];

// razina koju posiljatelj zeli: 'auto' salje nisku dok netko ne zatrazi HD (stedi mobilne podatke),
// 'high' uvijek odabranu (HD), 'low' uvijek nisku bez obzira na zahtjeve
export const wantedLevel = ({ selected, hdRequested, mode = 'auto' }) =>
  mode === 'low' ? 'low' : mode === 'high' || hdRequested ? selected : 'low';

// nacini slanja koje bira posiljatelj
export const MODES = {
  auto: 'Automatski (niska dok netko ne zatraži HD)',
  high: 'Uvijek HD (720p)',
  low: 'Uvijek niska (240p)',
};

// stanje regulacije prema mreži: { cap, calm, bad }; cap je najvisa dopustena razina
export const initialCap = (selected) => ({ cap: selected, calm: 0, bad: 0 });

// Mjeri se samo gubitak paketa. Chromeov "qualityLimitationReason: bandwidth" javlja se i kad mreza
// nije losa (npr. dok se procjena propusnosti zagrijava ili zbog naseg ogranicenja bitratea),
// pa bi bez potrebe snizavao kvalitetu.
export function adjustCap(state, { selected, loss }) {
  const isBad = loss > BAD_LOSS;
  if (isBad) {
    const bad = state.bad + 1;
    if (bad >= BAD_TICKS && idx(state.cap) > 0) {
      return { cap: LEVELS[idx(state.cap) - 1], calm: 0, bad: 0 };
    }
    return { ...state, calm: 0, bad };
  }
  const calm = state.calm + 1;
  if (calm >= CALM_TICKS && idx(state.cap) < idx(selected)) {
    return { cap: LEVELS[idx(state.cap) + 1], calm: 0, bad: 0 };
  }
  return { ...state, calm, bad: 0 };
}

export const effectiveLevel = (opts, cap) => minLevel(wantedLevel(opts), cap);

// koliko treba smanjiti snimljenu sliku da dobije visinu razine (1 = bez smanjenja)
export const scaleFor = (level, captureHeight) =>
  Math.max(1, (captureHeight || HEIGHT[level]) / HEIGHT[level]);
