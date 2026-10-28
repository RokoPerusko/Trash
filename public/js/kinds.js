// Vrste objekata na karti. Novu vrstu (npr. dron, vozilo) dodaje se ovdje: jedan unos u
// KINDS i jedno pravilo u RULES. Ostatak aplikacije (popis, filteri, ikone, kartica detalja,
// alarmi) cita iste podatke, pa ne treba dirati ostali kod.

export const KINDS = {
  marker: { label: 'Marker', plural: 'Markeri', shape: 'pin', editable: true, history: false },
  device: { label: 'Uređaj', plural: 'Uređaji', shape: 'circle', editable: false, history: true },
  uav: {
    label: 'Dron',
    plural: 'Dronovi',
    shape: 'diamond',
    editable: false,
    history: true,
    air: true,
  },
};

// CoT tipovi bespilotnih letjelica: a-<afilijacija>-A-M-<F|H>-Q (nepokretna krila / rotor)
const UAV_TYPE = /^a-.-A-M-[A-Z]-Q/;

// redoslijed je bitan: prvo pravilo koje se podudara odlucuje
const RULES = [
  { kind: 'marker', test: (it, ctx) => (it.from || []).includes(ctx.markersPath) },
  { kind: 'uav', test: (it) => UAV_TYPE.test(String(it.type || '')) },
];

export function kindOf(item, ctx = { markersPath: '/api/markers' }) {
  for (const rule of RULES) if (rule.test(item, ctx)) return rule.kind;
  return 'device';
}

export const isAirType = (t) => /^a-.-A/.test(String(t || ''));
