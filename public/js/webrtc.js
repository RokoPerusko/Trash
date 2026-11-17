// WebRTC klijent za MediaMTX (koji koristi OTS): WHEP za gledanje i WHIP za slanje.
// Nema vanjskih biblioteka; ista razmjena SDP-a kao na MediaMTX-ovim stranicama.

import { BITRATE, scaleFor } from './quality.js';
import { orderCodecs } from './codecs.js';

const GATHER_MS = 2000;
const CONNECT_MS = 15000;

// "<stun:host>; rel="ice-server"; username="..."; credential="..."" iz Link zaglavlja
function parseIceLinks(header) {
  const servers = [];
  for (const part of (header || '').split(/,(?=\s*<)/)) {
    const m = part.match(/<([^>]+)>/);
    if (!m || !/rel="?ice-server"?/i.test(part)) continue;
    const server = { urls: [m[1]] };
    const user = part.match(/username="([^"]*)"/i);
    const cred = part.match(/credential="([^"]*)"/i);
    if (user) server.username = user[1];
    if (cred) server.credential = cred[1];
    servers.push(server);
  }
  return servers;
}

async function iceServers(endpoint) {
  try {
    const res = await fetch(endpoint, { method: 'OPTIONS' });
    return parseIceLinks(res.headers.get('Link'));
  } catch {
    return [];
  }
}

const gathered = (pc) =>
  new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') return resolve();
    const done = () => {
      clearTimeout(timer);
      pc.removeEventListener('icegatheringstatechange', check);
      resolve();
    };
    const check = () => pc.iceGatheringState === 'complete' && done();
    const timer = setTimeout(done, GATHER_MS);
    pc.addEventListener('icegatheringstatechange', check);
  });

export class StreamError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code; // 'not-live' | 'conflict' | 'http' | 'timeout' | 'failed'
  }
}

// Zajednicko: dogovor ponude i odgovora; vraca funkciju koja zatvara vezu
async function negotiate(pc, endpoint, onState) {
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await gathered(pc);
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/sdp' },
    body: pc.localDescription.sdp,
  });
  if (res.status !== 201) {
    const text = (await res.text().catch(() => '')).trim().slice(0, 200);
    if (res.status === 404) throw new StreamError('Stream trenutno nitko ne šalje.', 'not-live');
    if (res.status === 400 && /already|someone/i.test(text)) {
      throw new StreamError('Taj naziv već netko koristi.', 'conflict');
    }
    throw new StreamError(`Poslužitelj je odbio vezu (HTTP ${res.status}).`, 'http');
  }
  const location = res.headers.get('Location');
  await pc.setRemoteDescription({ type: 'answer', sdp: await res.text() });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new StreamError('Veza nije uspostavljena (mediji ne stižu).', 'timeout')),
      CONNECT_MS,
    );
    const check = () => {
      const s = pc.connectionState;
      if (s === 'connected') {
        clearTimeout(timer);
        resolve();
      } else if (s === 'failed') {
        clearTimeout(timer);
        reject(new StreamError('Veza nije uspostavljena (mediji ne stižu).', 'failed'));
      }
    };
    pc.addEventListener('connectionstatechange', check);
    check();
  });
  pc.addEventListener('connectionstatechange', () => onState?.(pc.connectionState));

  const sessionUrl = location ? new URL(location, endpoint).href : null;
  return () => {
    pc.close();
    if (sessionUrl) fetch(sessionUrl, { method: 'DELETE', keepalive: true }).catch(() => {});
  };
}

// Gledanje: prikazuje stream u <video>; vraca { stop }
export async function whepPlay(endpoint, video, onState) {
  const pc = new RTCPeerConnection({ iceServers: await iceServers(endpoint) });
  pc.addTransceiver('video', { direction: 'recvonly' });
  pc.addTransceiver('audio', { direction: 'recvonly' });
  // audio i video mogu stici kao dva razlicita toka; zato se svaka staza dodaje u isti tok
  const received = new MediaStream();
  pc.ontrack = (ev) => {
    received.addTrack(ev.track);
    if (video.srcObject !== received) video.srcObject = received;
  };
  try {
    const close = await negotiate(pc, endpoint, onState);
    return {
      stop: () => {
        close();
        video.srcObject = null;
      },
    };
  } catch (e) {
    pc.close();
    throw e;
  }
}

// Kodeci za slanje: 'auto' stavlja H.264 (video) odnosno Opus (audio) prvi, a konkretan odabir
// salje samo taj kodek. Mora se postaviti prije dogovora ponude.
function applyCodecs(pc, choice = {}) {
  for (const t of pc.getTransceivers()) {
    const kind = t.sender.track?.kind;
    const caps = kind && globalThis.RTCRtpSender?.getCapabilities?.(kind);
    if (!caps || !t.setCodecPreferences) continue;
    const isVideo = kind === 'video';
    t.setCodecPreferences(
      orderCodecs(caps.codecs, isVideo ? choice.video : choice.audio, isVideo ? 'H264' : 'opus'),
    );
  }
}

// Slanje: salje MediaStream s kamere; vraca { stop, setLevel, readStats }.
// setLevel mijenja bitrate i velicinu slike bez prekida veze, readStats mjeri kvalitetu mreze.
export async function whipPublish(endpoint, stream, onState, codecs = {}) {
  const pc = new RTCPeerConnection({ iceServers: await iceServers(endpoint) });
  for (const track of stream.getTracks()) pc.addTrack(track, stream);
  applyCodecs(pc, codecs);
  const sender = pc.getSenders().find((x) => x.track?.kind === 'video');
  try {
    const stop = await negotiate(pc, endpoint, onState);
    return {
      stop,
      async setLevel(level, captureHeight) {
        if (!sender) return;
        const params = sender.getParameters();
        if (!params.encodings?.length) params.encodings = [{}];
        params.encodings[0].maxBitrate = BITRATE[level];
        params.encodings[0].scaleResolutionDownBy = scaleFor(level, captureHeight);
        // zadrzi trazenu rezoluciju umjesto da je preglednik sam smanjuje (pada broj sličica)
        params.degradationPreference = 'maintain-resolution';
        await sender.setParameters(params);
      },
      async readStats() {
        let loss = 0;
        let sent = null;
        const codecs = new Map();
        const report = await pc.getStats();
        report.forEach((r) => r.type === 'codec' && codecs.set(r.id, r.mimeType));
        report.forEach((r) => {
          if (r.kind !== 'video') return;
          if (r.type === 'remote-inbound-rtp') loss = r.fractionLost ?? 0;
          if (r.type === 'outbound-rtp') {
            sent = {
              bytes: r.bytesSent,
              frames: r.framesEncoded,
              w: r.frameWidth,
              h: r.frameHeight,
              codec: String(codecs.get(r.codecId) ?? '').replace(/^video\//, ''),
            };
          }
        });
        return { loss, sent };
      },
    };
  } catch (e) {
    pc.close();
    throw e;
  }
}
