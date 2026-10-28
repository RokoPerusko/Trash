// Povijest uredjaja: trag po terenu i reprodukcija (klizac vremena, brzina 1x/10x/60x).
import { $, el, clear, icon, fmtClock, api } from './util.js';
import { themeColor } from './map.js';

const GAP_MS = 5 * 60 * 1000; // iznad ovoga smatramo da je signal bio u prekidu

export function createHistory(app) {
  const { Cesium, viewer } = app.map;
  const msg = $('dMsg');
  let hist = null; // { uid, points, valid, min, max }
  let time = 0;
  let playing = false;
  let speedMult = 1;
  let timer = null;
  const trail = [];

  const setPlayIcon = () => $('histPlay').replaceChildren(icon(playing ? 'pause' : 'play'));
  const fail = (text) => {
    msg.className = 'err';
    msg.textContent = text;
  };

  function clearTrail() {
    for (const e of trail) viewer.entities.remove(e);
    trail.length = 0;
  }
  const toCartesian = (p) => Cesium.Cartesian3.fromDegrees(p.lon, p.lat, p.alt || 0);
  const addSegment = (seg) =>
    viewer.entities.add({
      polyline: {
        positions: seg.map(toCartesian),
        width: 3,
        material: themeColor('--accent', '#5aa0ff').withAlpha(0.85),
        clampToGround: true,
      },
    });

  function buildTrail(valid) {
    clearTrail();
    let seg = [valid[0]];
    for (let i = 1; i < valid.length; i++) {
      if (valid[i].t - valid[i - 1].t > GAP_MS) {
        if (seg.length > 1) trail.push(addSegment(seg));
        seg = [];
      }
      seg.push(valid[i]);
    }
    if (seg.length > 1) trail.push(addSegment(seg));
  }

  function pointAt(t) {
    let best = null;
    for (const p of hist.valid) {
      if (p.t <= t) best = p;
      else break;
    }
    return best || hist.valid[0];
  }

  function updateFrame() {
    if (!hist) return;
    time = Math.min(Math.max(time, hist.min), hist.max);
    const p = pointAt(time);
    const gap = time - p.t > GAP_MS;
    $('histSlider').value = String(time);
    $('histTime').textContent = fmtClock(time) + (gap ? ' · nema signala' : '');
    $('histTime').className = gap ? 'warn' : '';
    const e = app.items.entities.get(hist.uid);
    if (e) e.position = toCartesian(p);
    if (app.items.selectedId() === hist.uid) {
      const rows = [
        ['Vrijeme (povijest)', fmtClock(p.t) + (gap ? ' · nema signala' : '')],
        ['Položaj', `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`],
        ['Visina', p.alt !== null ? `${Math.round(p.alt)} m` : null],
        ['Brzina', p.speed !== null ? `${p.speed.toFixed(1)} m/s` : null],
        ['Smjer', p.course !== null ? `${Math.round(p.course)}°` : null],
        ['Baterija', p.battery !== null ? `${p.battery}%` : null],
      ].filter(([, v]) => v);
      const dl = clear($('dInfo'));
      for (const [k, v] of rows) dl.append(el('dt', { text: k }), el('dd', { text: v }));
    }
  }

  function stopPlayback() {
    playing = false;
    setPlayIcon();
    if (timer) clearInterval(timer);
    timer = null;
  }

  async function enter(it) {
    msg.textContent = '';
    msg.className = '';
    let data;
    try {
      data = await api('GET', `/api/history?uid=${encodeURIComponent(it.id)}`);
    } catch (e) {
      fail(`Greška povijesti: ${e.message}`);
      return;
    }
    const valid = (data.points || []).filter((p) => p.valid);
    if (!valid.length) {
      fail('Nema valjanih točaka povijesti za ovaj uređaj.');
      return;
    }
    exit();
    hist = {
      uid: it.id,
      points: data.points,
      valid,
      min: valid[0].t,
      max: valid[valid.length - 1].t,
    };
    buildTrail(valid);
    $('histSlider').min = String(hist.min);
    $('histSlider').max = String(hist.max);
    time = hist.max;
    $('histBar').hidden = false;
    updateFrame();
  }

  function exit() {
    if (!hist) return;
    stopPlayback();
    clearTrail();
    hist = null;
    $('histBar').hidden = true;
    const it = app.items.selected();
    if (it) app.items.fillDetail(it);
  }

  $('dHistory').addEventListener('click', () => {
    const it = app.items.selected();
    if (it) enter(it);
  });
  $('histLive').addEventListener('click', exit);
  $('histSlider').addEventListener('input', (e) => {
    stopPlayback();
    time = Number(e.target.value);
    updateFrame();
  });
  $('histSpeed').addEventListener('change', (e) => {
    speedMult = Number(e.target.value);
  });
  $('histPlay').addEventListener('click', () => {
    if (!hist) return;
    if (playing) return stopPlayback();
    playing = true;
    setPlayIcon();
    timer = setInterval(() => {
      time += 200 * speedMult;
      if (time >= hist.max) {
        time = hist.max;
        updateFrame();
        stopPlayback();
        return;
      }
      updateFrame();
    }, 200);
  });

  return { exit, activeFor: () => hist?.uid ?? null };
}
