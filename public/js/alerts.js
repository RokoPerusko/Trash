// Alarmi: nasi (ulaz/izlaz iz zone, nema javljanja, niska baterija) i stvarni alarmi iz OTS-a
// (GET /api/alerts, npr. 911 s TAK klijenta). Novi alarmi javljaju se obavijescu i, ako je
// ukljuceno, zvukom.
import { $, el, clear, ago, api, toast, beep, prefs, emptyState, icon } from './util.js';
import { themeVar } from './map.js';
import { splitAlerts, matchAlert } from './alert-filter.js';

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

// kategorije za filtriranje popisa
const CATEGORY = {
  enter: 'zone',
  exit: 'zone',
  'no-report': 'link',
  'low-battery': 'battery',
};
const CATEGORY_LABELS = {
  all: 'Svi',
  zone: 'Zone',
  link: 'Veza',
  battery: 'Baterija',
  ots: 'Hitni',
  muted: 'Utišano',
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
  let filter = 'all';
  let query = '';
  const loadSet = (key) => {
    try {
      return new Set(JSON.parse(prefs.get(key, '[]')));
    } catch {
      return new Set();
    }
  };
  const hidden = loadSet('alertsHidden'); // kljucevi alarma koje je korisnik uklonio s popisa
  const muted = loadSet('alertsMuted'); // uredjaji ciji se alarmi ne javljaju obavijescu
  const saveSet = (key, set, max) => prefs.set(key, JSON.stringify([...set].slice(-max)));

  const fromOwn = (a) => ({
    key: `own-${a.id}`,
    time: Date.parse(a.time) || 0,
    tone: OWN[a.type]?.tone || 'warn',
    title: a.message,
    tag: OWN[a.type]?.label,
    deviceName: a.deviceName,
    cat: CATEGORY[a.type] || 'link',
    when: a.time,
    deviceId: a.deviceId,
  });
  const fromOts = (a) => ({
    key: `ots-${a.id}-${a.active ? 'active' : 'cancelled'}`,
    time: Date.parse(a.startTime) || 0,
    tone: a.active ? 'bad' : 'ok',
    title: `${a.callsign || a.senderUid || 'Nepoznat uređaj'}: ${OTS_LABELS[a.alertType] || `alarm (${a.alertType})`}`,
    tag: a.active ? 'aktivan' : 'poništen',
    cat: 'ots',
    deviceName: a.callsign,
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

  const view = () => splitAlerts(rows, { hidden, muted });

  function renderChips(visible, mutedRows) {
    const counts = { all: visible.length, muted: mutedRows.length };
    for (const r of visible) counts[r.cat] = (counts[r.cat] || 0) + 1;
    const box = clear($('alertChips'));
    box.hidden = visible.length + mutedRows.length === 0;
    for (const key of Object.keys(CATEGORY_LABELS)) {
      if (key !== 'all' && !counts[key]) continue;
      box.append(
        el('button', {
          type: 'button',
          class: filter === key ? 'on' : '',
          text: `${CATEGORY_LABELS[key]} ${counts[key] || 0}`,
          onclick: () => {
            filter = key;
            render();
          },
        }),
      );
    }
  }

  function rowActions(r) {
    const buttons = [];
    if (r.deviceId) {
      const isMuted = muted.has(r.deviceId);
      buttons.push(
        el(
          'button',
          {
            type: 'button',
            class: 'icon-btn',
            title: isMuted ? 'Uključi obavijesti za uređaj' : 'Utišaj uređaj',
            onclick: (ev) => {
              ev.stopPropagation();
              if (isMuted) muted.delete(r.deviceId);
              else muted.add(r.deviceId);
              saveSet('alertsMuted', muted, 200);
              render();
              toast(
                isMuted
                  ? `Obavijesti za ${r.deviceName || 'uređaj'} su uključene`
                  : `${r.deviceName || 'Uređaj'} je utišan (vidi pod Utišano)`,
                'ok',
                2500,
              );
            },
          },
          icon(isMuted ? 'volume' : 'bell-off'),
        ),
      );
    }
    buttons.push(
      el(
        'button',
        {
          type: 'button',
          class: 'icon-btn',
          title: 'Ukloni s popisa',
          onclick: (ev) => {
            ev.stopPropagation();
            hidden.add(r.key);
            saveSet('alertsHidden', hidden, 400);
            render();
          },
        },
        icon('x'),
      ),
    );
    return el('div', { class: 'li-actions' }, buttons);
  }

  function render() {
    const list = clear($('alertList'));
    const { visible, mutedRows, hiddenCount } = view();
    if (filter !== 'all' && filter !== 'muted' && !visible.some((r) => r.cat === filter)) {
      filter = 'all';
    }
    if (filter === 'muted' && !mutedRows.length) filter = 'all';
    renderChips(visible, mutedRows);
    $('alertSearchRow').hidden = rows.length < 3 && !query;
    $('alertRestore').hidden = hiddenCount === 0;
    $('alertRestore').textContent = `Vrati uklonjene (${hiddenCount})`;
    $('alertClear').hidden = filter === 'muted' || !visible.length;
    $('alertTools').hidden = $('alertClear').hidden && $('alertRestore').hidden;

    const pool =
      filter === 'muted' ? mutedRows : visible.filter((r) => filter === 'all' || r.cat === filter);
    const shown = pool.filter((r) => matchAlert(r, query));
    if (!rows.length) {
      list.appendChild(
        emptyState({
          tag: 'li',
          icon: 'bell',
          title: 'Sve je mirno',
          text: 'Alarm se javlja kad objekt uđe u zonu ili izađe iz nje, kad baterija padne ispod praga, kad uređaj prestane javljati položaj ili kad netko pošalje hitni poziv (911) iz TAK klijenta.',
        }),
      );
    } else if (!shown.length) {
      list.appendChild(
        emptyState({
          tag: 'li',
          icon: 'bell',
          title: query ? 'Nema rezultata' : 'Nema alarma na popisu',
          text: query
            ? 'Probaj drugi naziv uređaja ili riječ.'
            : hiddenCount
              ? 'Uklonjeni alarmi se mogu vratiti gumbom iznad.'
              : '',
        }),
      );
    }
    for (const r of shown.slice(0, 80)) {
      list.appendChild(
        el(
          'li',
          { class: `alert${muted.has(r.deviceId) ? ' muted' : ''}`, onclick: () => open(r) },
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
          rowActions(r),
        ),
      );
    }
    // oznaka na izborniku: neprocitani alarmi + aktivni alarmi iz OTS-a (bez uklonjenih i utisanih)
    const panelOpen = app.nav.current() === 'alerts';
    if (panelOpen && visible.length) prefs.set('alertsSeenUntil', visible[0].time);
    const unread = panelOpen
      ? visible.filter((r) => r.active).length
      : visible.filter((r) => r.active || r.time > seenUntil()).length;
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
    const fresh = rows.filter(
      (r) => !known.has(r.key) && !hidden.has(r.key) && !(r.deviceId && muted.has(r.deviceId)),
    );
    for (const r of rows) known.add(r.key);
    if (!firstLoad) {
      for (const r of fresh.slice(0, 3)) toast(r.title, r.tone);
      if (fresh.length && $('soundToggle').checked) beep();
    }
    firstLoad = false;
    render();
  }

  $('alertSearch').addEventListener('input', (e) => {
    query = e.target.value;
    render();
  });
  $('alertClear').addEventListener('click', () => {
    for (const r of view().visible) hidden.add(r.key);
    saveSet('alertsHidden', hidden, 400);
    render();
  });
  $('alertRestore').addEventListener('click', () => {
    hidden.clear();
    saveSet('alertsHidden', hidden, 400);
    render();
  });

  return { sync, render };
}
