// Objekti s OTS-a (uredjaji, dronovi, markeri): ikone na karti, popis s pretragom i
// filterima, kartica detalja i osvjezavanje stanja. Vrste objekata definirane su u kinds.js.
import { $, el, clear, ago, compass, api, prefs } from './util.js';
import { formatDuration } from './geo.js';
import { KINDS, kindOf, isAirType } from './kinds.js';

const COLORS = { f: '#4cc9f0', h: '#ff5d5d', n: '#5dd39e', u: '#ffd166' };
const AFFIL = { f: 'Prijatelj', h: 'Neprijatelj', n: 'Neutralno', u: 'Nepoznato' };
const OFFLINE_COLOR = '#7d889d';
const EXPIRY_WARN_MS = 2 * 60 * 60 * 1000; // upozori ako marker istice za manje od 2 h
const ICON_PX = 36;
const RECENT_REPORT_MS = 5 * 60 * 1000; // polozaj mladi od ovoga znaci da uredjaj javlja
const MARKER_TTL_MS = 24 * 3600 * 1000; // OTS postavlja rok markera na "sada + 24 h"
const CLOCK_WARN_MS = 5 * 60 * 1000; // upozori ako se sat OTS-a razlikuje vise od 5 min

const affil = (t) => /^a-([fhnu])/.exec(String(t || ''))?.[1];

