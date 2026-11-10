// Video streamovi iz OTS-a (MediaMTX): popis i adrese za gledanje i slanje u pregledniku.
import { OTS_PUBLIC_URL } from '../config.js';
import { sendJson } from '../http.js';
import { otsGet } from '../ots.js';

const enc = encodeURIComponent;

export async function handleVideo({ res, url }) {
  if (url.pathname !== '/api/video') return false;
  try {
    const r = await otsGet('/api/video_streams?per_page=100');
    if (r.status >= 400) return sendJson(res, { error: `OTS: HTTP ${r.status}` }, 502);
    const streams = (r.json?.results || [])
      .filter((v) => v?.path)
      .map((v) => ({
        id: String(v.uid || v.path),
        name: String(v.alias || v.path),
        path: String(v.path),
        ready: v.ready === true,
        protocol: v.protocol || null,
        viewUrl: `${OTS_PUBLIC_URL}/webrtc/${enc(v.path)}/`,
        hlsUrl: `${OTS_PUBLIC_URL}/hls/${enc(v.path)}/`,
        rtspUrl: v.rtsp_link || null,
      }));
    // stranica za slanje videa iz preglednika: <webrtcBase><naziv>/publish
    return sendJson(res, { streams, publishBase: `${OTS_PUBLIC_URL}/webrtc/` });
  } catch (e) {
    return sendJson(res, { error: e.message }, 502);
  }
}
