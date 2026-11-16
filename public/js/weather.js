// Vrijeme za sredinu karte: mali znacaj u traci i kartica s detaljima i procjenom za dron.
import { $, el, clear, api, compass } from './util.js';

const REFRESH_MS = 10 * 60_000;
const MIN_MOVE_DEG = 0.1; // novi upit tek kad se karta pomakne ~10 km
const IDLE_MS = 1200;

const LEVEL_CLASS = { ok: 'ok', warn: 'warn', bad: 'bad' };
const hour = (t) => String(t).slice(11, 16);

export function createWeather(app) {
  const { viewer, Cesium } = app.map;
  const chip = $('weatherChip');
  const card = $('weatherCard');
  let data = null;
  let at = null; // { lat, lon, time } zadnjeg upita
  let timer = null;
  let busy = false;

  function center() {
    const c = viewer.canvas;
    const p = viewer.camera.pickEllipsoid(
      new Cesium.Cartesian2(c.clientWidth / 2, c.clientHeight / 2),
      viewer.scene.globe.ellipsoid,
    );
    const carto = p ? Cesium.Cartographic.fromCartesian(p) : viewer.camera.positionCartographic; // pogled prema horizontu: koristi poziciju kamere
    return {
      lat: Cesium.Math.toDegrees(carto.latitude),
      lon: Cesium.Math.toDegrees(carto.longitude),
    };
  }

  const row = (label, value) =>
    el('div', { class: 'wx-row' }, el('span', { text: label }), el('b', { text: value }));

  function render() {
    chip.hidden = !data;
    if (!data) return;
    chip.textContent = `${Math.round(data.tempC)}° ${data.text} · ${data.windMs} m/s`;
    chip.className = `chip wx-${LEVEL_CLASS[data.drone.level]}`;
    const d = data;
    clear(card).append(
      el(
        'div',
        { class: 'wx-top' },
        el('div', { class: 'wx-temp', text: `${Math.round(d.tempC)}°` }),
        el(
          'div',
          { class: 'grow' },
          el('div', { class: 'wx-text', text: d.text }),
          el('div', { class: 'wx-sub', text: `Osjeća se kao ${Math.round(d.feelsC)}°` }),
        ),
      ),
      el(
        'div',
        { class: `wx-drone ${LEVEL_CLASS[d.drone.level]}` },
        el('b', { text: `Dron: ${d.drone.text}` }),
        d.drone.reasons.length ? el('span', { text: d.drone.reasons.join(', ') }) : null,
      ),
      el(
        'div',
        { class: 'wx-grid' },
        row('Vjetar', `${d.windMs} m/s${d.windDir === null ? '' : ` (${compass(d.windDir)})`}`),
        row('Udari', `${d.gustMs} m/s`),
        row('Oborina', `${d.precipMm} mm`),
        row('Oblaci', d.cloudPct === null ? '-' : `${d.cloudPct} %`),
        row('Vidljivost', d.visibilityM === null ? '-' : `${(d.visibilityM / 1000).toFixed(1)} km`),
        row('Vlaga', d.humidity === null ? '-' : `${d.humidity} %`),
        row('Tlak', d.pressureHpa === null ? '-' : `${d.pressureHpa} hPa`),
      ),
      el(
        'div',
        { class: 'wx-hours' },
        d.hourly.map((h) =>
          el(
            'div',
            { class: 'wx-hour' },
            el('span', { text: hour(h.time) }),
            el('b', { text: `${Math.round(h.tempC)}°` }),
            el('span', { text: `${h.windMs} m/s` }),
            el('span', { class: 'wx-rain', text: h.precipProb === null ? '' : `${h.precipProb}%` }),
          ),
        ),
      ),
      el('p', {
        class: 'wx-note',
        text: `Za sredinu karte, ${at.lat.toFixed(2)}, ${at.lon.toFixed(2)}. Izvor: Open-Meteo. Procjena za dron je okvirna.`,
      }),
    );
  }

  async function load() {
    if (busy) return;
    busy = true;
    try {
      const p = center();
      if (Number.isFinite(p.lat) && Number.isFinite(p.lon)) {
        data = await api('GET', `/api/weather?lat=${p.lat.toFixed(3)}&lon=${p.lon.toFixed(3)}`);
        at = { ...p, time: Date.now() };
      }
    } catch {
      /* ostaje zadnje poznato vrijeme */
    }
    busy = false;
    render();
  }

  const moved = () => {
    if (!at) return true;
    const p = center();
    return Math.abs(p.lat - at.lat) > MIN_MOVE_DEG || Math.abs(p.lon - at.lon) > MIN_MOVE_DEG;
  };
  viewer.camera.moveEnd.addEventListener(() => {
    clearTimeout(timer);
    timer = setTimeout(() => moved() && load(), IDLE_MS);
  });
  setInterval(load, REFRESH_MS);

  chip.addEventListener('click', (ev) => {
    ev.stopPropagation();
    card.hidden = !card.hidden;
  });
  document.addEventListener('click', (ev) => {
    if (!card.hidden && !card.contains(ev.target)) card.hidden = true;
  });

  setTimeout(load, 2500); // nakon sto se karta postavi na pocetni pogled
  return { load };
}