export function createItems(app) {
  const { Cesium, viewer, hasToken } = app.map;
  const entities = new Map();
  const iconCache = new Map();
  let items = [];
  let selectedId = null;
  let filter = 'all';
  let query = '';
  let showStale = false;
  let showOffline = prefs.get('showOffline') === '1';
  const offlineHideMs = (app.cfg.offlineHideHours || 24) * 3600 * 1000;
  let firstFit = true;
  let chipSignature = '';

  const kind = (it) => it.kind || kindOf(it, { markersPath: app.markersPath });
  // OTS zna oznaciti uredjaj kao "Disconnected" iako mu polozaji i dalje stizu (npr. nakon
  // skoka sata ili ponovnog spajanja), pa svjez polozaj ima prednost pred statusom
  const reportedRecently = (it) => Date.now() - (Date.parse(it.posTime) || 0) < RECENT_REPORT_MS;
  const offline = (it) =>
    it.info?.Status && it.info.Status !== 'Connected' && !reportedRecently(it);
  const itemColor = (it) => (offline(it) ? OFFLINE_COLOR : COLORS[affil(it.type)] || '#d5dbe8');
  const isStale = (it) => kind(it) === 'marker' && it.stale && Date.parse(it.stale) < Date.now();
  // uredjaj koji je odspojen i ne javlja dulje od praga (OTS ga ne brise, pa ostaje na zadnjem
  // poznatom polozaju); skriva se osim ako je ukljucen prikaz odspojenih
  const isLongOffline = (it) =>
    kind(it) !== 'marker' &&
    offline(it) &&
    Date.now() - (Date.parse(it.time) || Date.now()) > offlineHideMs;
  const isVisible = (it) => (showStale || !isStale(it)) && (showOffline || !isLongOffline(it));
  const isAir = (it) => KINDS[kind(it)]?.air || isAirType(it.type);

  function typeLabel(it) {
    const a = AFFIL[affil(it.type)];
    const air = isAir(it) && kind(it) !== 'uav' ? 'zračni' : '';
    return [KINDS[kind(it)]?.label || 'Objekt', a, air].filter(Boolean).join(' · ');
  }

  // ---------- ikone na karti: oblik ovisi o vrsti, boja o afilijaciji ----------
  function shapeIcon(shape, color, selected) {
    const key = `${shape}|${color}|${selected ? 1 : 0}`;
    if (iconCache.has(key)) return iconCache.get(key);
    const scale = 2;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = ICON_PX * scale;
    const g = canvas.getContext('2d');
    g.scale(scale, scale);
    const c = ICON_PX / 2;
    g.lineJoin = 'round';
    g.lineWidth = 2.5;
    g.strokeStyle = '#ffffff';
    g.fillStyle = color;
    if (selected) {
      g.save();
      g.strokeStyle = 'rgba(90,160,255,0.95)';
      g.lineWidth = 3;
      g.beginPath();
      g.arc(c, shape === 'pin' ? c - 3 : c, 15, 0, Math.PI * 2);
      g.stroke();
      g.restore();
    }
    g.beginPath();
    if (shape === 'pin') {
      g.moveTo(c, 33);
      g.bezierCurveTo(c - 11, 20, c - 8, 5, c, 5);
      g.bezierCurveTo(c + 8, 5, c + 11, 20, c, 33);
    } else if (shape === 'diamond') {
      g.moveTo(c, 4);
      g.lineTo(c + 10, 30);
      g.lineTo(c, 24);
      g.lineTo(c - 10, 30);
    } else {
      g.arc(c, c, 8, 0, Math.PI * 2);
    }
    g.closePath();
    g.fill();
    g.stroke();
    if (shape === 'pin') {
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.arc(c, 14, 3, 0, Math.PI * 2);
      g.fill();
    }
    iconCache.set(key, canvas);
    return canvas;
  }

  function upsert(item) {
    const k = KINDS[kind(item)] || KINDS.device;
    const air = isAir(item) && item.alt !== null;
    const position = Cesium.Cartesian3.fromDegrees(item.lon, item.lat, air ? item.alt : 0);
    const hRef = air ? Cesium.HeightReference.NONE : Cesium.HeightReference.CLAMP_TO_GROUND;
    const image = shapeIcon(k.shape, itemColor(item), item.id === selectedId);
    const course = item.telemetry?.course;
    const rotation =
      k.shape === 'diamond' && Number.isFinite(course) ? -Cesium.Math.toRadians(course) : 0;
    const vertical =
      k.shape === 'pin' ? Cesium.VerticalOrigin.BOTTOM : Cesium.VerticalOrigin.CENTER;
    const labelY = k.shape === 'pin' ? -40 : -26;
    let e = entities.get(item.id);
    if (!e) {
      e = viewer.entities.add({
        id: item.id,
        position,
        billboard: {
          image,
          width: ICON_PX,
          height: ICON_PX,
          rotation,
          verticalOrigin: vertical,
          heightReference: hRef,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: item.name,
          font: '600 13px system-ui, sans-serif',
          fillColor: Cesium.Color.WHITE,
          showBackground: true,
          backgroundColor: Cesium.Color.fromCssColorString('rgba(15,20,32,0.78)'),
          backgroundPadding: new Cesium.Cartesian2(7, 4),
          pixelOffset: new Cesium.Cartesian2(0, labelY),
          heightReference: hRef,
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 60000),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
      entities.set(item.id, e);
    } else {
      e.position = position;
      e.billboard.image = image;
      e.billboard.rotation = rotation;
      e.billboard.verticalOrigin = vertical;
      e.billboard.heightReference = hRef;
      e.label.heightReference = hRef;
      e.label.text = item.name;
      e.label.pixelOffset = new Cesium.Cartesian2(0, labelY);
    }
  }

  function removeEntity(id) {
    const e = entities.get(id);
    if (e) viewer.entities.remove(e);
    entities.delete(id);
  }

  // ---------- popis ----------
  function renderChips() {
    const counts = new Map();
    for (const it of items.filter(isVisible)) counts.set(kind(it), (counts.get(kind(it)) || 0) + 1);
    const present = Object.keys(KINDS).filter((k) => counts.has(k));
    const signature = `${filter}|${present.map((k) => `${k}${counts.get(k)}`).join()}`;
    if (signature === chipSignature) return;
    chipSignature = signature;
    if (filter !== 'all' && !counts.has(filter)) filter = 'all';
    const box = clear($('chips'));
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    const make = (key, label, n) =>
      el('button', {
        type: 'button',
        class: filter === key ? 'on' : '',
        text: `${label} ${n}`,
        onclick: () => {
          filter = key;
          chipSignature = '';
          renderList();
        },
      });
    box.appendChild(make('all', 'Sve', total));
    for (const k of present) box.appendChild(make(k, KINDS[k].plural, counts.get(k)));
  }

  function renderList() {
    renderChips();
    const q = query.trim().toLowerCase();
    const shown = items
      .filter(isVisible)
      .filter((it) => filter === 'all' || kind(it) === filter)
      .filter(
        (it) => !q || it.name.toLowerCase().includes(q) || String(it.id).toLowerCase().includes(q),
      );
    const list = clear($('list'));
    if (!shown.length) {
      list.appendChild(
        el('li', {
          class: 'empty',
          text: items.length ? 'Nema rezultata.' : 'Nema objekata na serveru.',
        }),
      );
      return;
    }
    for (const it of shown) {
      const warn = expiryInfo(it)[1];
      const battery = it.telemetry?.battery;
      const sub = [typeLabel(it)];
      if (Number.isFinite(battery)) sub.push(`${Math.round(battery)} %`);
      list.appendChild(
        el(
          'li',
          { class: it.id === selectedId ? 'sel' : '', onclick: () => select(it.id, true) },
          el('span', { class: `dot${warn ? ' warn' : ''}`, style: `background:${itemColor(it)}` }),
          el(
            'div',
            { class: 'grow' },
            el('div', { class: 'nm', text: it.name }),
            el('div', { class: 'sub', text: sub.join(' · ') }),
          ),
        ),
      );
    }
  }

  // ---------- detalji ----------
  function expiryInfo(it) {
    if (!it.stale) return [null, false];
    if (isStale(it)) return ['istekao', true];
    const left = Date.parse(it.stale) - Date.now();
    const when = new Date(it.stale).toLocaleString('hr-HR');
    if (kind(it) === 'marker' && left >= 0 && left < EXPIRY_WARN_MS) {
      const mins = Math.max(1, Math.round(left / 60000));
      const t = mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60} min` : `${mins} min`;
      return [`${when} · uskoro istječe (za ${t})`, true];
    }
    return [when, false];
  }

  const aglCache = new Map();
  async function groundAt(lat, lon) {
    const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
    if (aglCache.has(key)) return aglCache.get(key);
    const heights = await app.map.sampleTerrain([
      new Cesium.Cartographic(Cesium.Math.toRadians(lon), Cesium.Math.toRadians(lat)),
    ]);
    const h = heights?.[0] ?? null;
    if (aglCache.size > 200) aglCache.clear();
    aglCache.set(key, h);
    return h;
  }

  function setDetailRows(rows) {
    const dl = clear($('dInfo'));
    let aglCell = null;
    for (const [k, v, warn, isAgl] of rows) {
      const dd = el('dd', { class: warn ? 'warn' : '', text: v });
      if (isAgl) aglCell = dd;
      dl.append(el('dt', { text: k }), dd);
    }
    return aglCell;
  }

  function fillDetail(it) {
    $('dName').textContent = it.name;
    $('dBadge').textContent = typeLabel(it);
    $('dDot').style.background = itemColor(it);
    const [expText, expWarn] = expiryInfo(it);
    const t = it.telemetry || {};
    const rows = [
      ...Object.entries(it.info || {}),
      Number.isFinite(t.speed)
        ? ['Brzina', `${(t.speed * 3.6).toFixed(1)} km/h (${t.speed.toFixed(1)} m/s)`]
        : null,
      Number.isFinite(t.course) ? ['Smjer', `${Math.round(t.course)}° ${compass(t.course)}`] : null,
      ['Položaj', `${it.lat.toFixed(5)}, ${it.lon.toFixed(5)}`],
      it.alt !== null ? ['Visina (HAE)', `${Math.round(it.alt)} m`] : null,
      isAir(it) && it.alt !== null && hasToken ? ['Visina nad tlom', '…', false, true] : null,
      [kind(it) === 'marker' ? 'Postavljen' : 'Zadnje javljanje', ago(it.time)],
      ['Položaj od', it.posTime ? ago(it.posTime) : null],
      ['Istječe', expText, expWarn],
      ['CoT tip', it.type],
      ['ID', it.id],
    ].filter((r) => r && r[1]);
    const aglCell = setDetailRows(rows);
    if (aglCell) {
      const id = it.id;
      groundAt(it.lat, it.lon).then((ground) => {
        if (selectedId !== id) return;
        aglCell.textContent = ground === null ? 'nepoznato' : `${Math.round(it.alt - ground)} m`;
      });
    }
    $('dPre').textContent = JSON.stringify(
      { izvori: it.from || [], sirovi_odgovori: it.raws || {} },
      null,
      2,
    );
    const k = KINDS[kind(it)] || KINDS.device;
    $('dDelete').hidden = !k.editable;
    $('dRename').hidden = !k.editable;
    $('dHistory').hidden = !k.history;
  }

  function select(id, fly) {
    if (app.history?.activeFor() && app.history.activeFor() !== id) app.history.exit();
    const previous = selectedId;
    selectedId = id;
    const it = items.find((i) => i.id === id);
    if (!it) {
      deselect();
      return;
    }
    $('detail').hidden = false;
    $('dMsg').textContent = '';
    $('dMsg').className = '';
    fillDetail(it);
    if (previous && previous !== id) {
      const prev = items.find((i) => i.id === previous);
      if (prev && isVisible(prev)) upsert(prev);
    }
    upsert(it);
    const e = entities.get(id);
    if (e && viewer.selectedEntity !== e) viewer.selectedEntity = e;
    if (fly && e) flyTo(e);
    renderList();
  }

  function deselect() {
    if (app.history?.activeFor()) app.history.exit();
    const previous = items.find((i) => i.id === selectedId);
    selectedId = null;
    $('detail').hidden = true;
    if (previous && entities.has(previous.id)) upsert(previous);
    if (viewer.selectedEntity) viewer.selectedEntity = undefined;
    renderList();
  }

  const flyTo = (e) =>
    viewer.flyTo(e, {
      duration: 1.2,
      offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-40), 400),
    });

  viewer.selectedEntityChanged.addEventListener((e) => {
    if (e) {
      if (items.some((i) => i.id === String(e.id)) && String(e.id) !== selectedId) {
        select(String(e.id), false);
      }
    } else if (selectedId) deselect();
  });

  function fitAll() {
    if (!entities.size) return;
    viewer.flyTo([...entities.values()], {
      duration: 1.5,
      offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-45), 0),
    });
  }

  // ---------- osvjezavanje ----------
  function setPill(cls, text) {
    $('pill').className = `pill ${cls}`;
    $('pillText').textContent = text;
  }
  function setBanner(text) {
    $('banner').hidden = !text;
    $('banner').textContent = text || '';
  }

  async function poll() {
    try {
      const s = await api('GET', '/api/state');
      items = s.items || [];
      const visible = items.filter(isVisible);
      const seen = new Set();
      for (const it of visible) {
        seen.add(it.id);
        if (app.history?.activeFor() === it.id) continue; // polozaj se prikazuje iz povijesti
        upsert(it);
      }
      for (const id of [...entities.keys()]) if (!seen.has(id)) removeEntity(id);

      const failed = Object.entries(s.sources || {}).filter(([, v]) => v.error || v.status >= 400);
      const total = Object.keys(s.sources || {}).length;
      if (failed.length && failed.length === total) {
        setPill('bad', 'OTS nedostupan');
        setBanner(s.error || 'Server ne odgovara. Provjeri vezu i prijavu u .env.');
      } else {
        setPill('ok', `${visible.length} ${visible.length === 1 ? 'objekt' : 'objekata'}`);
        const warnings = [];
        if (failed.length) warnings.push(`Ne radi: ${failed.map(([p]) => p).join(', ')}`);
        if (!hasToken) warnings.push('Nema CESIUM_ION_TOKEN: ravna karta bez terena i zgrada.');
        const skew = Math.abs(s.clockSkewMs || 0);
        if (skew > CLOCK_WARN_MS) {
          const dir = s.clockSkewMs > 0 ? 'kasni' : 'žuri';
          // OTS stavlja marker na rok "OTS sada + 24 h"; klijenti ga odbacuju tek ako sat kasni oko 24 h
          const expires = s.clockSkewMs > 0 && skew > MARKER_TTL_MS - CLOCK_WARN_MS;
          warnings.push(
            `Sat OTS servera ${dir} ${formatDuration(skew / 1000)}.` +
              (expires
                ? ' TAK klijenti (iTAK/ATAK) markere postavljene iz aplikacije vide kao istekle.'
                : ' Vremena na OTS-u neće se podudarati s ostalim uređajima.') +
              ' Uskladi sat OTS računala (NTP).',
          );
        }
        if (Object.values(s.sources || {}).some((v) => v.truncated)) {
          warnings.push('Popis na OTS-u je predug, prikazana je samo prva količina zapisa.');
        }
        setBanner(warnings.join(' · '));
      }
      $('upd').textContent = `Osvježeno ${new Date().toLocaleTimeString('hr-HR')}`;
      if (selectedId && app.history?.activeFor() !== selectedId) {
        const it = items.find((i) => i.id === selectedId);
        if (it && isVisible(it)) fillDetail(it);
        else deselect();
      }
      renderList();
      if (firstFit && items.length) {
        firstFit = false;
        fitAll();
      }
    } catch (e) {
      setPill('bad', 'Backend nedostupan');
      setBanner(e.message);
    }
  }

  // ---------- kontrole ----------
  $('search').addEventListener('input', (e) => {
    query = e.target.value;
    renderList();
  });
  function applyVisibility() {
    for (const it of items) {
      if (isVisible(it)) upsert(it);
      else removeEntity(it.id);
    }
    if (selectedId && !isVisible(items.find((i) => i.id === selectedId) || {})) deselect();
    else renderList();
  }
  $('staleToggle').addEventListener('change', (e) => {
    showStale = e.target.checked;
    applyVisibility();
  });
  $('offlineToggle').checked = showOffline;
  $('offlineToggle').addEventListener('change', (e) => {
    showOffline = e.target.checked;
    prefs.set('showOffline', showOffline ? '1' : '0');
    applyVisibility();
  });
  $('dClose').addEventListener('click', deselect);
  $('dFly').addEventListener('click', () => {
    const e = entities.get(selectedId);
    if (e) flyTo(e);
  });
  $('toolFit').addEventListener('click', fitAll);

  return {
    poll,
    select,
    deselect,
    fitAll,
    fillDetail,
    upsert,
    flyTo,
    entities,
    kind,
    isVisible,
    get: (id) => items.find((i) => i.id === id),
    all: () => items,
    selectedId: () => selectedId,
    selected: () => items.find((i) => i.id === selectedId),
  };
}
