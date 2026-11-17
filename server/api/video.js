// Video streamovi iz OTS-a (MediaMTX): popis i adrese za gledanje i slanje u pregledniku.
import { OTS_PUBLIC_URL } from '../config.js';
import { sendJson, hasAppHeader, readJson } from '../http.js';
import { otsGet, otsSend } from '../ots.js';
import { BODY_LIMIT_SMALL } from '../config.js';
import { audit } from '../data.js';
import { qualityBook } from '../quality.js';

const enc = encodeURIComponent;

// brisanje streama (kao u OTS-ovom sucelju); smije samo stream koji OTS stvarno poznaje
async function deleteStream({ req, res, who, ip }) {
  if (!hasAppHeader(req)) return sendJson(res, { error: 'zabranjeno' }, 403);
  const parsed = await readJson(req, BODY_LIMIT_SMALL);
  if (parsed.error) return sendJson(res, { error: parsed.error }, parsed.status);
  const path = String(parsed.body.path ?? '');
  try {
    const list = await otsGet('/api/video_streams?per_page=100');
    if (!(list.json?.results || []).some((v) => v?.path === path)) {
      return sendJson(res, { error: 'stream nije pronaden' }, 404);
    }
    const r = await otsSend(
      'DELETE',
      `/api/mediamtx/stream/delete?${new URLSearchParams({ path })}`,
    );
    const ok = r.status >= 200 && r.status < 300;
    audit.record(who, ip, 'video.obrisan', { path, ok });
    return sendJson(
      res,
      ok ? { ok } : { ok, error: r.json?.error || `OTS: HTTP ${r.status}` },
      ok ? 200 : 502,
    );
  } catch (e) {
    return sendJson(res, { error: e.message }, 502);
  }
}

const PATH_RE = /^[A-Za-z0-9_.-]{1,80}$/;
const VIEWER_RE = /^[A-Za-z0-9_-]{6,40}$/;

// kvaliteta na zahtjev: gledatelj javlja zeli li HD, posiljatelj pita ima li takvih zahtjeva
async function handleQuality({ req, res, url }) {
  if (req.method === 'GET') {
    const path = url.searchParams.get('path') || '';
    if (!PATH_RE.test(path)) return sendJson(res, { error: 'neispravan stream' }, 400);
    return sendJson(res, qualityBook.status(path));
  }
  if (req.method === 'POST') {
    if (!hasAppHeader(req)) return sendJson(res, { error: 'zabranjeno' }, 403);
    const parsed = await readJson(req, BODY_LIMIT_SMALL);
    if (parsed.error) return sendJson(res, { error: parsed.error }, parsed.status);
    const { path, viewerId, hd } = parsed.body;
    if (!PATH_RE.test(String(path)) || !VIEWER_RE.test(String(viewerId))) {
      return sendJson(res, { error: 'neispravan zahtjev' }, 400);
    }
    qualityBook.request(String(path), String(viewerId), hd === true);
    return sendJson(res, { ok: true });
  }
  return false;
}

export async function handleVideo(ctx) {
  const { req, res, url } = ctx;
  if (url.pathname === '/api/video/quality') return handleQuality(ctx);
  if (url.pathname === '/api/video/delete' && req.method === 'POST') return deleteStream(ctx);
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
    // WebRTC (WHIP/WHEP) adrese: <publishBase><naziv>/whip|whep
    return sendJson(res, {
      streams,
      publishBase: `${OTS_PUBLIC_URL}/webrtc/`,
      hlsBase: `${OTS_PUBLIC_URL}/hls/`,
    });
  } catch (e) {
    return sendJson(res, { error: e.message }, 502);
  }
}
