// Izbor kodeka za slanje (cista logika nad popisom sposobnosti preglednika, bez DOM-a).
// Popis dolazi iz RTCRtpSender.getCapabilities('video' | 'audio').

// pomocni zapisi koji nisu pravi kodeci i moraju ostati uz odabrani (npr. rtx za ponovno slanje)
const COMPANION = /^(video\/(rtx|red|ulpfec|flexfec-03)|audio\/(red|cn|telephone-event))$/i;

const nameOf = (mime) => String(mime).split('/')[1]?.toUpperCase() ?? '';

// jedinstveni nazivi kodeka koje preglednik moze slati, npr. ['H264', 'VP8', 'VP9', 'AV1']
export function codecNames(capabilities) {
  const names = [];
  for (const c of capabilities?.codecs ?? []) {
    if (COMPANION.test(c.mimeType)) continue;
    const n = nameOf(c.mimeType);
    if (n && !names.includes(n)) names.push(n);
  }
  return names;
}

// Redoslijed za setCodecPreferences. 'auto' stavlja `first` na pocetak, a ostali ostaju kao
// rezerva; konkretan odabir ostavlja samo taj kodek (i pomocne zapise), pa se nista drugo ne
// moze dogovoriti. Ako preglednik trazeni kodek nema, vraca sve (bolje nego prazan popis).
export function orderCodecs(codecs, choice, first = 'H264') {
  const is = (c, name) => nameOf(c.mimeType) === String(name).toUpperCase();
  if (!choice || choice === 'auto') {
    return [...codecs.filter((c) => is(c, first)), ...codecs.filter((c) => !is(c, first))];
  }
  const chosen = codecs.filter((c) => is(c, choice));
  if (!chosen.length) return codecs;
  return [...chosen, ...codecs.filter((c) => COMPANION.test(c.mimeType))];
}

export const VIDEO_LABELS = {
  H264: 'H.264 (iTAK, HLS, najširi izbor)',
  VP8: 'VP8 (preglednici)',
  VP9: 'VP9 (preglednici, manje podataka)',
  AV1: 'AV1 (najmanje podataka, jak procesor)',
};
export const AUDIO_LABELS = {
  OPUS: 'Opus (preporučeno)',
  G722: 'G.722',
  PCMU: 'PCMU (G.711 µ-law)',
  PCMA: 'PCMA (G.711 A-law)',
};
