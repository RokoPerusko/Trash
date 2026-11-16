// WebRTC klijent za MediaMTX (koji koristi OTS): WHEP za gledanje i WHIP za slanje.
// Nema vanjskih biblioteka; ista razmjena SDP-a kao na MediaMTX-ovim stranicama.

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
  pc.ontrack = (ev) => {
    if (video.srcObject !== ev.streams[0]) video.srcObject = ev.streams[0];
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

// H.264 prvi: najsiri raspon uredjaja (iOS/Safari ga uvijek moze dekodirati)
function preferH264(pc) {
  const t = pc.getTransceivers().find((x) => x.sender.track?.kind === 'video');
  const caps = globalThis.RTCRtpSender?.getCapabilities?.('video');
  if (!t?.setCodecPreferences || !caps) return;
  const isH264 = (c) => /h264/i.test(c.mimeType);
  t.setCodecPreferences([...caps.codecs.filter(isH264), ...caps.codecs.filter((c) => !isH264(c))]);
}

// Slanje: salje MediaStream s kamere; vraca { stop }
export async function whipPublish(endpoint, stream, onState) {
  const pc = new RTCPeerConnection({ iceServers: await iceServers(endpoint) });
  for (const track of stream.getTracks()) pc.addTrack(track, stream);
  preferH264(pc);
  try {
    return { stop: await negotiate(pc, endpoint, onState) };
  } catch (e) {
    pc.close();
    throw e;
  }
}
