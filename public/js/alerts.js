// Alarmi: nasi (ulaz/izlaz iz zone, nema javljanja, niska baterija) i stvarni alarmi iz OTS-a
// (GET /api/alerts, npr. 911 s TAK klijenta). Novi alarmi javljaju se obavijescu i, ako je
// ukljuceno, zvukom.
import { $, el, clear, ago, api, toast, beep, prefs } from './util.js';
import { themeVar } from './map.js';

const OWN = {
  enter: { tone: 'ok', label: 'Ulaz u zonu' },
  exit: { tone: 'warn', label: 'Izlaz iz zone' },
  'no-report': { tone: 'bad', label: 'Nema javljanja' },
  'low-battery': { tone: 'warn', label: 'Niska baterija' },
};
// poznate oznake CoT alarma; ostale se prikazuju sirove
const OTS_LABELS = {
  'b-a-o-tbl': 'Hitni poziv (911)',
  'b-a-o-pan': 'Ring the bell',
  'b-a-o-opn': 'Troops in contact',
  'b-a-o-can': 'Alarm poništen',
};

const toneColor = (tone) =>
  tone === 'ok'
    ? themeVar('--ok', '#3fcf8e')
    : tone === 'bad'
      ? themeVar('--danger', '#e5484d')
      : themeVar('--warn', '#f5b942');

export function createAlerts(app) {
  const known = new Set();
  let firstLoad = true;
  let rows = [];

  const fromOwn = (a) => ({
    key: `own-${a.id}`,
    time: Date.parse(a.time) || 0,
    tone: OWN[a.type]?.tone || 'warn',
    title: a.message,
    tag: OWN[a.type]?.label,
    when: a.time,
    deviceId: a.deviceId,
  });
  const fromOts = (a) => ({
    key: `ots-${a.id}-${a.active ? 'active' : 'cancelled'}`,
    time: Date.parse(a.startTime) || 0,
    tone: a.active ? 'bad' : 'ok',
    title: `${a.callsign || a.senderUid || 'Nepoznat uređaj'}: ${OTS_LABELS[a.alertType] || `alarm (${a.alertType})`}`,
    tag: a.active ? 'aktivan' : 'poništen',
    active: a.active,
    when: a.startTime,
    deviceId: a.senderUid,
    lat: a.lat,
    lon: a.lon,
  });

  function open(row) {
    if (row.deviceId && app.items.get(row.deviceId)) {
      app.items.select(row.deviceId, true);
      return;
    }
    if (row.lat !== null && row.lat !== undefined) {
      const { Cesium, viewer } = app.map;
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(row.lon, row.lat, 1500),
        duration: 1.2,
      });
    }
  }

  const seenUntil = () => Number(prefs.get('alertsSeenUntil', 0));

  function render() {
    const list = clear($('alertList'));
    if (!rows.length) {
      list.appendChild(el('li', { class: 'empty', text: 'Nema alarma.' }));
    }
    for (const r of rows.slice(0, 80)) {
      list.appendChild(
        el(
          'li',
          { class: 'alert', onclick: () => open(r) },
          el('span', { class: 'adot', style: `background:${toneColor(r.tone)}` }),
          el(
            'div',
            { class: 'grow' },
            el(
              'div',
              {},
              r.title,
              r.tag ? el('span', { class: `tag${r.active ? ' active' : ''}`, text: r.tag }) : null,
            ),
            el('div', { class: 'sub', text: ago(r.when) || '' }),
          ),
        ),
      );
    }
    // oznaka na izborniku: neprocitani alarmi + aktivni alarmi iz OTS-a
    const panelOpen = app.nav.current() === 'alerts';
    if (panelOpen && rows.length) prefs.set('alertsSeenUntil', rows[0].time);
    const unread = panelOpen
      ? rows.filter((r) => r.active).length
      : rows.filter((r) => r.active || r.time > seenUntil()).length;
    const badge = $('alertsBadge');
    badge.hidden = unread === 0;
    badge.textContent = String(unread);
  }

  async function sync() {
    let data;
    try {
      data = await api('GET', '/api/alerts?limit=80');
    } catch {
      return; // zadrzi zadnje poznato stanje
    }
    rows = [...(data.alerts || []).map(fromOwn), ...(data.ots || []).map(fromOts)].sort(
      (a, b) => b.time - a.time,
    );
    const fresh = rows.filter((r) => !known.has(r.key));
    for (const r of rows) known.add(r.key);
    if (!firstLoad) {
      for (const r of fresh.slice(0, 3)) toast(r.title, r.tone);
      if (fresh.length && $('soundToggle').checked) beep();
    }
    firstLoad = false;
    render();
  }

  return { sync, render };
}
